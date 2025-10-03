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
        this.peers = new Map(); // Track multiple peers
        this.myPeerId = null;
        this.lastVideoState = null; // Track last video state to prevent duplicate events
        this.syncThrottle = 100; // Throttle video sync events to prevent flooding
        this.lastSyncTime = 0; // Track last sync time
        
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
            this.myPeerId = this.socket.id;
            this.showNotification('Connected to signaling server', 'success');
            console.log("✅ Connected to signaling server:", this.socket.id);
            this.socket.emit('join-room', this.roomId);
            this.updateConnectionStatus(false);
        });

        this.socket.on('user-joined', (userId) => {
            this.addChatMessage('System', `User ${userId} joined the room`, true);
            this.showNotification('Peer joined the room', 'info');
            // Create a new peer connection for this user
            this.createPeerConnection(userId, true);
        });

        this.socket.on('room-users', (users) => {
            console.log('Users in room:', users);
            // Connect to existing users
            users.forEach(userId => {
                if (userId !== this.myPeerId && !this.peers.has(userId)) {
                    this.createPeerConnection(userId, false);
                }
            });
        });

        this.socket.on('user-left', (userId) => {
            this.addChatMessage('System', `User ${userId} disconnected`, true);
            this.showNotification('Peer disconnected', 'info');
            // Clean up the peer connection
            if (this.peers.has(userId)) {
                const peerConnection = this.peers.get(userId);
                peerConnection.close();
                this.peers.delete(userId);
            }
            this.updateConnectionStatus(this.peers.size > 0);
        });

        this.socket.on('offer', async (data) => {
            console.log("📥 Received offer from", data.sender);
            await this.handleOffer(data.offer, data.sender);
        });

        this.socket.on('answer', async (data) => {
            console.log("📥 Received answer from", data.sender);
            await this.handleAnswer(data.answer, data.sender);
        });

        this.socket.on('ice-candidate', async (data) => {
            console.log("📥 Received ICE candidate from", data.sender);
            await this.handleIceCandidate(data.candidate, data.sender);
        });

        this.socket.on('video-state', (data) => {
            if (this.player && data.sender !== this.myPeerId) {
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

    createPeerConnection(userId, isInitiator) {
        console.log(`Creating peer connection for user ${userId}, initiator: ${isInitiator}`);
        
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        };
        
        const peerConnection = new RTCPeerConnection(configuration);
        this.peers.set(userId, peerConnection);
        
        // Create data channel if we're the initiator
        if (isInitiator) {
            const dataChannel = peerConnection.createDataChannel('video-sync', { 
                ordered: true,
                maxRetransmits: 3
            });
            this.setupDataChannel(dataChannel, userId);
        } else {
            peerConnection.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, userId);
            };
        }
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                console.log("📤 Sending ICE candidate to", userId);
                this.socket.emit('ice-candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };
        
        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state with ${userId} changed to:`, peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                this.updateConnectionStatus(true);
                this.addChatMessage('System', `Connected to peer ${userId}`, true);
            } else if (peerConnection.connectionState === 'disconnected' || 
                       peerConnection.connectionState === 'failed') {
                this.updateConnectionStatus(this.peers.size > 0);
                this.addChatMessage('System', `Connection to peer ${userId} failed or lost`, true);
            }
        };
        
        // Start the connection process if we're the initiator
        if (isInitiator) {
            this.createOffer(userId);
        }
    }

    setupDataChannel(dataChannel, userId) {
        dataChannel.onopen = () => {
            console.log(`Data channel opened with ${userId}`);
            this.addChatMessage('System', `Data channel opened with peer ${userId}`, true);
        };
        
        dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'video-state') {
                    this.handleVideoStateChange(data.payload);
                } else if (data.type === 'chat') {
                    this.addChatMessage(data.payload.username, data.payload.text, false);
                }
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        };
        
        dataChannel.onerror = (error) => {
            console.error(`Data channel error with ${userId}:`, error);
        };
        
        dataChannel.onclose = () => {
            console.log(`Data channel closed with ${userId}`);
            this.addChatMessage('System', `Data channel closed with peer ${userId}`, true);
        };
    }

    async createOffer(userId) {
        const peerConnection = this.peers.get(userId);
        if (!peerConnection) return;
        
        try {
            console.log(`📤 Creating offer for ${userId}`);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', { 
                target: userId, 
                offer: offer 
            });
        } catch (error) {
            console.error(`Error creating offer for ${userId}:`, error);
            this.showNotification('Error creating connection offer', 'error');
        }
    }

    async handleOffer(offer, senderId) {
        const peerConnection = this.peers.get(senderId);
        if (!peerConnection) {
            this.createPeerConnection(senderId, false);
        }
        
        try {
            console.log(`📥 Setting remote description for ${senderId}`);
            await this.peers.get(senderId).setRemoteDescription(offer);
            const answer = await this.peers.get(senderId).createAnswer();
            await this.peers.get(senderId).setLocalDescription(answer);
            
            console.log(`📤 Sending answer to ${senderId}`);
            this.socket.emit('answer', { 
                target: senderId, 
                answer: answer 
            });
        } catch (error) {
            console.error(`Error handling offer from ${senderId}:`, error);
        }
    }

    async handleAnswer(answer, senderId) {
        const peerConnection = this.peers.get(senderId);
        if (!peerConnection) return;
        
        try {
            console.log(`📥 Setting remote description (answer) for ${senderId}`);
            await peerConnection.setRemoteDescription(answer);
        } catch (error) {
            console.error(`Error handling answer from ${senderId}:`, error);
        }
    }

    async handleIceCandidate(candidate, senderId) {
        const peerConnection = this.peers.get(senderId);
        if (!peerConnection) return;
        
        try {
            console.log(`📥 Adding ICE candidate from ${senderId}`);
            await peerConnection.addIceCandidate(candidate);
        } catch (error) {
            console.error(`Error adding ICE candidate from ${senderId}:`, error);
        }
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
        
        this.addChatMessage('System', 'Attempting to connect to peers...', true);
        this.showNotification('Connecting to peers...', 'info');
        
        // If we're already in a room, the connections should be handled by the socket events
        if (this.peers.size === 0) {
            this.showNotification('No other users in the room. Share the room link to invite others.', 'info');
        }
    }

    disconnect() {
        // Close all peer connections
        this.peers.forEach((peerConnection, userId) => {
            peerConnection.close();
        });
        this.peers.clear();
        
        const connectBtn = document.getElementById('connectBtn');
        connectBtn.innerHTML = '<i class="fas fa-plug"></i> Connect to Peers';
        connectBtn.classList.remove('connected', 'connecting');
        this.updateConnectionStatus(false);
        this.addChatMessage('System', 'Disconnected from all peers', true);
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

    onPlayerReady(event) {
        const playerOverlay = document.getElementById('playerOverlay');
        if (playerOverlay) {
            playerOverlay.classList.add('hidden');
        }
    }

    onPlayerStateChange(event) {
        // Throttle video state changes to prevent flooding
        const now = Date.now();
        if (now - this.lastSyncTime < this.syncThrottle) {
            return;
        }
        this.lastSyncTime = now;
        
        if (!this.isConnected || window.ignorePlayerStateChange) {
            window.ignorePlayerStateChange = false;
            return;
        }
        
        try {
            const currentState = {
                state: event.data,
                currentTime: this.player.getCurrentTime(),
                videoId: this.player.getVideoData().video_id
            };
            
            // Only send if the state has actually changed
            if (!this.lastVideoState || 
                this.lastVideoState.state !== currentState.state ||
                Math.abs(this.lastVideoState.currentTime - currentState.currentTime) > 0.5) {
                
                this.lastVideoState = currentState;
                
                const state = {
                    sender: this.myPeerId,
                    ...currentState
                };
                
                // Only send play/pause state changes immediately
                if (state.state === YT.PlayerState.PLAYING || state.state === YT.PlayerState.PAUSED) {
                    // Send through socket.io for reliability
                    this.socket.emit('video-state', {
                        target: this.roomId,
                        ...state
                    });
                    
                    // Also send through WebRTC data channels for lower latency
                    this.peers.forEach((peerConnection, userId) => {
                        const dataChannels = peerConnection.dataChannels || [];
                        dataChannels.forEach(dataChannel => {
                            if (dataChannel.readyState === 'open') {
                                dataChannel.send(JSON.stringify({
                                    type: 'video-state',
                                    payload: state
                                }));
                            }
                        });
                    });
                }
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
        
        // Set flag to prevent echo
        window.ignorePlayerStateChange = true;
        
        // Clear the flag after a short delay
        setTimeout(() => {
            window.ignorePlayerStateChange = false;
        }, 500);
        
        const playerState = this.player.getPlayerState();
        
        // Always seek to the correct time first
        if (Math.abs(this.player.getCurrentTime() - data.currentTime) > 0.5) {
            this.player.seekTo(data.currentTime, true);
        }
        
        // Then handle play/pause state
        switch(data.state) {
            case YT.PlayerState.PLAYING: 
                if (playerState !== YT.PlayerState.PLAYING) {
                    this.player.playVideo();
                }
                break;
                
            case YT.PlayerState.PAUSED: 
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

        // Send through socket.io for reliability
        this.socket.emit('chat-message', {
            target: this.roomId,
            message: message,
            username: this.currentUser.username,
            timestamp: messageData.timestamp
        });
        
        // Also send through WebRTC data channels for lower latency
        this.peers.forEach((peerConnection, userId) => {
            const dataChannels = peerConnection.dataChannels || [];
            dataChannels.forEach(dataChannel => {
                if (dataChannel.readyState === 'open') {
                    dataChannel.send(JSON.stringify({
                        type: 'chat',
                        payload: messageData
                    }));
                }
            });
        });
        
        this.addChatMessage('You', message, false, true);
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