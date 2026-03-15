# Deployment Guide

## Vercel (Recommended)

### One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ruslanmv/3D-Avatar-Chatbot)

Click the button, sign in, and deploy. Your app will be live in ~30 seconds.

### CLI deploy

```bash
npm install -g vercel
vercel login
vercel --prod
```

### GitHub integration

1. Go to [vercel.com](https://vercel.com) → Add New → Project
2. Import your GitHub repository
3. Click Deploy

Vercel auto-deploys on every push to `main`. Pull requests get preview deployments.

### Configuration

The project includes a production-ready `vercel.json` with:

- Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Cache optimization for static assets (JS, CSS, images, GLB/VRM models)
- CORS headers for 3D model files
- Clean URLs and route rewrites
- WebXR permissions (microphone, camera, xr-spatial-tracking)

No environment variables needed — API keys are stored in browser localStorage.

### Custom domain

1. Vercel Dashboard → Project → Settings → Domains
2. Add your domain (e.g., `chatbot.yourdomain.com`)
3. Configure DNS as instructed
4. SSL certificate is automatic (Let's Encrypt)

---

## Other Platforms

### GitHub Pages

```bash
npm run deploy:gh-pages
```

Or enable in repository settings → Pages → branch `gh-pages`.

### Netlify

1. Connect your GitHub repo at [netlify.com](https://netlify.com)
2. Publish directory: `/`
3. No build command needed

### Any static host

Upload the project folder to any web server. Requirements:

- HTTPS (required for WebXR and microphone access)
- Serve `.glb`, `.vrm` files with `Content-Type: model/gltf-binary`
- Serve `.wasm` files with `Content-Type: application/wasm`

---

## Post-Deployment Checklist

- [ ] App loads at your URL
- [ ] Settings modal opens, API key saves
- [ ] Chat sends and receives messages
- [ ] Avatar loads and animates
- [ ] Voice input works (Chrome/Edge/Safari, requires HTTPS)
- [ ] Text-to-speech works
- [ ] VR button appears (on supported devices)
- [ ] Mobile responsive layout works

---

## Security

The deployment is secure by default:

- API keys stored in browser localStorage only (never sent to your server)
- Security headers configured in `vercel.json`
- HTTPS enforced for WebXR and microphone APIs
- No server-side data collection or tracking
- CORS proxy (`nexus-proxy/` or `api/proxy.js`) for API requests

Set OpenAI/provider spending limits in your provider dashboard to control costs.
