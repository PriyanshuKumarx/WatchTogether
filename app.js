// Enhanced YouTube Watch Together Application
class YouTubeWatchTogether {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.player = null;
        this.roomId = this.generateRoomId();
        this.isConnected = false;
        this.isOfferer = false;
        this.currentUser = null;
        this.peers = []; // 🔑 NEW: Store current peer IDs for targeting

        this.init();
    }

    init() {
        this.currentUser = AuthManager.checkAuth();
        if (!this.currentUser) return;

        this.updateUserInterface();
        this.setupEventListeners();
        this.showRoomInfo();
        this.initializeYouTubePlayer();
        this.initializeSocket();
        this.applySavedTheme();
    }

    updateUserInterface() {
        const userAvatarSpan = document.querySelector('.user-avatar span');
        const usernameElement = document.querySelector('.username');
        if (userAvatarSpan) userAvatarSpan.textContent = this.currentUser.username.charAt(0).toUpperCase();
        if (usernameElement) usernameElement.textContent = this.currentUser.username;
    }

    generateRoomId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('room') || `room-${Math.random().toString(36).substr(2, 9)}`;
    }

    showRoomInfo() {
        const roomInfoElement = document.getElementById('roomInfo');
        if (roomInfoElement) {
            roomInfoElement.textContent = `Room: ${this.roomId}`;
            roomInfoElement.addEventListener('click', () => {
                this.copyToClipboard(this.roomId);
                this.showNotification('Room ID copied to clipboard!', 'success');
            });
        }
    }

    setupEventListeners() {
        document.getElementById('loadVideo')?.addEventListener('click', () => this.loadVideo());
        document.getElementById('videoUrl')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.loadVideo(); });
        document.getElementById('connectBtn')?.addEventListener('click', () => this.toggleConnection());
        document.getElementById('sendMessage')?.addEventListener('click', () => this.sendChatMessage());
        document.getElementById('messageInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.sendChatMessage(); });
        document.getElementById('themeToggle')?.addEventListener('click', () => this.toggleTheme());
        document.getElementById('userMenu')?.addEventListener('click', (e) => this.toggleUserMenu(e));
        document.getElementById('logoutBtn')?.addEventListener('click', () => AuthManager.logout());
        document.getElementById('shareRoom')?.addEventListener('click', () => this.shareRoom());
        document.getElementById('newRoom')?.addEventListener('click', () => this.createNewRoom());
        document.addEventListener('click', (e) => { if (!e.target.closest('.user-menu')) this.closeUserMenu(); });
        this.setupButtonAnimations();
    }

    setupButtonAnimations() {
        document.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', function () {
                this.classList.add('clicked');
                setTimeout(() => { this.classList.remove('clicked'); }, 300);
            });
        });
    }

    initializeSocket() {
        // ✅ FIX: Explicitly connect to the Node.js Socket.IO server on port 3000
        this.socket = io("http://127.0.0.1:3000");

        this.socket.on('connect', () => {
            this.showNotification('Connected to signaling server', 'success');
            console.log("✅ Connected:", this.socket.id);
            this.socket.emit('join-room', this.roomId);
            this.updateConnectionStatus(false);
        });

        this.socket.on('user-joined', (userId) => { 
            this.addChatMessage('System', 'A peer joined the room', true); 
            this.showNotification('Peer joined', 'info'); 
            
            // Add new peer to the list
            if (!this.peers.includes(userId)) this.peers.push(userId);
            
            // If we are the offeror and a new peer joins, we can start the connection now
            if (this.isOfferer && !this.peerConnection) this.connect();
        });

        this.socket.on('room-users', (users) => {
            this.peers = users; // 🔑 FIX: Store the initial list of peers
            this.isOfferer = users.length === 0;
            
            if (users.length > 0) console.log(`Found ${users.length} peers.`);
            
            // If users are already in the room (and we are the offeror), start connection
            if (this.isOfferer && !this.peerConnection && users.length > 0) this.connect();
        });
        
        this.socket.on('user-left', (userId) => { 
            this.addChatMessage('System', 'A peer disconnected', true); 
            this.peers = this.peers.filter(id => id !== userId); // Remove disconnected peer
            this.updateConnectionStatus(false); 
        });

        this.socket.on('offer', async (data) => { console.log("📥 Received offer..."); await this.handleOffer(data.offer, data.sender); });
        this.socket.on('answer', async (data) => { console.log("📥 Received answer..."); await this.handleAnswer(data.answer); });
        this.socket.on('ice-candidate', async (data) => { await this.handleIceCandidate(data.candidate); });
        this.socket.on('video-state', (data) => { if (this.player && data.sender !== this.socket.id) this.handleVideoStateChange(data); });
        this.socket.on('chat-message', (data) => this.addChatMessage(data.username, data.text, false));
        this.socket.on('disconnect', () => this.updateConnectionStatus(false));
    }

    initializeYouTubePlayer() {
        window.onYouTubeIframeAPIReady = () => this.createPlayer();
        if (window.YT && window.YT.Player && !this.player) this.createPlayer();
    }

    createPlayer() {
        const playerElement = document.getElementById('player');
        if (!playerElement) return;
        this.player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            playerVars: { playsinline: 1, controls: 1, rel: 0, modestbranding: 1, disablekb: 1 },
            events: { 'onStateChange': (e) => this.onPlayerStateChange(e), 'onReady': (e) => this.onPlayerReady(e) }
        });
    }

    loadVideo() {
        const url = document.getElementById('videoUrl').value.trim();
        if (!url) return this.showNotification('Please enter a YouTube URL', 'error');
        const videoId = this.extractVideoId(url);
        if (!videoId) return this.showNotification('Invalid YouTube URL', 'error');
        this.player.loadVideoById(videoId);
        this.addChatMessage('System', `Video loaded: ${videoId}`, true);
        this.showNotification('Video loaded successfully', 'success');
        document.getElementById('playerOverlay')?.classList.add('hidden');
    }

    extractVideoId(url) {
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[7] && match[7].length === 11) ? match[7] : null;
    }

    toggleConnection() { this.isConnected ? this.disconnect() : this.connect(); }

    connect() {
        const connectBtn = document.getElementById('connectBtn');
        if (!this.peerConnection) {
            this.setupPeerConnection();
            connectBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Connecting...';
            connectBtn.classList.add('connecting');
            this.addChatMessage('System', 'Attempting to connect to peers...', true);
            this.showNotification('Connecting to peers...', 'info');
        }
    }

    disconnect() {
        this.peerConnection?.close(); this.peerConnection = null;
        this.dataChannel?.close(); this.dataChannel = null;
        this.updateConnectionStatus(false);
        this.addChatMessage('System', 'Disconnected from peers', true);
    }

    updateConnectionStatus(connected) {
        this.isConnected = connected;
        const connectionStatus = document.getElementById('connectionStatus');
        const statusDot = document.querySelector('.status-dot');
        const connectBtn = document.getElementById('connectBtn');
        
        if (connectionStatus) connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
        if (statusDot) statusDot.classList.toggle('connected', connected);
        
        if (connectBtn) {
            connectBtn.classList.remove('connecting');
            connectBtn.innerHTML = connected 
                ? '<i class="fas fa-unlink"></i> Disconnect Peers' 
                : '<i class="fas fa-plug"></i> Connect to Peers';
            connectBtn.classList.toggle('connected', connected);
        }
    }

    setupPeerConnection() {
        // Robust STUN servers for improved WebRTC reliability
        const configuration = { iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }, 
            { urls: 'stun:stun.services.mozilla.com' }, 
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]};
        
        this.peerConnection = new RTCPeerConnection(configuration);

        this.dataChannel = this.peerConnection.createDataChannel('chat', { negotiated: true, id: 0 });
        this.setupDataChannel();
        this.peerConnection.ondatachannel = (event) => { this.dataChannel = event.channel; this.setupDataChannel(); };

        this.peerConnection.onicecandidate = (event) => { 
            if (event.candidate) {
                // 🔑 FIX: Send ICE candidate to all available peers individually
                for (const peerId of this.peers) {
                    this.socket.emit('ice-candidate', { target: peerId, candidate: event.candidate });
                }
            }
        };
        this.peerConnection.onconnectionstatechange = () => { this.updateConnectionStatus(this.peerConnection.connectionState === 'connected'); };
        this.peerConnection.onnegotiationneeded = async () => { if (this.isOfferer) await this.createOffer(); };
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => this.addChatMessage('System', 'Chat channel opened (Peer-to-Peer)', true);
        this.dataChannel.onmessage = (event) => {
            try { const message = JSON.parse(event.data); this.addChatMessage(message.username, message.text, false); } 
            catch (e) { console.error('Error parsing message:', e); }
        };
    }

    async createOffer() {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        // 🔑 FIX: Send offer to all current peers
        for (const peerId of this.peers) {
            this.socket.emit('offer', { target: peerId, offer: offer });
        }
    }

    async handleOffer(offer, senderId) {
        if (!this.peerConnection) this.setupPeerConnection();
        await this.peerConnection.setRemoteDescription(offer);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        this.socket.emit('answer', { target: senderId, answer: answer });
    }

    async handleAnswer(answer) { await this.peerConnection.setRemoteDescription(answer); }

    async handleIceCandidate(candidate) { await this.peerConnection.addIceCandidate(candidate); }

    onPlayerReady() { document.getElementById('playerOverlay')?.classList.add('hidden'); }

    onPlayerStateChange(event) {
        if (!this.isConnected || window.ignorePlayerStateChange) { window.ignorePlayerStateChange = false; return; }
        if (!this.player) return;
        const state = { sender: this.socket.id, state: event.data, currentTime: this.player.getCurrentTime(), videoId: this.player.getVideoData().video_id };
        if (state.state === YT.PlayerState.PLAYING || state.state === YT.PlayerState.PAUSED) {
            // Target the whole room for video sync 
            this.socket.emit('video-state', { target: this.roomId, ...state });
        }
    }

    handleVideoStateChange(data) {
        if (!this.player) return;
        window.ignorePlayerStateChange = true;
        const playerState = this.player.getPlayerState();
        
        if (data.state === YT.PlayerState.PLAYING) { 
             // Seek only if difference is significant (to minimize constant seeking)
            if (Math.abs(this.player.getCurrentTime() - data.currentTime) > 1) this.player.seekTo(data.currentTime, true); 
            if (playerState !== YT.PlayerState.PLAYING) this.player.playVideo(); 
        } else if (data.state === YT.PlayerState.PAUSED) { 
            if (Math.abs(this.player.getCurrentTime() - data.currentTime) > 1) this.player.seekTo(data.currentTime, true); 
            if (playerState !== YT.PlayerState.PAUSED) this.player.pauseVideo(); 
        } else if (data.state === YT.PlayerState.CUED && this.player.getVideoData().video_id !== data.videoId) { 
            this.player.loadVideoById(data.videoId); 
        }
    }

    sendChatMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        if (!message) return;
        const messageData = { username: this.currentUser.username, text: message, timestamp: new Date().toLocaleTimeString() };

        // 1. Prefer WebRTC DataChannel (if open)
        if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(messageData));
        }
        // 2. Fallback to Socket.IO (if connected)
        else if (this.socket?.connected) {
            this.socket.emit('chat-message', { target: this.roomId, message, username: this.currentUser.username, timestamp: messageData.timestamp });
        }
        
        this.addChatMessage('You', message, false, true);
        messageInput.value = '';
    }

    addChatMessage(username, text, isSystem = false, isSelf = false) {
        const chatMessages = document.getElementById('chatMessages'); if (!chatMessages) return;
        const messageElement = document.createElement('div'); messageElement.className = 'chat-message';
        const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        messageElement.classList.toggle('system', isSystem); 
        messageElement.classList.toggle('self', isSelf);
        
        // Simplified message content structure for robust chat:
        messageElement.innerHTML = `
            <div class="message-meta">
                <span class="username">${username}</span>
                <span class="timestamp">${timestamp}</span>
            </div>
            <div class="message-text">${text}</div>
        `;
        
        chatMessages.appendChild(messageElement); chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // UI/UX Helpers
    toggleTheme() {
        const isLight = document.documentElement.classList.toggle('light-theme');
        document.getElementById('themeToggle')?.innerHTML = isLight ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    }

    applySavedTheme() { if (localStorage.getItem('theme') === 'light') document.documentElement.classList.add('light-theme'); }

    toggleUserMenu(e) { e.stopPropagation(); document.getElementById('userDropdown')?.classList.toggle('hidden'); }
    closeUserMenu() { document.getElementById('userDropdown')?.classList.add('hidden'); }
    shareRoom() { this.copyToClipboard(`${window.location.origin}${window.location.pathname}?room=${this.roomId}`); }
    createNewRoom() { window.location.href = `app.html?room=room-${Math.random().toString(36).substr(2, 9)}`; }
    copyToClipboard(text) { navigator.clipboard.writeText(text).catch(err => console.error('Copy failed:', err)); }
    
    // NOTE: Notification implementation should be added here, as included in your previous CSS
    showNotification(message, type = 'info') { 
        const notificationArea = document.getElementById('notificationArea');
        if (!notificationArea) return; 

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `<span>${message}</span>`; // Simplified structure for quick fix
        
        notificationArea.appendChild(notification);
        setTimeout(() => notification.remove(), 5000); 
    }
}

document.addEventListener('DOMContentLoaded', () => { if (document.querySelector('.app-container')) new YouTubeWatchTogether(); });