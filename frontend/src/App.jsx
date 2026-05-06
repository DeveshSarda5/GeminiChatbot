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

      const response = await fetch(`${API_BASE_URL}/message`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const data = await response.json();
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
          <p className="eyebrow">Gemini 2.5 Flash</p>
          <h1>Chatbot Workspace</h1>
          <p className="muted">
            Ask questions, attach notes, and inspect images in one running chat context.
          </p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Session</h2>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
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

          <button type="button" className="secondary-button" onClick={handleNewChat} disabled={isSending}>
            New Chat
          </button>
        </div>

        <div className="panel">
          <h2>Context</h2>
          <div className="upload-stack">
            <button
              type="button"
              className="upload-button"
              onClick={() => documentInputRef.current?.click()}
              disabled={isSending}
            >
              Upload Document
            </button>
            <button
              type="button"
              className="upload-button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isSending}
            >
              Upload Image
            </button>
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
          <div className="status-pill">{isSending ? statusText : "Live"}</div>
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
            <button type="submit" className="primary-button" disabled={!canSend}>
              {draftFile ? "Send with file" : "Send"}
            </button>
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
