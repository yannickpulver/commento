# Commento 💬

Dashboard for unanswered Instagram comments.

**🔗 Live: [commento-five.vercel.app](https://commento-five.vercel.app)**

## Features

- 📸 Shows all posts with unanswered comments
- 💬 Reply directly (auto-prepends @username)
- ✕ Dismiss comments (persists across sessions)
- 📱 Mobile-optimized
- ⚡ Lazy loading (10 posts at a time)
- 🎨 DiceBear avatars

## Setup (Self-Hosting)

### 1. Configure Facebook App

In your [Facebook Developer Console](https://developers.facebook.com/apps/):

1. **Settings → Basic:**
   - App Domains: `localhost`, `your-domain.vercel.app`
   - Privacy Policy URL: (any URL)

2. **Add Product → Facebook Login:**
   - Valid OAuth Redirect URIs: 
     - `http://localhost:3000/callback`
     - `https://your-domain.vercel.app/callback`

3. **Add Product → Instagram Graph API**

4. **App Review → Permissions:**
   - `instagram_basic` ✓
   - `instagram_manage_comments` ✓
   - `pages_show_list` ✓
   - `pages_read_engagement` ✓

### 2. Environment Variables

```bash
FB_APP_ID=your_app_id
FB_APP_SECRET=your_app_secret
REDIRECT_URI=http://localhost:3000/callback
PORT=3000
```

### 3. Run

```bash
npm install
npm start
```

## Deploy (Vercel)

1. Fork/clone this repo
2. Import in Vercel
3. Set environment variables (REDIRECT_URI = your Vercel URL + `/callback`)
4. Deploy!

## Troubleshooting

**"No Facebook Pages found"**
→ Your Instagram must be connected to a Facebook Page (Business/Creator Account)

**"Permission denied"**
→ Go to App Review and make sure all permissions are enabled for you (as admin you don't need a review)
