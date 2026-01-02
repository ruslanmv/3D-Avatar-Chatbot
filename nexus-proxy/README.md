# Nexus Proxy Server

CORS proxy for Nexus Avatar AI providers (OpenAI, Claude, Watsonx).

## Quick Start

```bash
cd nexus-proxy
npm install
npm start
```

Server runs on http://localhost:3001

## Environment Variables

- `PORT=3001` - Server port (default: 3001, avoids conflict with frontend)
- `ALLOWED_ORIGINS=*` - Comma-separated list of allowed origins (default: \*)

## Supported Providers

- ✅ OpenAI (api.openai.com)
- ✅ Anthropic Claude (api.anthropic.com)
- ✅ IBM Watsonx (iam.cloud.ibm.com, \*.ml.cloud.ibm.com)

## API

### Health Check

```
GET /health
```

### Proxy Request

```
POST /proxy
Content-Type: application/json

{
  "url": "https://api.openai.com/v1/chat/completions",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer sk-...",
    "Content-Type": "application/json"
  },
  "body": { "model": "gpt-4", "messages": [...] }
}
```

## Security

- Allowlist-based: Only configured AI provider URLs are proxied
- CORS protection: Frontend origins can be restricted via env
- No open relay: Blocks arbitrary URL proxying

## Production Deployment

For production, set specific allowed origins:

```bash
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com npm start
```
