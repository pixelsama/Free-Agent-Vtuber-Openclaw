export const DEFAULT_PTT_IDLE_GRACE_MS = 180;

function noop() {}

function createSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForSpeechDrain({
  timeoutMs,
  idleGraceMs = DEFAULT_PTT_IDLE_GRACE_MS,
  getPendingCount = () => 0,
  getLastActivityAt = () => 0,
  getQueue = () => Promise.resolve(),
  now = () => Date.now(),
  sleep = createSleep,
  onWaitStart = noop,
} = {}) {
  const safeTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
  const safeIdleGraceMs = Number.isFinite(idleGraceMs) ? Math.max(0, idleGraceMs) : 0;
  const deadline = now() + safeTimeoutMs;
  const pollIntervalMs =
    safeIdleGraceMs > 0
      ? Math.min(safeIdleGraceMs, 50)
      : 20;

  onWaitStart();

  while (now() <= deadline) {
    const queueSnapshot = getQueue();
    const idleForMs = now() - getLastActivityAt();
    if (getPendingCount() === 0 && queueSnapshot === getQueue() && idleForMs >= safeIdleGraceMs) {
      return {
        timedOut: false,
      };
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(pollIntervalMs, remainingMs));
  }

  return {
    timedOut: true,
  };
}
