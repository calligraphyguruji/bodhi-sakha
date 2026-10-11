# Bodhisakha (बोधिसखा) — Production AI Assistant

A full-stack, production-grade conversational AI assistant built with **React 19**, **Vite**, **Express**, and **Google Gemini AI**. Designed with authentic Sanskrit identity (*Bodhisakha* — "Companion of Wisdom"), a warm **Saffron (`#FF9933`)** aesthetic, multi-turn dialogue persistence, multi-user authentication, long-term personal memory, document understanding, deep reasoning, and optimized for **Vercel Serverless Function** deployment.

Created and owned by **Mr. Aman Mishra**.

---

## 🌟 Live Demo

- **Production URL**: [https://bodhi-sakha-phi.vercel.app/](https://bodhi-sakha-phi.vercel.app/)
- **Repository**: [https://github.com/calligraphyguruji/basic-chatbot](https://github.com/calligraphyguruji/basic-chatbot)

---

## 🚀 Key Features

### 1. Direct Server-Side Google Gemini AI & Ultra-Low-Latency Streaming
- Direct connection to Google Gemini API using `@google/generative-ai` with immediate chunk-by-chunk stream forwarding (`res.write(chunkText)`) for minimal Time To First Token (TTFT).
- In-memory `GoogleGenerativeAI` client caching to prevent repetitive client allocations and SSL handshakes across requests.
- Intelligent search bypass: general definitions, math, and concepts execute directly with zero retrieval latency, reserving web search and RAG strictly for time-sensitive or curriculum topics.
- Redundant search prevention: avoids duplicate search passes when external context has already been gathered.
- Server-side credentials isolation: `GEMINI_API_KEY` is strictly held on the server/backend and never exposed in client bundles.
- Resilient model fallback: cascades across Gemini models (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-flash-latest`) with transient error retry.

### 2. Persistent Multi-User Architecture & Authentication
- Secure **Register / Sign In** modal with client and server validation.
- Passwords securely hashed with `bcryptjs` and session tokens signed via JWT (`jsonwebtoken`).
- Complete user data isolation: users can never access or inspect another user's conversations, files, or memories (full IDOR prevention).
- Support for unauthenticated guest conversations as well as permanent user accounts.

### 3. Modern ChatGPT-Style Responsive Sidebar & Chat History
- Persistent left sidebar with mobile slide-over drawer and overlay.
- Chronologically grouped conversations: **Today**, **Yesterday**, **Previous 7 Days**, and **Older**.
- Instant conversation search with debounced filtering across titles and message content.
- Conversation management actions: **Rename**, **Pin to top**, and **Delete** with confirmation.
- Auto-generates conversation title from the user's initial message.

### 4. Long-Term Personal Memory & Settings
- Extract key user preferences, background, and learning goals automatically without ballooning context tokens.
- Settings → **Manage Memories**: view stored user facts, delete individual memory items, or wipe all memories.
- Seamlessly injects relevant user facts into the system prompt for tailored, contextual explanations.
- Dark mode & Light mode toggle with persistent local preference.

### 5. File Upload & Multi-Format Document Understanding
- Supports **PDF**, **DOCX**, **TXT**, **CSV**, **JSON**, **PNG**, **JPG**, and **WEBP** attachments up to 15MB.
- Serverless-native text extraction using `unpdf` and `mammoth` (no DOM/canvas dependencies; fully operational on Vercel Serverless and local Node.js environments).
- Seamless document Q&A for both logged-in users (persisted in database) and guest users (processed directly in memory).
- Uploaded file chips appear above the composer and in message bubbles.
- Document text is indexed and provided directly to the AI model as ground truth context for document Q&A.

### 6. Intelligent Adaptive Response Length Policy
- **Simple Questions & Facts** (definitions, full forms, basic calculations): 1–4 sentences max, zero conversational throat-clearing.
- **Medium Inquiries** (how things work, conceptual summaries, comparisons): concise structured explanation with 2–4 key points.
- **Complex Tasks & Architecture** (system design, complete implementations, formula sheets): deep, structured responses.
- Explicit user prompts (`short answer`, `in one line`, `in detail`) take strict precedence.

### 7. Deep Thinking / Reasoning Mode
- Toggle button (`🧠 Deep Thinking`) in the chat composer.
- Routes prompts to reasoning models with higher analytical depth.
- Displays a dedicated reasoning badge (`Reasoned with Deep Thinking`) on completed responses without exposing raw internal draft tokens.

### 8. Responsive Mobile-First Chat Architecture
- **Natural Left-Aligned AI Flow**: AI responses flow naturally beside and below the left-aligned avatar without artificial horizontal centering.
- **Maximum Viewport Utilization**: Flex layout with `flex: 1` and `min-width: 0` ensures responses expand naturally across available mobile screen widths (320px–480px+).
- **Horizontal Overflow Protection**: Safely wraps long text, break-anywhere words, inline and block math/LaTeX, with internal horizontal scrolling dedicated to code blocks and tables.
- **Desktop Parity**: Preserves existing desktop spacing, typography, and clean Bodhisakha visual aesthetic.

### 9. Core Chatbot Capabilities Preserved
- Real-time live weather lookup via `wttr.in`.
- Voice input with speech-to-text recognition and text-to-speech voice playback.
- Educational intent detection (formula sheets, MCQs, study plans).
- Full Markdown and LaTeX formula rendering with KaTeX.

---

## 🛠️ Stack & Dependencies

- **Frontend**: React 19, Vite 8, React Markdown, Rehype-KaTeX, Remark-GFM, Remark-Math.
- **Backend / Serverless**: Express 5, Vercel Serverless Functions (`/api/*`), Node.js.
- **Database / Storage**: PostgreSQL (`pg`) with automatic zero-overhead local JSON storage fallback (`.data/db.json`) when `DATABASE_URL` is omitted.
- **AI Models**: Google Gemini (`@google/generative-ai`, `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-flash-latest`).

---

## ⚙️ Environment Variables

Create `.env` (or configure in Vercel Project Settings) based on `.env.example`:

```bash
# Backend / Vercel Serverless
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=5001
CLIENT_ORIGIN=https://bodhi-sakha-phi.vercel.app

# Database (PostgreSQL / Supabase / Neon)
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Authentication
JWT_SECRET=your_jwt_secret_key_here

# Image Generation
IMAGE_API_KEY=your_image_api_key_here
```

---

## 💻 Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start Backend Server**:
   ```bash
   npm run server
   ```

3. **Start Frontend Dev Server**:
   ```bash
   npm run dev
   ```

4. **Run Tests & Linting**:
   ```bash
   npm test
   npm run lint
   npm run build
   ```

---

## 🔒 Security Architecture

- **Zero Client Keys**: Secrets and API keys are strictly kept server-side in Vercel functions or backend Express routes.
- **IDOR Protection**: Database queries strictly filter and verify user ownership (`user_id = $authId`) before reading, modifying, or deleting conversations, memories, or files.
- **Input Sanitization**: Request bodies, message lengths, and file sizes are strictly validated.
- **CORS & CSP**: Restricts API calls to authorized origins and enforces hardened Content Security Policies.

---

## 📄 License

MIT © [Mr. Aman Mishra](https://github.com/calligraphyguruji)
