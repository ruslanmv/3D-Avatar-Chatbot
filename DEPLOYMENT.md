# 🚀 Deployment Guide

Complete guide for deploying the 3D Avatar Chatbot to various platforms.

---

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Platform-Specific Deployment](#platform-specific-deployment)
    - [GitHub Pages](#github-pages)
    - [Netlify](#netlify)
    - [Vercel](#vercel)
    - [Traditional Web Server](#traditional-web-server)
    - [Docker](#docker)
- [Configuration](#configuration)
- [Security Checklist](#security-checklist)
- [Performance Optimization](#performance-optimization)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before deploying, ensure you have:

- ✅ Node.js >= 18.0.0 installed
- ✅ npm >= 9.0.0 installed
- ✅ Git configured
- ✅ OpenAI API key (for testing)
- ✅ Domain name (optional, for custom domains)
- ✅ SSL certificate (for production)

---

## Environment Setup

### 1. Prepare the Project

```bash
# Clone the repository
git clone https://github.com/ruslanmv/3D-Avatar-Chatbot.git
cd 3D-Avatar-Chatbot

# Install dependencies
make install

# Run validation
make validate

# Build for production
make build
```

### 2. Environment Variables

Create a `.env` file for local testing (DO NOT commit this file):

```bash
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-3.5-turbo
```

**Important**: The application stores API keys in browser localStorage. No
server-side environment variables needed for deployment.

---

## Platform-Specific Deployment

### GitHub Pages

#### Method 1: Automated Deployment (Recommended)

```bash
# Deploy with one command
make deploy
```

#### Method 2: Manual Deployment

```bash
# Install gh-pages
npm install -g gh-pages

# Deploy to GitHub Pages
npm run deploy:gh-pages
```

#### Method 3: GitHub Actions (Automatic)

The project includes a CI/CD pipeline that automatically deploys to GitHub Pages
on push to the `main` branch.

1. Go to repository settings
2. Navigate to "Pages"
3. Select branch: `gh-pages`
4. Select folder: `/ (root)`
5. Click "Save"

Your site will be available at: `https://ruslanmv.github.io/3D-Avatar-Chatbot/`

#### Custom Domain Setup

1. Add a `CNAME` file to the root:

    ```
    your-domain.com
    ```

2. Configure DNS records:

    ```
    Type: A
    Host: @
    Value: 185.199.108.153
           185.199.109.153
           185.199.110.153
           185.199.111.153
    ```

3. Add CNAME record:
    ```
    Type: CNAME
    Host: www
    Value: ruslanmv.github.io
    ```

---

### Netlify

#### Method 1: GitHub Integration (Recommended)

1. Go to [Netlify](https://netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect GitHub and select the repository
4. Configure build settings:
    - **Build command**: `npm run build` (optional)
    - **Publish directory**: `/`
    - **Production branch**: `main`
5. Click "Deploy site"

#### Method 2: CLI Deployment

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
make deploy-netlify
# or
netlify deploy --prod
```

#### Method 3: Drag & Drop

1. Build the project: `make build`
2. Go to [Netlify Drop](https://app.netlify.com/drop)
3. Drag the entire project folder
4. Done!

#### Custom Domain on Netlify

1. Go to Site settings → Domain management
2. Click "Add custom domain"
3. Enter your domain name
4. Configure DNS:
    ```
    Type: A
    Host: @
    Value: [Netlify IP from dashboard]
    ```
5. Enable HTTPS (automatic with Let's Encrypt)

---

### Vercel

#### Method 1: GitHub Integration

1. Go to [Vercel](https://vercel.com)
2. Click "New Project"
3. Import from GitHub
4. Select the repository
5. Configure:
    - **Framework Preset**: Other
    - **Build Command**: (leave empty)
    - **Output Directory**: `./`
6. Click "Deploy"

#### Method 2: CLI Deployment

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel deploy
```

#### Custom Domain on Vercel

1. Go to Project Settings → Domains
2. Add your custom domain
3. Configure DNS as instructed by Vercel
4. Vercel automatically provides SSL

---

### Traditional Web Server

#### Using Apache

1. **Build the project**:

    ```bash
    make build
    ```

2. **Upload files**:

    ```bash
    scp -r . user@yourserver.com:/var/www/html/chatbot/
    ```

3. **Configure Apache**:

    ```apache
    <VirtualHost *:443>
        ServerName chatbot.example.com
        DocumentRoot /var/www/html/chatbot

        SSLEngine on
        SSLCertificateFile /path/to/cert.pem
        SSLCertificateKeyFile /path/to/key.pem

        <Directory /var/www/html/chatbot>
            Options Indexes FollowSymLinks
            AllowOverride All
            Require all granted
        </Directory>

        # Enable gzip compression
        AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript

        # Cache control
        <FilesMatch "\.(jpg|jpeg|png|gif|svg|webp|js|css)$">
            Header set Cache-Control "max-age=31536000, public"
        </FilesMatch>
    </VirtualHost>
    ```

4. **Restart Apache**:
    ```bash
    sudo systemctl restart apache2
    ```

#### Using Nginx

1. **Build and upload** (same as Apache)

2. **Configure Nginx**:

    ```nginx
    server {
        listen 443 ssl http2;
        server_name chatbot.example.com;

        ssl_certificate /path/to/cert.pem;
        ssl_certificate_key /path/to/key.pem;

        root /var/www/html/chatbot;
        index index.html;

        location / {
            try_files $uri $uri/ =404;
        }

        # Gzip compression
        gzip on;
        gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

        # Cache control
        location ~* \.(jpg|jpeg|png|gif|svg|webp|js|css)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    ```

3. **Test and restart**:
    ```bash
    sudo nginx -t
    sudo systemctl restart nginx
    ```

---

### Docker

#### Dockerfile

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

#### Build and Run

```bash
# Build the image
docker build -t 3d-avatar-chatbot .

# Run the container
docker run -d -p 80:80 --name chatbot 3d-avatar-chatbot

# Or using docker-compose
docker-compose up -d
```

#### docker-compose.yml

```yaml
version: '3.8'
services:
    chatbot:
        build: .
        ports:
            - '80:80'
            - '443:443'
        restart: unless-stopped
        volumes:
            - ./ssl:/etc/nginx/ssl
```

---

## Configuration

### Content Security Policy (CSP)

Add CSP headers for enhanced security:

```html
<meta
    http-equiv="Content-Security-Policy"
    content="default-src 'self';
               script-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
               style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
               font-src 'self' https://fonts.gstatic.com;
               connect-src 'self' https://api.openai.com;"
/>
```

### CORS Configuration

If deploying to a custom domain:

```javascript
// No CORS configuration needed - all API calls are client-side
```

### Cache Headers

Optimize with proper cache headers:

```
Cache-Control: max-age=31536000, immutable  # For static assets
Cache-Control: no-cache                      # For HTML files
```

---

## Security Checklist

Before deploying to production:

- [ ] **HTTPS Enabled** - SSL certificate configured
- [ ] **CSP Headers** - Content Security Policy implemented
- [ ] **No API Keys in Code** - All keys stored client-side
- [ ] **CORS Configured** - If needed for your domain
- [ ] **Security Headers** - X-Frame-Options, X-Content-Type-Options
- [ ] **Minified Assets** - JS/CSS minified
- [ ] **Gzip/Brotli** - Compression enabled
- [ ] **Rate Limiting** - Implement if using backend
- [ ] **Input Validation** - All user inputs sanitized
- [ ] **Error Handling** - No sensitive info in errors
- [ ] **Dependencies Updated** - Run `npm audit`
- [ ] **Backup Strategy** - Regular backups configured

---

## Performance Optimization

### 1. Asset Optimization

```bash
# Minify JavaScript
npx terser app.js -o app.min.js

# Optimize images
npx imagemin-cli images/*.png --out-dir=images/optimized

# Generate WebP versions
find images -name "*.png" -exec cwebp -q 80 {} -o {}.webp \;
```

### 2. Enable Compression

```nginx
# Nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript;

# Apache
AddOutputFilterByType DEFLATE text/html text/css application/javascript
```

### 3. CDN Integration

Use a CDN for static assets:

```html
<!-- Cloudflare, Fastly, or CloudFront -->
<link rel="stylesheet" href="https://cdn.example.com/css/style.css" />
```

### 4. Lazy Loading

Implement lazy loading for the 3D avatar:

```javascript
// Already implemented in the codebase
const loadAvatar = () => import('./app.js');
```

---

## Monitoring

### Application Monitoring

#### Using Sentry

```javascript
// Add to main.js
if (window.location.hostname !== 'localhost') {
    Sentry.init({
        dsn: 'your-sentry-dsn',
        environment: 'production',
    });
}
```

#### Using Google Analytics

```html
<!-- Add to index.html -->
<script
    async
    src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"
></script>
<script>
    window.dataLayer = window.dataLayer || [];
    function gtag() {
        dataLayer.push(arguments);
    }
    gtag('js', new Date());
    gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

### Uptime Monitoring

Use services like:

- [UptimeRobot](https://uptimerobot.com)
- [Pingdom](https://www.pingdom.com)
- [StatusCake](https://www.statuscake.com)

---

## Troubleshooting

### Common Issues

#### 1. API Key Not Working

**Problem**: "Invalid API key" error

**Solution**:

- Clear browser localStorage
- Re-enter API key in settings
- Check key starts with `sk-`
- Verify key hasn't been revoked

#### 2. 3D Avatar Not Loading

**Problem**: Avatar doesn't appear

**Solution**:

```bash
# Check browser console for errors
# Ensure all files uploaded correctly
ls -la app.js build-viewer/
# Verify MIME types configured
```

#### 3. Speech Recognition Not Working

**Problem**: Microphone button doesn't work

**Solution**:

- Use HTTPS (required for mic access)
- Check browser compatibility (Chrome/Edge/Safari)
- Grant microphone permissions

#### 4. CORS Errors

**Problem**: "Cross-Origin Request Blocked"

**Solution**:

```nginx
# Add to Nginx config
add_header Access-Control-Allow-Origin *;
add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
```

#### 5. Deployment Fails

**Problem**: Build or deploy command fails

**Solution**:

```bash
# Clean and reinstall
make clean
make install

# Run diagnostics
make info
npm run validate
```

---

## Post-Deployment

### 1. Test Checklist

- [ ] Homepage loads correctly
- [ ] Settings modal works
- [ ] API key can be saved
- [ ] Chat functionality works
- [ ] Voice input works (if HTTPS)
- [ ] Voice output works
- [ ] All personalities accessible
- [ ] Mobile responsive
- [ ] SSL certificate valid
- [ ] Performance acceptable

### 2. Performance Testing

```bash
# Test with Lighthouse
npm install -g lighthouse
lighthouse https://your-domain.com --view

# Load testing
npm install -g loadtest
loadtest -c 10 -t 60 https://your-domain.com
```

### 3. Documentation

Update the following after deployment:

- Update README with live demo URL
- Document any custom configuration
- Note any platform-specific issues
- Update API documentation

---

## Support

For deployment issues:

- 📖 [Documentation](https://github.com/ruslanmv/3D-Avatar-Chatbot/wiki)
- 💬 [Discussions](https://github.com/ruslanmv/3D-Avatar-Chatbot/discussions)
- 🐛 [Issue Tracker](https://github.com/ruslanmv/3D-Avatar-Chatbot/issues)

---

**Happy Deploying! 🚀**
