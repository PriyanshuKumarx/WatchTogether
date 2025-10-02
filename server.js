const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors'); 
const dotenv = require('dotenv'); 

// Load environment variables from .env file
dotenv.config();

const app = express();
const server = http.createServer(app);
// FIX: Use PORT 5000 as the new default for the WebRTC app
const PORT = process.env.PORT || 5000; 

// --- Security and Storage Setup ---
const users = new Map();
// FIX: The rooms Map will now primarily store user IDs for signaling
const rooms = new Map(); 
const JWT_SECRET = process.env.JWT_SECRET || 'development-fallback-key-do-not-use-in-prod'; 

// Mock Initial User (for testing sign-in)
async function initializeMockUsers() {
    const mockUserEmail = 'test@user.com';
    if (!users.has(mockUserEmail)) {
        const mockPassword = 'password';
        const hashedPassword = await bcrypt.hash(mockPassword, 10);
        users.set(mockUserEmail, {
            id: uuidv4(),
            username: 'TestUser',
            email: mockUserEmail,
            password: hashedPassword,
            createdAt: new Date()
        });
        console.log('Mock user created: test@user.com / password');
    }
}
initializeMockUsers();


// --- CORS and Middleware Setup ---
// Standard CORS for API endpoints
const corsOptions = {
    origin: '*', // Loosened for API access from Render/local clients
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json()); 
app.use(express.static(path.join(__dirname))); 

// Initialize Socket.IO with WebRTC-friendly CORS settings
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for signaling server access
        methods: ["GET", "POST"],
        credentials: true
    }
});

// --- HTML Routes ---
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/auth.html', (req, res) => { res.sendFile(path.join(__dirname, 'auth.html')); });
app.get('/app.html', (req, res) => { res.sendFile(path.join(__dirname, 'app.html')); });
app.get('/about.html', (req, res) => { res.sendFile(path.join(__dirname, 'about.html')); });
app.get('/contact.html', (req, res) => { res.sendFile(path.join(__dirname, 'contact.html')); });
app.get('/privacy.html', (req, res) => { res.sendFile(path.join(__dirname, 'privacy.html')); });
app.get('/terms.html', (req, res) => { res.sendFile(path.join(__dirname, 'terms.html')); });
app.get('/cookie.html', (req, res) => { res.sendFile(path.join(__dirname, 'cookie.html')); });
app.get('/blog.html', (req, res) => { res.sendFile(path.join(__dirname, 'blog.html')); });


// --- Auth API Endpoints (FROM ORIGINAL SERVER.JS) ---
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (users.has(email)) {
            return res.status(409).json({ error: 'User with this email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = { id: uuidv4(), username, email, password: hashedPassword, createdAt: new Date() };
        users.set(email, user);

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });

    } catch (error) {
        console.error('Signup error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error. Check server logs.' });
        }
    }
});

app.post('/api/auth/signin', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = users.get(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });

    } catch (error) {
        console.error('Signin error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error. Check server logs.' });
        }
    }
});

// --- Socket.io WebRTC Signaling Handling (CONSOLIDATED) ---
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId) => {
        if (socket.roomId) socket.leave(socket.roomId);
        socket.join(roomId);
        socket.roomId = roomId;

        if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: [] });
        }

        const room = rooms.get(roomId);
        if (!room.users.includes(socket.id)) {
            room.users.push(socket.id);
        }

        // Send back room users (except self)
        socket.emit("room-users", room.users.filter(id => id !== socket.id));
        socket.to(roomId).emit("user-joined", socket.id);
    });

    // WebRTC signaling
    socket.on("offer", (data) => {
        socket.to(data.target).emit("offer", {
            offer: data.offer,
            sender: socket.id
        });
    });

    socket.on("answer", (data) => {
        socket.to(data.target).emit("answer", {
            answer: data.answer,
            sender: socket.id
        });
    });

    socket.on("ice-candidate", (data) => {
        socket.to(data.target).emit("ice-candidate", {
            candidate: data.candidate,
            sender: socket.id
        });
    });

    // Chat (Shared Channel)
    socket.on("chat-message", (data) => {
        // Broadcast to everyone in the room except the sender
        socket.to(socket.roomId).emit("chat-message", {
            username: data.username,
            text: data.message,
            timestamp: data.timestamp
        });
    });

    // Disconnect
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);

        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                room.users = room.users.filter(id => id !== socket.id);
                // Notify others in the room
                socket.to(socket.roomId).emit("user-left", socket.id);
                if (room.users.length === 0) { rooms.delete(socket.roomId); }
            }
        }
    });
});

// --- Server Listen ---
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view the application`);
});