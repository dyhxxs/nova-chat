export function titleFromMessage(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (!clean) return '新对话';
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean;
}
