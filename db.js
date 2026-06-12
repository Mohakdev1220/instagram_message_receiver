// db.js
// A tiny JSON-file database. No native modules, no separate DB server.
// All data lives in ig_dashboard.json, which is created automatically.
//
// Data shape:
// {
//   conversations: { [id]: { id, username, last_message_at, last_message_preview } },
//   messages: { [id]: { id, conversation_id, direction, content_type, content_text,
//                        attachment_url, attachment_type, received_at } }
// }

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'ig_dashboard.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { conversations: {}, messages: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    console.error('Could not read database file, starting fresh:', err.message);
    return { conversations: {}, messages: {} };
  }
}

let data = load();

function save() {
  // Write to a temp file first, then rename, to avoid corrupting the file
  // if the process is killed mid-write.
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

// ---------- Conversations ----------
function getConversations() {
  return Object.values(data.conversations).sort(
    (a, b) => (b.last_message_at || 0) - (a.last_message_at || 0)
  );
}

function upsertConversation(id, preview, timestamp) {
  const existing = data.conversations[id];
  data.conversations[id] = {
    id,
    username: existing?.username || null,
    last_message_at: timestamp,
    last_message_preview: preview,
  };
  save();
}

function setConversationUsername(id, username) {
  if (!data.conversations[id]) return;
  data.conversations[id].username = username;
  save();
}

// ---------- Messages ----------
function getMessages(conversationId) {
  return Object.values(data.messages)
    .filter((m) => m.conversation_id === conversationId)
    .sort((a, b) => a.received_at - b.received_at);
}

function messageExists(id) {
  return Boolean(data.messages[id]);
}

function insertMessage(message) {
  if (data.messages[message.id]) return; // already stored (dedupe)
  data.messages[message.id] = message;
  save();
}

module.exports = {
  getConversations,
  upsertConversation,
  setConversationUsername,
  getMessages,
  messageExists,
  insertMessage,
};
