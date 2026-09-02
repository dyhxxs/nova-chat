export function friendlyNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/API Key|api key|模型权限|provider.*key/i.test(message)) return '第三方 API Key 无效，或当前账户没有访问该模型的权限。';
  if (/unauthorized|口令|401/i.test(message)) return '访问凭据无效，请在设置中重新填写。';
  if (/timeout|超时/i.test(message)) return '连接超时，请检查服务地址和网络。';
  if (/network|fetch|socket|connect|closed|连接/i.test(message)) return '无法连接服务，请检查地址、网络和服务状态。';
  return message || '请求失败，请稍后重试。';
}
