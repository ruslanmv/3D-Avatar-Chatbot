# 🚀 Vercel Deployment Guide

Complete guide for deploying the 3D Avatar Chatbot to Vercel.

---

## Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ruslanmv/3D-Avatar-Chatbot)

Click the button above to deploy in one click!

---

## Method 1: GitHub Integration (Recommended)

### Step 1: Connect GitHub

1. Go to [Vercel](https://vercel.com)
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Select `3D-Avatar-Chatbot`

### Step 2: Configure Project

Vercel will auto-detect the project settings:

```
Framework Preset: Other
Root Directory: ./
Build Command: (leave empty - no build needed)
Output Directory: ./
Install Command: npm install
```

### Step 3: Environment Variables (Optional)

No environment variables needed! The app uses browser localStorage for API keys.

### Step 4: Deploy

Click "Deploy" and wait ~30 seconds.

Your app will be live at: `https://your-project.vercel.app`

---

## Method 2: Vercel CLI

### Install Vercel CLI

```bash
npm install -g vercel
```

### Login

```bash
vercel login
```

### Deploy

```bash
# From project root
cd 3D-Avatar-Chatbot

# Deploy to production
vercel --prod

# Or deploy to preview
vercel
```

### Configure Project

The `vercel.json` file is already configured with:

- Security headers (CSP, X-Frame-Options, etc.)
- Cache optimization for static assets
- Clean URLs
- Automatic HTTPS
- Rewrites for demo page

---

## Method 3: Drag & Drop

1. Build the project (optional):

    ```bash
    make build
    ```

2. Go to [Vercel Dashboard](https://vercel.com/new)

3. Drag and drop the entire project folder

4. Done! Your site is live.

---

## Custom Domain Setup

### Add Custom Domain

1. Go to your project in Vercel Dashboard
2. Click "Settings" → "Domains"
3. Click "Add Domain"
4. Enter your domain name (e.g., `chatbot.example.com`)

### Configure DNS

Vercel will provide instructions. Typically:

**For root domain (@):**

```
Type: A
Name: @
Value: 76.76.21.21
```

**For www subdomain:**

```
Type: CNAME
Name: www
Value: cname.vercel-dns.com
```

### SSL Certificate

Vercel automatically provides free SSL certificates via Let's Encrypt.

---

## Configuration Details

### vercel.json

The project includes a production-ready `vercel.json`:

```json
{
    "version": 3,
    "builds": [
        {
            "src": "index.html",
            "use": "@vercel/static"
        }
    ],
    "headers": [
        // Security headers
        // Cache control
        // Performance optimization
    ],
    "rewrites": [
        {
            "source": "/demo",
            "destination": "/demo.html"
        }
    ],
    "cleanUrls": true,
    "trailingSlash": false
}
```

### Features Enabled

✅ **Security Headers**: X-Frame-Options, CSP, XSS Protection ✅ **Cache
Optimization**: Long-term caching for static assets ✅ **Clean URLs**: Remove
.html extension ✅ **HTTPS**: Automatic SSL certificate ✅ **CDN**: Global edge
network ✅ **Gzip/Brotli**: Automatic compression

---

## Environment-Specific Settings

### Production

Vercel automatically optimizes for production:

- Minification
- Compression (Gzip/Brotli)
- HTTP/2
- Image optimization
- Smart CDN caching

### Preview Deployments

Every git push creates a unique preview URL:

```
https://3d-avatar-chatbot-git-branch-name.vercel.app
```

Perfect for:

- Testing pull requests
- Sharing work-in-progress
- Client previews

---

## Advanced Configuration

### Serverless Functions (Future)

If you add API routes later:

```javascript
// api/chat.js
export default function handler(req, res) {
    res.status(200).json({ message: 'Hello from Vercel!' });
}
```

Access at: `https://your-app.vercel.app/api/chat`

### Analytics

Enable Vercel Analytics:

1. Go to Project Settings → Analytics
2. Enable "Vercel Analytics"
3. Add to your HTML:

```html
<script src="/_vercel/insights/script.js" defer></script>
```

### Speed Insights

Enable Web Vitals monitoring:

1. Project Settings → Speed Insights
2. Enable monitoring
3. View Core Web Vitals in dashboard

---

## Deployment Checklist

Before deploying to production:

- [ ] Test locally: `npm start`
- [ ] Run validation: `make validate`
- [ ] Check security: `make security`
- [ ] Test with real OpenAI API key
- [ ] Verify microphone permissions (HTTPS)
- [ ] Test on mobile devices
- [ ] Check 3D avatar loads correctly
- [ ] Verify all personalities work
- [ ] Test voice input/output
- [ ] Review security headers

---

## Monitoring & Logs

### Real-time Logs

```bash
vercel logs your-project.vercel.app
```

### Deployment Status

```bash
vercel ls
```

### Inspect Deployment

```bash
vercel inspect <deployment-url>
```

---

## Troubleshooting

### Build Fails

**Problem**: "Build failed with exit code 1"

**Solution**: The project doesn't need a build step. Ensure Build Command is
empty or uses `echo "No build needed"`.

### 404 Errors

**Problem**: Routes not working

**Solution**: Check `vercel.json` rewrites and routes configuration.

### API Key Issues

**Problem**: API key not persisting

**Solution**: API keys are stored in browser localStorage. Clear browser cache
and re-enter.

### CORS Errors

**Problem**: Cross-origin errors

**Solution**: Add to `vercel.json`:

```json
{
    "headers": [
        {
            "source": "/(.*)",
            "headers": [
                {
                    "key": "Access-Control-Allow-Origin",
                    "value": "*"
                }
            ]
        }
    ]
}
```

---

## Performance Optimization

### Image Optimization

Vercel automatically optimizes images:

```html
<img src="/avatar.png" alt="Avatar" />
<!-- Automatically served as WebP when supported -->
```

### Edge Caching

Configure cache in `vercel.json`:

```json
{
    "headers": [
        {
            "source": "/(.*\\.(js|css))",
            "headers": [
                {
                    "key": "Cache-Control",
                    "value": "public, max-age=31536000, immutable"
                }
            ]
        }
    ]
}
```

### Compression

Vercel automatically compresses with:

- Gzip
- Brotli (when supported)

No configuration needed!

---

## Comparison: Vercel vs Others

| Feature              | Vercel      | Netlify | GitHub Pages |
| -------------------- | ----------- | ------- | ------------ |
| Setup Time           | 1 min       | 2 min   | 5 min        |
| Custom Domain        | ✅ Free     | ✅ Free | ✅ Free      |
| SSL                  | ✅ Auto     | ✅ Auto | ✅ Auto      |
| Preview Deploys      | ✅ Yes      | ✅ Yes  | ❌ No        |
| Serverless Functions | ✅ Yes      | ✅ Yes  | ❌ No        |
| Edge Network         | ✅ Yes      | ✅ Yes  | ✅ Yes       |
| Build Minutes        | 6000/mo     | 300/mo  | Unlimited    |
| Analytics            | ✅ Built-in | 💰 Paid | ❌ No        |
| Speed Insights       | ✅ Built-in | ❌ No   | ❌ No        |

---

## Vercel CLI Commands

### Useful Commands

```bash
# Deploy to production
vercel --prod

# Deploy to preview
vercel

# List deployments
vercel ls

# View logs
vercel logs

# Remove deployment
vercel rm <deployment-url>

# Link local to Vercel project
vercel link

# Pull environment variables
vercel env pull

# Check deployment status
vercel inspect <url>

# Promote deployment to production
vercel promote <url>
```

---

## Continuous Deployment

Vercel automatically deploys when you:

1. **Push to main branch** → Production deployment
2. **Push to any branch** → Preview deployment
3. **Open pull request** → Preview deployment with comment

### Branch Configuration

Configure in `vercel.json`:

```json
{
    "github": {
        "enabled": true,
        "autoAlias": true,
        "silent": false
    }
}
```

---

## Cost & Limits

### Free Tier (Hobby)

- ✅ Unlimited deployments
- ✅ 100 GB bandwidth/month
- ✅ Serverless function execution: 100 GB-hours
- ✅ 6000 build minutes/month
- ✅ Custom domains
- ✅ SSL certificates
- ✅ Preview deployments

### Pro Tier ($20/month)

- Everything in Free
- 1 TB bandwidth
- Unlimited build minutes
- Team collaboration
- Password protection
- Advanced analytics

**Perfect for this project**: Free tier is more than enough!

---

## Support

For Vercel-specific issues:

- 📖 [Vercel Documentation](https://vercel.com/docs)
- 💬 [Vercel Community](https://github.com/vercel/vercel/discussions)
- 🐛 [Vercel Support](https://vercel.com/support)

For project issues:

- 📖 [Project Documentation](https://github.com/ruslanmv/3D-Avatar-Chatbot/wiki)
- 💬
  [GitHub Discussions](https://github.com/ruslanmv/3D-Avatar-Chatbot/discussions)
- 🐛 [Issue Tracker](https://github.com/ruslanmv/3D-Avatar-Chatbot/issues)

---

## Next Steps

After deploying:

1. ✅ Share your live URL
2. ✅ Configure custom domain (optional)
3. ✅ Enable analytics
4. ✅ Set up monitoring
5. ✅ Add to your portfolio

---

**Your app is now live on Vercel! 🎉**

Access your deployment at: `https://your-project.vercel.app`
