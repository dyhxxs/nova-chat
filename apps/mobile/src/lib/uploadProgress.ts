export function uploadProgressPercent(bytesSent: number, totalBytes: number): number | undefined {
  if (!Number.isFinite(bytesSent) || !Number.isFinite(totalBytes) || totalBytes <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((bytesSent / totalBytes) * 100)));
}
