import { useState, useEffect, useRef } from 'react';
import { isSpeechRecognitionSupported, initSpeechRecognizer } from '../utils/speechUtils';

/**
 * Modern Chat Composer Component
 * Supports:
 * - Text entry with auto-expanding textarea
 * - Shift+Enter for newlines, Enter to submit
 * - File attachment button (PDF, DOCX, TXT, CSV, JSON, PNG, JPG, WEBP)
 * - File chips with removal
 * - Deep Thinking toggle (🧠 Thinking)
 * - Microphone voice input (speech-to-text)
 * - High-speed Saffron Send button
 */
function ChatInput({
  onSendMessage,
  onFileUpload,
  onRemoveAttachment,
  disabled = false,
  reasoningMode = false,
  onToggleReasoning,
}) {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadBusy = useRef(false);

  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (err) { void err; }
      }
    };
  }, []);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 46), 160)}px`;
    }
  }, [inputText]);

  const handleToggleVoiceInput = () => {
    if (disabled) return;

    if (!isSpeechRecognitionSupported()) {
      alert('Voice input is not supported in this browser. Please use Chrome, Safari, or Edge.');
      return;
    }

    if (isListening) {
      try { recognitionRef.current?.stop(); } catch (err) { void err; }
      setIsListening(false);
      return;
    }

    const recognizer = initSpeechRecognizer({
      onStart: () => setIsListening(true),
      onResult: (transcript) => {
        if (transcript) setInputText(transcript);
      },
      onEnd: () => setIsListening(false),
      onError: (err) => {
        console.warn('Speech recognition error:', err);
        setIsListening(false);
      },
    });

    recognitionRef.current = recognizer;
    try {
      recognizer?.start();
    } catch {
      setIsListening(false);
    }
  };

  const addFiles = async (selected) => {
    if (disabled || uploadBusy.current) return;
    uploadBusy.current = true;
    setUploading(true);
    setUploadError('');
    let imageCount = attachments.filter(a => a.fileType?.startsWith('image/')).length;
    let imageBytes = attachments.filter(a => a.fileType?.startsWith('image/')).reduce((sum,a) => sum+(a.fileSize || 0),0);
    let fileCount = attachments.length;
    const errors = [];
    try {
      for (const file of Array.from(selected)) {
        try {
          const isImage = /\.(png|jpe?g|webp)$/i.test(file.name) || file.type.startsWith('image/');
          if (!/\.(pdf|docx|txt|csv|json|png|jpe?g|webp)$/i.test(file.name)) throw new Error('Unsupported file. Choose PDF, DOCX, TXT, CSV, JSON, JPEG, PNG or WebP.');
          if (fileCount >= 10 || (isImage && imageCount >= 3)) throw new Error('Attach up to 10 files, including up to 3 images.');
          if (!file.size || file.size > (isImage ? 2 : 15) * 1024 * 1024) throw new Error(isImage ? 'Images must be no larger than 2 MB. Please resize this image.' : 'Files must be no larger than 15 MB.');
          if (isImage && imageBytes + file.size > 2800000) throw new Error('Attach images totaling no more than 2.8 MB.');
          let fileData;
          if (file.size <= 3 * 1024 * 1024) {
            fileData = await new Promise((resolve,reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('Unable to read this file.'));
              reader.readAsDataURL(file);
            });
          }
          const uploaded = await onFileUpload({fileName:file.name,fileType:file.type,fileData,file});
          setAttachments(prev => [...prev,uploaded]);
          fileCount++;
          if (isImage) {imageCount++;imageBytes += file.size;}
        } catch (err) { errors.push(`${file.name}: ${err.message || 'Unable to process this file.'}`); }
      }
    } finally {
      setUploadError(errors.join(' '));
      setUploading(false);
      uploadBusy.current = false;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  const handleFileChange = e => addFiles(e.target.files || []);

  const removeAttachment = async (index) => {
    if (disabled || uploadBusy.current) return;
    const removed = attachments[index];
    uploadBusy.current = true;
    setUploading(true);
    try {
      await onRemoveAttachment?.(removed);
      setAttachments(prev => prev.filter(a => a.id !== removed.id));
    } catch (error) {setUploadError(error.message);}
    finally {uploadBusy.current = false;setUploading(false);}
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (isListening) {
      try { recognitionRef.current?.stop(); } catch (err) { void err; }
      setIsListening(false);
    }

    const trimmed = inputText.trim();
    if ((!trimmed && attachments.length === 0) || disabled || uploading) {
      return;
    }

    onSendMessage(trimmed, attachments);
    setInputText('');
    setAttachments([]);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div className="composer-wrapper"
      onDragOver={e => {e.preventDefault();}}
      onDrop={e => {e.preventDefault();addFiles(e.dataTransfer.files);}}>
      {uploading && <p role="status">Uploading and validating attachments…</p>}
      {uploadError && <p role="alert">{uploadError}</p>}
      {/* Attachment Chips */}
      {attachments.length > 0 && (
        <div className="composer-attachments-bar">
          {attachments.map((att, idx) => (
            <div key={idx} className="attachment-chip">
              {att.imageData && <img className="attachment-thumbnail" src={att.imageData} alt={att.fileName} />}
              <span className="file-icon">
                {att.fileType?.startsWith('image/') ? '🖼️' : att.fileName?.endsWith('.pdf') ? '📄' : '📝'}
              </span>
              <span className="file-name" title={att.fileName}>{att.fileName}</span>
              <button
                type="button"
                className="remove-chip-btn"
                disabled={disabled || uploading}
                onClick={() => removeAttachment(idx)}
                aria-label={`Remove ${att.fileName}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Composer Box */}
      <form className="chat-input-box" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          rows={1}
          className="chat-input"
          placeholder={
            isListening
              ? 'Listening... Speak into your microphone'
              : 'Ask anything, upload documents, or press Shift+Enter for newlines...'
          }
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || uploading}
          aria-label="Ask AI Assistant"
        />

        {/* Toolbar row with controls */}
        <div className="composer-toolbar">
          <div className="toolbar-left">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
              multiple
              accept=".pdf,.txt,.docx,.csv,.json,.png,.jpg,.jpeg,.webp"
            />

            {/* Attach button */}
            <button
              type="button"
              className="toolbar-btn attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
              title="Attach Document or Image (PDF, DOCX, TXT, CSV, JSON, PNG, JPG)"
              aria-label="Attach file"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span className="btn-label-desktop">Attach</span>
            </button>

            {/* Reasoning Mode Toggle */}
            <button
              type="button"
              className={`toolbar-btn reasoning-toggle-btn ${reasoningMode ? 'active' : ''}`}
              onClick={onToggleReasoning}
              disabled={disabled}
              title={reasoningMode ? 'Deep Thinking is ON' : 'Toggle Deep Thinking mode'}
              aria-label="Deep Thinking mode"
            >
              <span className="toggle-icon">🧠</span>
              <span className="btn-label-desktop">Deep Thinking</span>
            </button>
          </div>

          <div className="toolbar-right">
            {/* Mic Speech Input */}
            <button
              type="button"
              className={`mic-button ${isListening ? 'listening' : ''}`}
              onClick={handleToggleVoiceInput}
              disabled={disabled}
              title={isListening ? 'Stop listening' : 'Voice input'}
              aria-label={isListening ? 'Stop listening' : 'Voice input'}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>

            {/* Send / Dispatch Button */}
            <button
              type="submit"
              className="send-button"
              disabled={disabled || uploading || (!inputText.trim() && attachments.length === 0)}
              title="Send message"
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default ChatInput;
