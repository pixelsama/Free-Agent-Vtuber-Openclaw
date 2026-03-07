import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSpeechDrain } from '../src/hooks/voice/pttSpeechDrain.js';

describe('waitForSpeechDrain', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for speech work that is queued shortly after flush starts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T00:00:00.000Z'));

    let pendingCount = 0;
    let lastActivityAt = 0;
    let queue = Promise.resolve();

    const scheduleSpeechTask = ({ enqueueDelayMs, durationMs }) => {
      setTimeout(() => {
        pendingCount += 1;
        lastActivityAt = Date.now();
        queue = queue.then(
          () =>
            new Promise((resolve) => {
              setTimeout(() => {
                pendingCount -= 1;
                lastActivityAt = Date.now();
                resolve();
              }, durationMs);
            }),
        );
      }, enqueueDelayMs);
    };

    scheduleSpeechTask({
      enqueueDelayMs: 20,
      durationMs: 30,
    });

    let settled = false;
    let result = null;
    const drainPromise = waitForSpeechDrain({
      timeoutMs: 400,
      idleGraceMs: 50,
      getPendingCount: () => pendingCount,
      getLastActivityAt: () => lastActivityAt,
      getQueue: () => queue,
      onWaitStart: () => {
        lastActivityAt = Date.now();
      },
    }).then((value) => {
      settled = true;
      result = value;
    });

    await vi.advanceTimersByTimeAsync(70);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(40);
    await drainPromise;

    expect(result).toEqual({ timedOut: false });
  });

  it('times out when pending speech never drains', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T00:00:00.000Z'));

    let lastActivityAt = 0;
    const queue = new Promise(() => {});

    const drainPromise = waitForSpeechDrain({
      timeoutMs: 120,
      idleGraceMs: 40,
      getPendingCount: () => 1,
      getLastActivityAt: () => lastActivityAt,
      getQueue: () => queue,
      onWaitStart: () => {
        lastActivityAt = Date.now();
      },
    });

    await vi.advanceTimersByTimeAsync(130);

    await expect(drainPromise).resolves.toEqual({ timedOut: true });
  });
});
