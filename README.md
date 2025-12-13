# 🤖 3D Avatar Chatbot

> **Production-Ready AI Chatbot** with 3D Avatar, OpenAI Integration, Speech
> Recognition, and Text-to-Speech

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/ruslanmv/3D-Avatar-Chatbot)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![CI/CD](https://github.com/ruslanmv/3D-Avatar-Chatbot/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/ruslanmv/3D-Avatar-Chatbot/actions)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A lightweight, commercial-grade AI conversation platform featuring an
interactive 3D animated avatar, powered by OpenAI's GPT models, with full
speech-to-text and text-to-speech capabilities. Perfect for entertainment,
education, customer engagement, and professional applications.

---

## 📑 Table of Contents

- [Features](#-features)
- [Live Demo](#-live-demo)
- [Quick Start](#-quick-start)
- [Installation](#-installation)
- [Usage](#-usage)
- [Architecture](#-architecture)
- [Configuration](#-configuration)
- [Development](#-development)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [API Reference](#-api-reference)
- [Performance](#-performance)
- [Security](#-security)
- [Contributing](#-contributing)
- [License](#-license)
- [Author](#-author)
- [Support](#-support)

---

## ✨ Features

### Core Capabilities

- **🎭 Interactive 3D Avatar** - Real-time animated 3D character with
  state-based animations (idle, listening, thinking, speaking)
- **🧠 AI-Powered Conversations** - Powered by OpenAI GPT-4, GPT-4 Turbo, and
  GPT-3.5 Turbo models
- **🎤 Speech-to-Text** - Natural voice input using Web Speech API with
  high-accuracy transcription
- **🔊 Text-to-Speech** - Avatar speaks responses with customizable voice, rate,
  and pitch
- **🎭 Multiple Personalities** - 6 distinct personality modes optimized for
  different audiences
- **📱 Responsive Design** - Seamless experience across desktop, tablet, and
  mobile devices
- **💾 Conversation Persistence** - Automatic chat history with context
  retention
- **⚙️ Customizable Settings** - Full control over voice, model, UI preferences,
  and behavior

### Personality Modes

1. **👶 Friendly Kids** - Fun and engaging for children (ages 6-12)
2. **📚 Educational** - Informative tutor for learning and knowledge
3. **💼 Professional** - Business-focused and efficient communication
4. **🎨 Creative** - Imaginative and artistic companion
5. **📖 Storyteller** - Engaging narratives and storytelling
6. **🌟 Life Coach** - Motivational and supportive guidance

### Technical Excellence

- ✅ **Zero Framework Dependencies** - Pure vanilla JavaScript for maximum
  performance
- ✅ **Production-Ready** - Enterprise-grade error handling and logging
- ✅ **TypeScript-Ready** - JSDoc annotations for type safety
- ✅ **Modular Architecture** - Clean separation of concerns
- ✅ **Automated Testing** - Unit tests with Jest
- ✅ **CI/CD Pipeline** - GitHub Actions for automated quality checks
- ✅ **Code Quality** - ESLint and Prettier for consistent code style
- ✅ **Secure by Design** - Local API key storage, no data tracking
- ✅ **Accessibility** - WCAG compliant interface
- ✅ **Cross-Browser** - Works on Chrome, Edge, Safari, and Firefox

---

## 🚀 Live Demo & Deployment

### Try the Demo
**[Live Demo →](https://ruslanmv.github.io/3D-Avatar-Chatbot/demo.html)**

Experience the chatbot on GitHub Pages. Simply provide your OpenAI API
key (stored locally in your browser) and start chatting!

### Deploy to Production (5 Minutes)

**Deploy to Vercel - Free & Instant:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ruslanmv/3D-Avatar-Chatbot)

**Quick Start Guides:**
- 🚀 [Vercel Quick Start](./VERCEL_QUICKSTART.md) - Deploy in 5 minutes
- 📘 [Production Deployment Guide](./PRODUCTION_DEPLOYMENT.md) - Complete guide

---

## ⚡ Quick Start

### For Production Use (Recommended)

**Deploy to Vercel in 3 steps:**

1. Click the "Deploy with Vercel" button above
2. Sign in and deploy (takes 1 minute)
3. Configure your OpenAI API key in settings

See [VERCEL_QUICKSTART.md](./VERCEL_QUICKSTART.md) for detailed instructions.

### For Development

**Prerequisites:**
- Node.js >= 18.0.0
- npm >= 9.0.0
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))
- Modern web browser (Chrome, Edge, Safari, or Firefox)

**Installation:**

```bash
# Clone the repository
git clone https://github.com/ruslanmv/3D-Avatar-Chatbot.git
cd 3D-Avatar-Chatbot

# Install dependencies
npm install

# Start development server
npm run dev
```

Open `http://localhost:8080` in your browser.

### First-Time Setup

1. Click the settings icon (⚙️) in the top right
2. Enter your OpenAI API key
3. Select your preferred model (GPT-3.5 Turbo recommended for testing)
4. Click "Save Settings"
5. Choose a personality from the dropdown
6. Start chatting!

---

## 📦 Installation

### Option 1: Using Make (Recommended)

```bash
make help                 # Show all available commands
make install             # Install dependencies
make dev                 # Start development server
make build               # Build for production
make test                # Run tests
make lint                # Lint and fix code
make format              # Format code
make validate            # Run all validations
```

### Option 2: Using npm

```bash
npm install              # Install dependencies
npm start                # Start server
npm run dev              # Start with auto-open
npm test                 # Run tests
npm run lint             # Lint code
npm run format           # Format code
npm run build            # Build project
```

### Option 3: Direct File Access

Simply open `index.html` in your browser. No build step required!

---

## 🎯 Usage

### Basic Chat

1. Type your message in the input box
2. Press Enter or click the send button
3. The avatar will animate and respond
4. Responses are automatically spoken (if enabled)

### Voice Input

1. Click the microphone icon 🎤
2. Speak your message
3. The transcription appears in the input box
4. Review and send

### Changing Personalities

Use the dropdown in the header to switch between personalities. Each has unique
characteristics:

- **Kids Mode**: Simple language, encouraging, educational
- **Educational**: Clear explanations, examples, teaching-focused
- **Professional**: Concise, efficient, business-oriented
- **Creative**: Imaginative, artistic, out-of-the-box thinking
- **Storyteller**: Narrative-driven, engaging, immersive
- **Life Coach**: Supportive, motivational, goal-oriented

### Settings Configuration

#### OpenAI Settings

- **API Key**: Your personal OpenAI API key (required)
- **Model**: Choose GPT-4, GPT-4 Turbo, or GPT-3.5 Turbo

#### Voice Settings

- **Voice**: Select from available system voices
- **Speech Rate**: 0.5x - 2.0x speed
- **Speech Pitch**: 0.5x - 2.0x pitch
- **Auto-speak**: Toggle automatic response speaking

#### Display Settings

- **Show Timestamps**: Display message times
- **Sound Effects**: Enable UI sound effects

---

## 🏗️ Architecture

### Project Structure

```
3D-Avatar-Chatbot/
├── index.html              # Main application page
├── demo.html              # Lightweight GitHub Pages demo
├── package.json           # Dependencies and scripts
├── Makefile              # Build automation
├── LICENSE               # Apache 2.0 license
├── README.md             # This file
├── .eslintrc.json        # ESLint configuration
├── .prettierrc.json      # Prettier configuration
├── .editorconfig         # Editor configuration
├── jsdoc.json            # JSDoc configuration
├── .gitignore            # Git ignore rules
├── .env.example          # Environment variables example
│
├── css/
│   ├── chatbot.css       # Chatbot UI styles
│   └── style.css         # Avatar viewer styles
│
├── js/
│   ├── config.js         # Configuration & personalities
│   ├── openai-service.js # OpenAI API integration
│   ├── speech-service.js # Speech recognition & synthesis
│   ├── chat-manager.js   # Chat UI management
│   ├── avatar-controller.js # Avatar animations
│   └── main.js           # Main application orchestrator
│
├── html/
│   └── test-template.html # Test template
│
├── tests/
│   ├── setup.js          # Jest setup
│   ├── config.test.js    # Config module tests
│   └── openai-service.test.js # OpenAI service tests
│
├── .github/
│   └── workflows/
│       └── ci.yml        # CI/CD pipeline
│
├── build-viewer/         # Avatar viewer build files
└── app.js                # 3D Avatar viewer (bundled)
```

### Module Overview

#### `config.js` - Configuration Module

- Manages application settings and API keys
- Defines personality configurations
- Handles localStorage persistence
- Validates API key format

#### `openai-service.js` - OpenAI Integration

- Handles API requests to OpenAI
- Manages conversation history
- Implements token counting and limits
- Provides error handling and retry logic

#### `speech-service.js` - Speech Services

- Speech recognition (STT) implementation
- Text-to-speech (TTS) synthesis
- Voice management and selection
- Browser compatibility detection

#### `chat-manager.js` - Chat UI Manager

- Renders chat messages
- Manages message history
- Handles typing indicators
- Provides notification system

#### `avatar-controller.js` - Avatar Controller

- Controls 3D avatar animations
- Manages avatar states (idle, listening, thinking, speaking)
- Handles camera controls
- Provides avatar visibility toggle

#### `main.js` - Application Orchestrator

- Initializes all services
- Coordinates user interactions
- Manages application lifecycle
- Handles event delegation

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file (optional, for reference only):

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-3.5-turbo

# Application
APP_NAME=3D Avatar Chatbot
APP_VERSION=2.0.0
```

**Note**: API keys are stored in browser localStorage for security. Never commit
actual keys to version control.

### Customizing Personalities

Edit `js/config.js` to add or modify personalities:

```javascript
personalities: {
    'custom-mode': {
        name: 'Custom Mode',
        icon: '🎯',
        description: 'Your custom description',
        systemPrompt: `Your custom system prompt...`,
        temperature: 0.8,
    }
}
```

### Styling Customization

The application uses CSS variables for easy theming. Edit `css/chatbot.css`:

```css
:root {
    --primary-color: #6366f1;
    --accent-color: #10b981;
    --background-color: #0f172a;
    /* ... more variables */
}
```

---

## 🛠️ Development

### Development Workflow

```bash
# Start development server with live reload
make dev

# Run linting
make lint

# Run tests in watch mode
make test-watch

# Format code
make format

# Run full validation
make validate
```

### Code Quality

The project enforces strict code quality standards:

- **ESLint**: JavaScript linting with recommended rules
- **Prettier**: Consistent code formatting
- **JSDoc**: Comprehensive documentation
- **EditorConfig**: Consistent editor settings
- **Git Hooks**: Pre-commit validation (optional)

### Adding New Features

1. Create a new branch: `git checkout -b feature/your-feature`
2. Write your code with JSDoc comments
3. Add unit tests in `tests/`
4. Run validation: `make validate`
5. Commit your changes
6. Open a Pull Request

---

## 🧪 Testing

### Running Tests

```bash
# Run all tests
make test

# Run tests with coverage
make coverage

# Run tests in watch mode
make test-watch

# Run tests in CI mode
make test-ci
```

### Test Structure

- `tests/setup.js` - Jest configuration and mocks
- `tests/config.test.js` - Configuration module tests
- `tests/openai-service.test.js` - OpenAI service tests

### Coverage Requirements

The project maintains high test coverage standards:

- Branches: 70%
- Functions: 70%
- Lines: 70%
- Statements: 70%

---

## 🚢 Deployment

### Deploy to GitHub Pages

```bash
make deploy
# or
npm run deploy
```

### Deploy to Netlify

```bash
make deploy-netlify
# or
npm run deploy:netlify
```

### Deploy to Vercel

#### One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ruslanmv/3D-Avatar-Chatbot)

#### Manual Deploy

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy to production
vercel --prod
```

See [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) for complete Vercel deployment
guide.

### Deploy to Traditional Web Server

1. Build the project: `make build`
2. Upload all files to your web server
3. Ensure HTTPS is enabled
4. Configure CORS if needed

### Environment-Specific Configurations

#### Production Checklist

- [ ] Enable HTTPS
- [ ] Configure CSP headers
- [ ] Set up error monitoring (e.g., Sentry)
- [ ] Configure CDN for static assets
- [ ] Enable gzip/brotli compression
- [ ] Set appropriate cache headers
- [ ] Test on multiple devices and browsers

---

## 📚 API Reference

### AppConfig

```javascript
// Save API key
AppConfig.saveApiKey('sk-...');

// Get current personality
const personality = AppConfig.getCurrentPersonality();

// Check configuration
if (AppConfig.isConfigured()) {
    // Ready to use
}

// Save settings
AppConfig.saveSpeechSettings({ rate: 1.2, pitch: 1.0 });
AppConfig.saveUISettings({ showTimestamps: true });
```

### OpenAI Service

```javascript
// Send message
const response = await OpenAIService.sendMessage('Hello!');

// Clear conversation
OpenAIService.clearHistory();

// Change personality
OpenAIService.changePersonality(personality);

// Get token count
const tokens = OpenAIService.getTokenCount();

// Export conversation
const json = OpenAIService.exportHistory();
```

### Speech Service

```javascript
// Start speech recognition
SpeechService.startRecognition({
    onResult: (transcript, confidence) => {
        console.log(transcript);
    },
    onError: (error) => {
        console.error(error);
    },
});

// Stop recognition
SpeechService.stopRecognition();

// Text-to-speech
SpeechService.speak('Hello world!', {
    onStart: () => console.log('Speaking...'),
    onEnd: () => console.log('Done'),
});

// Get available voices
const voices = SpeechService.getVoices();
```

### Chat Manager

```javascript
// Add message
ChatManager.addMessage('Hello!', 'user');
ChatManager.addMessage('Hi there!', 'bot');

// Clear messages
ChatManager.clearMessages();

// Show notifications
ChatManager.showError('Error message');
ChatManager.showInfo('Info message');

// Show typing indicator
ChatManager.showTypingIndicator();
ChatManager.removeTypingIndicator();
```

### Avatar Controller

```javascript
// Set avatar state
AvatarController.idle();
AvatarController.listen();
AvatarController.think();
AvatarController.speak();

// Control visibility
AvatarController.toggleVisibility();

// Reset camera
AvatarController.resetCamera();

// Handle resize
AvatarController.handleResize();
```

---

## ⚡ Performance

### Optimization Strategies

- **Lazy Loading**: Avatar models loaded on demand
- **Debouncing**: User input debounced to reduce API calls
- **Caching**: Conversation history cached locally
- **Compression**: Minified CSS and optimized assets
- **CDN**: Fonts and icons loaded from Google Fonts CDN

### Performance Metrics

- **First Contentful Paint**: < 1.5s
- **Time to Interactive**: < 3.0s
- **Lighthouse Score**: 90+
- **Bundle Size**: < 1.5MB (including 3D avatar)

### Browser Compatibility

| Browser | Version | Speech Recognition | Speech Synthesis |
| ------- | ------- | ------------------ | ---------------- |
| Chrome  | 94+     | ✅ Yes             | ✅ Yes           |
| Edge    | 94+     | ✅ Yes             | ✅ Yes           |
| Safari  | 14.1+   | ✅ Yes             | ✅ Yes           |
| Firefox | Latest  | ❌ No              | ✅ Yes           |

**Note**: Speech recognition requires a Chromium-based browser or Safari.

---

## 🔒 Security

### Security Features

- ✅ **Local API Key Storage**: Keys stored in browser localStorage only
- ✅ **No External Tracking**: Zero analytics or data collection
- ✅ **HTTPS Recommended**: Secure communication for production
- ✅ **No Backend Required**: Direct browser-to-OpenAI communication
- ✅ **Content Security Policy**: Recommended CSP headers
- ✅ **Input Validation**: All user inputs sanitized
- ✅ **Rate Limiting**: Built-in request throttling

### Best Practices

1. **Never commit API keys** to version control
2. **Use HTTPS** in production environments
3. **Rotate API keys** regularly
4. **Monitor usage** in OpenAI dashboard
5. **Set spending limits** in OpenAI account
6. **Review API permissions** periodically

### Security Audit

Run security audits regularly:

```bash
make security
# or
npm audit
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

### How to Contribute

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your changes (`git commit -m 'Add some AmazingFeature'`)
4. **Push** to the branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

### Code Standards

- Follow existing code style
- Add JSDoc comments to all functions
- Write unit tests for new features
- Update documentation as needed
- Ensure all tests pass: `make validate`

### Reporting Issues

Please use GitHub Issues to report bugs or request features:

- 🐛 [Report a Bug](https://github.com/ruslanmv/3D-Avatar-Chatbot/issues)
- ✨ [Request a Feature](https://github.com/ruslanmv/3D-Avatar-Chatbot/issues)

---

## 📄 License

This project is licensed under the **Apache License 2.0** - see the
[LICENSE](LICENSE) file for details.

```
Copyright 2024 Ruslan Magana

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## 👤 Author

**Ruslan Magana**

- Website: [ruslanmv.com](https://ruslanmv.com)
- GitHub: [@ruslanmv](https://github.com/ruslanmv)
- LinkedIn: [Ruslan Magana](https://www.linkedin.com/in/ruslanmv)

---

## 💬 Support

Need help? Here are some options:

- 📖 [Documentation](https://github.com/ruslanmv/3D-Avatar-Chatbot/wiki)
- 💬 [Discussions](https://github.com/ruslanmv/3D-Avatar-Chatbot/discussions)
- 🐛 [Issue Tracker](https://github.com/ruslanmv/3D-Avatar-Chatbot/issues)
- 📧 Email: contact@ruslanmv.com

---

## 🙏 Acknowledgments

Special thanks to:

- **OpenAI** - For providing powerful AI models
- **THREE.js Community** - For 3D graphics support
- **Web Speech API** - For speech recognition and synthesis
- **Open Source Community** - For inspiration and tools

---

## 🗺️ Roadmap

Future enhancements planned:

- [ ] Multi-language support (i18n)
- [ ] OpenAI Whisper integration for better STT
- [ ] Voice cloning capabilities
- [ ] Custom avatar uploads
- [ ] Chat export (PDF, JSON, Markdown)
- [ ] Conversation analytics dashboard
- [ ] Mobile app version (React Native)
- [ ] Backend API option for team usage
- [ ] Multi-user support with rooms
- [ ] Integration with Claude, Gemini, and other AI models
- [ ] Plugin system for extensions
- [ ] Emotion detection from voice
- [ ] Real-time translation

---

## 📊 Project Status

![GitHub stars](https://img.shields.io/github/stars/ruslanmv/3D-Avatar-Chatbot?style=social)
![GitHub forks](https://img.shields.io/github/forks/ruslanmv/3D-Avatar-Chatbot?style=social)
![GitHub watchers](https://img.shields.io/github/watchers/ruslanmv/3D-Avatar-Chatbot?style=social)

**Project Status**: 🟢 Active Development

---

<div align="center">

**Made with ❤️ for developers, educators, and innovators**

_Production-Ready • Enterprise-Grade • Open Source_

[⭐ Star this repo](https://github.com/ruslanmv/3D-Avatar-Chatbot) if you find
it useful!

</div>
