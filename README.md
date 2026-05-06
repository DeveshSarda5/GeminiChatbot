# Gemini Chatbot

A full-stack Gemini chatbot application with a modern, clean interface inspired by popular AI assistants like ChatGPT and Google Gemini. Built with React and Node.js, it provides a seamless experience for text chat, document analysis, and image recognition with an elegant lavender-themed UI.

## Features

- Interactive text chat with conversation history
- PDF and TXT document upload and analysis directly from the chat input
- PNG and JPG image upload and vision capabilities with buttons right in the composer, similar to Gemini/ChatGPT
- Real-time image preview
- Light and dark mode with an intuitive theme switch button and elegant lavender color scheme
- Context-aware chat sessions
- A prominent "New Chat" button to quickly reset sessions and clear previous context
- Interactive UI elements with dynamic hover effects
- Responsive, modern interface inspired by Gemini/ChatGPT
- In-memory state management

## Tech Stack

- **Frontend**: React 18 + Vite, with modern CSS for styling
- **Backend**: Node.js + Express.js
- **AI Model**: Google Gemini 2.5 Flash
- **Styling**: Custom CSS with CSS variables for theming

## Project Structure

```
Gemini_Chatbot/
├── backend/
│   ├── routes/
│   │   └── chatRoutes.js
│   ├── uploads/
│   ├── server.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── package.json
└── README.md
```

## Installation

### Prerequisites
- Node.js 16 or higher
- npm or yarn
- Google Gemini API key

### Backend Setup

```bash
cd backend
npm install
```

### Frontend Setup

```bash
cd frontend
npm install
```

## Configuration

### Environment Variables

Create `backend/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=5000
FRONTEND_URL=http://localhost:5173
```

Optional: Create `frontend/.env.local` for deployed setups:

```env
VITE_API_BASE_URL=http://localhost:5000/api/chat
```

## Running the Application

### Development Mode

Open two terminal windows:

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Or use root shortcuts:
```bash
npm run backend:dev
npm run frontend:dev
```

The frontend will be available at `http://localhost:5173` and the backend at `http://localhost:5000`.

## Usage Guide

1. **Start a chat**: Open the application and begin typing messages
2. **Upload documents**: Click the document icon in the chat input to analyze PDF or TXT files
3. **Upload images**: Click the image icon in the chat input to analyze PNG or JPG images
4. **Preview**: View uploaded images before sending
5. **Switch themes**: Toggle between light and dark modes using the sun/moon theme switch button
6. **Start fresh**: Click the prominent "New Chat" button to begin a new conversation and clear the previous context

## API Reference

### Chat Endpoints

**POST `/api/chat/message`**
Send a message with optional file attachment

Multipart form data:
- `chatId`: Chat session identifier (required)
- `message`: Text message (optional if file included)
- `file`: Document or image file (PDF, TXT, PNG, JPG)

**POST `/api/chat/reset`**
Reset a chat session and clear context

JSON body:
```json
{
  "chatId": "session-id"
}
```

**GET `/api/chat/session/:chatId`**
Check session status and context state

Response:
```json
{
  "exists": boolean,
  "hasDocument": boolean,
  "hasImage": boolean
}
```

## Design

The application features a modern interface with:
- **Lavender/Purple Theme**: An elegant alternative to typical blue-based AI assistant designs
- **Light Mode**: Light lavender background (#faf5ff) with purple accents for daytime use
- **Dark Mode**: Deep purple background (#1a0f2e) with light lavender text for evening use
- **Responsive Layout**: Sidebar navigation with main chat panel
- **Clean Typography**: Optimized for readability and visual hierarchy

## Notes

- Chat state is stored in memory and cleared on server restart
- Uploaded files are processed temporarily and automatically deleted after use
- No database or persistent storage is implemented
- No authentication is included; suitable for local or trusted environments
- Maximum file sizes depend on server configuration

## Future Enhancements

- Database integration for persistent chat history
- User authentication and accounts
- Chat export and sharing
- Advanced file type support
- Streaming responses
- Customizable system prompts

## License

MIT License - feel free to use this project for learning or as a starting point for your own application.
