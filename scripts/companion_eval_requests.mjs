// FIFO scheduling keeps synthetic QA within the normal account request limits.
export function createRequestScheduler({ concurrency = 2, minIntervalMs = 3500 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(minIntervalMs) || minIntervalMs < 0) throw new Error('invalid_request_scheduler');
  let active = 0, nextStartAt = 0, timer;
  const queue = [];
  function pump() {
    if (active >= concurrency || !queue.length) return;
    const delay = Math.max(0, nextStartAt - Date.now());
    if (delay) {
      if (!timer) timer = setTimeout(() => { timer = undefined; pump(); }, delay);
      return;
    }
    const item = queue.shift();
    active += 1;
    nextStartAt = Date.now() + minIntervalMs;
    Promise.resolve().then(() => {
      try { return item.task(); }
      finally {
        // A busy event loop can postpone the microtask beyond its reserved start.
        // Space from the actual invocation so QA requests cannot start back-to-back.
        nextStartAt = Date.now() + minIntervalMs;
        pump();
      }
    }).then(item.resolve, item.reject).finally(() => { active -= 1; pump(); });
    pump();
  }
  return task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); pump(); });
}
