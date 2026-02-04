# Commento 📸

Dashboard für unbeantwortete Instagram-Kommentare.

**🔗 Live: [commento-five.vercel.app](https://commento-five.vercel.app)**

## Features

- 📸 Zeigt alle Posts mit unbeantworteten Kommentaren
- 💬 Direkt antworten (mit auto @username)
- ✓ Als erledigt markieren (bleibt versteckt)
- 📱 Mobile-optimiert
- ⚡ Lazy Loading (10 Posts auf einmal)
- 🎨 DiceBear Avatare

## Setup (Self-Hosting)

### 1. Facebook App konfigurieren

In deiner [Facebook Developer Console](https://developers.facebook.com/apps/):

1. **Settings → Basic:**
   - App Domains: `localhost`, `your-domain.vercel.app`
   - Privacy Policy URL: (irgendeine URL)

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

### 3. Starten

```bash
npm install
npm start
```

## Deploy (Vercel)

1. Fork/Clone dieses Repo
2. In Vercel importieren
3. Environment Variables setzen (REDIRECT_URI = deine Vercel URL + `/callback`)
4. Deploy!

## Troubleshooting

**"No Facebook Pages found"**
→ Dein Instagram muss mit einer Facebook Page verbunden sein (Business/Creator Account)

**"Permission denied"**
→ Geh zu App Review und stelle sicher, dass alle Permissions für dich aktiviert sind (als Admin brauchst du kein Review)

