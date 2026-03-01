import { useEffect, useState } from 'react';

const deltaHandlers = new Set();
const doneHandlers = new Set();
const errorHandlers = new Set();
const statusHandlers = new Set();

let isStreamingState = false;
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

const setStreamingState = (next) => {
  isStreamingState = next;
  statusHandlers.forEach((handler) => {
    try {
      handler(next);
    } catch (error) {
      console.error('Streaming status handler failed:', error);
    }
  });
};

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

    onEvent(eventType, dataLines.join('\n'));
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

const processSseEvent = (eventType, data, emitDone) => {
  if (!data && eventType !== 'done') {
    return;
  }

  if (eventType === 'text-delta') {
    try {
      const parsed = JSON.parse(data);
      if (parsed?.content) {
        notifyHandlers(deltaHandlers, parsed.content);
      }
    } catch (error) {
      console.error('Failed to parse text-delta payload:', error, data);
    }
    return;
  }

  if (eventType === 'done') {
    try {
      const parsed = data ? JSON.parse(data) : null;
      emitDone(parsed);
    } catch (error) {
      console.error('Failed to parse done payload:', error, data);
      emitDone(null);
    }
    return;
  }

  if (eventType === 'error') {
    notifyHandlers(errorHandlers, data);
  }
};

const startStreaming = async (sessionId, content, extras = {}) => {
  if (!content) {
    return;
  }

  if (abortController) {
    abortController.abort();
  }

  abortController = new AbortController();
  setStreamingState(true);

  const payload = {
    session_id: sessionId,
    content,
    ...extras,
  };

  let doneEmitted = false;

  const emitDone = (payloadData) => {
    doneEmitted = true;
    notifyHandlers(doneHandlers, payloadData);
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
        processSseEvent(eventType, data, emitDone);
      });
    }

    const remaining = textDecoder.decode();
    if (remaining) {
      parseSseChunk(buffer + remaining, (eventType, data) => {
        processSseEvent(eventType, data, emitDone);
      });
    }

    if (!doneEmitted) {
      emitDone(null);
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Streaming request failed:', error);
      notifyHandlers(errorHandlers, error);
    }
  } finally {
    if (abortController?.signal.aborted && !doneEmitted) {
      emitDone({ aborted: true });
    }
    abortController = null;
    setStreamingState(false);
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

export function useStreamingChat() {
  const [isStreaming, setIsStreaming] = useState(isStreamingState);

  useEffect(() => {
    const handler = (value) => setIsStreaming(value);
    statusHandlers.add(handler);
    return () => {
      statusHandlers.delete(handler);
    };
  }, []);

  return {
    isStreaming,
    startStreaming,
    cancelStreaming,
    onDelta,
    onDone,
    onError,
  };
}
