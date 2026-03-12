#!/usr/bin/env node
/*
 * Strict model-download completion checker for onboarding GUI automation.
 * Usage:
 *   node docs/scripts/cdp_wait_model_download_done.js --kind tts --port 9222
 *   node docs/scripts/cdp_wait_model_download_done.js --kind asr --timeout-ms 1800000
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv = []) {
  const options = {
    kind: 'tts',
    port: 9222,
    timeoutMs: 30 * 60 * 1000,
    intervalMs: 4000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || '');
    const next = argv[i + 1];
    if (item === '--kind' && typeof next === 'string') {
      options.kind = next.trim().toLowerCase();
      i += 1;
      continue;
    }
    if (item === '--port' && Number.isFinite(Number(next))) {
      options.port = Number(next);
      i += 1;
      continue;
    }
    if (item === '--timeout-ms' && Number.isFinite(Number(next))) {
      options.timeoutMs = Number(next);
      i += 1;
      continue;
    }
    if (item === '--interval-ms' && Number.isFinite(Number(next))) {
      options.intervalMs = Number(next);
      i += 1;
      continue;
    }
  }

  if (options.kind !== 'asr' && options.kind !== 'tts') {
    throw new Error(`Invalid --kind: ${options.kind}. Expected "asr" or "tts".`);
  }
  return options;
}

async function connectCdp(port = 9222) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((target) => target?.type === 'page' && !String(target.url || '').startsWith('devtools://'));
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`No CDP page target on port ${port}`);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data || '{}'));
    if (!payload.id || !pending.has(payload.id)) {
      return;
    }
    const entry = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) {
      entry.reject(new Error(JSON.stringify(payload.error)));
      return;
    }
    entry.resolve(payload.result);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ id: requestId, method, params }));
      setTimeout(() => {
        if (!pending.has(requestId)) {
          return;
        }
        pending.delete(requestId);
        reject(new Error(`Timeout: ${method}`));
      }, 20000);
    });
  }

  await send('Runtime.enable');
  return {
    ws,
    evaluate: async (expression) => {
      const out = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return out?.result?.value;
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const label = options.kind === 'asr' ? 'ASR' : 'TTS';
  const donePattern = options.kind === 'asr'
    ? /(当前模型已下载|ASR\s*本地模型下载完成)/i
    : /(当前模型已下载|TTS\s*本地模型下载完成)/i;
  const failedPattern = options.kind === 'asr'
    ? /(下载\s*ASR\s*模型失败|任务失败|failed|download.*failed)/i
    : /(下载\s*TTS\s*模型失败|任务失败|failed|download.*failed)/i;

  const { ws, evaluate } = await connectCdp(options.port);
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.timeoutMs) {
    const snap = await evaluate(`(() => {
      const body = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
      const hasRedownload = Array.from(document.querySelectorAll('button,[role="button"],.MuiButtonBase-root'))
        .some((el) => (el.textContent || '').includes('重新下载'));
      return {
        ts: new Date().toISOString(),
        body,
        hasRedownload,
      };
    })()`);

    const body = String(snap?.body || '');
    const hasDoneText = donePattern.test(body);
    const hasFailedText = failedPattern.test(body);
    const hasRedownload = Boolean(snap?.hasRedownload);

    const trace = {
      ts: snap?.ts || new Date().toISOString(),
      kind: options.kind,
      hasDoneText,
      hasRedownload,
      hasFailedText,
    };
    console.log(JSON.stringify(trace));

    if (hasFailedText) {
      throw new Error(`${label} download failed state detected`);
    }
    if (hasDoneText && hasRedownload) {
      console.log(`${label}_DONE_CONFIRMED`);
      ws.close();
      return;
    }

    await sleep(options.intervalMs);
  }

  throw new Error(`Timeout waiting for ${label} completion`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
