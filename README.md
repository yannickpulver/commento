# Instagram Comment Dashboard

Zeigt alle unbeantworteten Instagram-Kommentare mit Thumbnail und Antwort-Möglichkeit.

## Setup

### 1. Facebook App konfigurieren

In deiner [Facebook Developer Console](https://developers.facebook.com/apps/):

1. **Settings → Basic:**
   - App Domains: `localhost`
   - Privacy Policy URL: (irgendeine URL)

2. **Add Product → Facebook Login:**
   - Valid OAuth Redirect URIs: `http://localhost:3000/callback`

3. **Add Product → Instagram Graph API**

4. **App Review → Permissions:**
   - `instagram_basic` ✓
   - `instagram_manage_comments` ✓
   - `pages_show_list` ✓
   - `pages_read_engagement` ✓

### 2. Starten

```bash
cd instagram-dashboard
npm install
npm start
```

### 3. Öffnen

http://localhost:3000

Beim ersten Mal wirst du zur Instagram/Facebook-Anmeldung weitergeleitet.

## Features

- 📸 Zeigt alle Posts mit unbeantworteten Kommentaren
- 💬 Direkt antworten aus dem Dashboard
- ✓ Als erledigt markieren
- 🔄 Refresh Button

## Troubleshooting

**"No Facebook Pages found"**
→ Dein Instagram muss mit einer Facebook Page verbunden sein (Business/Creator Account)

**"Permission denied"**
→ Geh zu App Review und stelle sicher, dass alle Permissions für dich aktiviert sind (als Admin brauchst du kein Review)

---

Made with 🦞
