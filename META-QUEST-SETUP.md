# Meta Quest VR Setup Guide

Complete guide to getting the VR Chatbot working on Meta Quest 3/2.

## 🚨 **Critical Requirements**

### 1. **HTTPS is MANDATORY**

WebXR **WILL NOT WORK** without HTTPS (except on localhost).

❌ **Won't work:** `http://yoursite.com`
✅ **Will work:** `https://yoursite.com`
✅ **Will work:** `http://localhost:8080` (local development only)

### 2. **Use Quest Browser**

The built-in Quest Browser has the best WebXR support.

## 🧪 **Quick Test - VR Test Page**

We've created a simple test page to verify VR is working:

### **Step 1: Test Locally First**

```bash
# Start local server
python3 -m http.server 8080

# On your computer, open:
# http://localhost:8080/vr-test.html
```

You should see:

-   ✅ A green rotating cube
-   ✅ A pulsing magenta sphere
-   ✅ A grid floor
-   ✅ "ENTER VR" button (may be grayed out without headset)

### **Step 2: Test on Meta Quest**

#### **Option A: Local Network (Easy, No HTTPS needed)**

1. **Find your computer's IP address:**

    ```bash
    # Mac/Linux:
    ifconfig | grep "inet " | grep -v 127.0.0.1

    # Windows:
    ipconfig | findstr IPv4
    ```

    Example: `192.168.1.100`

2. **Make sure Quest is on same WiFi** as your computer

3. **On Meta Quest:**

    - Put on headset
    - Open **Quest Browser** (not Chrome or Firefox)
    - Navigate to: `http://YOUR_IP:8080/vr-test.html`
    - Example: `http://192.168.1.100:8080/vr-test.html`

4. **Look for debug info** (top-left):

    ```
    Browser: Meta Quest ✅
    WebXR: ✅ Supported
    HTTPS: ❌ No (OK for local)
    VR Session: Not started
    ```

5. **Click the "ENTER VR" button** (bottom of screen)

6. **Grant permissions** when prompted

7. **You should see:**
    - Green rotating cube in 3D space
    - Magenta pulsing sphere
    - Grid floor
    - Full 6DOF head tracking

#### **Option B: Production Deployment (Requires HTTPS)**

1. **Deploy to a service with HTTPS:**

    - Vercel: `vercel --prod`
    - Netlify: `netlify deploy --prod`
    - GitHub Pages (with custom domain)

2. **On Meta Quest:**

    - Open Quest Browser
    - Navigate to your HTTPS URL
    - Click "ENTER VR"

## 🔍 **Troubleshooting**

### **Issue 1: No VR Button Appears**

**Check Debug Info** (top-left of vr-test.html):

**If WebXR shows ❌:**

```
WebXR: ❌ Not supported
```

**Fixes:**

-   ✅ Use Quest Browser (not Chrome/Firefox)
-   ✅ Update Quest firmware to latest version
-   ✅ Enable experimental features in Quest settings

**If HTTPS shows ❌ on production:**

```
HTTPS: ❌ No
```

**Fixes:**

-   Deploy to Vercel/Netlify (auto HTTPS)
-   Use local network with IP address
-   Don't use `http://` in production

### **Issue 2: VR Button Grayed Out**

**Cause:** Quest browser hasn't detected the headset is being worn

**Fixes:**

-   Make sure headset is on your head (proximity sensor)
-   Restart Quest Browser
-   Restart Quest headset

### **Issue 3: Black Screen in VR**

**Symptoms:** Click VR button, screen goes black

**Possible causes:**

1. **Camera too far from objects**

    - Our test cube is at -2m from camera
    - Check you're looking forward (not down)

2. **Rendering issue**

    ```javascript
    // Check browser console (Quest Browser -> Menu -> More Tools -> Developer)
    ```

3. **Scene not loading**
    - Refresh the page
    - Clear browser cache

### **Issue 4: "VR Not Available"**

**On Desktop:**

-   Normal - you need a VR headset
-   Page still works in desktop mode

**On Quest:**

-   Check Quest Browser is up to date
-   Enable WebXR in Quest settings:
    -   Settings > System > Developer > Enable USB Debugging

### **Issue 5: Performance Issues / Lag**

**Solutions:**

-   Close other apps on Quest
-   Lower graphics quality in scene
-   Check WiFi signal strength
-   Reduce polygon count of 3D models

## 📱 **Production Deployment for Quest**

### **Recommended: Vercel (Free HTTPS)**

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod

# You'll get a URL like:
# https://your-project.vercel.app
```

**On Quest:**

```
https://your-project.vercel.app/vr-test.html
```

### **Alternative: Netlify**

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod
```

## 🎯 **Testing Checklist**

Before deploying to production, test these:

-   [ ] vr-test.html loads on desktop
-   [ ] Green cube is visible and rotating
-   [ ] Magenta sphere is pulsing
-   [ ] Debug info shows correct browser
-   [ ] VR button appears on Quest Browser
-   [ ] VR button is clickable (not grayed out)
-   [ ] VR session starts when clicked
-   [ ] Scene is visible in VR
-   [ ] Head tracking works (look around)
-   [ ] Can see objects clearly
-   [ ] Performance is smooth (60+ FPS)

## 🔧 **Developer Console on Quest**

To debug on Quest:

1. Open Quest Browser
2. Press **menu button** (three dots)
3. Go to **"More Tools" > "Developer Tools"**
4. Check **Console** tab for errors

Common errors:

```
WebXR not available
→ Use HTTPS or localhost

SecurityError: Access denied
→ Grant WebXR permissions

ReferenceError: THREE is not defined
→ Check internet connection (Three.js CDN)
```

## 📊 **Performance Tips for Quest**

Meta Quest 3 has limited GPU compared to PC. Optimize:

1. **Keep polygon count low:**

    - < 50,000 triangles total
    - Use simple materials
    - Avoid complex shaders

2. **Lighting:**

    - Use baked lighting when possible
    - Limit to 2-3 dynamic lights
    - Avoid shadows (expensive)

3. **Textures:**

    - Max 1024x1024 (prefer 512x512)
    - Use compressed formats
    - Limit total VRAM usage

4. **Draw calls:**
    - Merge meshes when possible
    - Use instancing for repeated objects
    - Batch materials

## 🎮 **Controls in VR**

**Head Tracking:**

-   ✅ Automatic - just look around

**Controllers:**

-   ✅ Point at UI elements
-   ✅ Trigger to click
-   ✅ Thumbstick to move (if enabled)

**Hands:**

-   🚧 Hand tracking not yet implemented
-   Use controllers for now

## 🆘 **Still Not Working?**

### **Quick Diagnostic:**

1. **Visit vr-test.html first**

    ```
    http://YOUR_IP:8080/vr-test.html
    ```

2. **Check all debug indicators are green**

3. **If any are red, follow troubleshooting above**

4. **If still stuck, check:**
    - Quest firmware version (Settings > System > About)
    - Quest Browser version
    - WiFi connection quality
    - Computer firewall settings (may block local network access)

### **Get Help:**

-   Check browser console for errors
-   Screenshot debug info panel
-   Note exact error messages
-   Open GitHub issue with details

## ✅ **Success Indicators**

You know it's working when:

-   ✅ Debug panel shows all green checkmarks
-   ✅ "ENTER VR" button is blue and clickable
-   ✅ Clicking button shows "VR Session Started! 🥽"
-   ✅ You see 3D objects in immersive space
-   ✅ Head tracking is smooth
-   ✅ Objects are at correct scale (arm's length)

## 🎉 **Next Steps**

Once vr-test.html works:

1. Try **index-vr.html** for full avatar experience
2. Upload VRM avatars
3. Test expressions and animations
4. Connect to chatbot AI

---

**Remember:** Always test with **vr-test.html** first before trying the full chatbot!

For more info, see:

-   [VR-README.md](VR-README.md) - Complete VR features guide
-   [DEPLOYMENT.md](DEPLOYMENT.md) - Production deployment guide
