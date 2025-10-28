import { ref } from 'vue';

const deltaHandlers = new Set();
const doneHandlers = new Set();
const errorHandlers = new Set();
const isStreaming = ref(false);
let abortController = null;

const stripTrailingSlash = (value) => (value.endsWith('/') ? value.slice(0, -1) : value);
const ensurePrefixedSlash = (value) => (value.startsWith('/') ? value : `/${value}`);

const apiBase = (() => {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!raw) return '';
  return stripTrailingSlash(raw);
})();

const streamPath = (() => {
  const raw = import.meta.env.VITE_STREAM_PATH?.trim() || 'chat/stream';
  return ensurePrefixedSlash(raw);
})();

const buildStreamUrl = () => `${apiBase}${streamPath}`;

const parseSseChunk = (buffer, onEvent) => {
  let startIndex = 0;
  while (true) {
    const endIndex = buffer.indexOf('\n\n', startIndex);
    if (endIndex === -1) break;
    const rawEvent = buffer.slice(startIndex, endIndex).trim();
    startIndex = endIndex + 2;
    if (!rawEvent) continue;

    let eventType = 'message';
    const dataLines = [];

    rawEvent.split(/\n/).forEach((line) => {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    });

    const data = dataLines.join('\n');
    onEvent(eventType, data);
  }

  return buffer.slice(startIndex);
};

const notifyHandlers = (handlers, payload) => {
  handlers.forEach((handler) => {
    try {
      handler(payload);
    } catch (error) {
      console.error('Streaming handler error:', error);
    }
  });
};

export function useStreamingChat() {
  const startStreaming = async (sessionId, content, extras = {}) => {
    if (!content) {
      console.warn('startStreaming called without content.');
      return;
    }

    if (abortController) {
      abortController.abort();
    }

    abortController = new AbortController();
    isStreaming.value = true;

    const payload = {
      session_id: sessionId,
      content,
      ...extras,
    };

    let doneEmitted = false;

    const emitDone = (payload) => {
      doneEmitted = true;
      notifyHandlers(doneHandlers, payload);
    };

    try {
      const response = await fetch(buildStreamUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`流式接口请求失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const textDecoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += textDecoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, (eventType, data) => {
          if (!data) return;
          if (eventType === 'text-delta') {
            try {
              const parsed = JSON.parse(data);
              if (parsed?.content) {
                notifyHandlers(deltaHandlers, parsed.content);
              }
            } catch (error) {
              console.error('Failed to parse text-delta payload:', error, data);
            }
          } else if (eventType === 'done') {
            try {
              const parsed = data ? JSON.parse(data) : null;
              emitDone(parsed);
            } catch (error) {
              console.error('Failed to parse done payload:', error, data);
              emitDone(null);
            }
          } else if (eventType === 'error') {
            notifyHandlers(errorHandlers, data);
          }
        });
      }

      const remaining = textDecoder.decode();
      if (remaining) {
        parseSseChunk(buffer + remaining, (eventType, data) => {
          if (eventType === 'text-delta' && data) {
            try {
              const parsed = JSON.parse(data);
              if (parsed?.content) {
                notifyHandlers(deltaHandlers, parsed.content);
              }
            } catch (error) {
              console.error('Failed to parse trailing delta payload:', error, data);
            }
          } else if (eventType === 'done') {
            try {
              const parsed = data ? JSON.parse(data) : null;
              emitDone(parsed);
            } catch (error) {
              console.error('Failed to parse trailing done payload:', error, data);
              emitDone(null);
            }
          }
        });
      }
      if (!doneEmitted) {
        emitDone(null);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.info('Streaming aborted by client.');
      } else {
        console.error('Streaming request failed:', error);
        notifyHandlers(errorHandlers, error);
      }
    } finally {
      if (abortController?.signal.aborted && !doneEmitted) {
        emitDone({ aborted: true });
      }
      abortController = null;
      isStreaming.value = false;
    }
  };

  const cancelStreaming = () => {
    if (abortController) {
      abortController.abort();
    }
  };

  const onDelta = (handler) => {
    if (typeof handler === 'function') {
      deltaHandlers.add(handler);
    }
    return () => deltaHandlers.delete(handler);
  };

  const onDone = (handler) => {
    if (typeof handler === 'function') {
      doneHandlers.add(handler);
    }
    return () => doneHandlers.delete(handler);
  };

  const onError = (handler) => {
    if (typeof handler === 'function') {
      errorHandlers.add(handler);
    }
    return () => errorHandlers.delete(handler);
  };

  return {
    isStreaming,
    startStreaming,
    cancelStreaming,
    onDelta,
    onDone,
    onError,
  };
}
