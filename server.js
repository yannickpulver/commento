require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const { FB_APP_ID, FB_APP_SECRET, REDIRECT_URI, PORT } = process.env;

// Cookie helper
function parseTokenCookie(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/ig_token=([^;]+)/);
  if (match) {
    try {
      return JSON.parse(decodeURIComponent(match[1]));
    } catch (e) {}
  }
  return null;
}

// Home page
app.get('/', (req, res) => {
  const token = parseTokenCookie(req);
  if (token && token.access_token) {
    res.sendFile(__dirname + '/public/dashboard.html');
  } else {
    res.sendFile(__dirname + '/public/login.html');
  }
});

// Start OAuth flow
app.get('/auth', (req, res) => {
  const scope = 'instagram_basic,instagram_manage_comments,pages_show_list,pages_read_engagement';
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&response_type=code`;
  res.redirect(authUrl);
});

// OAuth callback
app.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.send(`Error: ${error}`);
  }
  
  try {
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${FB_APP_SECRET}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    
    if (tokenData.error) {
      return res.send(`Error: ${JSON.stringify(tokenData.error)}`);
    }
    
    const longLivedUrl = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`;
    const longLivedRes = await fetch(longLivedUrl);
    const longLivedData = await longLivedRes.json();
    
    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${longLivedData.access_token}`);
    const pagesData = await pagesRes.json();
    
    if (!pagesData.data || pagesData.data.length === 0) {
      return res.send('No Facebook Pages found. Make sure your Instagram is connected to a Facebook Page.');
    }
    
    const pageId = pagesData.data[0].id;
    const pageToken = pagesData.data[0].access_token;
    
    const igRes = await fetch(`https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
    const igData = await igRes.json();
    
    if (!igData.instagram_business_account) {
      return res.send('No Instagram Business Account connected to this Page.');
    }
    
    const tokenObj = {
      access_token: pageToken,
      instagram_id: igData.instagram_business_account.id,
      page_id: pageId
    };
    
    res.setHeader('Set-Cookie', `ig_token=${encodeURIComponent(JSON.stringify(tokenObj))}; Path=/; Max-Age=${60*24*60*60}; HttpOnly; SameSite=Lax`);
    res.redirect('/');
  } catch (err) {
    res.send(`Error: ${err.message}`);
  }
});

// API: Get media list (paginated)
app.get('/api/media', async (req, res) => {
  const token = parseTokenCookie(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  const cursor = req.query.cursor || '';
  const limit = 10;
  
  try {
    let url = `https://graph.facebook.com/v18.0/${token.instagram_id}/media?fields=id,caption,media_url,thumbnail_url,permalink,timestamp,media_type&limit=${limit}&access_token=${token.access_token}`;
    if (cursor) {
      url += `&after=${cursor}`;
    }
    
    const mediaRes = await fetch(url);
    const mediaData = await mediaRes.json();
    
    if (mediaData.error) {
      return res.status(400).json(mediaData);
    }
    
    res.json({
      posts: mediaData.data || [],
      nextCursor: mediaData.paging?.cursors?.after || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get comments for a single post
app.get('/api/comments/:postId', async (req, res) => {
  const token = parseTokenCookie(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  const { postId } = req.params;
  
  try {
    const commentsRes = await fetch(
      `https://graph.facebook.com/v18.0/${postId}/comments?fields=id,text,username,timestamp,replies{id,text,username}&limit=100&access_token=${token.access_token}`
    );
    const commentsData = await commentsRes.json();
    
    if (commentsData.error) {
      return res.status(400).json(commentsData);
    }
    
    // Filter unanswered only
    const unanswered = (commentsData.data || []).filter(comment => {
      return !comment.replies || !comment.replies.data || comment.replies.data.length === 0;
    });
    
    res.json({ comments: unanswered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Reply to comment
app.post('/api/reply', async (req, res) => {
  const token = parseTokenCookie(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  const { comment_id, message } = req.body;
  
  try {
    const replyRes = await fetch(
      `https://graph.facebook.com/v18.0/${comment_id}/replies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          access_token: token.access_token
        })
      }
    );
    const replyData = await replyRes.json();
    
    if (replyData.error) {
      return res.status(400).json(replyData);
    }
    
    res.json({ success: true, id: replyData.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Check auth status
app.get('/api/status', (req, res) => {
  const token = parseTokenCookie(req);
  res.json({ 
    authenticated: !!(token && token.access_token),
    instagram_id: token?.instagram_id 
  });
});

// API: Get Instagram profile picture (proxy)
const avatarCache = new Map();
app.get('/api/avatar/:username', async (req, res) => {
  const { username } = req.params;
  
  // Check cache first (1 hour)
  const cached = avatarCache.get(username);
  if (cached && (Date.now() - cached.time) < 3600000) {
    return res.redirect(cached.url);
  }
  
  try {
    // Use Instagram's private API (same as mobile app)
    const response = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 458229237)',
        'X-IG-App-ID': '936619743392459',
        'Accept': '*/*',
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      const avatarUrl = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url;
      
      if (avatarUrl) {
        // Decode unicode escapes
        const decodedUrl = avatarUrl.replace(/\\u0026/g, '&');
        avatarCache.set(username, { url: decodedUrl, time: Date.now() });
        return res.redirect(decodedUrl);
      }
    }
    
    // Fallback: UI Avatars
    res.redirect(`https://ui-avatars.com/api/?name=${username}&background=333&color=fff&size=64`);
  } catch (err) {
    // Fallback on error
    res.redirect(`https://ui-avatars.com/api/?name=${username}&background=333&color=fff&size=64`);
  }
});

// Logout
app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'ig_token=; Path=/; Max-Age=0');
  res.redirect('/');
});

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`\n🦞 Commento running at http://localhost:${port}\n`);
});
