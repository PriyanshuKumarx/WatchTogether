// Authentication functionality (Client-side)

// 🔑 FIX: Set the base URL for the deployed API service.
// REPLACE THIS PLACEHOLDER with your actual live Render domain (e.g., https://syncstream-app.onrender.com)
const API_BASE_URL = "https://your-render-service-name.onrender.com"; 


class AuthManager {
    constructor() {
        this.currentUser = null;
        this.isSignUp = false;
        this.init();
    }

    init() {
        if (document.getElementById('authForm')) {
            this.handleUrlParams();
            this.setupEventListeners();
        }
        // Run checkAuthState on all pages to ensure session is valid
        this.checkAuthState();
    }

    checkAuthState() {
        const token = localStorage.getItem('authToken');
        const user = localStorage.getItem('currentUser');
        const isAppPage = window.location.pathname.includes('app.html');
        const isAuthPage = window.location.pathname.includes('auth.html');
        
        if (token && user) {
            try {
                this.currentUser = JSON.parse(user);
                // If on auth page, redirect to app page because they're already logged in
                if (isAuthPage) {
                     this.redirectToApp();
                }
            } catch (e) {
                console.error("Error parsing user data:", e);
                this.logout();
            }
        } else if (isAppPage) {
            // If on app page, but missing token, redirect to login
            window.location.href = 'auth.html';
        }
    }

    handleUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const action = urlParams.get('action');
        
        if (action === 'signup') {
            this.switchToSignUp();
        }
    }

    setupEventListeners() {
        const authForm = document.getElementById('authForm');
        const authSwitchLink = document.getElementById('auth-switch-link');
        const socialButtons = document.querySelectorAll('.btn-social');
        const forgotPassword = document.getElementById('forgotPassword');

        if (authForm) {
            authForm.addEventListener('submit', (e) => this.handleAuthSubmit(e));
        }

        if (authSwitchLink) {
            authSwitchLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleAuthMode();
            });
        }

        socialButtons.forEach(btn => {
            btn.addEventListener('click', () => this.handleSocialAuth(btn.classList));
        });

        if (forgotPassword) {
            forgotPassword.addEventListener('click', (e) => {
                e.preventDefault();
                this.showNotification('Password reset feature coming soon!', 'info');
            });
        }
    }

    toggleAuthMode() {
        this.isSignUp = !this.isSignUp;
        this.updateAuthUI();
    }
    
    switchToSignUp() {
        this.isSignUp = true;
        this.updateAuthUI();
    }

    updateAuthUI() {
        const title = document.getElementById('auth-title');
        const subtitle = document.getElementById('auth-subtitle');
        const submitText = document.getElementById('submitText');
        const switchText = document.getElementById('auth-switch-text');
        const switchLink = document.getElementById('auth-switch-link');
        const signupFields = document.getElementById('signupFields');
        const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
        const rememberMe = document.getElementById('rememberMe');

        if (this.isSignUp) {
            title.textContent = 'Create Account';
            subtitle.textContent = 'Sign up to start your watch party';
            submitText.textContent = 'Create Account';
            switchText.innerHTML = 'Already have an account?';
            switchLink.textContent = 'Sign in';
            signupFields.classList.remove('hidden');
            confirmPasswordGroup.classList.remove('hidden');
            rememberMe.classList.add('hidden');
        } else {
            title.textContent = 'Welcome Back';
            subtitle.textContent = 'Sign in to your account to continue';
            submitText.textContent = 'Sign In';
            switchText.innerHTML = 'Don\'t have an account?';
            switchLink.textContent = 'Sign up';
            signupFields.classList.add('hidden');
            confirmPasswordGroup.classList.add('hidden');
            rememberMe.classList.remove('hidden');
        }

        this.clearForm();
        this.clearErrors();
    }

    clearForm() {
        const form = document.getElementById('authForm');
        if (form) {
            form.reset();
        }
    }

    clearErrors() {
        const errorElements = document.querySelectorAll('.error-message');
        errorElements.forEach(el => {
            el.textContent = '';
        });
    }

    async handleAuthSubmit(e) {
        e.preventDefault();
        
        const submitBtn = document.getElementById('submitBtn');
        const submitText = document.getElementById('submitText');
        const submitSpinner = document.getElementById('submitSpinner');
        
        // Show loading state
        submitText.classList.add('hidden');
        submitSpinner.classList.remove('hidden');
        submitBtn.disabled = true;

        try {
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);
            
            if (!this.validateForm(data)) {
                return;
            }

            const apiPath = this.isSignUp ? '/api/auth/signup' : '/api/auth/signin';
            
            // FIX: Use the full, deployed URL
            const fullUrl = API_BASE_URL + apiPath; 

            const response = await fetch(fullUrl, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            // Robust error checking for JSON parsing failure
            const text = await response.text();
            let result = {};
            try {
                result = JSON.parse(text);
            } catch (e) {
                // If JSON parsing fails (e.g., server returned plain text or empty body on internal error)
                throw new Error(`Server Error: ${response.status} ${response.statusText}`);
            }

            if (!response.ok) {
                 // Throw the specific error message from the JSON body
                 throw new Error(result.error || 'Authentication failed due to invalid response.');
            }
            
            // Success: Store credentials and redirect
            localStorage.setItem('authToken', result.token);
            localStorage.setItem('currentUser', JSON.stringify(result.user));

            if (this.isSignUp) {
                this.showNotification('Account created and signed in successfully!', 'success');
            } else {
                this.showNotification('Signed in successfully!', 'success');
            }

            setTimeout(() => {
                this.redirectToApp();
            }, 1000);

        } catch (error) {
            this.showNotification(error.message, 'error');
        } finally {
            // Reset loading state
            submitText.classList.remove('hidden');
            submitSpinner.classList.add('hidden');
            submitBtn.disabled = false;
        }
    }

    validateForm(data) {
        this.clearErrors();
        let isValid = true;

        if (this.isSignUp) {
            if (!data.username || data.username.length < 3) {
                this.showError('usernameError', 'Username must be at least 3 characters');
                isValid = false;
            }
        }

        if (!data.email || !this.isValidEmail(data.email)) {
            this.showError('emailError', 'Please enter a valid email address');
            isValid = false;
        }

        if (!data.password || data.password.length < 6) {
            this.showError('passwordError', 'Password must be at least 6 characters');
            isValid = false;
        }

        if (this.isSignUp && data.password !== data.confirmPassword) {
            this.showError('confirmPasswordError', 'Passwords do not match');
            isValid = false;
        }

        return isValid;
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    showError(elementId, message) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
        }
    }

    async handleSocialAuth(btnClasses) {
        this.showNotification('Social authentication is coming soon!', 'info');
    }

    redirectToApp() {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        window.location.href = `app.html${roomParam ? `?room=${roomParam}` : ''}`;
    }

    showNotification(message, type = 'info') {
        const notificationArea = document.getElementById('notificationArea') || this.createNotificationArea();
        
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
    
    createNotificationArea() {
        const notificationArea = document.createElement('div');
        notificationArea.id = 'notificationArea';
        notificationArea.className = 'notification-area';
        document.body.appendChild(notificationArea);
        return notificationArea;
    }

    static checkAuth() {
        const token = localStorage.getItem('authToken');
        const user = localStorage.getItem('currentUser');
        
        if (!token || !user) {
            return null;
        }
        
        try {
            return JSON.parse(user);
        } catch (e) {
            return null;
        }
    }

    static logout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('authForm') || document.querySelector('.app-container')) {
        new AuthManager();
    }
});