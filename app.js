// app.js (UPDATED for WebRTC Video Chat)
// Note: This updated file assumes the corresponding HTML elements (localVideo, remoteVideos) 
// and auth logic exist as required by the combined code structure.

class VideoChatApplication {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peers = {}; // Map to store RTCPeerConnection instances
        this.player = null; // Kept for structural consistency, but player functions removed
        this.roomId = this.generateRoomId();
        this.isConnected = false;
        this.currentUser = null;
        
        this.init();
    }

    async init() {
        this.currentUser = AuthManager.checkAuth();
        if (!this.currentUser) return;
        
        this.updateUserInterface();
        this.setupEventListeners();
        this.showRoomInfo();

        await this.getMediaStream();
        
        this.initializeSocket();
        this.applySavedTheme();
    }
    
    // --- Media and UI Setup ---

    updateUserInterface() {
        const userAvatarSpan = document.querySelector('.user-avatar span');
        const usernameElement = document.querySelector('.username');
        
        if (userAvatarSpan) {
            userAvatarSpan.textContent = this.currentUser.username.charAt(0).toUpperCase();
        }
        
        if (usernameElement) {
            usernameElement.textContent = this.currentUser.username;
        }
        
        // Assume an HTML element with id 'localVideo' exists in app.html
        const localVideo = document.getElementById("localVideo");
        if (localVideo && this.localStream) {
            localVideo.srcObject = this.localStream;
        }
    }
    
    async getMediaStream() {
        try {
            // Request video and audio permissions
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            
            const localVideoElement = document.getElementById("localVideo");
            if (localVideoElement) {
                localVideoElement.srcObject = this.localStream;
                localVideoElement.autoplay = true;
                localVideoElement.playsInline = true;
                localVideoElement.muted = true; // Mute local video
            } else {
                this.showNotification('Could not find local video element. Check app.html.', 'error');
            }
        } catch (error) {
            console.error("Error accessing media devices:", error);
            this.showNotification('Error accessing video/mic. Please grant permissions.', 'error');
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
        // Removed loadVideo functionality - not relevant for video chat app
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

    // --- Signaling and Connection (WebRTC Peer & Socket) ---

    initializeSocket() {
        // FIX: Hardcoded to localhost:5000 as requested in the new code block
        this.socket = io("http://localhost:5000"); 

        this.socket.on('connect', () => {
            this.showNotification('Connected to signaling server', 'success');
            this.socket.emit('join-room', this.roomId);
            this.updateConnectionStatus(false);
        });

        this.socket.on('room-users', (users) => {
            users.forEach((userId) => {
                // Initiator is true for existing users
                this.createPeerConnection(userId, true);
            });
        });
        
        this.socket.on('user-joined', (userId) => {
            this.addChatMessage('System', 'A peer joined the room', true);
            // Initiator is true for new users
            this.createPeerConnection(userId, true);
        });

        this.socket.on('user-left', (userId) => {
            this.removePeer(userId);
            this.addChatMessage('System', 'A peer disconnected', true);
            this.showNotification('Peer disconnected', 'info');
        });

        this.socket.on('offer', async (data) => {
            await this.handleOffer(data);
        });

        this.socket.on('answer', async (data) => {
            await this.handleAnswer(data);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data);
        });

        this.socket.on('chat-message', (data) => {
            this.addChatMessage(data.username, data.text, false);
        });

        this.socket.on('disconnect', () => {
            this.showNotification('Disconnected from server', 'error');
            this.updateConnectionStatus(false);
        });
    }
    
    toggleConnection() {
        // Since WebRTC video chat automatically tries to connect peers when they join, 
        // this button is now repurposed to disconnect all peers and stop local media.
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Close all existing peer connections
        Object.keys(this.peers).forEach(userId => this.removePeer(userId));

        if (this.socket) {
            this.socket.disconnect();
        }
        
        this.updateConnectionStatus(false);
        this.showNotification('Video session ended.', 'info');
    }
    
    removePeer(userId) {
        if (this.peers[userId]) {
            this.peers[userId].close();
            delete this.peers[userId];
            document.getElementById(userId)?.remove();
            
            // Check if any peer is left to update connection status
            if (Object.keys(this.peers).length === 0) {
                 this.updateConnectionStatus(false);
            }
        }
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
                connectBtn.innerHTML = '<i class="fas fa-unlink"></i> Stop Video Chat';
                connectBtn.classList.add('connected');
                connectBtn.classList.remove('connecting');
            } else {
                connectBtn.innerHTML = '<i class="fas fa-plug"></i> Start Video Chat';
                connectBtn.classList.remove('connected', 'connecting');
            }
        }
    }
    
    createPeerConnection(userId, initiator) {
        if (this.peers[userId]) return this.peers[userId];
        if (!this.localStream) {
            this.showNotification('Local media not available.', 'error');
            return null;
        }

        const peer = new RTCPeerConnection({
             iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        });
        this.peers[userId] = peer;
        
        // Add local stream tracks to peer connection
        this.localStream.getTracks().forEach((track) => {
            peer.addTrack(track, this.localStream);
        });

        // Handle remote stream
        peer.ontrack = (event) => {
            let video = document.getElementById(userId);
            if (!video) {
                // Create a new video element for the remote stream
                const remoteVideosContainer = document.querySelector(".video-section"); 
                video = document.createElement("video");
                video.id = userId;
                video.autoplay = true;
                video.playsInline = true;
                video.classList.add("remote-video");
                remoteVideosContainer.appendChild(video);
                this.updateConnectionStatus(true);
            }
            video.srcObject = event.streams[0];
        };

        // ICE candidate
        peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit("ice-candidate", { candidate: event.candidate, target: userId });
            }
        };
        
        // If initiator, create offer
        if (initiator) {
            peer.onnegotiationneeded = async () => {
                try {
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    this.socket.emit("offer", { offer, target: userId });
                } catch (error) {
                    console.error("Error creating offer:", error);
                }
            };
        }

        return peer;
    }

    async handleOffer(data) {
        // Not initiator, so this client is the answerer
        const peer = this.createPeerConnection(data.sender, false); 
        
        try {
            await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            this.socket.emit("answer", { answer, target: data.sender });
        } catch (error) {
            console.error("Error handling offer:", error);
        }
    }

    async handleAnswer(data) {
        const peer = this.peers[data.sender];
        if (peer) {
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
            } catch (error) {
                 console.error("Error handling answer:", error);
            }
        }
    }

    async handleIceCandidate(data) {
        const peer = this.peers[data.sender];
        if (peer && data.candidate) {
            try {
                await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.error("Error adding ICE candidate:", err);
            }
        }
    }
    
    // --- Chat Functionality ---

    sendChatMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();
        if (!message) return;

        const timestamp = new Date().toLocaleTimeString();
        this.addChatMessage(this.currentUser.username, message, false, true);

        // Send chat message via Socket.IO to all peers in the room
        this.socket.emit('chat-message', {
            target: this.roomId,
            message: message,
            username: this.currentUser.username,
            timestamp: timestamp
        });

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
    
    // --- UI/UX Helpers (Retained) ---

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

// Rename the application initialization to reflect the new functionality
document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.app-container')) {
        new VideoChatApplication();
    }
});