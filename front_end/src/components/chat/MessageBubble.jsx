import { memo } from 'react';
import './MessageBubble.css';

function formatTimestamp(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="typing">
      <span />
      <span />
      <span />
    </span>
  );
}

const MessageBubble = memo(function MessageBubble({ message, characterName = '' }) {
  const { role, text, timestamp, isStreaming, failed, attachments } = message;
  const isUser = role === 'user';
  const hasText = typeof text === 'string' && text.length > 0;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  return (
    <div className={`bubble-row ${isUser ? 'bubble-row--user' : 'bubble-row--ai'}`}>
      {!isUser && (
        <div className="bubble-avatar" aria-hidden="true">
          <span className="bubble-avatar-initial">
            {characterName ? characterName.charAt(0).toUpperCase() : '✦'}
          </span>
        </div>
      )}

      <div className="bubble-body">
        <div
          className={[
            'bubble',
            isUser ? 'bubble--user' : 'bubble--ai',
            failed ? 'bubble--failed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {hasAttachments && (
            <div className="bubble-attachment-row">
              <span className="bubble-attachment-icon">📷</span>
              <span className="bubble-attachment-label">{attachments.length > 1 ? `${attachments.length} 张截图` : '截图'}</span>
            </div>
          )}

          {isStreaming && !hasText ? (
            <TypingDots />
          ) : (
            <span className={isStreaming ? 'bubble-text bubble-text--streaming' : 'bubble-text'}>
              {hasText ? text : (failed ? '⚠ 发送失败' : '')}
            </span>
          )}
        </div>

        <span className="bubble-timestamp">{formatTimestamp(timestamp)}</span>
      </div>
    </div>
  );
});

export default MessageBubble;
