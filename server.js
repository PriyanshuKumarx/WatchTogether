// server.js (Final Functional Backend)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors'); 
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// --- Security and Storage Setup ---
const users = new Map();
const rooms = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'development-fallback-key-do-not-use-in-prod'; 

// --- CORS Configuration ---
const allowedOrigins = [
    'http://127.0.0.1:5500', 
    'http://localhost:5500',
    'http://127.0.0.1:3000', 
    'http://localhost:3000',
    'https://syncstream-app.onrender.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'), false);
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};

// Initialize Socket.IO with CORS settings
const io = new Server(server, {
    cors: corsOptions
});

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
    }
}
initializeMockUsers();


// --- Middleware and Static Serving ---
app.use(cors(corsOptions));
app.use(express.json()); 
app.use(express.static(path.join(__dirname))); 

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

// --- Auth API ---
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
        if (users.has(email)) return res.status(409).json({ error: 'User with this email already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = { id: uuidv4(), username, email, password: hashedPassword, createdAt: new Date() };
        users.set(email, user);

        const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error) {
        console.error('Signup error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
    }
});

app.post('/api/auth/signin', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        const user = users.get(email);
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ error: 'Invalid email or password' });

        const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error) {
        console.error('Signin error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
    }
});

// --- Socket.io Events (WebRTC Signaling) ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId) => {
        if (socket.roomId) { socket.leave(socket.roomId); }
        socket.join(roomId);
        socket.roomId = roomId;
        
        if (!rooms.has(roomId)) { rooms.set(roomId, { users: [] }); }
        const room = rooms.get(roomId);
        
        if (!room.users.includes(socket.id)) { room.users.push(socket.id); }
        
        socket.emit('room-users', room.users.filter(id => id !== socket.id));
        socket.to(roomId).emit('user-joined', socket.id);
    });

    // WebRTC Signaling Handlers
    // 🔑 FIX: Broadcast all offer/ice candidates within the room 
    // (since we are using data channels and not individual sockets for signaling)
    socket.on('offer', (data) => { socket.to(socket.roomId).emit('offer', { offer: data.offer, sender: socket.id }); });
    socket.on('answer', (data) => { io.to(data.target).emit('answer', { answer: data.answer, sender: socket.id }); });
    socket.on('ice-candidate', (data) => { socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id }); });
    
    // Video Sync & Chat
    socket.on('video-state', (data) => { socket.to(socket.roomId).emit('video-state', { ...data, sender: socket.id }); });
    socket.on('chat-message', (data) => { socket.to(socket.roomId).emit('chat-message', { username: data.username, text: data.message, timestamp: data.timestamp }); });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                room.users = room.users.filter(id => id !== socket.id);
                socket.to(socket.roomId).emit('user-left', socket.id);
                if (room.users.length === 0) { rooms.delete(socket.roomId); }
            }
            socket.leave(socket.roomId);
        }
    });
});

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Visit http://localhost:${PORT}`);
});