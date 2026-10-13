/** Proxy errors are infrastructure failures, not bad account credentials. */
export function gatewayHttpErrorMessage(status: number): string {
  if (status === 530) return '服务器入口暂时不可用（530），可能是隧道离线或域名解析异常。这不是账号或密码错误，请稍后重试；持续失败请联系管理员恢复固定网关。';
  if ([502, 503, 504, 521, 522, 523, 524].includes(status)) {
    return `网关服务暂时不可用（${status}），请稍后重试；持续失败请联系管理员检查服务器和隧道是否在线。`;
  }
  return `服务器返回了 ${status}。`;
}
