const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// In-memory chat storage: { chatId: { history: [], docText: "", imageData: null } }
const chatStorage = {};

// Multer config: store files temporarily on disk
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "text/plain", "image/png", "image/jpeg"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Unsupported file type"));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Helper: extract text from PDF or TXT
async function extractText(file) {
  if (file.mimetype === "application/pdf") {
    const dataBuffer = fs.readFileSync(file.path);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } else if (file.mimetype === "text/plain") {
    return fs.readFileSync(file.path, "utf-8");
  }
  return null;
}

// Helper: read image as base64
function readImageAsBase64(file) {
  const buffer = fs.readFileSync(file.path);
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: file.mimetype,
    },
  };
}

// Helper: clean up temp file
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn("Could not delete temp file:", filePath);
  }
}

function getFriendlyErrorMessage(err) {
  if (!err) {
    return "Something went wrong. Please try again.";
  }

  if (typeof err.message === "string") {
    try {
      const parsed = JSON.parse(err.message);
      const providerError = parsed?.error;

      if (providerError?.code === 503 || providerError?.status === "UNAVAILABLE") {
        return "Gemini is temporarily experiencing high demand. Please try again in a moment.";
      }

      if (providerError?.message) {
        return providerError.message;
      }
    } catch (_) {
      // Fall through to the plain message checks below.
    }

    if (err.message.includes("503") || err.message.includes("UNAVAILABLE")) {
      return "Gemini is temporarily experiencing high demand. Please try again in a moment.";
    }
  }

  return err.message || "Internal server error";
}

// POST /api/chat/message
router.post("/message", upload.single("file"), async (req, res) => {
  try {
    const { chatId, message } = req.body;

    if (!chatId) return res.status(400).json({ error: "chatId is required" });
    if (!message && !req.file)
      return res.status(400).json({ error: "Message or file is required" });

    // Initialise session if new
    if (!chatStorage[chatId]) {
      chatStorage[chatId] = { history: [], docText: "", imageData: null };
    }
    const session = chatStorage[chatId];

    // Process uploaded file
    let fileInfo = null;
    if (req.file) {
      const mime = req.file.mimetype;
      if (mime === "application/pdf" || mime === "text/plain") {
        const text = await extractText(req.file);
        session.docText = text;
        fileInfo = { type: "document", name: req.file.originalname };
      } else if (mime === "image/png" || mime === "image/jpeg") {
        session.imageData = readImageAsBase64(req.file);
        fileInfo = { type: "image", name: req.file.originalname };
      }
      cleanupFile(req.file.path);
    }

    // Build the content parts for this turn
    const parts = [];

    // Inject document context if present
    if (session.docText) {
      parts.push({
        text: `[Uploaded Document Content]:\n${session.docText}\n\n`,
      });
    }

    // Inject image if present
    if (session.imageData) {
      parts.push(session.imageData);
    }

    // Append the user message
    if (message) {
      parts.push({ text: message });
    }

    // Build full contents array: history + new user turn
    const contents = [
      ...session.history,
      { role: "user", parts },
    ];

    // Call Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
    });

    const botText = response.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I could not generate a response.";

    // Save exchange to history (keep parts lean for history — text only)
    session.history.push({
      role: "user",
      parts: [{ text: message || "(file uploaded)" }],
    });
    session.history.push({
      role: "model",
      parts: [{ text: botText }],
    });

    res.json({
      response: botText,
      fileInfo,
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: getFriendlyErrorMessage(err) });
  }
});

// POST /api/chat/reset
router.post("/reset", (req, res) => {
  const { chatId } = req.body;
  if (chatId && chatStorage[chatId]) {
    delete chatStorage[chatId];
  }
  res.json({ success: true, message: "Chat reset successfully" });
});

// GET /api/chat/session/:chatId — check session info
router.get("/session/:chatId", (req, res) => {
  const session = chatStorage[req.params.chatId];
  if (!session) return res.json({ exists: false });
  res.json({
    exists: true,
    messageCount: session.history.length,
    hasDocument: !!session.docText,
    hasImage: !!session.imageData,
  });
});

module.exports = router;
