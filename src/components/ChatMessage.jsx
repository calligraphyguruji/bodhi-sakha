import { lazy, Suspense } from 'react';
import { BotAvatar, UserAvatar } from './Avatars';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

/**
 * Enhanced ChatMessage Component
 * Supports:
 * - Text rendering with Markdown + LaTeX
 * - AI Generated Images with download, enlarge, and prompt info
 * - Attached files display on user turns
 * - Deep Thinking reasoning badge indicators
 * - Text-to-speech speaker controls
 */
function ChatMessage({ message, isSpeaking = false, onToggleSpeak, onRetry }) {
  const isUser = message.sender === 'user' || message.role === 'user';
  const textContent = message.text || message.content || '';
  const attachments = message.attachments || [];
  const imageUrl = message.imageUrl || message.metadata?.imageUrl;
  const isReasoning = message.reasoningMode || message.model === 'deep-thinking';

  if (isUser) {
    return (
      <div className="chat-message-row user-row">
        <div className="user-message-container">
          {/* File attachments chips */}
          {attachments.length > 0 && (
            <div className="message-attachments-display">
              {attachments.map((att, i) => (
                <div key={i} className="msg-file-chip">
                  <span>📄</span>
                  <span className="file-name">{att.fileName}</span>
                </div>
              ))}
            </div>
          )}
          <div className="message-bubble user-bubble" style={{ whiteSpace: 'pre-wrap' }}>
            {textContent}
          </div>
        </div>
        <UserAvatar />
      </div>
    );
  }

  return (
    <div className="chat-message-row bot-row">
      <BotAvatar />
      <div className="bot-bubble-wrapper">
        <div className="message-bubble bot-bubble markdown-content">
          {/* Deep Thinking Mode Badge */}
          {isReasoning && (
            <div className="reasoning-thought-badge">
              <span className="brain-icon">🧠</span>
              <span>Reasoned with Deep Thinking</span>
            </div>
          )}

          {/* AI Generated Image Card */}
          {imageUrl && (
            <div className="generated-image-card">
              <img
                src={imageUrl}
                alt={textContent || 'AI Generated Image'}
                className="ai-generated-image"
                loading="lazy"
                onClick={() => window.open(imageUrl, '_blank')}
              />
              <div className="image-card-footer">
                <span className="image-card-caption">{textContent}</span>
                <a
                  href={imageUrl}
                  download={`generated-${message.id || 'image'}.jpg`}
                  target="_blank"
                  rel="noreferrer"
                  className="download-image-link"
                >
                  📥 Download
                </a>
              </div>
            </div>
          )}

          {/* Standard Text or Markdown response */}
          {textContent && !imageUrl && (
            <Suspense fallback={<span>{textContent}</span>}>
              <MarkdownContent>{textContent}</MarkdownContent>
            </Suspense>
          )}
        </div>

        {message.error && (
          <div className="chat-error" role="alert">
            <p>{message.error}</p>
            {onRetry && <button type="button" className="primary-action-btn compact" onClick={onRetry}>Retry</button>}
          </div>
        )}

        {/* Audio Speaker Playback Control */}
        {onToggleSpeak && textContent && (
          <button
            type="button"
            className={`speaker-button ${isSpeaking ? 'speaking' : ''}`}
            onClick={() => onToggleSpeak(message.id, textContent)}
            title={isSpeaking ? 'Stop speaking' : 'Listen to message'}
            aria-label={isSpeaking ? 'Stop speaking' : 'Listen to message'}
          >
            {isSpeaking ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;
