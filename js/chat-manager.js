/**
 * Chat Manager Module
 * Handles chat UI, message display, and user interactions
 */

class ChatManager {
    constructor() {
        this.messageContainer = null;
        this.messageHistory = [];
        this.isWaitingForResponse = false;
    }

    /**
     * Initialize the chat manager
     */
    initialize() {
        this.messageContainer = document.getElementById('chatMessages');
        this.loadChatHistory();
    }

    /**
     * Add a message to the chat
     * @param {string} content - Message content
     * @param {string} sender - 'user' or 'bot'
     * @param {boolean} save - Whether to save to history
     */
    addMessage(content, sender = 'user', save = true) {
        const message = {
            id: Date.now(),
            content,
            sender,
            timestamp: new Date().toISOString(),
        };

        // Remove welcome message if exists
        this.removeWelcomeMessage();

        // Create message element
        const messageElement = this.createMessageElement(message);

        // Add to DOM
        this.messageContainer.appendChild(messageElement);

        // Scroll to bottom
        this.scrollToBottom();

        // Save to history
        if (save) {
            this.messageHistory.push(message);
            this.saveChatHistory();
        }

        return message;
    }

    /**
     * Create message DOM element
     * @param message
     */
    createMessageElement(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.sender}`;
        messageDiv.dataset.messageId = message.id;

        // Avatar
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.textContent = message.sender === 'user' ? '👤' : '🤖';

        // Content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        // Message bubble
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';
        bubbleDiv.textContent = message.content;

        contentDiv.appendChild(bubbleDiv);

        // Timestamp (if enabled)
        if (AppConfig.ui.showTimestamps) {
            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            timeDiv.textContent = this.formatTime(message.timestamp);
            contentDiv.appendChild(timeDiv);
        }

        // Assemble message
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentDiv);

        return messageDiv;
    }

    /**
     * Show typing indicator
     */
    showTypingIndicator() {
        // Remove existing typing indicator if any
        this.removeTypingIndicator();

        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot';
        typingDiv.id = 'typingIndicator';

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.textContent = '🤖';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'typing-bubble';
        bubbleDiv.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;

        contentDiv.appendChild(bubbleDiv);
        typingDiv.appendChild(avatarDiv);
        typingDiv.appendChild(contentDiv);

        this.messageContainer.appendChild(typingDiv);
        this.scrollToBottom();
    }

    /**
     * Remove typing indicator
     */
    removeTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Remove welcome message
     */
    removeWelcomeMessage() {
        const welcomeMsg = this.messageContainer.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
    }

    /**
     * Clear all messages
     */
    clearMessages() {
        // Keep welcome message, remove others
        const messages = this.messageContainer.querySelectorAll('.message');
        messages.forEach((msg) => msg.remove());

        // Show welcome message again
        if (!this.messageContainer.querySelector('.welcome-message')) {
            const welcomeDiv = document.createElement('div');
            welcomeDiv.className = 'welcome-message';
            welcomeDiv.innerHTML = `
                <div class="welcome-icon">👋</div>
                <h2>Hello! I'm your AI assistant</h2>
                <p>I can chat with you using voice or text. Choose a personality above and start the conversation!</p>
            `;
            this.messageContainer.appendChild(welcomeDiv);
        }

        // Clear history
        this.messageHistory = [];
        this.saveChatHistory();
    }

    /**
     * Scroll chat to bottom
     */
    scrollToBottom() {
        setTimeout(() => {
            this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
        }, 100);
    }

    /**
     * Format timestamp
     * @param timestamp
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        // If less than a minute ago
        if (diff < 60000) {
            return 'Just now';
        }

        // If today
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            });
        }

        // Otherwise
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
    }

    /**
     * Save chat history to localStorage
     */
    saveChatHistory() {
        try {
            // Only save last 50 messages
            const historyToSave = this.messageHistory.slice(-50);
            localStorage.setItem('chat_history', JSON.stringify(historyToSave));
        } catch (error) {
            console.error('Failed to save chat history:', error);
        }
    }

    /**
     * Load chat history from localStorage
     */
    loadChatHistory() {
        try {
            const saved = localStorage.getItem('chat_history');
            if (saved) {
                this.messageHistory = JSON.parse(saved);

                // Restore messages to UI
                this.messageHistory.forEach((message) => {
                    const messageElement = this.createMessageElement(message);
                    this.messageContainer.appendChild(messageElement);
                });

                if (this.messageHistory.length > 0) {
                    this.removeWelcomeMessage();
                    this.scrollToBottom();
                }
            }
        } catch (error) {
            console.error('Failed to load chat history:', error);
        }
    }

    /**
     * Export chat history as text
     */
    exportChatAsText() {
        let text = '3D Avatar Chatbot - Conversation History\n';
        text += `${'='.repeat(50)}\n\n`;

        this.messageHistory.forEach((message) => {
            const sender = message.sender === 'user' ? 'You' : 'AI';
            const time = new Date(message.timestamp).toLocaleString();
            text += `[${time}] ${sender}:\n${message.content}\n\n`;
        });

        return text;
    }

    /**
     * Download chat history
     */
    downloadChatHistory() {
        const text = this.exportChatAsText();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `chat-history-${Date.now()}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    }

    /**
     * Get message count
     */
    getMessageCount() {
        return this.messageHistory.length;
    }

    /**
     * Get last message
     */
    getLastMessage() {
        return this.messageHistory[this.messageHistory.length - 1];
    }

    /**
     * Search messages
     * @param query
     */
    searchMessages(query) {
        return this.messageHistory.filter((message) => message.content.toLowerCase().includes(query.toLowerCase()));
    }

    /**
     * Set waiting state
     * @param waiting
     */
    setWaitingState(waiting) {
        this.isWaitingForResponse = waiting;
        if (waiting) {
            this.showTypingIndicator();
        } else {
            this.removeTypingIndicator();
        }
    }

    /**
     * Show error message
     * @param errorMessage
     */
    showError(errorMessage) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message error';
        errorDiv.innerHTML = `
            <div class="message-avatar">⚠️</div>
            <div class="message-content">
                <div class="message-bubble" style="background: #fee; color: #c00; border: 1px solid #fcc;">
                    ${errorMessage}
                </div>
            </div>
        `;

        this.messageContainer.appendChild(errorDiv);
        this.scrollToBottom();

        // Remove error after 5 seconds
        setTimeout(() => {
            errorDiv.style.opacity = '0';
            setTimeout(() => errorDiv.remove(), 300);
        }, 5000);
    }

    /**
     * Show info message
     * @param infoMessage
     */
    showInfo(infoMessage) {
        const infoDiv = document.createElement('div');
        infoDiv.className = 'message info';
        infoDiv.style.textAlign = 'center';
        infoDiv.style.margin = '1rem 0';
        infoDiv.innerHTML = `
            <div style="display: inline-block; padding: 0.5rem 1rem; background: #e0f2fe; color: #0369a1; border-radius: 1rem; font-size: 0.875rem;">
                ${infoMessage}
            </div>
        `;

        this.messageContainer.appendChild(infoDiv);
        this.scrollToBottom();
    }

    /**
     * Update message (for streaming responses in future)
     * @param messageId
     * @param newContent
     */
    updateMessage(messageId, newContent) {
        const messageElement = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            const bubble = messageElement.querySelector('.message-bubble');
            if (bubble) {
                bubble.textContent = newContent;
            }
        }

        // Update in history
        const messageIndex = this.messageHistory.findIndex((m) => m.id === messageId);
        if (messageIndex !== -1) {
            this.messageHistory[messageIndex].content = newContent;
            this.saveChatHistory();
        }
    }
}

// Create a singleton instance
const chatManager = new ChatManager();

// Export for use in other modules
window.ChatManager = chatManager;
