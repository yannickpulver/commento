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
// ?all=1 returns every comment (paginated through all pages, capped at 2000); default = unanswered only, first page
app.get('/api/comments/:postId', async (req, res) => {
  const token = parseTokenCookie(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { postId } = req.params;
  const fetchAll = req.query.all === '1';

  try {
    let url = `https://graph.facebook.com/v18.0/${postId}/comments?fields=id,text,username,timestamp,replies{id,text,username}&limit=100&access_token=${token.access_token}`;
    let collected = [];
    const MAX = 2000;

    while (url && collected.length < MAX) {
      const r = await fetch(url);
      const d = await r.json();
      if (d.error) return res.status(400).json(d);
      collected = collected.concat(d.data || []);
      url = fetchAll ? d.paging?.next : null;
    }

    if (!fetchAll) {
      // Inbox mode: filter unanswered only
      collected = collected.filter(c => !c.replies || !c.replies.data || c.replies.data.length === 0);
    }

    res.json({ comments: collected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Follower count via Instagram business_discovery (only works for business/creator accounts)
app.get('/api/follower/:username', async (req, res) => {
  const token = parseTokenCookie(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { username } = req.params;

  try {
    const url = `https://graph.facebook.com/v18.0/${token.instagram_id}?fields=business_discovery.username(${encodeURIComponent(username)}){followers_count,name,profile_picture_url}&access_token=${token.access_token}`;
    const r = await fetch(url);
    const d = await r.json();

    res.set('Cache-Control', 'public, max-age=3600');

    if (d.error || !d.business_discovery) {
      return res.json({ username, followers_count: null });
    }

    res.json({
      username,
      followers_count: d.business_discovery.followers_count ?? null,
      name: d.business_discovery.name || null,
      profile_picture_url: d.business_discovery.profile_picture_url || null
    });
  } catch (err) {
    res.json({ username, followers_count: null });
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
// Instagram blocks cloud IPs, so we use DiceBear avatars (deterministic & stylish)
app.get('/api/avatar/:username', (req, res) => {
  const { username } = req.params;
  
  // DiceBear "initials" style with Instagram gradient colors
  // Same seed = same avatar every time
  res.set('Cache-Control', 'public, max-age=604800'); // 1 week
  res.redirect(`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}&backgroundColor=c13584,e1306c,fd1d1d,f77737,fcaf45&backgroundType=gradientLinear&fontWeight=600`);
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
