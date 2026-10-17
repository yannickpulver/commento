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

Login runs over the Instagram API with Instagram Login. It works with Instagram Business and Creator accounts, no Facebook Page needed.

### 1. Configure Meta App

In the [Meta Developer Console](https://developers.facebook.com/apps/), create an app with the use case **Manage messaging & content on Instagram**, then open **Instagram → API setup with Instagram login**:

- Permissions: `instagram_business_basic`, `instagram_business_manage_comments`
- **Set up Instagram business login** → Redirect URLs:
  - `http://localhost:3000/callback`
  - `https://your-domain.vercel.app/callback`
- **App roles → Roles → Instagram Testers**: add your Instagram account and accept the invite at instagram.com/accounts/manage_access (until the app passes App Review)

### 2. Environment Variables

```bash
# Instagram app ID + secret from "API setup with Instagram login" (not the Meta app ID)
INSTAGRAM_APP_ID=your_instagram_app_id
INSTAGRAM_APP_SECRET=your_instagram_app_secret
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

**"Insufficient developer role" / login fails**
→ Your Instagram account must be an Instagram Tester of the app (see step 1), and a Business or Creator account
