import { useCallback, useState } from 'react';

const STORAGE_KEY = 'chatHistory.v1';
const MAX_MESSAGES = 200;

function generateId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadFromStorage() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    // Strip any messages that were still streaming when the app was closed
    return parsed.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
  } catch {
    return [];
  }
}

function saveToStorage(messages) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const toSave = messages
      .filter((m) => !m.isStreaming)
      .slice(-MAX_MESSAGES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Ignore storage errors (quota exceeded, private browsing, etc.)
  }
}

/**
 * Manages chat message history with localStorage persistence.
 *
 * Message shape:
 *   { id, role: 'user'|'ai', text, timestamp, attachments?, isStreaming?, failed? }
 */
export function useChatHistory() {
  const [messages, setMessages] = useState(() => loadFromStorage());

  const addUserMessage = useCallback((text, attachments = []) => {
    const msg = {
      id: generateId(),
      role: 'user',
      text: typeof text === 'string' ? text : '',
      timestamp: Date.now(),
      attachments: Array.isArray(attachments) ? attachments : [],
      isStreaming: false,
    };
    setMessages((prev) => {
      const next = [...prev, msg].slice(-MAX_MESSAGES);
      saveToStorage(next);
      return next;
    });
    return msg.id;
  }, []);

  const startAiMessage = useCallback(() => {
    const msgId = generateId();
    const msg = {
      id: msgId,
      role: 'ai',
      text: '',
      timestamp: Date.now(),
      isStreaming: true,
    };
    setMessages((prev) => [...prev, msg]);
    return msgId;
  }, []);

  const appendAiDelta = useCallback((msgId, delta) => {
    if (!msgId || !delta) {
      return;
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, text: m.text + delta } : m)),
    );
  }, []);

  const finalizeAiMessage = useCallback((msgId) => {
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === msgId ? { ...m, isStreaming: false } : m,
      );
      saveToStorage(next);
      return next;
    });
  }, []);

  const cancelAiMessage = useCallback((msgId) => {
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === msgId ? { ...m, isStreaming: false, failed: true } : m,
      );
      saveToStorage(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  return {
    messages,
    addUserMessage,
    startAiMessage,
    appendAiDelta,
    finalizeAiMessage,
    cancelAiMessage,
    clearHistory,
  };
}
