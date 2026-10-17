require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const { INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, REDIRECT_URI, PORT } = process.env;
const API = 'https://graph.instagram.com/v25.0';

// Cookie helper. Tokens from the old Facebook login count as logged out.
function parseTokenCookie(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/ig_token=([^;]+)/);
  if (match) {
    try {
      const token = JSON.parse(decodeURIComponent(match[1]));
      if (token.provider === 'instagram') return token;
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

// Start Instagram Login (Business/Creator accounts, no Facebook Page needed)
app.get('/auth', (req, res) => {
  const authUrl = new URL('https://www.instagram.com/oauth/authorize');
  authUrl.searchParams.set('client_id', INSTAGRAM_APP_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'instagram_business_basic,instagram_business_manage_comments');
  authUrl.searchParams.set('enable_fb_login', 'false');
  res.redirect(authUrl.toString());
});

// OAuth callback: code → short-lived token → 60-day token
app.get('/callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error || !code) {
    return res.send(`Error: ${error || 'no code'} ${error_description || ''}`);
  }

  try {
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: INSTAGRAM_APP_ID,
        client_secret: INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code: code.replace(/#_$/, '')
      })
    });
    const shortData = await shortRes.json();
    // The docs wrap the response in `data`; accept the flat shape as well
    const short = shortData.data?.[0] ?? shortData;

    if (!short.access_token) {
      return res.send(`Error: ${JSON.stringify(shortData)}`);
    }

    const longRes = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${INSTAGRAM_APP_SECRET}&access_token=${short.access_token}`);
    const longData = await longRes.json();

    if (!longData.access_token) {
      return res.send(`Error: ${JSON.stringify(longData.error || longData)}`);
    }

    const tokenObj = { access_token: longData.access_token, provider: 'instagram' };

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
    let url = `${API}/me/media?fields=id,caption,media_url,thumbnail_url,permalink,timestamp,media_type&limit=${limit}&access_token=${token.access_token}`;
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

// Instagram Login sometimes leaves `username` empty; `from.username` has it then
function withUsername(c) {
  return { ...c, username: c.username || c.from?.username || 'unknown' };
}

// Nested replies come without username; looks them up in batches of 50
async function fillUnknownUsernames(comments, token) {
  const unknown = comments.filter(c => c.username === 'unknown');
  for (let i = 0; i < unknown.length; i += 50) {
    const chunk = unknown.slice(i, i + 50);
    const d = await (await fetch(`${API}/?ids=${chunk.map(c => c.id).join(',')}&fields=username,from{username}&access_token=${token.access_token}`)).json();
    for (const c of chunk) c.username = d[c.id]?.username || d[c.id]?.from?.username || 'unknown';
  }
}

// Own username per token, to tell which thread messages are mine
const ownUsernames = new Map();
async function ownUsername(token) {
  if (!ownUsernames.has(token.access_token)) {
    const d = await (await fetch(`${API}/me?fields=username&access_token=${token.access_token}`)).json();
    ownUsernames.set(token.access_token, d.username);
  }
  return ownUsernames.get(token.access_token);
}

// Groups comments into threads: top-level comment + replies, oldest first.
// Replies come nested in `replies` or flat with `parent_id`.
function toThreads(comments) {
  const threads = new Map();
  const thread = id => threads.get(id) || threads.set(id, { id, root: null, replies: new Map() }).get(id);
  for (const c of comments) {
    if (c.parent_id) {
      thread(c.parent_id).replies.set(c.id, c);
      continue;
    }
    const t = thread(c.id);
    t.root = c;
    // The flat copy of a reply has the username, the nested one doesn't
    for (const r of c.replies?.data || []) if (!t.replies.has(r.id)) t.replies.set(r.id, withUsername(r));
  }
  return [...threads.values()].map(t => {
    const replies = [...t.replies.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const root = t.root || replies.shift();
    return { id: t.id, root, replies, last: replies.at(-1) || root };
  });
}

// API: Get comments for a single post
// Default: threads whose last message isn't mine (inbox). ?all=1: every top-level comment (picker)
app.get('/api/comments/:postId', async (req, res) => {
  const token = parseTokenCookie(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { postId } = req.params;

  try {
    let url = `${API}/${postId}/comments?fields=id,text,username,from{username},timestamp,parent_id,replies{id,text,username,from{username},timestamp}&limit=100&access_token=${token.access_token}`;
    let collected = [];
    const MAX = 2000;

    while (url && collected.length < MAX) {
      const r = await fetch(url);
      const d = await r.json();
      if (d.error) return res.status(400).json(d);
      collected = collected.concat((d.data || []).map(withUsername));
      url = d.paging?.next;
    }

    if (req.query.all === '1') {
      const comments = collected.filter(c => !c.parent_id);
      await fillUnknownUsernames(comments, token);
      return res.json({ comments });
    }

    const me = await ownUsername(token);
    const all = toThreads(collected);
    await fillUnknownUsernames(all.flatMap(t => [t.root, ...t.replies]), token);
    const threads = all.filter(t => t.last.username !== me);
    res.json({ me, threads });
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
      `${API}/${comment_id}/replies`,
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
  res.json({ authenticated: !!(token && token.access_token) });
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
