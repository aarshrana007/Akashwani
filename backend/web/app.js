/* Teams Clone web app v2 — vanilla JS, Socket.IO realtime, LiveKit calls */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => (n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ts) => { const d = new Date(ts), t = new Date(); return d.toDateString() === t.toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); };
const toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };
const avatarHtml = (name, color, { sq = false, online } = {}) => `<div class="avatar${sq ? ' sq' : ''}" style="background:${color || 'var(--accent)'}">${esc(initials(name))}${online === undefined ? '' : `<span class="dot${online ? ' on' : ''}"></span>`}</div>`;

let token = localStorage.getItem('token'), me = JSON.parse(localStorage.getItem('me') || 'null');
let socket, chats = [], people = [], cur = null, msgs = [], editing = null, typingTimer, typers = {}, tab = 'chats';

// ---------- API ----------
async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'ngrok-skip-browser-warning': '1', Authorization: 'Bearer ' + token };
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && token) { logout(); throw new Error('Session expired'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

// ---------- auth ----------
let authMode = 'login'; // 'login' | 'register' | 'reset'
const registering = () => authMode === 'register';
function setAuthMode(mode) {
  authMode = mode; const reg = mode === 'register', reset = mode === 'reset';
  $('nameField').classList.toggle('hidden', !reg); $('aName').required = reg;
  $('codeRow').classList.toggle('hidden', !reg && !reset); $('aCode').required = reg || reset; $('codeHint').classList.add('hidden'); $('aCode').value = '';
  $('aPass').placeholder = reset ? 'New password' : 'Password'; $('aPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authTitle').textContent = { login: 'Sign in', register: 'Create account', reset: 'Reset password' }[mode];
  $('aBtn').textContent = { login: 'Sign in', register: 'Create account', reset: 'Set new password' }[mode];
  $('aSwitchText').textContent = mode === 'login' ? 'New to Akashwani?' : 'Back to'; $('aSwitch').textContent = mode === 'login' ? 'Create account' : 'Sign in';
  $('aSwitch').onclick = () => setAuthMode(mode === 'login' ? 'register' : 'login');
  $('forgotRow').classList.toggle('hidden', mode !== 'login'); $('aErr').textContent = '';
}
function toggleAuth() { setAuthMode(authMode === 'login' ? 'register' : 'login'); }
async function submitAuth(e) {
  e.preventDefault(); $('aErr').textContent = ''; $('aBtn').disabled = true;
  try {
    const r = await fetch({ login: '/auth/login', register: '/auth/register', reset: '/auth/reset' }[authMode], { method: 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify({ email: $('aEmail').value.trim(), password: $('aPass').value, name: $('aName').value.trim(), code: $('aCode').value.trim() }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    token = j.token; me = j.user; localStorage.setItem('token', token); localStorage.setItem('me', JSON.stringify(me));
    boot();
  } catch (err) { $('aErr').textContent = err.message; } finally { $('aBtn').disabled = false; }
  return false;
}
async function sendCode() {
  const email = $('aEmail').value.trim(); $('aErr').textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return $('aErr').textContent = 'Enter a valid email address first';
  $('sendCodeBtn').disabled = true;
  try {
    const r = await fetch('/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' }, body: JSON.stringify({ email, purpose: authMode === 'reset' ? 'reset' : 'register' }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    $('codeHint').textContent = j.sent ? `Code sent to ${email} — check your inbox (and spam).` : 'Email sending is not configured: the code is shown in the backend window on the laptop.';
    $('codeHint').classList.remove('hidden'); $('aCode').focus();
    let n = 60; $('sendCodeBtn').textContent = `Resend (${n})`; const iv = setInterval(() => { if (--n <= 0) { clearInterval(iv); $('sendCodeBtn').textContent = 'Resend'; $('sendCodeBtn').disabled = false; } else $('sendCodeBtn').textContent = `Resend (${n})`; }, 1000);
  } catch (e) { $('aErr').textContent = e.message; $('sendCodeBtn').disabled = false; }
}
function logout() { localStorage.removeItem('token'); localStorage.removeItem('me'); token = null; me = null; socket?.disconnect(); location.reload(); }

// ---------- boot ----------
async function boot() {
  $('auth').classList.add('hidden'); $('app').classList.remove('hidden');
  $('meAvatar').outerHTML = avatarHtml(me.name, me.color).replace('class="avatar"', 'class="avatar" id="meAvatar"'); $('meAvatar2').outerHTML = avatarHtml(me.name, me.color).replace('class="avatar"', 'class="avatar" id="meAvatar2"'); $('meName').textContent = me.name; $('meEmail').textContent = me.email;
  connectSocket();
  await Promise.all([loadChats(), loadPeople()]);
  api('/config').then(c => { if (!c.recording) $('recBtn').classList.add('hidden'); });
  if ('Notification' in window && Notification.permission === 'default') setTimeout(() => Notification.requestPermission(), 3000);
}
function connectSocket() {
  socket = io({ auth: { token }, extraHeaders: { 'ngrok-skip-browser-warning': '1' } });
  socket.on('connect_error', (e) => { if (e.message === 'unauthorised') logout(); });
  socket.on('chats:changed', loadChats);
  socket.on('users:changed', loadPeople);
  socket.on('members:changed', ({ chatId }) => { loadChats(); if (cur?.id === chatId) refreshHeader(); });
  socket.on('presence', ({ userId, online }) => { people.forEach(p => { if (p.id === userId) p.online = online; }); chats.forEach(c => { if (c.otherId === userId) c.online = online; }); renderPeople(); renderChats(); if (cur) refreshHeader(); });
  socket.on('message', (m) => {
    if (cur?.id === m.chat_id) { msgs.push(m); renderMsgs(); markRead(); }
    else { const c = chats.find(x => x.id === m.chat_id); if (c && m.user_id !== me.id) { c.unread++; c.last = m; renderChats(); notify(c, m); } }
    loadChats();
  });
  socket.on('message:edit', (d) => { const m = msgs.find(x => x.id === d.id); if (m) { m.text = d.text; m.edited = d.edited; renderMsgs(); } });
  socket.on('message:delete', (d) => { const m = msgs.find(x => x.id === d.id); if (m) { m.deleted = 1; m.text = ''; renderMsgs(); } });
  socket.on('message:react', (d) => { const m = msgs.find(x => x.id === d.id); if (m) { m.reactions = d.reactions; renderMsgs(); } });
  socket.on('read', ({ chatId, userId, messageId }) => { if (cur?.id === chatId) { const mem = cur.members.find(x => x.id === userId); if (mem) mem.last_read = Math.max(mem.last_read, messageId); renderSeen(); } });
  socket.on('typing', ({ chatId, userId, name, typing }) => { if (cur?.id !== chatId) return; if (typing) typers[userId] = name; else delete typers[userId]; renderTyping(); });
  socket.on('call:incoming', showIncoming);
  socket.on('call:declined', ({ by }) => toast(`${by} declined the call`));
  socket.on('call:state', ({ chatId, count }) => { const c = chats.find(x => x.id === chatId); if (c) { c.inCall = count; renderChats(); } if (cur?.id === chatId) refreshHeader(); });
}
function notify(c, m) {
  if (document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(c.kind === 'dm' ? m.user_name : `${m.user_name} · ${c.name}`, { body: m.text, tag: 'chat-' + c.id }); } catch {}
}

// ---------- lists ----------
let nav = 'chats', filter = 'all';
function setNav(n) {
  nav = n; document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === n));
  if (n === 'recordings') return openRecordings();
  if (document.body.classList.contains('inchat') && !cur) closeChat();
  $('sideTitle').textContent = { chats: 'Chat', teams: 'Teams', people: 'People' }[n];
  $('chatList').classList.toggle('hidden', n === 'people'); $('peopleList').classList.toggle('hidden', n !== 'people'); $('chips').classList.toggle('hidden', n !== 'chats');
  $('sideSearch').placeholder = n === 'people' ? 'Search people…' : 'Search conversations…';
  if (n === 'people') renderPeople(); else renderChats();
  if (window.innerWidth < 800) { document.body.classList.remove('inchat'); }
}
function setFilter(f, btn) { filter = f; document.querySelectorAll('#chips button').forEach(b => b.classList.toggle('on', b === btn)); renderChats(); }
function updateUnread() { const n = chats.reduce((a, c) => a + (c.unread || 0), 0); ['railUnread', 'navUnread', 'chipUnread'].forEach(id => { const e = $(id); if (!e) return; e.textContent = n; e.classList.toggle('hidden', !n); }); }
async function loadChats() { chats = await api('/api/chats'); renderChats(); }
async function loadPeople() { people = await api('/api/users'); renderPeople(); }
function renderChats() {
  updateUnread();
  const q = ($('sideSearch')?.value || '').trim().toLowerCase();
  let list = chats;
  if (nav === 'teams') list = list.filter(c => c.kind === 'team');
  if (filter === 'unread') list = list.filter(c => c.unread > 0);
  if (filter === 'groups') list = list.filter(c => c.kind === 'team');
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || (c.last?.text || '').toLowerCase().includes(q));
  $('chatList').innerHTML = list.length ? list.map(c => `
    <div class="row${cur?.id === c.id ? ' on' : ''}" onclick="openChat(${c.id})">
      ${avatarHtml(c.name, c.color, { sq: c.kind === 'team', online: c.kind === 'dm' ? c.online : undefined })}
      <div class="grow"><div class="name">${esc(c.name)}${c.inCall ? ' <span class="badge" style="background:var(--ok)">● ' + c.inCall + ' in call</span>' : ''}</div>
        <div class="sub">${c.last ? (c.last.deleted ? '<i>message deleted</i>' : esc((c.last.user_id === me.id ? 'You: ' : '') + c.last.text)) : (c.kind === 'team' ? c.members.length + ' members' : 'Say hi')}</div></div>
      <div class="meta">${c.last ? fmtTime(c.last.ts) : ''}${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</div>
    </div>`).join('') : `<div class="empty">${chats.length ? 'Nothing matches.' : (nav === 'teams' ? 'No teams yet.<br>Tap the pencil to create one.' : 'No chats yet.<br>Tap the pencil to start one.')}</div>`;
}
function renderPeople() {
  const q = ($('sideSearch')?.value || '').trim().toLowerCase();
  const list = q ? people.filter(p => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : people;
  $('peopleList').innerHTML = list.length ? list.map(p => `
    <div class="row" onclick="openDm(${p.id})">${avatarHtml(p.name, p.color, { online: p.online })}
      <div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">${p.online ? '<span style="color:var(--ok)">● Available</span>' : 'Offline'} · ${esc(p.email)}</div></div></div>`).join('')
    : '<div class="empty">Nobody else has signed up yet.<br>Share your link!</div>';
}
async function openDm(userId) { const c = await api('/api/chats/dm', { method: 'POST', body: { userId } }); await loadChats(); openChat(c.id); }

// ---------- chat view ----------
async function openChat(id) {
  cur = chats.find(c => c.id === id); if (!cur) return;
  document.body.classList.add('inchat'); $('mainEmpty').classList.add('hidden'); $('recView').classList.add('hidden'); $('chatView').classList.remove('hidden');
  socket.emit('join', id); typers = {}; renderTyping(); cancelEdit(); if (window.innerWidth < 800) togglePanel(false);
  refreshHeader(); renderChats();
  msgs = await api(`/api/chats/${id}/messages`); renderMsgs(true); markRead();
}
function togglePanel(force) {
  const on = force === undefined ? !$('panel').classList.contains('on') : force;
  $('panel').classList.toggle('on', on); if (on) renderPanel();
}
function renderPanel() {
  if (!cur) return; const c = cur;
  $('pAvatar').outerHTML = avatarHtml(c.name, c.color, { sq: c.kind === 'team', online: c.kind === 'dm' ? c.online : undefined }).replace('class="avatar', 'id="pAvatar" class="avatar').replace('width:38px', '');
  $('pAvatar').style.width = $('pAvatar').style.height = '56px'; $('pAvatar').style.fontSize = '20px';
  $('pName').textContent = c.name;
  const other = c.kind === 'dm' ? c.members.find(m => m.id !== me.id) : null;
  $('pSub').textContent = c.kind === 'dm' ? `${other?.email || ''} · ${c.online ? 'Available' : 'Offline'}` : `${c.members.length} members`;
  $('pAddBtn').classList.toggle('hidden', c.kind !== 'team');
  $('pMembersTitle').textContent = c.kind === 'team' ? `Members (${c.members.length})` : 'About';
  $('pMembers').innerHTML = c.members.map(m => `<div class="mrow">${avatarHtml(m.name, m.color, { online: m.id === me.id ? true : (people.find(p => p.id === m.id)?.online) })}<div class="grow"><div style="font-weight:600">${esc(m.name)}${m.id === me.id ? ' (you)' : ''}</div><div class="muted small">${esc(m.email)}</div></div></div>`).join('');
}
function closeChat() { togglePanel(false); document.body.classList.remove('inchat'); cur = null; $('chatView').classList.add('hidden'); $('recView').classList.add('hidden'); $('mainEmpty').classList.remove('hidden'); if (nav === 'recordings') { nav = 'chats'; document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === 'chats')); } renderChats(); }
function refreshHeader() {
  const c = chats.find(x => x.id === cur.id) || cur; cur = c;
  $('chatAvatar').outerHTML = avatarHtml(c.name, c.color, { sq: c.kind === 'team', online: c.kind === 'dm' ? c.online : undefined }).replace('class="avatar', 'id="chatAvatar" class="avatar');
  $('chatTitle').textContent = c.name;
  $('chatSub').textContent = c.kind === 'dm' ? (c.online ? 'Available' : 'Offline') : c.members.map(m => m.name).join(', ');
  $('addMemberBtn').classList.toggle('hidden', c.kind !== 'team');
  if (c.inCall) $('chatSub').textContent = `● ${c.inCall} in call · ` + $('chatSub').textContent;
  if ($('panel').classList.contains('on')) renderPanel();
}
function renderMsgs(scrollHard) {
  const el = $('msgs'); const atBottom = scrollHard || el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
  let lastDay = '', html = '';
  for (const m of msgs) {
    const day = fmtDay(m.ts); if (day !== lastDay) { html += `<div class="day">${day}</div>`; lastDay = day; }
    const mine = m.user_id === me.id;
    const rx = {}; for (const r of m.reactions || []) (rx[r.emoji] ||= []).push(r.user_id);
    html += `<div class="m${mine ? ' me' : ''}" id="m${m.id}">
      ${mine ? '' : `<div class="avatar" style="background:${m.user_color};width:28px;height:28px;font-size:11px;align-self:flex-end">${esc(initials(m.user_name))}</div>`}
      <div class="b">${!mine && cur.kind === 'team' ? `<div class="f">${esc(m.user_name)}</div>` : ''}
        <div class="t${m.deleted ? ' del' : ''}">${m.deleted ? 'Message deleted' : esc(m.text)}</div>
        ${Object.keys(rx).length ? `<div class="rx">${Object.entries(rx).map(([e, u]) => `<button class="${u.includes(me.id) ? 'mine' : ''}" onclick="react(${m.id},'${e}')" title="${esc(u.map(id => id === me.id ? 'You' : (cur.members.find(x => x.id === id)?.name || '?')).join(', '))}">${e} ${u.length}</button>`).join('')}</div>` : ''}
        <div class="ts">${m.edited ? '<span class="ed">edited</span>' : ''}${fmtTime(m.ts)}</div></div>
      ${m.deleted ? '' : `<div class="act">${['👍', '❤️', '😂', '🎉'].map(e => `<button onclick="react(${m.id},'${e}')">${e}</button>`).join('')}${mine ? `<button onclick="startEdit(${m.id})" title="Edit">✏️</button><button onclick="delMsg(${m.id})" title="Delete">🗑</button>` : ''}</div>`}
    </div>`;
  }
  el.innerHTML = html || '<div class="empty">No messages yet. Say hello 👋</div>';
  renderSeen();
  if (atBottom) el.scrollTop = el.scrollHeight;
  // long-press / tap to open actions on touch
  el.querySelectorAll('.m .b').forEach(b => b.onclick = (e) => { if (e.target.tagName === 'BUTTON') return; const m = b.closest('.m'); const was = m.classList.contains('open'); el.querySelectorAll('.m.open').forEach(x => x.classList.remove('open')); if (!was) m.classList.add('open'); });
}
function renderSeen() {
  document.querySelectorAll('.seen').forEach(e => e.remove());
  const lastMine = [...msgs].reverse().find(m => m.user_id === me.id); if (!lastMine || !cur) return;
  const seenBy = cur.members.filter(m => m.id !== me.id && m.last_read >= lastMine.id).map(m => m.name);
  if (!seenBy.length) return;
  const d = document.createElement('div'); d.className = 'seen'; d.textContent = cur.kind === 'dm' ? 'Seen' : 'Seen by ' + seenBy.join(', ');
  $('m' + lastMine.id)?.after(d);
}
function markRead() { const last = msgs[msgs.length - 1]; if (!last) return; api(`/api/chats/${cur.id}/read`, { method: 'POST', body: { messageId: last.id } }).catch(() => {}); const c = chats.find(x => x.id === cur.id); if (c && c.unread) { c.unread = 0; renderChats(); } }
function renderTyping() { const n = Object.values(typers); $('typing').textContent = n.length ? `${n.join(', ')} ${n.length > 1 ? 'are' : 'is'} typing…` : ''; }

// composer
const input = $('msgIn');
input.addEventListener('input', () => {
  input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  if (!cur) return; socket.emit('typing', { chatId: cur.id, typing: true });
  clearTimeout(typingTimer); typingTimer = setTimeout(() => socket.emit('typing', { chatId: cur.id, typing: false }), 1500);
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') cancelEdit(); });
async function send() {
  const text = input.value.trim(); if (!text || !cur) return;
  input.value = ''; input.style.height = 'auto'; socket.emit('typing', { chatId: cur.id, typing: false });
  try {
    if (editing) { const id = editing; cancelEdit(); await api(`/api/messages/${id}`, { method: 'PATCH', body: { text } }); }
    else await api(`/api/chats/${cur.id}/messages`, { method: 'POST', body: { text } });
  } catch (e) { toast(e.message); }
}
function startEdit(id) { const m = msgs.find(x => x.id === id); if (!m) return; editing = id; input.value = m.text; $('editbar').classList.add('on'); input.focus(); }
function cancelEdit() { if (editing) { input.value = ''; input.style.height = 'auto'; } editing = null; $('editbar').classList.remove('on'); }
async function delMsg(id) { if (confirm('Delete this message?')) await api(`/api/messages/${id}`, { method: 'DELETE' }).catch(e => toast(e.message)); }
async function react(id, emoji) { await api(`/api/messages/${id}/react`, { method: 'POST', body: { emoji } }).catch(e => toast(e.message)); }

// ---------- new chat / members ----------
function pickList(el, list) { el.innerHTML = list.length ? list.map(p => `<label><input type="checkbox" value="${p.id}">${avatarHtml(p.name, p.color, { online: p.online })}<span>${esc(p.name)}</span></label>`).join('') : '<div class="muted" style="padding:10px">Nobody else has signed up yet.</div>'; }
function openNew() { $('newTeamName').value = ''; pickList($('newPick'), people); $('newDlg').classList.add('on'); }
function closeDlg(id) { $(id).classList.remove('on'); }
async function createNew() {
  const ids = [...$('newPick').querySelectorAll('input:checked')].map(i => +i.value); const name = $('newTeamName').value.trim();
  try {
    let c;
    if (name) c = await api('/api/chats/team', { method: 'POST', body: { name, memberIds: ids } });
    else if (ids.length === 1) c = await api('/api/chats/dm', { method: 'POST', body: { userId: ids[0] } });
    else return toast('Enter a team name, or pick exactly one person for a direct chat');
    closeDlg('newDlg'); await loadChats(); openChat(c.id);
  } catch (e) { toast(e.message); }
}
function openAddMember() { pickList($('memberPick'), people.filter(p => !cur.members.some(m => m.id === p.id))); $('memberDlg').classList.add('on'); }
async function addMembers() {
  for (const i of $('memberPick').querySelectorAll('input:checked')) await api(`/api/chats/${cur.id}/members`, { method: 'POST', body: { userId: +i.value } }).catch(e => toast(e.message));
  closeDlg('memberDlg'); await loadChats(); refreshHeader();
}

// ---------- calls ----------
const LK = window.LivekitClient;
let room = null, callChat = null, recording = false, handUp = false, facing = 'user', ring = null, incomingCall = null;
async function startCall(chatId, ringOthers) {
  if (room) return toast('Already in a call');
  callChat = chats.find(c => c.id === chatId); if (!callChat) return;
  $('callTitle').textContent = callChat.name; $('grid').innerHTML = ''; $('grid').classList.remove('stage'); layout = 'auto'; $('call').classList.add('on'); setRec(false); handUp = false; $('handBtn').classList.remove('on');
  if (ringOthers) socket.emit('call:ring', { chatId });
  try {
    const { token: t, url } = await api(`/api/chats/${chatId}/call-token`);
    room = new LK.Room({ adaptiveStream: true, dynacast: true });
    room.on(LK.RoomEvent.TrackSubscribed, (track, pub, p) => attach(track, p, pub.source))
        .on(LK.RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach(e => e.closest('.tile')?.remove()); applyLayout(); })
        .on(LK.RoomEvent.LocalTrackPublished, (pub) => pub.track?.kind === 'video' && attach(pub.track, room.localParticipant, pub.source))
        .on(LK.RoomEvent.LocalTrackUnpublished, (pub) => { pub.track?.detach().forEach(e => e.closest('.tile')?.remove()); applyLayout(); })
        .on(LK.RoomEvent.ParticipantConnected, updateCount).on(LK.RoomEvent.ParticipantDisconnected, (p) => { updateCount(); document.querySelectorAll(`[data-p="${p.identity}"]`).forEach(e => e.remove()); })
        .on(LK.RoomEvent.DataReceived, (payload, p) => { try { onData(JSON.parse(new TextDecoder().decode(payload)), p); } catch {} })
        .on(LK.RoomEvent.Disconnected, () => endCall());
    await room.connect(url, t);
    await room.localParticipant.enableCameraAndMicrophone().catch(e => toast('Camera/mic: ' + e.message));
    updateCount(); socket.emit('call:joined', { chatId });
  } catch (e) { toast('Could not join: ' + e.message); endCall(); }
}
function attach(track, p, source) {
  if (track.kind === 'audio') { const a = track.attach(); a.dataset.p = p.identity; document.body.appendChild(a); return; }
  const share = source === LK.Track.Source.ScreenShare;
  const tile = document.createElement('div'); tile.className = 'tile' + (p.isLocal ? ' local' : '') + (share ? ' share' : ' cam') + (share && p.isLocal ? ' selfshare' : ''); tile.dataset.p = p.identity;
  const v = track.attach(); v.setAttribute('playsinline', ''); tile.appendChild(v);
  tile.insertAdjacentHTML('beforeend', `<div class="lbl">${share && p.isLocal ? 'You are sharing your screen' : esc(p.name || p.identity) + (p.isLocal ? ' (you)' : '') + (share ? ' — screen' : '')}</div><div class="hand hidden">✋</div>`);
  if (share) $('grid').prepend(tile); else $('grid').appendChild(tile);
  if (share && !p.isLocal && layout === 'auto') applyLayout('stage'); else applyLayout();
}
let layout = 'auto'; // 'auto' = stage when someone shares, grid otherwise; user can force 'grid' or 'stage'
function applyLayout(force) {
  const g = $('grid'); const hasShare = !!g.querySelector('.tile.share:not(.selfshare)');
  const mode = force || (layout === 'auto' ? (hasShare ? 'stage' : 'grid') : layout);
  let strip = g.querySelector('.strip');
  if (mode === 'stage' && hasShare) {
    if (!strip) { strip = document.createElement('div'); strip.className = 'strip'; g.appendChild(strip); }
    g.querySelectorAll(':scope > .tile.cam').forEach(t => strip.appendChild(t));
    g.classList.add('stage');
  } else {
    if (strip) { [...strip.children].forEach(t => g.appendChild(t)); strip.remove(); }
    g.classList.remove('stage');
  }
  $('layoutBtn').firstChild.textContent = g.classList.contains('stage') ? '▣' : '▦';
}
function toggleLayout() { layout = $('grid').classList.contains('stage') ? 'grid' : 'stage'; applyLayout(); toast(layout === 'stage' ? 'Focus on shared content' : 'Grid view'); }
function updateCount() { if (room) $('callCount').textContent = `${room.numParticipants} in call`; }
function onData(d, p) {
  if (d.type === 'recording') setRec(d.state === 'started', d.by, true);
  if (d.type === 'hand') document.querySelectorAll(`.tile.cam[data-p="${p.identity}"] .hand`).forEach(h => h.classList.toggle('hidden', !d.up));
}
const sendData = (obj) => room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), { reliable: true });
async function toggleMic() { const on = !room.localParticipant.isMicrophoneEnabled; await room.localParticipant.setMicrophoneEnabled(on); $('micBtn').classList.toggle('on', on); $('micBtn').firstChild.textContent = on ? '🎤' : '🔇'; }
async function toggleCam() { const on = !room.localParticipant.isCameraEnabled; await room.localParticipant.setCameraEnabled(on); $('camBtn').classList.toggle('on', on); $('camBtn').firstChild.textContent = on ? '📷' : '🚫'; }
async function flip() { const pub = room.localParticipant.getTrackPublication(LK.Track.Source.Camera); if (!pub?.track) return; facing = facing === 'user' ? 'environment' : 'user'; await pub.track.restartTrack({ facingMode: facing }); document.querySelector('.tile.local.cam')?.classList.toggle('local', facing === 'user'); }
async function toggleShare() { try { const on = !room.localParticipant.isScreenShareEnabled; await room.localParticipant.setScreenShareEnabled(on, { audio: true }); $('shareBtn').classList.toggle('on', room.localParticipant.isScreenShareEnabled); } catch (e) { if (e.name !== 'NotAllowedError') toast('Share: ' + e.message); } }
async function toggleHand() { handUp = !handUp; $('handBtn').classList.toggle('on', handUp); document.querySelector('.tile.local.cam .hand')?.classList.toggle('hidden', !handUp); await sendData({ type: 'hand', up: handUp }); }
async function hangup() { if (recording) await browserRec.stop().catch(() => {}); await room?.disconnect(); endCall(); }
function endCall() { if (callChat) socket.emit('call:left', { chatId: callChat.id }); room = null; callChat = null; $('call').classList.remove('on'); document.querySelectorAll('audio[data-p]').forEach(a => a.remove()); }

// incoming
function showIncoming(d) {
  if (room || incomingCall) return; incomingCall = d;
  $('incAvatar').outerHTML = avatarHtml(d.kind === 'dm' ? d.from : d.name, undefined, { sq: d.kind === 'team' }).replace('class="avatar', 'id="incAvatar" class="avatar');
  $('incTitle').textContent = d.kind === 'dm' ? d.from : d.name; $('incSub').textContent = d.kind === 'dm' ? 'Incoming video call…' : `${d.from} started a call`;
  $('incoming').classList.add('on'); startRing(); notifyCall(d);
  setTimeout(() => { if (incomingCall === d) dismissIncoming(); }, 45000);
}
function notifyCall(d) { if (!document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') try { new Notification('Incoming call', { body: d.kind === 'dm' ? d.from : `${d.from} · ${d.name}`, tag: 'call' }); } catch {} }
function dismissIncoming() { incomingCall = null; $('incoming').classList.remove('on'); stopRing(); }
async function acceptCall() { const d = incomingCall; dismissIncoming(); if (!chats.find(c => c.id === d.chatId)) await loadChats(); startCall(d.chatId, false); }
function declineCall() { socket.emit('call:decline', { chatId: incomingCall.chatId, toId: incomingCall.fromId }); dismissIncoming(); }
function startRing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(); const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 660; o.connect(g); o.start();
    const beat = () => { const t = ctx.currentTime; g.gain.setValueAtTime(0.25, t); g.gain.setValueAtTime(0, t + 0.4); g.gain.setValueAtTime(0.25, t + 0.6); g.gain.setValueAtTime(0, t + 1.0); };
    beat(); ring = { ctx, iv: setInterval(beat, 2500) }; if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
  } catch {}
}
function stopRing() { if (!ring) return; clearInterval(ring.iv); ring.ctx.close(); ring = null; }

// recording (in-browser: canvas grid + mixed audio → upload)
function setRec(on, by, remote) {
  recording = on; $('recTag').classList.toggle('hidden', !on); $('recBtn').firstChild.textContent = on ? '⏹' : '⏺'; $('recBtn').classList.toggle('d', on);
  if (by !== undefined) { const b = $('banner'); b.textContent = on ? `Recording started by ${by}. Everyone is being recorded.` : 'Recording stopped.'; b.style.display = 'block'; setTimeout(() => b.style.display = 'none', 5000); }
  if (remote) $('recBtn').disabled = on; // only the recorder can stop it
}
let recOpts = { cams: true, share: true, audio: true };
async function toggleRec() { if (recording) { try { await browserRec.stop(); } catch (e) { toast('Recording: ' + e.message); } } else $('recDlg').classList.add('on'); }
async function confirmRec() {
  recOpts = { cams: $('recCams').checked, share: $('recShare').checked, audio: $('recAudio').checked }; closeDlg('recDlg');
  if (!recOpts.cams && !recOpts.share) return toast('Pick cameras and/or shared screen to record');
  try { await browserRec.start(); } catch (e) { toast('Recording: ' + e.message); }
}
const browserRec = (() => {
  let rec, canvas, ctx, raf, audioCtx, chunks, startedAt, mime; const W = 1280, H = 720;
  function draw() {
    const all = [...document.querySelectorAll('#grid video')].filter(v => v.readyState >= 2);
    const share = recOpts.share ? all.find(v => v.closest('.tile.share')) : null; const cams = recOpts.cams ? all.filter(v => !v.closest('.tile.share')) : [];
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const fit = (v, x, y, bw, bh) => { const ar = v.videoWidth / v.videoHeight || 4 / 3; let w = bw, h = bw / ar; if (h > bh) { h = bh; w = bh * ar; } ctx.drawImage(v, x + (bw - w) / 2, y + (bh - h) / 2, w, h); return [x + (bw - w) / 2, y + (bh - h) / 2, w, h]; };
    const label = (v, x, y, w, h) => { const lbl = v.closest('.tile')?.querySelector('.lbl')?.textContent || ''; ctx.font = '14px sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x + 8, y + h - 30, ctx.measureText(lbl).width + 16, 22); ctx.fillStyle = '#fff'; ctx.fillText(lbl, x + 16, y + h - 14); };
    if (share) {
      const sideW = cams.length ? 280 : 0; label(share, ...fit(share, 0, 0, W - sideW, H));
      const ch = Math.min(210, H / Math.max(cams.length, 1));
      cams.forEach((v, i) => label(v, ...fit(v, W - sideW, i * ch, sideW, ch)));
    } else {
      const n = cams.length || 1, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), cw = W / cols, chh = H / rows;
      cams.forEach((v, i) => label(v, ...fit(v, (i % cols) * cw, Math.floor(i / cols) * chh, cw, chh)));
    }
    raf = requestAnimationFrame(draw);
  }
  function mixAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)(); const dest = audioCtx.createMediaStreamDestination();
    const add = (t) => { try { audioCtx.createMediaStreamSource(new MediaStream([t.mediaStreamTrack])).connect(dest); } catch {} };
    room.remoteParticipants.forEach(p => p.audioTrackPublications.forEach(pub => pub.track && add(pub.track)));
    room.localParticipant.audioTrackPublications.forEach(pub => pub.track && add(pub.track));
    return dest.stream.getAudioTracks();
  }
  async function start() {
    canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; ctx = canvas.getContext('2d'); draw();
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...(recOpts.audio ? mixAudio() : [])]);
    mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => window.MediaRecorder?.isTypeSupported(m));
    if (!mime) throw new Error('This browser cannot record. Use Chrome/Edge on a laptop.');
    chunks = []; startedAt = Date.now(); rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data); rec.start(1000);
    await sendData({ type: 'recording', state: 'started', by: me.name }); setRec(true, me.name);
  }
  async function stop() {
    await new Promise(r => { rec.onstop = r; rec.stop(); }); cancelAnimationFrame(raf); audioCtx?.close();
    await sendData({ type: 'recording', state: 'stopped' }); setRec(false);
    const blob = new Blob(chunks, { type: mime }), ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    toast(`Uploading recording (${(blob.size / 1e6).toFixed(1)} MB)…`);
    const r = await fetch(`/api/chats/${callChat.id}/recordings?ext=${ext}&startedAt=${startedAt}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream', 'ngrok-skip-browser-warning': '1' }, body: blob });
    toast(r.ok ? 'Recording saved. See 🎞 Recordings.' : 'Upload failed.');
  }
  return { start, stop };
})();

// ---------- recordings ----------
async function openRecordings() {
  document.body.classList.add('inchat'); $('mainEmpty').classList.add('hidden'); $('chatView').classList.add('hidden'); $('recView').classList.remove('hidden'); togglePanel(false); cur = null; renderChats();
  const recs = await api('/api/recordings');
  $('recList').innerHTML = recs.length ? recs.map(r => `
    <div class="row" onclick="play('${r.url}?token=${token}')"><div class="avatar sq" style="background:var(--navy)"><svg class="i"><use href="#i-rec"/></svg></div>
      <div class="grow"><div class="name">${esc(r.chat_name)}</div><div class="sub">${new Date(r.started).toLocaleString()} · by ${esc(r.user_name)} · ${Math.max(1, Math.round((r.ended - r.started) / 60000))} min</div></div><div class="meta">▶</div></div>`).join('')
    : '<div class="empty">No recordings yet. Start one from a call with ⏺.</div>';
}
function play(url) { $('pv').src = url; $('player').classList.add('on'); }
function closePlayer() { $('pv').pause(); $('pv').src = ''; $('player').classList.remove('on'); }

// ---------- start ----------
if (token && me) boot();
setTimeout(() => { $('splash').classList.add('off'); setTimeout(() => $('splash').remove(), 400); }, 900);
document.addEventListener('click', (e) => { if (!e.target.closest('.m')) document.querySelectorAll('.m.open').forEach(x => x.classList.remove('open')); });
