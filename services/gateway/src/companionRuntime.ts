import { randomUUID } from 'node:crypto';
import { companionContextSchema, type GenerateRequest } from '@nova-chat/protocol';
import { analyzeCompanionTurn } from './companionState.js';
import type { AppDatabase } from './database.js';
import type { ModelProvider, ProviderLogger } from './provider.js';
import { toPublicError } from './errors.js';

/** Durable deliveries and one bounded proactive sweep, owned by the gateway lifecycle. */
export class CompanionRuntime {
  private stopped = false;
  private proactiveRunning = false;
  private readonly operations = new Map<AbortController, Promise<void>>();
  private readonly deliveryTimer: ReturnType<typeof setInterval>;
  private readonly proactiveTimer: ReturnType<typeof setInterval>;

  constructor(private readonly database: AppDatabase, private readonly provider: ModelProvider, private readonly logger: ProviderLogger) {
    database.recoverInterruptedCompanionDeliveries();
    this.deliveryTimer = setInterval(() => this.deliverDue(), 5_000);
    this.proactiveTimer = setInterval(() => this.startProactiveSweep(), 60_000);
    this.deliveryTimer.unref();
    this.proactiveTimer.unref();
  }

  deliverDue() {
    if (this.stopped || this.operations.size >= 4) return;
    for (const delivery of this.database.claimCompanionDeliveries(Date.now(), 4 - this.operations.size)) {
      const controller = new AbortController();
      const operation = this.deliver(delivery, controller).finally(() => this.operations.delete(controller));
      this.operations.set(controller, operation);
    }
  }

  private async deliver(delivery: { userId: string; kind: 'photo' | 'reply'; payload: GenerateRequest }, controller: AbortController) {
    const { userId, payload, kind } = delivery;
    const companionId = payload.companionId!;
    try {
      const profile = this.database.getCompanion(userId, companionId);
      if (!profile || this.database.getUserById(userId)?.disabled) return;
      const thread = this.database.getCompanionThread(userId, companionId, payload.conversationId);
      const originalUser = payload.messages.filter(message => message.role === 'user').at(-1)?.content;
      const latestUser = thread?.messages.filter(message => message.role === 'user').at(-1)?.content;
      if (kind === 'photo' && thread && analyzeCompanionTurn(thread.messages).scene === 'safety') return;
      if (kind === 'reply' && (latestUser !== originalUser || this.database.latestCompanionUserTurnId(userId, companionId, payload.conversationId) !== payload.requestId)) return;
      if (kind === 'photo' && latestUser !== originalUser && /别发|不用发|不要发/u.test(latestUser ?? '')) return;
      const request = { ...payload, companion: companionContextSchema.strip().parse(profile) };
      const result = await this.provider.generate(request, { id: userId }, controller.signal, () => undefined);
      if (this.stopped || !this.database.getCompanion(userId, companionId) || this.database.getUserById(userId)?.disabled) return;
      const latest = this.database.getCompanionThread(userId, companionId, payload.conversationId);
      const currentUser = latest?.messages.filter(message => message.role === 'user').at(-1)?.content;
      if (kind === 'photo' && latest && analyzeCompanionTurn(latest.messages).scene === 'safety') return;
      if (kind === 'reply' && (currentUser !== originalUser || this.database.latestCompanionUserTurnId(userId, companionId, payload.conversationId) !== payload.requestId)) return;
      if (kind === 'photo' && currentUser !== originalUser && /别发|不用发|不要发/u.test(currentUser ?? '')) return;
      if (kind === 'photo' && !result.attachments?.length) throw new Error('Photo result has no attachment');
      const parts = kind === 'reply' ? result.segments ?? [result.text] : [result.text];
      for (const content of parts) {
        if (content.trim() || result.attachments?.length) this.database.createCompanionEvent({ userId, companionId,
          conversationId: payload.conversationId, kind: kind === 'photo' ? 'photo' : 'message', content,
          attachments: kind === 'photo' ? result.attachments ?? [] : [], sourceRequestId: payload.requestId });
      }
      if (kind === 'reply' && result.companionPhotoRequested) {
        this.database.queueCompanionDelivery(userId, { ...request, requestId: randomUUID(), companionAction: 'photo',
          messages: [...request.messages, { role: 'assistant', content: result.text, attachments: [] }] }, 'photo', Date.now());
      }
    } catch (error) {
      if (this.stopped || controller.signal.aborted) return;
      this.logger.warn({ event: 'companion_delivery_failed', requestId: payload.requestId, code: toPublicError(error).code }, 'companion delivery failed');
      if (this.database.getCompanion(userId, companionId)) this.database.createCompanionEvent({ userId, companionId,
        conversationId: payload.conversationId, kind: 'message', content: kind === 'photo' ? '照片没发出来 晚点再试吧' : '刚才没回上 晚点聊',
        attachments: [], sourceRequestId: payload.requestId });
    } finally {
      if (!this.stopped) this.database.finishCompanionDelivery(payload.requestId);
    }
  }

  startProactiveSweep() {
    if (this.stopped || this.proactiveRunning || this.operations.size >= 4) return;
    this.proactiveRunning = true;
    const controller = new AbortController();
    const operation = this.proactiveSweep(controller).catch(error => {
      if (!this.stopped) this.logger.warn({ event: 'companion_proactive_sweep_failed', code: toPublicError(error).code }, 'companion proactive sweep failed');
    }).finally(() => { this.proactiveRunning = false; this.operations.delete(controller); });
    this.operations.set(controller, operation);
  }

  private async proactiveSweep(controller: AbortController) {
    // Current companions use China local time. Keep unsolicited messages within 09:00–22:00.
    const hour = (new Date().getUTCHours() + 8) % 24;
    if (hour < 9 || hour >= 22) return;
    for (const user of this.database.listUsers()) {
      if (this.stopped) return;
      if (user.disabled) continue;
      for (const thread of this.database.listIdleCompanionThreads(user.id)) {
        if (this.stopped) return;
        const profile = this.database.getCompanion(user.id, thread.companionId);
        const latestUserText = thread.messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
        if (!profile?.proactiveMessagesEnabled || analyzeCompanionTurn(thread.messages).scene === 'safety'
          || /别回|不用回|别理我|先别说|不想说话|别(?:再)?(?:联系|找我)|不要(?:再)?(?:联系|找我)/u.test(latestUserText)) continue;
        // Lease the attempt before calling upstream; a failure retries sooner than a completed decision.
        this.database.markCompanionProactive(thread.companionId, Date.now() + 15 * 60_000);
        try {
          const request: GenerateRequest = { requestId: randomUUID(), conversationId: thread.conversationId, deviceId: 'companion-proactive',
            companionId: thread.companionId, companion: companionContextSchema.strip().parse(profile), companionAction: 'chat', messages: thread.messages,
            options: { model: this.database.getCompanionProviderSettings('chat').defaultModel, reasoningEffort: 'none', verbosity: 'low', instructions: '', maxOutputTokens: 512, autoTools: false, knowledgeBase: false, webSearch: false, codeInterpreter: false } };
          const result = await this.provider.generate(request, { id: user.id }, controller.signal, () => undefined, undefined, 'proactive');
          if (this.stopped || this.database.getUserById(user.id)?.disabled) return;
          const current = this.database.getCompanion(user.id, thread.companionId);
          const latest = this.database.getCompanionThread(user.id, thread.companionId, thread.conversationId);
          // A user returning while generation runs takes priority over a stale unsolicited message.
          if (!current?.proactiveMessagesEnabled || latest?.lastInteractionAt !== thread.lastInteractionAt) continue;
          this.database.markCompanionProactive(thread.companionId);
          for (const content of result.segments ?? [result.text]) {
            if (content.trim()) this.database.createCompanionEvent({ userId: user.id, companionId: thread.companionId,
              conversationId: thread.conversationId, kind: 'message', content, attachments: [] });
          }
          if (result.companionPhotoRequested) {
            this.database.queueCompanionDelivery(user.id, { ...request, companionAction: 'photo',
              messages: [...thread.messages, { role: 'assistant', content: result.text, attachments: [] }] }, 'photo', Date.now());
            this.deliverDue();
          }
        } catch (error) {
          if (!this.stopped) this.logger.warn({ event: 'companion_proactive_failed', companionId: thread.companionId, code: toPublicError(error).code }, 'companion proactive message failed');
        }
      }
    }
  }

  async close() {
    this.stopped = true;
    clearInterval(this.deliveryTimer);
    clearInterval(this.proactiveTimer);
    for (const controller of this.operations.keys()) controller.abort();
    await Promise.allSettled(this.operations.values());
  }
}
