const socket = io();

const conversationListEl = document.getElementById('conversation-list');
const threadHeaderEl = document.getElementById('thread-header');
const threadMessagesEl = document.getElementById('thread-messages');
const replyForm = document.getElementById('reply-form');
const replyText = document.getElementById('reply-text');

let conversations = [];
let activeConversationId = null;

// ---------- Helpers ----------
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- Conversation list ----------
async function loadConversations() {
  const res = await fetch('/api/conversations');
  conversations = await res.json();
  renderConversationList();
}

function renderConversationList() {
  if (conversations.length === 0) {
    conversationListEl.innerHTML = '<div class="empty-state">Waiting for the first message…</div>';
    return;
  }

  conversationListEl.innerHTML = conversations
    .map((c) => `
      <div class="conversation-item ${c.id === activeConversationId ? 'active' : ''}" data-id="${c.id}">
        <span class="conversation-name">${escapeHtml(c.username || `User ${c.id}`)}</span>
        <span class="conversation-preview">${escapeHtml(c.last_message_preview || '')}</span>
        <span class="conversation-time">${formatTime(c.last_message_at)}</span>
      </div>
    `)
    .join('');

  conversationListEl.querySelectorAll('.conversation-item').forEach((el) => {
    el.addEventListener('click', () => openConversation(el.dataset.id));
  });
}

// ---------- Thread ----------
async function openConversation(id) {
  activeConversationId = id;
  renderConversationList();

  const convo = conversations.find((c) => c.id === id);
  threadHeaderEl.classList.remove('hidden');
  threadHeaderEl.querySelector('.thread-username').textContent = convo?.username || `User ${id}`;
  threadHeaderEl.querySelector('.thread-id').textContent = id;

  replyForm.classList.remove('hidden');

  const res = await fetch(`/api/conversations/${id}/messages`);
  const messages = await res.json();
  renderMessages(messages);
}

function renderMessages(messages) {
  if (messages.length === 0) {
    threadMessagesEl.innerHTML = '<div class="empty-state main-empty"><p>No messages yet</p></div>';
    return;
  }

  threadMessagesEl.innerHTML = messages.map(messageHtml).join('');
  threadMessagesEl.scrollTop = threadMessagesEl.scrollHeight;
}

function messageHtml(m) {
  let body = '';
  if (m.content_text) {
    body += `<span class="message-text">${escapeHtml(m.content_text)}</span>`;
  }
  if (m.attachment_url) {
    body += `<a class="message-attachment" href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener">
      ${escapeHtml(m.attachment_type || 'attachment')} ↗
    </a>`;
  }
  return `
    <div class="message ${m.direction}">
      ${body}
      <span class="message-time">${formatTime(m.received_at)}</span>
    </div>
  `;
}

function appendMessage(m) {
  if (threadMessagesEl.querySelector('.main-empty')) {
    threadMessagesEl.innerHTML = '';
  }
  threadMessagesEl.insertAdjacentHTML('beforeend', messageHtml(m));
  threadMessagesEl.scrollTop = threadMessagesEl.scrollHeight;
}

// ---------- Reply ----------
replyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = replyText.value.trim();
  if (!text || !activeConversationId) return;

  replyText.value = '';
  replyText.style.height = 'auto';

  const res = await fetch(`/api/conversations/${activeConversationId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Could not send: ${err.error || 'unknown error'}`);
  }
});

// auto-grow textarea
replyText.addEventListener('input', () => {
  replyText.style.height = 'auto';
  replyText.style.height = replyText.scrollHeight + 'px';
});

// ---------- Realtime updates ----------
socket.on('new_message', (m) => {
  // Update or create the conversation entry
  let convo = conversations.find((c) => c.id === m.conversation_id);
  if (!convo) {
    convo = { id: m.conversation_id, username: null, last_message_at: 0, last_message_preview: '' };
    conversations.unshift(convo);
  }
  convo.last_message_at = m.received_at;
  convo.last_message_preview = m.content_text || `[${m.attachment_type || 'attachment'}]`;

  conversations.sort((a, b) => b.last_message_at - a.last_message_at);
  renderConversationList();

  if (m.conversation_id === activeConversationId) {
    appendMessage(m);
  }
});

socket.on('conversation_updated', ({ id, username }) => {
  const convo = conversations.find((c) => c.id === id);
  if (convo) {
    convo.username = username;
    renderConversationList();
    if (id === activeConversationId) {
      threadHeaderEl.querySelector('.thread-username').textContent = username;
    }
  }
});

// ---------- Init ----------
loadConversations();
