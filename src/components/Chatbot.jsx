import { useState, useEffect, useRef, useCallback } from 'react';
import ChatInput from './ChatInput';
import ChatMessage from './ChatMessage';
import TypingIndicator from './TypingIndicator';
import Sidebar from './Sidebar';
import AuthModal from './AuthModal';
import MemoryModal from './MemoryModal';
import SettingsModal from './SettingsModal';
import { readChatResponse, friendlyChatError } from '../services/chatResponse';
import { speakText, stopSpeech } from '../utils/speechUtils';
import { useAuth } from '../context/useAuth';
import { AIService } from '../services/aiService';

const SUGGESTIONS = [
  'Explain a programming concept',
  'Analyze my PDF document',
  'Help me debug code',
  'Help me plan a full-stack project',
];

function ChatbotSession() {
  const { user } = useAuth();

  // App Theme: 'light' or 'dark'
  const [theme, setTheme] = useState(() => localStorage.getItem('app_theme') || 'light');

  // Sidebar visibility
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Modals state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  // Conversations & Search state
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Messages state
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      text: 'Namaste! I am Bodhisakha (बोधिसखा), your personal AI assistant and intellectual companion. How can I help you today?',
    },
  ]);

  // Deep Thinking toggle
  const [reasoningMode, setReasoningMode] = useState(false);

  // Status & Speech
  const [isTyping, setIsTyping] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [speakingMessageId, setSpeakingMessageId] = useState(null);

  const messagesEndRef = useRef(null);
  const busyRef = useRef(false);
  const requestSequence = useRef(0);
  const abortControllerRef = useRef(null);

  // Theme synchronization
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Clean up timers & speech
  useEffect(() => {
    return () => {
      stopSpeech();
      // Invalidate in-flight callbacks when this chat session unmounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSequence.current++;
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Load conversations when user logs in or search changes
  const loadConversations = useCallback(async (query = '') => {
    if (!user) {
      setConversations([]);
      return;
    }
    try {
      const list = await AIService.getConversations(query);
      setConversations(list);
    } catch (err) {
      console.warn('Failed to load conversations:', err.message);
    }
  }, [user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadConversations(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [loadConversations, searchQuery]);

  const cancelPending = () => {
    requestSequence.current++;
    abortControllerRef.current?.abort();
    busyRef.current = false;
    setIsTyping(false);
    setStatusMessage('');
  };

  // Select conversation and load its messages
  const handleSelectConversation = async (convId) => {
    if (!convId || convId === activeConversationId) return;
    cancelPending();
    const sequence = requestSequence.current;
    setActiveConversationId(convId);
    setSidebarOpen(false); // Close drawer on mobile
    try {
      const data = await AIService.getConversation(convId);
      if (sequence !== requestSequence.current) return;
      if (data.messages && data.messages.length > 0) {
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            sender: m.role === 'user' ? 'user' : 'bot',
            text: m.content,
            model: m.model,
            imageUrl: m.metadata?.imageUrl,
            attachments: m.metadata?.attachments,
          }))
        );
      } else {
        setMessages([
          {
            id: Date.now(),
            sender: 'bot',
            text: `Conversation loaded: "${data.conversation?.title || 'Chat'}". How can I assist you?`,
          },
        ]);
      }
    } catch (err) {
      console.error('Failed to load conversation history:', err);
    }
  };

  // New Chat
  const handleNewChat = async () => {
    cancelPending();
    setActiveConversationId(null);
    setMessages([
      {
        id: Date.now(),
        sender: 'bot',
        text: 'How can I help you today?',
      },
    ]);
    setSidebarOpen(false);
  };

  // Rename Conversation
  const handleRenameConversation = async (id, title) => {
    try {
      await AIService.updateConversation(id, { title });
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
    } catch (err) {
      console.error('Rename failed:', err);
    }
  };

  // Delete Conversation
  const handleDeleteConversation = async (id) => {
    if (!window.confirm('Are you sure you want to delete this conversation?')) return;
    try {
      await AIService.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        handleNewChat();
      }
    } catch (err) {
      console.error('Delete conversation failed:', err);
    }
  };

  // Pin / Unpin Conversation
  const handleTogglePin = async (id, pinned) => {
    try {
      await AIService.updateConversation(id, { pinned });
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, pinned } : c))
      );
    } catch (err) {
      console.error('Pin toggle failed:', err);
    }
  };

  // Toggle Speech
  const handleToggleSpeak = (id, text) => {
    if (speakingMessageId === id) {
      stopSpeech();
      setSpeakingMessageId(null);
    } else {
      speakText(text, {
        onStart: () => setSpeakingMessageId(id),
        onEnd: () => setSpeakingMessageId(null),
        onError: () => setSpeakingMessageId(null),
      });
    }
  };

  // File Upload helper
  const handleFileUpload = async ({ fileName, fileType, fileData, file }) => {
    return AIService.uploadFile({
      fileName,
      fileType,
      fileData,
      file,
      conversationId: activeConversationId || null,
    });
  };

  // A retry reuses the user turn, bot slot, conversation and request ID.
  const handleSendMessage = async (userText, attachments = [], retry = null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const sequence = ++requestSequence.current;
    stopSpeech();
    setSpeakingMessageId(null);
    const requestId = retry?.requestId || crypto.randomUUID();
    const botId = retry?.botId || `bot_${requestId}`;
    const history = retry?.history || messages.filter(m => !m.error && !m.partial).map(m => ({sender:m.sender,text:m.text}));
    const actualMessage = userText.trim() || 'Please analyze the attached documents.';
    const snapshot = {requestId,botId,history,userText,attachments,reasoningMode:retry?.reasoningMode ?? reasoningMode,conversationId:retry?.conversationId || activeConversationId};
    let currentConvId = snapshot.conversationId;
    if (retry) setMessages(prev => prev.map(m => m.id === botId ? {...m,text:'',error:null,partial:false} : m));
    else setMessages(prev => [...prev,{id:`user_${requestId}`,sender:'user',text:actualMessage,attachments},{id:botId,sender:'bot',text:'',reasoningMode:snapshot.reasoningMode}]);
    setIsTyping(true);
    setStatusMessage(snapshot.reasoningMode ? 'Thinking deeply through the problem...' : 'Thinking...');
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timer = setTimeout(() => controller.abort(),58000);
    try {
      if (user && !currentConvId) {
        const conv = await AIService.createConversation(actualMessage.slice(0,36));
        if (sequence !== requestSequence.current) return;
        currentConvId = conv.id;
        setActiveConversationId(conv.id);
      }
      const contextAttachments = attachments.length ? attachments : [...messages].reverse().find(m => m.attachments?.length)?.attachments || [];
      const fileContext = contextAttachments.map(a => `[File: ${a.fileName}]\n${a.extractedText || ''}`).join('\n\n').slice(0,15000);
      const response = await AIService.sendMessage({message:actualMessage,history,conversationId:currentConvId,requestId,attachmentIds:attachments.map(a => a.id).filter(Boolean),reasoningMode:snapshot.reasoningMode,fileContext,signal:controller.signal});
      const result = await readChatResponse(response,text => {
        if (sequence !== requestSequence.current) return;
        setStatusMessage('');
        setMessages(prev => prev.map(m => m.id === botId ? {...m,text} : m));
      });
      if (result?.imageUrl && sequence === requestSequence.current) setMessages(prev => prev.map(m => m.id === botId ? {...m,imageUrl:result.imageUrl} : m));
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      const safe = friendlyChatError(error);
      setMessages(prev => prev.map(m => m.id === botId ? {...m,error:safe.message,partial:Boolean(m.text),retry:safe.retryable ? {...snapshot,conversationId:currentConvId} : null} : m));
    } finally {
      clearTimeout(timer);
      if (sequence === requestSequence.current) {
        busyRef.current = false;
        setIsTyping(false);
        setStatusMessage('');
        if (user) loadConversations();
      }
    }
  };

  return (
    <div className="assistant-layout">
      {/* 1. Left Persistent / Drawer Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        activeId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        onTogglePin={handleTogglePin}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenMemory={() => setMemoryModalOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* 2. Main Chat Area */}
      <div className="assistant-main-panel">
        {/* Top Navbar */}
        <header className="assistant-top-navbar">
          <div className="navbar-left">
            <button
              type="button"
              className="navbar-hamburger-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle sidebar menu"
            >
              ☰
            </button>
            <div className="assistant-brand-title">
              <span className="brand-badge-dot"></span>
              <h1>Bodhisakha</h1>
              <span className="brand-badge-tag">AI</span>
            </div>
          </div>

          <div className="navbar-right">
            <button
              type="button"
              className="navbar-action-btn theme-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
              aria-label="Toggle dark mode"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {user ? (
              <button
                type="button"
                className="navbar-user-btn"
                onClick={() => setSettingsModalOpen(true)}
                title="Account Settings"
                aria-label="Account Settings"
              >
                <span className="nav-avatar-circle">{user.name.charAt(0).toUpperCase()}</span>
                <span className="nav-user-name">{user.name.split(' ')[0]}</span>
              </button>
            ) : (
              <button
                type="button"
                className="primary-action-btn compact"
                onClick={() => setAuthModalOpen(true)}
              >
                Sign In
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Message List */}
        <div className="messages-scroll-area">
          <div className="messages-list">
            {/* Empty state suggestions */}
            {messages.length <= 1 && (
              <div className="chat-empty-hero">
                <div className="empty-hero-icon">✨</div>
                <h2>How can I help you today?</h2>
                <p>Ask anything, upload documents, explore ideas, or enable Deep Thinking for more detailed responses.</p>
                <div className="suggested-prompts-grid">
                  {SUGGESTIONS.map((sug, i) => (
                    <button
                      key={i}
                      type="button"
                      className="suggested-prompt-card"
                      onClick={() => handleSendMessage(sug)}
                    >
                      <span>{sug}</span>
                      <span className="prompt-arrow">↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conversation Messages */}
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isSpeaking={speakingMessageId === message.id}
                onToggleSpeak={handleToggleSpeak}
                onRetry={message.retry && !isTyping ? () => handleSendMessage(message.retry.userText, message.retry.attachments, message.retry) : null}
              />
            ))}

            {/* Typing Indicator with custom status message */}
            {isTyping && <TypingIndicator statusText={statusMessage} />}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Composer Bar */}
        <div className="chat-bottom-bar">
          <ChatInput
            onSendMessage={handleSendMessage}
            onFileUpload={handleFileUpload}
            disabled={isTyping}
            reasoningMode={reasoningMode}
            onToggleReasoning={() => setReasoningMode(!reasoningMode)}
          />
        </div>
      </div>

      {/* Modals */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      <MemoryModal isOpen={memoryModalOpen} onClose={() => setMemoryModalOpen(false)} />
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        onOpenMemory={() => setMemoryModalOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}

export default function Chatbot() {
  const { user } = useAuth();
  return <ChatbotSession key={user?.id || 'guest'} />;
}
