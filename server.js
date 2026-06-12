// server.js
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const basicAuth = require('express-basic-auth');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;       // you choose this, used when registering the webhook
const APP_SECRET = process.env.APP_SECRET;           // from your Meta App > Settings > Basic
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // long-lived token for your Page
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || 'changeme';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- IMPORTANT: webhook route needs the *raw* body to verify the signature,
// so we capture it before express.json() parses it.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ============================================================
// 1. WEBHOOK VERIFICATION (Meta calls this once when you set up the webhook)
// ============================================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ============================================================
// 2. WEBHOOK EVENTS (Meta calls this every time you get a new message)
// ============================================================
app.post('/webhook', (req, res) => {
  // Verify the request really came from Meta
  if (!verifySignature(req)) {
    console.warn('Webhook signature verification failed.');
    return res.sendStatus(403);
  }

  // Respond immediately - Meta requires a fast 200 OK
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'instagram') return;

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        handleMessagingEvent(event);
      }
    }
  } catch (err) {
    console.error('Error handling webhook event:', err);
  }
});

function verifySignature(req) {
  const signature = req.get('X-Hub-Signature-256');
  if (!signature || !req.rawBody) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');

  // timing-safe comparison
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function handleMessagingEvent(event) {
  // Ignore delivery/read receipts and echo of our own messages
  if (event.read || event.delivery) return;

  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;
  const message = event.message;
  if (!senderId || !message) return;

  // If the message id matches one we just sent, it's an echo of our own reply - skip
  if (message.is_echo) return;

  const timestamp = event.timestamp || Date.now();
  const messageId = message.mid || `local_${Date.now()}_${Math.random()}`;

  let contentType = 'text';
  let contentText = message.text || null;
  let attachmentUrl = null;
  let attachmentType = null;

  // Shared posts/reels/images come through as attachments
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    const att = message.attachments[0];
    attachmentType = att.type || 'unknown'; // 'image', 'video', 'share', 'ig_reel', etc.
    attachmentUrl = att.payload?.url || null;
    if (!contentText) {
      contentType = attachmentType;
      contentText = att.payload?.title || null;
    }
  }

  db.upsertConversation(senderId, contentText || `[${attachmentType || 'attachment'}]`, timestamp);

  const storedMessage = {
    id: messageId,
    conversation_id: senderId,
    direction: 'incoming',
    content_type: contentType,
    content_text: contentText,
    attachment_url: attachmentUrl,
    attachment_type: attachmentType,
    received_at: timestamp,
  };
  db.insertMessage(storedMessage);

  // Push to any connected dashboards in real time
  io.emit('new_message', storedMessage);

  // Best-effort: fetch a display name for this conversation if we don't have one yet
  maybeFetchUsername(senderId);
}

// Looks up the sender's IG username via the Graph API the first time we see them.
// Safe to skip entirely if you don't need usernames - it's just a nicer dashboard.
async function maybeFetchUsername(igsid) {
  const conversations = db.getConversations();
  const row = conversations.find((c) => c.id === igsid);
  if (!row || row.username || !PAGE_ACCESS_TOKEN) return;

  try {
    const url = `https://graph.facebook.com/v19.0/${igsid}?fields=username,name&access_token=${PAGE_ACCESS_TOKEN}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const username = data.username || data.name || null;
    if (username) {
      db.setConversationUsername(igsid, username);
      io.emit('conversation_updated', { id: igsid, username });
    }
  } catch (err) {
    console.warn('Could not fetch username for', igsid, err.message);
  }
}

// ============================================================
// 3. DASHBOARD API (protected with HTTP basic auth)
// ============================================================
const requireAuth = basicAuth({
  users: { [DASHBOARD_USER]: DASHBOARD_PASS },
  challenge: true,
});

app.use('/api', requireAuth);
app.use('/', requireAuth, express.static('public'));

// List conversations, most recent first
app.get('/api/conversations', (_req, res) => {
  res.json(db.getConversations());
});

// Get all messages in one conversation, oldest first
app.get('/api/conversations/:id/messages', (req, res) => {
  res.json(db.getMessages(req.params.id));
});

// Send a reply through Instagram
app.post('/api/conversations/:id/reply', async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message text is required.' });
  }
  if (!PAGE_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'PAGE_ACCESS_TOKEN is not configured on the server.' });
  }

  try {
    const resp = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id },
          message: { text },
        }),
      }
    );
    const data = await resp.json();

    if (!resp.ok) {
      console.error('Send message failed:', data);
      return res.status(502).json({ error: data.error?.message || 'Failed to send message.' });
    }

    const timestamp = Date.now();
    const messageId = data.message_id || `local_${timestamp}`;

    const sentMessage = {
      id: messageId,
      conversation_id: id,
      direction: 'outgoing',
      content_type: 'text',
      content_text: text,
      attachment_url: null,
      attachment_type: null,
      received_at: timestamp,
    };
    db.insertMessage(sentMessage);
    db.upsertConversation(id, text, timestamp);

    io.emit('new_message', sentMessage);

    res.json({ ok: true, message: sentMessage });
  } catch (err) {
    console.error('Error sending reply:', err);
    res.status(500).json({ error: 'Unexpected error sending message.' });
  }
});

// ============================================================
// 4. START SERVER
// ============================================================
io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
});

server.listen(PORT, () => {
  console.log(`IG dashboard server running on port ${PORT}`);
});
