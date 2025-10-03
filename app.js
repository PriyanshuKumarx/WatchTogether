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
        this.socketInitialized = false;
        
        this.init();
    }

    init() {
        this.currentUser = AuthManager.checkAuth();
        if (!this.currentUser) return;
        
        this.updateUserInterface();
        this.setupEventListeners();
        this.showRoomInfo();
        
        this.initializeYouTubePlayer();
        
        // Initialize socket.io with retry mechanism
        this.initializeSocketWithRetry();
        
        this.applySavedTheme();
    }

    initializeSocketWithRetry() {
        const maxRetries = 5;
        let retryCount = 0;
        
        const tryConnect = () => {
            if (typeof io !== 'undefined') {
                this.initializeSocket();
                this.socketInitialized = true;
            } else if (retryCount < maxRetries) {
                retryCount++;
                console.log(`Socket.io not loaded yet, retrying (${retryCount}/${maxRetries})...`);
                setTimeout(tryConnect, 1000);
            } else {
                this.showNotification('Failed to load socket.io. Please refresh the page.', 'error');
            }
        };
        
        tryConnect();
    }

    updateUserInterface() {
        const userAvatarSpan = document.querySelector('.user-avatar span');
        const usernameElement = document.querySelector('.username');
        
        if (userAvatarSpan) {
            userAvatarSpan.textContent = this.currentUser.username.charAt(0).toUpperCase();
        }
        
        if (usernameElement) {
            usernameElement.textContent = this.currentUser.username;
        }
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
        document.getElementById('videoUrl')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadVideo();
        });
        document.getElementById('connectBtn')?.addEventListener('click', () => this.toggleConnection());
        document.getElementById('sendMessage')?.addEventListener('click', () => this.sendChatMessage());
        document.getElementById('messageInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
        document.getElementById('themeToggle')?.addEventListener('click', () => this.toggleTheme());
        document.getElementById('userMenu')?.addEventListener('click', (e) => this.toggleUserMenu(e));
        document.getElementById('logoutBtn')?.addEventListener('click', () => AuthManager.logout());
        document.getElementById('shareRoom')?.addEventListener('click', () => this.shareRoom());
        document.getElementById('newRoom')?.addEventListener('click', () => this.createNewRoom());
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.user-menu')) {
                this.closeUserMenu();
            }
        });
        this.setupButtonAnimations();
    }

    setupButtonAnimations() {
        document.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', function() {
                this.classList.add('clicked');
                setTimeout(() => {
                    this.classList.remove('clicked');
                }, 300);
            });
        });
    }

    initializeSocket() {
        // Use io() without arguments to connect dynamically to the host serving the HTML
        this.socket = io(); 

        this.socket.on('connect', () => {
            this.showNotification('Connected to signaling server', 'success');
            console.log("✅ Connected to signaling server:", this.socket.id);
            this.socket.emit('join-room', this.roomId);
            this.updateConnectionStatus(false);
        });

        this.socket.on('user-joined', (userId) => {
            this.addChatMessage('System', 'A peer joined the room', true);
            this.showNotification('Peer joined the room', 'info');
        });

        this.socket.on('room-users', (users) => {
            this.isOfferer = users.length === 0;
            
            if (users.length > 0) {
                this.addChatMessage('System', `Found ${users.length} peer(s) in the room`, true);
                
                // If this client is the designated Offeror (first in room) 
                // AND has not yet initiated the connection, start the process.
                if (this.isOfferer && !this.peerConnection) {
                     this.connect(); 
                }
            }
        });

        this.socket.on('user-left', (userId) => {
            this.addChatMessage('System', 'A peer disconnected', true);
            this.showNotification('Peer disconnected', 'info');
            this.updateConnectionStatus(false);
        });

        this.socket.on('offer', async (data) => {
            console.log("📥 Received offer...");
            await this.handleOffer(data.offer, data.sender);
        });

        this.socket.on('answer', async (data) => {
            console.log("📥 Received answer...");
            await this.handleAnswer(data.answer);
        });

        this.socket.on('ice-candidate', async (data) => {
            if (this.peerConnection) {
                await this.handleIceCandidate(data.candidate);
            }
        });

        this.socket.on('video-state', (data) => {
            if (this.player && data.sender !== this.socket.id) {
                this.handleVideoStateChange(data);
            }
        });

        this.socket.on('chat-message', (data) => {
            this.addChatMessage(data.username, data.text, false);
        });

        this.socket.on('disconnect', () => {
            this.showNotification('Disconnected from server', 'error');
            this.updateConnectionStatus(false);
        });
    }

    initializeYouTubePlayer() {
        window.onYouTubeIframeAPIReady = () => {
            this.createPlayer();
        };
        if (window.YT && window.YT.Player && !this.player) {
             this.createPlayer();
        }
    }
    
    createPlayer() {
        const playerElement = document.getElementById('player');
        if (!playerElement) return;

        this.player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            playerVars: {
                'playsinline': 1,
                'controls': 1,
                'rel': 0,
                'modestbranding': 1,
                'disablekb': 1,
            },
            events: {
                'onStateChange': (e) => this.onPlayerStateChange(e),
                'onReady': (e) => this.onPlayerReady(e),
                'onError': (e) => this.onPlayerError(e)
            }
        });
    }

    loadVideo() {
        const url = document.getElementById('videoUrl').value.trim();
        if (!url) {
            this.showNotification('Please enter a YouTube URL', 'error');
            return;
        }
        
        if (!this.player || !this.player.loadVideoById) {
            this.showNotification('YouTube player is not ready yet. Please wait for initialization.', 'error');
            return;
        }

        const videoId = this.extractVideoId(url);
        if (videoId) {
            const loadBtn = document.getElementById('loadVideo');
            const originalHtml = loadBtn.innerHTML;
            loadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            loadBtn.disabled = true;

            try {
                this.player.loadVideoById(videoId);
                this.addChatMessage('System', `Video loaded: ${videoId}`, true);
                
                const playerOverlay = document.getElementById('playerOverlay');
                if (playerOverlay) {
                    playerOverlay.classList.add('hidden');
                }
                this.showNotification('Video loaded successfully', 'success');
                
            } catch (error) {
                this.showNotification('Error loading video. Player state invalid.', 'error');
            } finally {
                setTimeout(() => {
                    loadBtn.innerHTML = originalHtml;
                    loadBtn.disabled = false;
                }, 1000);
            }

        } else {
            this.addChatMessage('System', 'Invalid YouTube URL format', true);
            this.showNotification('Invalid YouTube URL', 'error');
        }
    }

    extractVideoId(url) {
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[7] && match[7].length === 11) ? match[7] : null;
    }

    toggleConnection() {
        if (this.isConnected) {
            this.disconnect();
        } else {
            this.connect();
        }
    }

    connect() {
        if (!this.socketInitialized) {
            this.showNotification('Socket connection not established yet. Please wait...', 'warning');
            return;
        }
        
        if (!this.peerConnection) {
            console.log("📡 Creating RTCPeerConnection...");
            this.setupPeerConnection();
            const connectBtn = document.getElementById('connectBtn');
            connectBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Connecting...';
            connectBtn.classList.add('connecting');
            this.addChatMessage('System', 'Attempting to connect to peers...', true);
            this.showNotification('Connecting to peers...', 'info');
        }
    }

    disconnect() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        
        const connectBtn = document.getElementById('connectBtn');
        connectBtn.innerHTML = '<i class="fas fa-plug"></i> Connect to Peers';
        connectBtn.classList.remove('connected', 'connecting');
        this.updateConnectionStatus(false);
        this.addChatMessage('System', 'Disconnected from peers', true);
    }

    updateConnectionStatus(connected) {
        this.isConnected = connected;
        const connectionStatus = document.getElementById('connectionStatus');
        const statusDot = document.querySelector('.status-dot');
        const connectBtn = document.getElementById('connectBtn');
        
        if (connectionStatus) {
            connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
        }
        
        if (statusDot) {
            if (connected) {
                statusDot.classList.add('connected');
            } else {
                statusDot.classList.remove('connected');
            }
        }

        if (connectBtn) {
             if (connected) {
                connectBtn.innerHTML = '<i class="fas fa-unlink"></i> Disconnect Peers';
                connectBtn.classList.add('connected');
                connectBtn.classList.remove('connecting');
            } else {
                connectBtn.innerHTML = '<i class="fas fa-plug"></i> Connect to Peers';
                connectBtn.classList.remove('connected', 'connecting');
            }
        }
    }

    setupPeerConnection() {
        const configuration = {
            iceServers: [
                // Robust STUN servers for improved connection reliability
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(configuration);
        
        // Create data channel with proper options
        this.dataChannel = this.peerConnection.createDataChannel('chat', { 
            ordered: true,
            maxRetransmits: 3
        });
        this.setupDataChannel();
        
        this.peerConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannel();
        };
        
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                console.log("📤 Sending ICE candidate...");
                this.socket.emit('ice-candidate', {
                    target: this.roomId,
                    candidate: event.candidate
                });
            }
        };
        
        this.peerConnection.onconnectionstatechange = () => {
            console.log("Connection state changed to:", this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'connected') {
                this.updateConnectionStatus(true);
                this.addChatMessage('System', 'Peer connected successfully', true);
            } else if (this.peerConnection.connectionState === 'disconnected' || 
                       this.peerConnection.connectionState === 'failed') {
                this.updateConnectionStatus(false);
                this.addChatMessage('System', 'Peer connection failed or lost', true);
            }
        };
        
        // Properly handle negotiation needed
        this.peerConnection.onnegotiationneeded = async () => {
            console.log("Negotiation needed");
            if (this.isOfferer) {
                await this.createOffer();
            }
        };
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => {
            this.addChatMessage('System', 'Chat data channel opened', true);
        };
        
        this.dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.addChatMessage(message.username, message.text, false);
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        };
        
        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
        };
        
        this.dataChannel.onclose = () => {
            this.addChatMessage('System', 'Chat data channel closed', true);
        };
    }

    async createOffer() {
        if (!this.peerConnection) return;
        
        try {
            console.log("📤 Sending offer...");
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', { target: this.roomId, offer: offer });
        } catch (error) {
            console.error('Error creating offer:', error);
            this.showNotification('Error creating connection offer', 'error');
        }
    }

    async handleOffer(offer, senderId) {
        if (!this.peerConnection) {
            this.setupPeerConnection();
        }
        
        try {
            await this.peerConnection.setRemoteDescription(offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            console.log("📤 Sending answer...");
            this.socket.emit('answer', { target: senderId, answer: answer });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(answer);
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(candidate) {
        try {
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(candidate);
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    onPlayerReady(event) {
        const playerOverlay = document.getElementById('playerOverlay');
        if (playerOverlay) {
            playerOverlay.classList.add('hidden');
        }
    }

    onPlayerStateChange(event) {
        if (!this.isConnected || window.ignorePlayerStateChange) {
            window.ignorePlayerStateChange = false;
            return;
        }
        
        try {
            const state = {
                sender: this.socket.id,
                state: event.data,
                currentTime: this.player.getCurrentTime(),
                videoId: this.player.getVideoData().video_id
            };
            
            if (state.state === YT.PlayerState.PLAYING || state.state === YT.PlayerState.PAUSED) {
                this.socket.emit('video-state', {
                    target: this.roomId,
                    ...state
                });
            }
        } catch (error) {
            console.error("Error sending video state:", error);
        }
    }

    onPlayerError(event) {
        console.error('YouTube player error:', event.data);
        this.showNotification(`YouTube error: ${event.data}`, 'error');
    }

    handleVideoStateChange(data) {
        if (!this.player) return;
        
        window.ignorePlayerStateChange = true;
        
        const playerState = this.player.getPlayerState();
        
        switch(data.state) {
            case YT.PlayerState.PLAYING: 
                if (Math.abs(this.player.getCurrentTime() - data.currentTime) > 2) {
                    this.player.seekTo(data.currentTime, true);
                }
                if (playerState !== YT.PlayerState.PLAYING) {
                    this.player.playVideo();
                }
                break;
                
            case YT.PlayerState.PAUSED: 
                if (Math.abs(this.player.getCurrentTime() - data.currentTime) > 2) {
                    this.player.seekTo(data.currentTime, true);
                }
                if (playerState !== YT.PlayerState.PAUSED) {
                    this.player.pauseVideo();
                }
                break;
                
            case YT.PlayerState.CUED: 
                if (this.player.getVideoData().video_id !== data.videoId) {
                    this.player.loadVideoById(data.videoId);
                }
                break;
        }
    }

    sendChatMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        if (!message) return;

        const messageData = {
            username: this.currentUser.username,
            text: message,
            timestamp: new Date().toLocaleTimeString()
        };

        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(messageData));
            this.addChatMessage('You', message, false, true);
        } 
        else if (this.socket && this.socket.connected) {
            this.socket.emit('chat-message', {
                target: this.roomId,
                message: message,
                username: this.currentUser.username,
                timestamp: messageData.timestamp
            });
            this.addChatMessage('You', message, false, true);
        } 
        else {
            this.addChatMessage('You', message, false, true);
            this.showNotification('No peers connected. Message sent locally only.', 'warning');
        }

        messageInput.value = '';
    }

    addChatMessage(username, text, isSystem = false, isSelf = false) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        
        const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        if (isSystem) {
            messageElement.classList.add('system');
            messageElement.innerHTML = `<div class="message-text">${text}</div>`;
        } else if (isSelf) {
            messageElement.classList.add('self');
            messageElement.innerHTML = `
                <div class="message-meta">
                    <span class="username">${username}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>
                <div class="message-text">${text}</div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-meta">
                    <span class="username">${username}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>
                <div class="message-text">${text}</div>
            `;
        }

        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // UI/UX Helpers
    toggleTheme() {
        const themeToggle = document.getElementById('themeToggle');
        const isLight = document.documentElement.classList.toggle('light-theme');
        
        if (themeToggle) {
            themeToggle.innerHTML = isLight ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        }
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    }
    
    applySavedTheme() {
        const savedTheme = localStorage.getItem('theme');
        const themeToggle = document.getElementById('themeToggle');
        if (savedTheme === 'light') {
            document.documentElement.classList.add('light-theme');
            if (themeToggle) {
                themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
            }
        }
    }

    toggleUserMenu(e) {
        e.stopPropagation();
        const userMenu = document.getElementById('userDropdown');
        userMenu.classList.toggle('hidden');
    }

    closeUserMenu() {
        const userMenu = document.getElementById('userDropdown');
        if (userMenu) {
            userMenu.classList.add('hidden');
        }
    }

    shareRoom() {
        const shareUrl = `${window.location.origin}${window.location.pathname}?room=${this.roomId}`;
        this.copyToClipboard(shareUrl);
        this.showNotification('Room link copied to clipboard!', 'success');
    }

    createNewRoom() {
        const newRoomId = `room-${Math.random().toString(36).substr(2, 9)}`;
        window.location.href = `app.html?room=${newRoomId}`;
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).catch(err => {
            console.error('Failed to copy text: ', err);
            this.showNotification('Failed to copy to clipboard', 'error');
        });
    }

    showNotification(message, type = 'info') {
        const notificationArea = document.getElementById('notificationArea');
        if (!notificationArea) return; 
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };

        notification.innerHTML = `
            <i class="fas fa-${icons[type] || 'info-circle'}"></i>
            <span>${message}</span>
        `;

        notificationArea.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideInRight 0.3s ease reverse';
            setTimeout(() => {
                if (notification.parentNode) notification.remove();
            }, 300);
        }, 5000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.app-container')) {
        new YouTubeWatchTogether();
    }
});