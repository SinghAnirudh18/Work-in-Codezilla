const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const login = require('./routes/loginandsignup');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const doctorSignup = require('./routes/doctorsignup');
const appointment = require('./routes/appointment');
const ChatMessage = require('./models/ChatMessage');

const {GoogleGenerativeAI} = require('@google/generative-ai')
// Google Translate API
const { translate } = require('@vitalets/google-translate-api');

require('dotenv').config();

const app = express();
app.use(cookieParser());
const genAI = new GoogleGenerativeAI("AIzaSyBcqJQl9hXGYo1Gf8Od3iaparO2kXj-zNg");
const server = http.createServer(app);
const io = new Server(server);

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(login);
app.use(doctorSignup);
app.use(appointment);

mongoose.connect('mongodb://localhost:27017/codezilla');

// Translation with fallback
async function translateTextWithFallback(text, targetLang, sourceLang = 'auto') {
    try {
        return await translateText(text, targetLang, sourceLang);
    } catch (error) {
        console.log('Primary translation failed, trying alternative method...');
        try {
            const { translate: translateAlt } = require('@vitalets/google-translate-api');
            const result = await translateAlt(text, { to: targetLang });
            return {
                text: result.text || text,
                translated: true,
                originalText: text,
                sourceLang: result.from || sourceLang,
                targetLang
            };
        } catch (altError) {
            console.error('All translation methods failed:', altError.message);
            return { text, translated: false, error: `Translation failed: ${error.message}`, originalText: text, sourceLang, targetLang };
        }
    }
}

async function translateText(text, targetLang, sourceLang = 'auto') {
    try {
        if (sourceLang === targetLang) {
            return { text, translated: false, originalText: text, sourceLang, targetLang };
        }
        console.log(`Translating: "${text}" from ${sourceLang} to ${targetLang}`);
        const result = await translate(text, { to: targetLang, from: sourceLang === 'auto' ? undefined : sourceLang });
        if (!result || !result.text) throw new Error('Invalid translation result');
        const detectedLang = result.from?.language?.iso || result.from?.language || result.from || sourceLang;
        console.log(`Translation successful: "${result.text}" (${detectedLang} → ${targetLang})`);

        return { text: result.text, translated: true, originalText: text, sourceLang: detectedLang, targetLang };
    } catch (error) {
        console.error('Translation error:', error.message);
        return { text, translated: false, error: error.message, originalText: text, sourceLang, targetLang };
    }
}

// Room + language data
const roomRoles = {};
const userLanguages = {};
const roomMessages = {};
const ROLE_LANGUAGES = { doctor: 'en', patient: 'hi' };

// Helper to process and send messages (used for both chat & STT)
async function processMessage(socket, { roomId, text, senderRole }) {
    const senderLang = userLanguages[socket.id];
    const timestamp = new Date();
    const baseMessage = {
        sender: senderRole,
        senderRole,
        originalText: text,
        sourceLang: senderLang,
        timestamp,
        socketId: socket.id
    };

    // Save to history
    roomMessages[roomId].push(baseMessage);
    await ChatMessage.create({
    sessionId: roomId,
    sender: senderRole,
    senderRole,
    originalText: text,
    translatedText: null, // or translation.text if you want
    translated: false,    // will be true if you store translated version
    sourceLang: senderLang,
    targetLang: null,     // fill if known
    timestamp
});
    // Send to everyone in room
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (!roomSockets) return;

    for (const userId of roomSockets) {
        const targetSocket = io.sockets.sockets.get(userId);
        if (!targetSocket) continue;
        const targetLang = userLanguages[userId];
        let messageToSend = { ...baseMessage };

        if (userId === socket.id) {
            messageToSend.message = text;
            messageToSend.isOriginal = true;
            messageToSend.translated = false;
        } else {
            const translation = await translateTextWithFallback(text, targetLang, senderLang);
            messageToSend.message = translation.text;
            messageToSend.translated = translation.translated;
            messageToSend.isOriginal = false;
            if (translation.translated) {
                messageToSend.translationInfo = {
                    originalText: text,
                    sourceLang: translation.sourceLang,
                    targetLang: translation.targetLang
                };
            }
            if (translation.error) {
                messageToSend.translationError = translation.error;
            }
        }
        targetSocket.emit("chat-message", messageToSend);
    }
}

// Routes
app.get("/summarise/:meetingid", async (req, res) => {
  try {
    const meetingId = req.params.meetingid;

    // 1️⃣ Get all messages for that meeting in time order
    const messages = await ChatMessage.find({ sessionId: meetingId })
      .sort({ timestamp: 1 })
      .lean();

    if (!messages.length) {
      return res.status(404).json({ error: "No messages found for this meeting" });
    }

    // 2️⃣ Prepare conversation text
    const conversationText = messages
      .map(
        (msg) =>
          `[${msg.timestamp.toISOString()}] ${msg.senderRole || msg.sender}: ${msg.originalText}`
      )
      .join("\n");

    // 3️⃣ Build prompt for Gemini
    const prompt = `
You are an AI meeting assistant.
Summarise the following meeting in bullet points, highlighting:
- Key discussion topics
- Decisions made
- Action items with responsible persons

Conversation:
${conversationText}
    `;

    // 4️⃣ Call Gemini API
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const summary = result.response.text();

    // 5️⃣ Return summary
    
    res.render("summary", { meetingId, summary });
  } catch (error) {
    console.error("Error generating summary:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get('/home', (req, res) => {
    if (req.cookies.token2) return res.render('home2');
    res.render('home');
});
app.get('/', (req, res) => res.render('main'));
app.get('/clear-cookies', (req, res) => {
    for (let cookieName in req.cookies) res.clearCookie(cookieName);
    res.send('All cookies cleared!');
});
app.get("/meet", (req, res) => res.render("index", { roomId: 101 }));
app.get("/room/:roomId", (req, res) => res.render("room", { roomId: req.params.roomId }));

app.post("/api/stt/result", (req, res) => {
    const { text, roomId, role } = req.body;
    console.log(`[STT] [${roomId}] ${role} -> ${text}`);
    if (text && roomId) io.to(roomId).emit("stt-message", { text, role, roomId });
    res.sendStatus(200);
});

app.get('/api/room/:roomId/messages', (req, res) => {
    res.json(roomMessages[req.params.roomId] || []);
});
app.get('/api/languages', (req, res) => {
    res.json({ en: 'English', hi: 'Hindi' });
});
app.post('/api/user/language', (req, res) => {
    const { socketId, language } = req.body;
    if (userLanguages[socketId]) {
        userLanguages[socketId] = language;
        const targetSocket = io.sockets.sockets.get(socketId);
        if (targetSocket) targetSocket.emit('language-changed', language);
        res.json({ success: true });
    } else res.status(404).json({ error: 'User not found' });
});
app.post('/api/translate', async (req, res) => {
    try {
        const { text, targetLang, sourceLang } = req.body;
        res.json(await translateTextWithFallback(text, targetLang, sourceLang));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Socket.IO
io.on("connection", (socket) => {
    console.log('User connected:', socket.id);

    socket.on("join-room", (roomId) => {
        socket.join(roomId);

        if (!roomRoles[roomId]) {
            roomRoles[roomId] = { doctor: null, patient: null };
            roomMessages[roomId] = [];
        }

        let assignedRole;
        if (!roomRoles[roomId].doctor) {
            roomRoles[roomId].doctor = socket.id;
            assignedRole = "doctor";
        } else if (!roomRoles[roomId].patient) {
            roomRoles[roomId].patient = socket.id;
            assignedRole = "patient";
        } else {
            socket.emit("room-full");
            return;
        }

        userLanguages[socket.id] = ROLE_LANGUAGES[assignedRole];
        socket.emit("role-assigned", assignedRole);
        socket.emit("language-assigned", ROLE_LANGUAGES[assignedRole]);

        console.log(`User ${socket.id} -> Role: ${assignedRole}, Lang: ${ROLE_LANGUAGES[assignedRole]}`);
        socket.to(roomId).emit("user-connected", socket.id);

        // Send message history translated to new user's language
        (async () => {
            for (const msg of roomMessages[roomId]) {
                const targetLang = userLanguages[socket.id];
                const translation = await translateTextWithFallback(msg.originalText, targetLang, msg.sourceLang);
                socket.emit("chat-message", {
                    ...msg,
                    message: translation.text,
                    translated: translation.translated,
                    translationInfo: translation.translated ? translation : null,
                    translationError: translation.error || null
                });
            }
        })();

        // WebRTC pass-through
        socket.on("offer", (data) => socket.to(roomId).emit("offer", { ...data, from: socket.id }));
        socket.on("answer", (data) => socket.to(roomId).emit("answer", { ...data, from: socket.id }));
        socket.on("ice-candidate", (data) => socket.to(roomId).emit("ice-candidate", data));

        // Chat message
        socket.on("chat-message", async ({ roomId, message }) => {
            let senderRole = roomRoles[roomId]?.doctor === socket.id ? "doctor" :
                             roomRoles[roomId]?.patient === socket.id ? "patient" : null;
            if (senderRole) await processMessage(socket, { roomId, text: message, senderRole });
        });

        // STT message
        socket.on("stt-message", async ({ text, roomId }) => {
            let senderRole = roomRoles[roomId]?.doctor === socket.id ? "doctor" :
                             roomRoles[roomId]?.patient === socket.id ? "patient" : null;
            if (senderRole) await processMessage(socket, { roomId, text, senderRole });
        });

        socket.on("disconnect", () => {
            console.log('User disconnected:', socket.id);
            for (const roomId in roomRoles) {
                if (roomRoles[roomId].doctor === socket.id) roomRoles[roomId].doctor = null;
                if (roomRoles[roomId].patient === socket.id) roomRoles[roomId].patient = null;
                if (!roomRoles[roomId].doctor && !roomRoles[roomId].patient) {
                    delete roomRoles[roomId];
                    delete roomMessages[roomId];
                }
            }
            delete userLanguages[socket.id];
            socket.broadcast.emit("user-disconnected", socket.id);
        });
    });
});

server.listen(3000, () => {
    console.log("Server running at http://localhost:3000");
    console.log("Doctor language: English (en)");
    console.log("Patient language: Hindi (hi)");
});
