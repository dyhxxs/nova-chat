import type { AppDatabase } from './database.js';
import type { ProviderLogger } from './provider.js';

/** Durable, bounded push delivery. Notification failure never loses the chat event. */
export class CompanionPushRuntime {
  private stopped = false;
  private operation?: Promise<void>;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly database: AppDatabase, private readonly logger: ProviderLogger) {
    this.timer = setInterval(() => { void this.deliverDue(); }, 5_000);
    this.timer.unref();
  }

  deliverDue(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.operation) return this.operation;
    this.operation = this.deliver().finally(() => { this.operation = undefined; });
    return this.operation;
  }

  private async deliver() {
    for (const event of this.database.dueCompanionPushes()) {
      if (this.stopped) return;
      const activeTokens = this.database.listCompanionPushDevices(event.userId);
      const pendingTokens = event.retryTokensJson ? JSON.parse(event.retryTokensJson) as string[] : activeTokens;
      const tokens = activeTokens.filter(token => pendingTokens.includes(token));
      if (!tokens.length) { this.database.finishCompanionPush(event.eventId); continue; }
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
          signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]),
          body: JSON.stringify(tokens.map(to => ({ to, title: event.companionName,
            body: event.kind === 'photo' ? '[图片]' : event.content.slice(0, 160), sound: 'default', channelId: 'companion-messages',
            data: { type: 'companion-message', eventId: event.eventId, userId: event.userId, companionId: event.companionId,
              conversationId: event.conversationId, serverUrl: this.database.companionPushServerUrl(to) },
          }))),
        });
        if (!response.ok) throw new Error('push_transport_failed');
        const result = await response.json() as { data?: Array<{ status: string; details?: { error?: string } }> };
        if (!Array.isArray(result.data) || result.data.length !== tokens.length) throw new Error('push_response_invalid');
        const retry: string[] = [];
        for (const [index, ticket] of result.data.entries()) {
          if (ticket.details?.error === 'DeviceNotRegistered') this.database.removeInvalidCompanionPushToken(tokens[index]!);
          else if (ticket.status !== 'ok') retry.push(tokens[index]!);
        }
        if (retry.length) this.database.retryCompanionPush(event.eventId, event.attempts + 1, retry);
        else this.database.finishCompanionPush(event.eventId);
      } catch {
        if (this.stopped) return;
        this.database.retryCompanionPush(event.eventId, event.attempts + 1, tokens);
        this.logger.warn({ event: 'companion_push_failed', eventId: event.eventId }, 'companion notification will retry');
      }
    }
  }

  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    this.controller.abort();
    await this.operation;
  }
}
