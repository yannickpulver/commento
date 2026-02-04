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
    // Exchange code for access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${FB_APP_SECRET}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    
    if (tokenData.error) {
      return res.send(`Error: ${JSON.stringify(tokenData.error)}`);
    }
    
    // Get long-lived token
    const longLivedUrl = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`;
    const longLivedRes = await fetch(longLivedUrl);
    const longLivedData = await longLivedRes.json();
    
    // Get user's pages
    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${longLivedData.access_token}`);
    const pagesData = await pagesRes.json();
    
    if (!pagesData.data || pagesData.data.length === 0) {
      return res.send('No Facebook Pages found. Make sure your Instagram is connected to a Facebook Page.');
    }
    
    // Get Instagram Business Account for the first page
    const pageId = pagesData.data[0].id;
    const pageToken = pagesData.data[0].access_token;
    
    const igRes = await fetch(`https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
    const igData = await igRes.json();
    
    if (!igData.instagram_business_account) {
      return res.send('No Instagram Business Account connected to this Page.');
    }
    
    // Save in cookie (60 days)
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

// API: Get unanswered comments
app.get('/api/comments', async (req, res) => {
  const token = parseTokenCookie(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    // Get recent media
    const mediaRes = await fetch(
      `https://graph.facebook.com/v18.0/${token.instagram_id}/media?fields=id,caption,media_url,thumbnail_url,permalink,timestamp,media_type&limit=25&access_token=${token.access_token}`
    );
    const mediaData = await mediaRes.json();
    
    if (mediaData.error) {
      return res.status(400).json(mediaData);
    }
    
    // Get comments for each post
    const postsWithComments = [];
    
    for (const post of mediaData.data || []) {
      const commentsRes = await fetch(
        `https://graph.facebook.com/v18.0/${post.id}/comments?fields=id,text,username,timestamp,replies{id,text,username}&limit=50&access_token=${token.access_token}`
      );
      const commentsData = await commentsRes.json();
      
      // Filter unanswered comments (no reply)
      const unanswered = (commentsData.data || []).filter(comment => {
        if (!comment.replies || !comment.replies.data || comment.replies.data.length === 0) {
          return true;
        }
        return false;
      });
      
      if (unanswered.length > 0) {
        postsWithComments.push({
          ...post,
          thumbnail: post.thumbnail_url || post.media_url,
          unanswered_comments: unanswered
        });
      }
    }
    
    res.json({ posts: postsWithComments });
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

// Logout
app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'ig_token=; Path=/; Max-Age=0');
  res.redirect('/');
});

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`\n🦞 Instagram Dashboard running at http://localhost:${port}\n`);
});
