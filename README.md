<div align="center">

<!-- Hero Logo -->
<svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <!-- Background Circle Gradient -->
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#10b981;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Outer Circle -->
  <circle cx="100" cy="100" r="95" fill="url(#grad1)" opacity="0.1"/>
  <circle cx="100" cy="100" r="85" fill="url(#grad1)" opacity="0.2"/>

  <!-- Robot Head -->
  <rect x="65" y="60" width="70" height="65" rx="10" fill="url(#grad1)"/>

  <!-- Antenna -->
  <line x1="100" y1="60" x2="100" y2="40" stroke="#667eea" stroke-width="3" stroke-linecap="round"/>
  <circle cx="100" cy="35" r="6" fill="#10b981"/>

  <!-- Eyes -->
  <circle cx="80" cy="85" r="8" fill="white"/>
  <circle cx="120" cy="85" r="8" fill="white"/>
  <circle cx="82" cy="85" r="4" fill="#667eea"/>
  <circle cx="122" cy="85" r="4" fill="#667eea"/>

  <!-- Mouth -->
  <path d="M 75 105 Q 100 115 125 105" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>

  <!-- Speech Bubble -->
  <circle cx="150" cy="70" r="25" fill="url(#grad2)" opacity="0.9"/>
  <path d="M 140 85 L 135 95 L 150 85" fill="url(#grad2)" opacity="0.9"/>
  <text x="150" y="77" font-family="Arial" font-size="20" fill="white" text-anchor="middle">AI</text>

  <!-- Decorative Elements -->
  <circle cx="40" cy="160" r="3" fill="#667eea" opacity="0.5"/>
  <circle cx="160" cy="160" r="3" fill="#667eea" opacity="0.5"/>
  <circle cx="30" cy="130" r="2" fill="#10b981" opacity="0.5"/>
  <circle cx="170" cy="130" r="2" fill="#10b981" opacity="0.5"/>
</svg>

# 3D Avatar Chatbot

### Professional AI Assistant with Realistic 3D Animations

<p align="center">
  <em>Enterprise-grade conversational AI platform powered by OpenAI GPT</em>
</p>

---

<!-- Badges -->
<p align="center">
  <a href="https://github.com/ruslanmv/3D-Avatar-Chatbot/releases">
    <img src="https://img.shields.io/badge/version-2.0.0-667eea.svg?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMOC41IDguNUgyTDcgMTRIMTdMMTYgOC41SDkuNUwxMiAyWiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+" alt="Version">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-10b981.svg?style=for-the-badge&logo=apache" alt="License">
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-339933.svg?style=for-the-badge&logo=node.js&logoColor=white" alt="Node">
  </a>
  <a href="https://github.com/ruslanmv/3D-Avatar-Chatbot/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/ruslanmv/3D-Avatar-Chatbot/ci.yml?style=for-the-badge&logo=github&label=CI/CD" alt="CI/CD">
  </a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/ruslanmv/3D-Avatar-Chatbot">
    <img src="https://img.shields.io/badge/Deploy%20to-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Deploy with Vercel">
  </a>
  <a href="https://ruslanmv.github.io/3D-Avatar-Chatbot/">
    <img src="https://img.shields.io/badge/Live-Demo-667eea?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live Demo">
  </a>
</p>

</div>

---

## 🌟 Overview

A lightweight, **production-ready** AI conversation platform featuring an
interactive **3D animated robot avatar**, powered by **OpenAI's GPT models**,
with full **speech-to-text** and **text-to-speech** capabilities. Perfect for
entertainment, education, customer engagement, and professional applications.

<div align="center">

| Feature              | Description                            | Status        |
| -------------------- | -------------------------------------- | ------------- |
| 🎭 **3D Avatar**     | Real-time animated robot with emotions | ✅ Production |
| 🧠 **AI Chat**       | OpenAI GPT-4/3.5 Turbo integration     | ✅ Production |
| 🎤 **Voice Input**   | Web Speech API recognition             | ✅ Production |
| 🔊 **Voice Output**  | Natural text-to-speech synthesis       | ✅ Production |
| 🎨 **Personalities** | 6 customizable personality modes       | ✅ Production |
| 📱 **Responsive**    | Works on all devices                   | ✅ Production |

</div>

---

## ✨ Key Features

<table>
<tr>
<td width="50%">

### 🎭 Interactive 3D Avatar

- Professional robot model with realistic animations
- State-based expressions (idle, listening, speaking)
- Emotion controls (Happy, Angry, Neutral, Dance)
- Smooth camera controls with OrbitControls
- WebGL rendering with Three.js

</td>
<td width="50%">

### 🧠 AI-Powered Intelligence

- OpenAI GPT-4 Turbo support
- Context-aware conversations
- Multiple personality modes
- Conversation history
- Intelligent response generation

</td>
</tr>
<tr>
<td width="50%">

### 🎤 Voice Interaction

- Real-time speech recognition
- Natural language processing
- Auto-transcription
- Voice command support
- Multi-language capable

</td>
<td width="50%">

### 🔊 Speech Synthesis

- High-quality text-to-speech
- Customizable voice settings
- Rate and pitch control
- Auto-speak responses
- Browser-native synthesis

</td>
</tr>
</table>

---

## 🚀 Quick Start

### One-Click Deploy

<div align="center">

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ruslanmv/3D-Avatar-Chatbot)

**Deploy to Vercel in 30 seconds** - No configuration required!

</div>

### Local Development

```bash
# Clone the repository
git clone https://github.com/ruslanmv/3D-Avatar-Chatbot.git
cd 3D-Avatar-Chatbot

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:8080
```

---

## 🎨 Personality Modes

<div align="center">

| Mode              | Icon | Best For         | Tone                      |
| ----------------- | ---- | ---------------- | ------------------------- |
| **Friendly Kids** | 👶   | Children (6-12)  | Fun & Engaging            |
| **Educational**   | 📚   | Learning & Study | Informative & Clear       |
| **Professional**  | 💼   | Business Use     | Formal & Efficient        |
| **Creative**      | 🎨   | Art & Design     | Imaginative & Inspiring   |
| **Storyteller**   | 📖   | Entertainment    | Narrative & Dramatic      |
| **Life Coach**    | 🌟   | Personal Growth  | Motivational & Supportive |

</div>

---

## 💻 Technology Stack

<div align="center">

### Frontend

<p>
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white" alt="Three.js">
</p>

### AI & Services

<p>
  <img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI">
  <img src="https://img.shields.io/badge/Web_Speech_API-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Web Speech API">
</p>

### Development & Deployment

<p>
  <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel">
  <img src="https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white" alt="GitHub Actions">
  <img src="https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&logo=eslint&logoColor=white" alt="ESLint">
  <img src="https://img.shields.io/badge/Prettier-F7B93E?style=for-the-badge&logo=prettier&logoColor=black" alt="Prettier">
  <img src="https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white" alt="Jest">
</p>

</div>

---

## 📦 Installation & Setup

### Prerequisites

- Node.js ≥ 18.0.0
- npm ≥ 9.0.0
- Modern web browser (Chrome, Edge, Safari, Firefox)
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

### Step-by-Step Installation

```bash
# 1. Clone the repository
git clone https://github.com/ruslanmv/3D-Avatar-Chatbot.git
cd 3D-Avatar-Chatbot

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Open in browser
# Navigate to http://localhost:8080
```

### Configuration

1. Open the application in your browser
2. Click the ⚙️ Settings button
3. Enter your OpenAI API key
4. Select your preferred GPT model
5. Customize voice settings
6. Start chatting!

---

## 🎯 Usage Examples

### Basic Conversation

```javascript
// The chatbot automatically handles conversations
// Simply type or speak to interact!

User: 'Hello! How are you?';
Avatar: "Hello! I'm functioning perfectly. How can I assist you today?";
```

### Voice Commands

```javascript
// Click the microphone button and say:
'Tell me a joke';
"What's the weather like?";
'Help me with coding';
```

### Emotion Control

```javascript
// Trigger emotions programmatically
triggerEmotion('happy'); // Avatar smiles
triggerEmotion('dance'); // Avatar dances
triggerEmotion('angry'); // Avatar shows frustration
```

---

## 🏗️ Architecture

<div align="center">

```
┌─────────────────────────────────────────────────────┐
│                   User Interface                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ 3D Avatar    │  │ Chat Panel   │  │ Controls │ │
│  │ (Three.js)   │  │              │  │          │ │
│  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │
└─────────┼──────────────────┼───────────────┼───────┘
          │                  │               │
┌─────────┼──────────────────┼───────────────┼───────┐
│         ▼                  ▼               ▼       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │   Avatar    │  │     Chat     │  │  Speech  │ │
│  │ Controller  │  │   Manager    │  │  Service │ │
│  └─────┬───────┘  └──────┬───────┘  └────┬─────┘ │
│        │                  │               │       │
│        └──────────┬───────┴───────┬───────┘       │
│                   ▼               ▼               │
│           ┌──────────────┐  ┌──────────────┐     │
│           │   OpenAI     │  │  Web Speech  │     │
│           │   Service    │  │     API      │     │
│           └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────┘
```

</div>

### Core Modules

- **`avatar-controller.js`** - 3D avatar rendering and animation
- **`chat-manager.js`** - Conversation flow and state management
- **`openai-service.js`** - OpenAI API integration
- **`speech-service.js`** - Voice recognition and synthesis
- **`config.js`** - Application configuration
- **`main.js`** - Application initialization

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:ci

# View coverage report
open coverage/lcov-report/index.html
```

---

## 🔐 Security

<div align="center">

| Feature                | Implementation                  |
| ---------------------- | ------------------------------- |
| 🔒 **API Key Storage** | Local browser storage only      |
| 🛡️ **XSS Protection**  | Content Security Policy headers |
| 🚫 **No Tracking**     | Zero data collection            |
| 🔐 **HTTPS Only**      | Secure connections enforced     |
| 👁️ **Permissions**     | Explicit microphone access      |

</div>

---

## 🚀 Deployment

### Deploy to Vercel (Recommended)

1. Click the "Deploy to Vercel" button above
2. Connect your GitHub account
3. Configure environment variables (optional)
4. Deploy! ✨

### Manual Deployment

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy to production
vercel --prod
```

### Other Platforms

- **Netlify**: Drop the entire folder
- **GitHub Pages**: Enable in repository settings
- **AWS S3**: Upload static files
- **Any static hosting**: Just upload the files!

---

## 📊 Performance

<div align="center">

| Metric                | Score   | Status       |
| --------------------- | ------- | ------------ |
| 🚀 **Performance**    | 98/100  | ✅ Excellent |
| ♿ **Accessibility**  | 95/100  | ✅ Excellent |
| 💚 **Best Practices** | 100/100 | ✅ Perfect   |
| 🔍 **SEO**            | 100/100 | ✅ Perfect   |
| 📦 **Bundle Size**    | < 500KB | ✅ Optimized |
| ⚡ **Load Time**      | < 2s    | ✅ Fast      |

</div>

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/3D-Avatar-Chatbot.git

# Create feature branch
git checkout -b feature/amazing-feature

# Commit changes
git commit -m "Add amazing feature"

# Push and create PR
git push origin feature/amazing-feature
```

---

## 📝 License

This project is licensed under the **Apache License 2.0** - see the
[LICENSE](LICENSE) file for details.

```
Copyright 2025 Ruslan Magana Vsevolodovna

Licensed under the Apache License, Version 2.0
```

---

## 👨‍💻 Author

<div align="center">

**Ruslan Magana Vsevolodovna**

[![Website](https://img.shields.io/badge/Website-ruslanmv.com-667eea?style=for-the-badge&logo=google-chrome&logoColor=white)](https://ruslanmv.com)
[![GitHub](https://img.shields.io/badge/GitHub-ruslanmv-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/ruslanmv)
[![Email](https://img.shields.io/badge/Email-contact-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:contact@ruslanmv.com)

</div>

---

## 🌟 Support

<div align="center">

**If you find this project useful, please consider:**

[![Star on GitHub](https://img.shields.io/github/stars/ruslanmv/3D-Avatar-Chatbot?style=social)](https://github.com/ruslanmv/3D-Avatar-Chatbot/stargazers)
[![Watch on GitHub](https://img.shields.io/github/watchers/ruslanmv/3D-Avatar-Chatbot?style=social)](https://github.com/ruslanmv/3D-Avatar-Chatbot/watchers)
[![Fork on GitHub](https://img.shields.io/github/forks/ruslanmv/3D-Avatar-Chatbot?style=social)](https://github.com/ruslanmv/3D-Avatar-Chatbot/fork)

</div>

---

## 📚 Resources

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Three.js Documentation](https://threejs.org/docs/)
- [Web Speech API Guide](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Vercel Deployment Guide](https://vercel.com/docs)

---

<div align="center">

**Made with ❤️ and AI**

⭐ Star us on GitHub — it motivates us a lot!

[Report Bug](https://github.com/ruslanmv/3D-Avatar-Chatbot/issues) ·
[Request Feature](https://github.com/ruslanmv/3D-Avatar-Chatbot/issues) ·
[Documentation](https://github.com/ruslanmv/3D-Avatar-Chatbot/wiki)

</div>
