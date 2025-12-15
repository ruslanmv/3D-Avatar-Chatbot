# API Documentation

This directory contains the auto-generated API documentation for the 3D Avatar
Chatbot project.

## Overview

The documentation is generated using [JSDoc](https://jsdoc.app/) and provides
detailed information about:

- **Classes**: `AvatarController`, `ChatManager`, `OpenAIService`,
  `SpeechService`
- **Functions**: All public methods and their parameters
- **Configuration**: Application configuration options

## Generating Documentation

To regenerate the documentation, run:

```bash
npm run docs
```

This will parse all JavaScript files in the `js/` directory and generate HTML
documentation.

## Viewing Documentation

Open `index.html` in your web browser to view the complete API documentation:

```bash
open docs/index.html
```

Or simply navigate to the `docs/` directory and open `index.html`.

## Key Components

### AvatarController

Manages the 3D avatar rendering and animations using Three.js.

### ChatManager

Handles chat message flow and conversation state management.

### OpenAIService

Integrates with OpenAI API for AI-powered responses.

### SpeechService

Provides speech recognition and text-to-speech functionality.

## Documentation Structure

- **index.html** - Main documentation entry point
- **Classes** - Individual class documentation pages
- **Source Files** - Annotated source code
- **Global** - Global functions and variables

---

Generated with JSDoc | Last updated: 2025
