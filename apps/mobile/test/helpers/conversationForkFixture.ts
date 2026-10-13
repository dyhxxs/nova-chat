import type { AppMessage, Conversation } from '../../src/types';
export const forkUser = { id: 'fork-user', email: 'fork@example.test', displayName: 'Fork test', role: 'user' as const, disabled: false, createdAt: 1, updatedAt: 1 };
export const forkServer = 'https://fork.example.test';
export function message(id: string, role: AppMessage['role'], content = id, extra: Partial<AppMessage> = {}): AppMessage {
  return { id, role, content, createdAt: 100, status: 'complete', attachments: [], ...extra };
}
export function forkFixture(): Conversation {
  return { id: 'source', title: '原对话', createdAt: 1, updatedAt: 10, draft: '尚未发送的旧草稿', pinned: true, archived: true, importSourceId: 'old-import', assistant: { name: '研究助手', instructions: 'synthetic instructions' }, messages: [
    message('q1', 'user', '问题一'), message('a1', 'assistant', '回答一', { model: 'test-model', requestedModel: 'test-requested', generationRequestId: 'old-job', generationStartedAt: 1, completedAt: 2, generationOptions: { reasoningEffort: 'high', verbosity: 'medium', maxOutputTokens: 1000, webSearch: true, codeInterpreter: true }, usage: { totalTokens: 42 } }),
    message('q2', 'user', '请换一种解释'), message('a2', 'assistant', '回答二'),
  ] };
}
