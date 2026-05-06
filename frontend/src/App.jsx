import { useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/chat";
const FILE_READY_PROMPT =
  "A file was uploaded. Briefly confirm it is ready and mention what I can ask about it.";
const THEME_KEY = "gemini-chat-theme";
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

function createChatId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `chat-${Date.now()}`;
}

function createMessage(role, content, extra = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    ...extra,
  };
}

function formatTimestamp(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function parseError(response) {
  try {
    const data = await response.json();
    return data.error || "Request failed.";
  } catch (_) {
    return "Request failed.";
  }
}

async function sendToGemini(formData, onRetry) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/message`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await parseError(response);
        if (response.status === 503 && attempt < MAX_RETRIES - 1) {
          lastError = error;
          const delay = RETRY_DELAY * (attempt + 1);
          onRetry?.(attempt + 1, MAX_RETRIES, delay);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(error);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES - 1) {
        throw err;
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [chatId, setChatId] = useState(() => createChatId());
  const [messages, setMessages] = useState(() => [
    createMessage(
      "assistant",
      "Start with a message, upload a document, or share an image. I will keep the context for this chat until you start a new one.",
      { createdAt: Date.now() }
    ),
  ]);
  const [message, setMessage] = useState("");
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [draftFile, setDraftFile] = useState(null);
  const [draftFileType, setDraftFileType] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [statusText, setStatusText] = useState("Ready");
  const [error, setError] = useState("");
  const messagesEndRef = useRef(null);
  const documentInputRef = useRef(null);
  const imageInputRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    if (!draftFile || draftFileType !== "image") {
      setImagePreview("");
      return undefined;
    }

    const url = URL.createObjectURL(draftFile);
    setImagePreview(url);

    return () => URL.revokeObjectURL(url);
  }, [draftFile, draftFileType]);

  async function sendToChat({ text = "", file = null, uploadLabel = "" } = {}) {
    if (!text.trim() && !file) {
      return;
    }

    const userText = text.trim() || uploadLabel || "File uploaded";
    const outgoingMessage = createMessage("user", userText, {
      createdAt: Date.now(),
      attachmentName: file?.name || "",
    });

    setMessages((current) => [...current, outgoingMessage]);
    setIsSending(true);
    setError("");
    setStatusText(file ? "Uploading and sending to Gemini..." : "Waiting for Gemini...");

    try {
      const formData = new FormData();
      formData.append("chatId", chatId);
      if (text.trim()) {
        formData.append("message", text.trim());
      } else if (file) {
        formData.append("message", FILE_READY_PROMPT);
      }

      if (file) {
        formData.append("file", file);
      }

      const data = await sendToGemini(formData, (attempt, max, delay) => {
        setStatusText(`Gemini is busy. Retrying (${attempt}/${max}) in ${delay / 1000}s...`);
      });

      const assistantText = data.response || "I could not generate a response.";

      setMessages((current) => [
        ...current,
        createMessage("assistant", assistantText, {
          createdAt: Date.now(),
          fileInfo: data.fileInfo || null,
        }),
      ]);

      if (file) {
        if (data.fileInfo?.type === "document") {
          setSelectedDocument(file);
          setSelectedImage((current) => current);
        }

        if (data.fileInfo?.type === "image") {
          setSelectedImage(file);
          setSelectedDocument((current) => current);
        }
      }

      setDraftFile(null);
      setDraftFileType("");
      setStatusText("Ready");
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setMessages((current) => [
        ...current,
        createMessage(
          "assistant",
          err.message || "Something went wrong while talking to the server.",
          { createdAt: Date.now(), isError: true }
        ),
      ]);
      setStatusText("Request failed");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const text = message;
    const file = draftFile;
    setMessage("");
    await sendToChat({ text, file, uploadLabel: file ? `Attached ${draftFileType}: ${file.name}` : "" });
  }

  function handleFileUpload(event, type) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const isValidDocument =
      type === "document" &&
      ["application/pdf", "text/plain"].includes(file.type);
    const isValidImage =
      type === "image" &&
      ["image/png", "image/jpeg"].includes(file.type);

    if (!isValidDocument && !isValidImage) {
      setError(type === "document" ? "Only PDF and TXT files are supported." : "Only PNG and JPG images are supported.");
      return;
    }

    setError("");
    setDraftFile(file);
    setDraftFileType(type);
    setStatusText(type === "document" ? "Document attached" : "Image attached");
  }

  async function handleNewChat() {
    setIsSending(true);
    setError("");

    try {
      await fetch(`${API_BASE_URL}/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chatId }),
      });
    } catch (_) {
      // Even if reset fails, the UI should still start fresh locally.
    } finally {
      const freshChatId = createChatId();
      setChatId(freshChatId);
      setMessages([
        createMessage(
          "assistant",
          "Fresh chat started. No documents or images are attached to this conversation yet.",
          { createdAt: Date.now() }
        ),
      ]);
      setSelectedDocument(null);
      setSelectedImage(null);
      setDraftFile(null);
      setDraftFileType("");
      setImagePreview("");
      setMessage("");
      setStatusText("New chat ready");
      setIsSending(false);
    }
  }

  function clearDraftAttachment() {
    setDraftFile(null);
    setDraftFileType("");
    setImagePreview("");
    setStatusText("Ready");
  }

  const canSend = !isSending && (message.trim().length > 0 || !!draftFile);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <p className="eyebrow">Gemini 2.5 Flash</p>
              <h1>Chatbot</h1>
            </div>
            <button
              type="button"
              className="icon-button theme-toggle-btn"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
          <p className="muted">
            Ask questions, attach notes, and inspect images in one running chat context.
          </p>
          <button type="button" className="primary-button new-chat-btn" onClick={handleNewChat} disabled={isSending}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 8 }}>
              <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            New Chat
          </button>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Session</h2>
          </div>

          <div className="session-grid">
            <div className="session-stat">
              <span>Messages</span>
              <strong>{Math.max(messages.length - 1, 0)}</strong>
            </div>
            <div className="session-stat">
              <span>Document</span>
              <strong>{selectedDocument ? "Loaded" : "None"}</strong>
            </div>
            <div className="session-stat">
              <span>Image</span>
              <strong>{selectedImage ? "Loaded" : "None"}</strong>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Context</h2>
          <div className="upload-stack" style={{ display: "none" }}>
            <input
              ref={documentInputRef}
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              hidden
              onChange={(event) => handleFileUpload(event, "document")}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              hidden
              onChange={(event) => handleFileUpload(event, "image")}
            />
          </div>

          <div className="asset-list">
            <div className="asset-card">
              <span className="asset-label">Active document</span>
              <strong>{selectedDocument?.name || "No document in context"}</strong>
            </div>
            <div className="asset-card">
              <span className="asset-label">Active image</span>
              <strong>{selectedImage?.name || "No image in context"}</strong>
            </div>
          </div>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Current chat</p>
            <h2>Context-aware Gemini assistant</h2>
            <p className="header-copy">
              Attach a file, add your question, and send both together.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div className="status-pill">{isSending ? statusText : "Live"}</div>
            <button
              type="button"
              className="icon-button theme-toggle-btn"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleNewChat}
              disabled={isSending}
              style={{ padding: "10px 16px", minWidth: "auto", borderRadius: "16px", fontSize: "0.9rem" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 6 }}>
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              New Chat
            </button>
          </div>
        </header>

        <section className="messages">
          {messages.map((entry) => (
            <article
              key={entry.id}
              className={`message-row ${entry.role === "user" ? "user-row" : "assistant-row"}`}
            >
              <div className={`message-bubble ${entry.role === "user" ? "user-bubble" : "assistant-bubble"} ${entry.isError ? "error-bubble" : ""}`}>
                <div className="message-meta">
                  <span>{entry.role === "user" ? "You" : "Gemini"}</span>
                  <time>{formatTimestamp(entry.createdAt)}</time>
                </div>
                <p>{entry.content}</p>
                {entry.attachmentName ? (
                  <span className="attachment-chip">{entry.attachmentName}</span>
                ) : null}
              </div>
            </article>
          ))}

          {isSending ? (
            <article className="message-row assistant-row">
              <div className="message-bubble assistant-bubble typing-bubble">
                <div className="message-meta">
                  <span>Gemini</span>
                  <time>...</time>
                </div>
                <div className="typing-dots" aria-label="Gemini is typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
          ) : null}

          <div ref={messagesEndRef} />
        </section>

        <footer className="composer-wrap">
          {draftFile ? (
            <div className="draft-attachment">
              <div className="draft-attachment-main">
                {draftFileType === "image" && imagePreview ? (
                  <img src={imagePreview} alt="Pending upload preview" className="draft-image-preview" />
                ) : (
                  <div className="draft-file-icon">{draftFileType === "document" ? "PDF" : "IMG"}</div>
                )}
                <div>
                  <span className="draft-label">
                    {draftFileType === "image" ? "Image attached" : "Document attached"}
                  </span>
                  <strong>{draftFile.name}</strong>
                  <p>
                    {draftFileType === "image"
                      ? "Ask a question and send it with the image."
                      : "Ask a question and send it with the document."}
                  </p>
                </div>
              </div>
              <button type="button" className="clear-attachment" onClick={clearDraftAttachment} disabled={isSending}>
                Remove
              </button>
            </div>
          ) : null}

          <form className="composer" onSubmit={handleSubmit}>
            <div className="composer-textarea-wrapper">
              <button
                type="button"
                className="icon-button"
                onClick={() => documentInputRef.current?.click()}
                disabled={isSending}
                title="Attach Document"
                aria-label="Attach Document"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 2H6C4.9 2 4.01 2.9 4.01 4L4 20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor"/>
                </svg>
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isSending}
                title="Attach Image"
                aria-label="Attach Image"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M21 19V5C21 3.9 20.1 3 19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19ZM8.5 13.5L11 16.5L14.5 12L19 18H5L8.5 13.5Z" fill="currentColor"/>
                </svg>
              </button>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  draftFile
                    ? "Add your question for this attachment."
                    : "Message Gemini"
                }
                rows={1}
                disabled={isSending}
              />
            </div>
            <div className="composer-buttons">
              <button type="submit" className="primary-button" disabled={!canSend}>
                {draftFile ? "Send with file" : "Send"}
              </button>
            </div>
          </form>

          <div className="composer-footer">
            <span>Chat ID: {chatId.slice(0, 8)}</span>
            <span>{statusText}</span>
          </div>

          {error ? <p className="error-text">{error}</p> : null}
        </footer>
      </main>
    </div>
  );
}
