// Teams-clone backend v2: SQLite persistence, email/password auth, Socket.IO realtime, LiveKit tokens, recordings.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const QR = require('qrcode');
const { Server } = require('socket.io');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const D = require('./db');

const {
  LIVEKIT_URL = 'ws://localhost:7880', LIVEKIT_API_KEY = 'devkey', LIVEKIT_API_SECRET = 'secretsecretsecretsecret',
  RECORDINGS_DIR = path.join(__dirname, 'recordings'), PORT = 4000,
} = process.env;
const JWT_SECRET = process.env.JWT_SECRET || (fs.existsSync(path.join(__dirname, '.jwt')) ? fs.readFileSync(path.join(__dirname, '.jwt'), 'utf8')
  : (() => { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(path.join(__dirname, '.jwt'), s); return s; })());
const CLOUD = /^wss:\/\//.test(LIVEKIT_URL);
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
app.set('trust proxy', true);
app.use(cors());
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'geolocation=()'); next(); });
// simple rate limit for auth endpoints: 20 attempts / 10 min per IP
const hits = new Map();
const limit = (req, res, next) => { const k = req.ip + req.path, t = now(), h = (hits.get(k) || []).filter(x => t - x < 600000); h.push(t); hits.set(k, h); return h.length > 20 ? bad(res, 429, 'too many attempts — try again later') : next(); };

// Local-LiveKit mode: proxy signalling through this server so one URL works through a tunnel.
const lkProxy = createProxyMiddleware({ pathFilter: '/rtc', target: LIVEKIT_URL.replace(/^ws/, 'http'), ws: true, changeOrigin: true });
if (!CLOUD) { app.use(lkProxy); server.on('upgrade', (req, s, h) => { if (req.url.startsWith('/rtc')) lkProxy.upgrade(req, s, h); }); }

app.use(express.json({ limit: '1mb' }));
// <video src> can't send headers → accept ?token= as well as the Authorization header
app.use((req, _res, next) => { if (req.query.token && !req.headers.authorization) req.headers.authorization = 'Bearer ' + req.query.token; next(); });
app.use(express.static(path.join(__dirname, 'web')));
const roomSvc = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

// ---------- helpers ----------
const now = () => Date.now();
const COLORS = ['#6264a7', '#c4314b', '#92c353', '#e8912d', '#0d9488', '#7c3aed', '#db2777', '#2563eb'];
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sign = (u, sid) => jwt.sign({ id: u.id, sid }, JWT_SECRET, { expiresIn: '30d' });
const newSession = (u, req) => { const sid = crypto.randomBytes(16).toString('hex'); D.insertSession.run(sid, u.id, now(), now(), String(req.headers['user-agent'] || '').slice(0, 200), req.ip); return sid; };
const deviceName = (ua = '') => { const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device'; const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser'; return `${br} on ${os}`; };
const setting = (k, dflt) => D.getSetting.get(k)?.value ?? dflt;
// TOTP (RFC 6238) — compatible with Google/Microsoft Authenticator
const b32 = { enc: (buf) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5), 2)]; return out; },
  dec: (str) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of str.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); } };
const totpCode = (secret, step = 0) => { const t = Buffer.alloc(8); t.writeBigInt64BE(BigInt(Math.floor(now() / 30000) + step)); const h = crypto.createHmac('sha1', b32.dec(secret)).update(t).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); };
const totpOk = (secret, code) => [-1, 0, 1].some(st => totpCode(secret, st) === String(code || '').trim());
async function sendMail(to, subject, text) { if (!mailer) { console.log(`\n>>> [mail to ${to}] ${subject}\n${text}\n`); return false; } try { await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text }); return true; } catch (e) { console.error('mail failed:', e.message); return false; } }
const pub = (u) => ({ id: u.id, email: u.email, name: u.name, color: u.color, bio: u.bio || '', phone: u.phone || '', title: u.title || '', avatar: u.avatar || null, role: u.role || 'member', totp: !!u.totp });
const FILES_DIR = path.join(__dirname, 'files'); fs.mkdirSync(FILES_DIR, { recursive: true });
const safeName = (n) => String(n || 'file').replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
const extOf = (name, mime) => (path.extname(name || '').slice(1) || (mime || '').split('/')[1] || 'bin').replace(/[^\w]/g, '').slice(0, 8);
const bad = (res, code, error) => res.status(code).json({ error });
const verifyToken = (t) => { const p = jwt.verify(t, JWT_SECRET); const u = D.userById.get(p.id); if (!u || u.status !== 'active') return null; if (p.sid) { const sess = D.session.get(p.sid); if (!sess || sess.revoked) return null; D.touchSession.run(now(), p.sid, now() - 60000); u.sid = p.sid; } return u; };
const auth = (req, res, next) => { try { req.user = verifyToken((req.headers.authorization || '').replace('Bearer ', '')); if (!req.user) throw 0; next(); } catch { bad(res, 401, 'unauthorised'); } };
const admin = (req, res, next) => (req.user.role === 'admin' ? next() : bad(res, 403, 'admin only'));
const notBlocked = (req, res, next) => { const c = D.chatById.get(+req.params.id); if (c?.kind === 'dm') { const o = D.memberIds.all(c.id).map(m => m.user_id).find(id => id !== req.user.id); if (o && D.isBlocked.get(req.user.id, o, o, req.user.id)) return bad(res, 403, 'you cannot message this person'); } next(); };
const member = (req, res, next) => (D.isMember.get(+req.params.id, req.user.id) ? next() : bad(res, 403, 'not a member'));
const roomName = (chatId) => `chat-${chatId}`;
const emitChat = (chatId, ev, data) => io.to(roomName(chatId)).emit(ev, data);
const emitUser = (userId, ev, data) => io.to(`user-${userId}`).emit(ev, data);
const parseMsg = (m) => ({ ...m, reactions: JSON.parse(m.reactions || '[]') });

// ---------- auth ----------
// ---- email verification (6-digit code). Sends via SMTP if SMTP_USER/SMTP_PASS are set, else prints the code in this window.
const nodemailer = require('nodemailer');
const mailer = process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: +(process.env.SMTP_PORT || 465), secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
  : null;
const pendingCodes = new Map(); // email -> { code, exp, tries }
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
app.post('/auth/send-code', limit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const purpose = req.body?.purpose === 'reset' ? 'reset' : 'register';
  if (!EMAIL_RE.test(email)) return bad(res, 400, 'enter a valid email address');
  const exists = !!D.userByEmail.get(email);
  if (purpose === 'register' && exists) return bad(res, 409, 'email already registered — sign in instead');
  if (purpose === 'reset' && !exists) return bad(res, 404, 'no account with that email');
  const code = String(crypto.randomInt(100000, 999999));
  pendingCodes.set(purpose + ':' + email, { code, exp: now() + 10 * 60 * 1000, tries: 0 });
  if (mailer) {
    try { await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email, subject: `${process.env.APP_NAME || 'Akashwani'} verification code: ${code}`, text: `Your verification code is ${code}. It expires in 10 minutes.` }); }
    catch (e) { console.error('mail failed:', e.message); return bad(res, 500, 'could not send email: ' + e.message); }
    res.json({ ok: true, sent: true });
  } else {
    console.log(`\n>>> Verification code for ${email}: ${code}\n`);
    res.json({ ok: true, sent: false }); // no SMTP configured: code is in the backend window
  }
});

function checkCode(purpose, email, code) {
  const key = purpose + ':' + email, pc = pendingCodes.get(key);
  if (!pc || pc.exp < now()) return 'request a verification code first';
  if (++pc.tries > 5) { pendingCodes.delete(key); return 'too many attempts — request a new code'; }
  if (String(code || '').trim() !== pc.code) return 'wrong verification code';
  pendingCodes.delete(key); return null;
}

app.post('/auth/reset', limit, (req, res) => {
  const { email: rawEmail, password, code } = req.body || {};
  const email = String(rawEmail || '').trim().toLowerCase();
  const u = D.userByEmail.get(email); if (!u) return bad(res, 404, 'no account with that email');
  if (!password || password.length < 6) return bad(res, 400, 'new password must be 6+ characters');
  const err = checkCode('reset', email, code); if (err) return bad(res, 400, err);
  const salt = crypto.randomBytes(16).toString('hex');
  D.updatePassword.run(hash(password, salt), salt, u.id);
  D.revokeAll.run(u.id, ''); // password changed → sign out every device
  const fresh = D.userById.get(u.id);
  res.json({ token: sign(fresh, newSession(fresh, req)), user: pub(fresh) });
});

app.post('/auth/register', limit, (req, res) => {
  const { email: rawEmail, name, password, code } = req.body || {};
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return bad(res, 400, 'enter a valid email address');
  if (!name || !password || password.length < 6) return bad(res, 400, 'name and a 6+ char password required');
  if (D.userByEmail.get(email)) return bad(res, 409, 'email already registered');
  const err = checkCode('register', email, code); if (err) return bad(res, 400, err);
  const salt = crypto.randomBytes(16).toString('hex');
  const r = D.insertUser.run(email, name.trim(), hash(password, salt), salt, COLORS[Math.floor(Math.random() * COLORS.length)], now());
  const first = D.userCount.get().n === 1;
  if (first) D.setRole.run('admin', r.lastInsertRowid);
  if (!first && setting('signup', 'open') === 'approval') {
    D.setStatus.run('pending', r.lastInsertRowid);
    for (const a of D.adminUsers.all().filter(x => x.role === 'admin')) { emitUser(a.id, 'admin:pending'); sendMail(a.email, `${process.env.APP_NAME || 'Akashwani'}: new sign-up awaiting approval`, `${name} (${email}) has signed up and is waiting for your approval. Open Admin in the app to approve.`); }
    return res.json({ pending: true });
  }
  const u = D.userById.get(r.lastInsertRowid);
  io.emit('users:changed');
  res.json({ token: sign(u, newSession(u, req)), user: pub(u) });
});
const pendingLogins = new Map(); // tmp token -> { uid, exp } for 2FA step
app.post('/auth/login', limit, async (req, res) => {
  const { email, password } = req.body || {};
  const u = D.userByEmail.get((email || '').toLowerCase());
  if (!u || hash(password || '', u.salt) !== u.pass_hash) return bad(res, 401, 'wrong email or password');
  if (u.status === 'pending') return bad(res, 403, 'your account is waiting for admin approval');
  if (u.status === 'disabled') return bad(res, 403, 'this account has been disabled');
  if (u.totp) { const t = crypto.randomBytes(16).toString('hex'); pendingLogins.set(t, { uid: u.id, exp: now() + 5 * 60 * 1000 }); return res.json({ need2fa: true, tmp: t }); }
  finishLogin(u, req, res);
});
app.post('/auth/2fa', limit, (req, res) => {
  const p = pendingLogins.get(req.body?.tmp); if (!p || p.exp < now()) return bad(res, 400, 'login expired — try again');
  const u = D.userById.get(p.uid); const full = D.userByEmail.get(u.email);
  if (!totpOk(full.totp, req.body?.code)) return bad(res, 401, 'wrong authenticator code');
  pendingLogins.delete(req.body.tmp); finishLogin(u, req, res);
});
function finishLogin(u, req, res) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 200);
  const known = D.knownDevice.get(u.id, ua);
  const sid = newSession(u, req);
  if (!known) sendMail(u.email, `${process.env.APP_NAME || 'Akashwani'}: new sign-in`, `Your account was just signed in from a new device: ${deviceName(ua)} (IP ${req.ip}) at ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}.\nIf this wasn't you, open your profile → Devices → "Sign out everywhere" and change your password.`);
  res.json({ token: sign(u, sid), user: pub(u) });
}

app.get('/config', (_req, res) => res.json({ recording: 'browser', cloud: CLOUD }));
app.use('/api', auth);
app.get('/api/me', (req, res) => res.json(pub(req.user)));
app.get('/api/me/sessions', (req, res) => res.json(D.mySessions.all(req.user.id).map(s => ({ ...s, device: deviceName(s.ua), current: s.id === req.user.sid }))));
app.delete('/api/me/sessions/:sid', (req, res) => { D.revokeSession.run(req.params.sid, req.user.id); res.json({ ok: true }); });
app.post('/api/me/sessions/revoke-all', (req, res) => { D.revokeAll.run(req.user.id, req.user.sid || ''); res.json({ ok: true }); });
app.post('/api/me/2fa/setup', async (req, res) => {
  const secret = b32.enc(crypto.randomBytes(20)); pendingLogins.set('setup:' + req.user.id, { secret, exp: now() + 10 * 60 * 1000 });
  const url = `otpauth://totp/${encodeURIComponent(process.env.APP_NAME || 'Akashwani')}:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=${encodeURIComponent(process.env.APP_NAME || 'Akashwani')}`;
  res.json({ secret, qr: await QR.toDataURL(url, { margin: 1, width: 200 }) });
});
app.post('/api/me/2fa/enable', (req, res) => {
  const p = pendingLogins.get('setup:' + req.user.id); if (!p || p.exp < now()) return bad(res, 400, 'start setup again');
  if (!totpOk(p.secret, req.body?.code)) return bad(res, 400, 'wrong code — check the time on your phone');
  D.setTotp.run(p.secret, req.user.id); pendingLogins.delete('setup:' + req.user.id); res.json({ ok: true });
});
app.post('/api/me/2fa/disable', (req, res) => {
  const full = D.userByEmail.get(req.user.email); if (!full.totp) return res.json({ ok: true });
  if (!totpOk(full.totp, req.body?.code)) return bad(res, 400, 'wrong code'); D.setTotp.run(null, req.user.id); res.json({ ok: true });
});
app.get('/api/me/blocks', (req, res) => res.json(D.myBlocks.all(req.user.id)));
app.post('/api/users/:uid/block', (req, res) => { D.block.run(req.user.id, +req.params.uid, now()); emitUser(req.user.id, 'chats:changed'); res.json({ ok: true }); });
app.delete('/api/users/:uid/block', (req, res) => { D.unblock.run(req.user.id, +req.params.uid); emitUser(req.user.id, 'chats:changed'); res.json({ ok: true }); });
// ---------- admin ----------
app.get('/api/admin', admin, (req, res) => res.json({ signup: setting('signup', 'open'), pending: D.pendingUsers.all(), users: D.adminUsers.all().map(u => ({ ...u, online: online.has(u.id) })) }));
app.post('/api/admin/settings', admin, (req, res) => { if (['open', 'approval'].includes(req.body.signup)) D.setSetting.run('signup', req.body.signup); res.json({ ok: true }); });
app.post('/api/admin/users/:uid/approve', admin, (req, res) => { const u = D.userById.get(+req.params.uid); if (!u) return bad(res, 404, 'no user'); D.setStatus.run('active', u.id); io.emit('users:changed'); sendMail(u.email, `${process.env.APP_NAME || 'Akashwani'}: account approved`, 'Your account has been approved — you can sign in now.'); res.json({ ok: true }); });
app.post('/api/admin/users/:uid/disable', admin, (req, res) => { if (+req.params.uid === req.user.id) return bad(res, 400, 'not yourself'); D.setStatus.run('disabled', +req.params.uid); D.revokeAll.run(+req.params.uid, ''); io.emit('users:changed'); res.json({ ok: true }); });
app.post('/api/admin/users/:uid/enable', admin, (req, res) => { D.setStatus.run('active', +req.params.uid); io.emit('users:changed'); res.json({ ok: true }); });
app.delete('/api/admin/users/:uid', admin, (req, res) => { if (+req.params.uid === req.user.id) return bad(res, 400, 'not yourself'); D.deleteUser.run(+req.params.uid); io.emit('users:changed'); res.json({ ok: true }); });
app.post('/api/admin/users/:uid/role', admin, (req, res) => { if (+req.params.uid === req.user.id) return bad(res, 400, 'not yourself'); D.setRole.run(req.body.role === 'admin' ? 'admin' : 'member', +req.params.uid); io.emit('users:changed'); res.json({ ok: true }); });
app.patch('/api/me', (req, res) => {
  const { name, bio, phone, title } = req.body || {};
  if (!name || !name.trim()) return bad(res, 400, 'name required');
  D.updateProfile.run(name.trim().slice(0, 60), String(bio || '').slice(0, 200), String(phone || '').slice(0, 30), String(title || '').slice(0, 60), req.user.id);
  io.emit('users:changed'); res.json(pub(D.userById.get(req.user.id)));
});
app.post('/api/me/avatar', express.raw({ type: 'image/*', limit: '5mb' }), (req, res) => {
  if (!req.body?.length) return bad(res, 400, 'image required');
  const file = `avatars/${req.user.id}-${Date.now().toString(36)}.${extOf('', req.headers['content-type'])}`;
  fs.mkdirSync(path.join(FILES_DIR, 'avatars'), { recursive: true }); fs.writeFileSync(path.join(FILES_DIR, file), req.body);
  D.updateAvatar.run('/files/' + file, req.user.id); io.emit('users:changed'); res.json(pub(D.userById.get(req.user.id)));
});
app.use('/files', (req, res, next) => (req.path.startsWith('/avatars/') ? next() : auth(req, res, next)), (req, res, next) => {
  const m = req.path.match(/^\/chat-(\d+)\//); if (!m) return next();
  return D.isMember.get(+m[1], req.user.id) ? next() : bad(res, 403, 'not a member');
}, express.static(FILES_DIR));

// ---------- attachments (files, images, voice notes) ----------
app.post('/api/chats/:id/upload', member, notBlocked, express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  if (!req.body?.length) return bad(res, 400, 'empty');
  const chatId = +req.params.id, name = safeName(req.query.name), mime = String(req.query.mime || req.headers['content-type'] || 'application/octet-stream').slice(0, 80);
  const duration = +req.query.duration || null, text = String(req.query.text || '').slice(0, 2000);
  const file = `chat-${chatId}/${Date.now().toString(36)}-${name}`;
  fs.mkdirSync(path.join(FILES_DIR, `chat-${chatId}`), { recursive: true }); fs.writeFileSync(path.join(FILES_DIR, file), req.body);
  const id = D.insertFileMessage.run(chatId, req.user.id, text, now(), '/files/' + file, name, req.body.length, mime, duration).lastInsertRowid;
  D.setRead.run(id, chatId, req.user.id, id);
  const m = parseMsg(D.messages.all(chatId, id + 1, 1)[0]);
  emitChat(chatId, 'message', m);
  for (const { user_id } of D.memberIds.all(chatId)) if (user_id !== req.user.id) emitUser(user_id, 'chats:changed');
  res.json(m);
});
app.get('/api/chats/:id/files', member, (req, res) => res.json(D.chatFiles.all(+req.params.id)));
app.get('/api/files', (req, res) => res.json(D.myFiles.all(req.user.id).map(f => ({ ...f, chat_name: f.kind === 'dm' ? 'Direct chat' : f.chat_name }))));

// ---------- users / presence ----------
const online = new Map(); // userId -> socket count
app.get('/api/users', (req, res) => res.json(D.contacts.all(req.user.id, req.user.id).map(u => ({ ...u, online: online.has(u.id) }))));
app.post('/api/users/lookup', (req, res) => { // find someone new by exact email
  const u = D.userByEmail.get(String(req.body.email || '').trim().toLowerCase());
  if (!u || u.id === req.user.id || u.status !== 'active' || D.isBlocked.get(req.user.id, u.id, u.id, req.user.id)) return bad(res, 404, 'No account with that email');
  res.json({ id: u.id, name: u.name, color: u.color, avatar: u.avatar, title: u.title });
});

// ---------- chats ----------
function chatSummary(c, me) {
  const members = D.membersOf.all(c.id);
  const other = c.kind === 'dm' ? members.find(m => m.id !== me) : null;
  return { id: c.id, kind: c.kind, name: c.kind === 'dm' ? (other?.name || 'Direct chat') : c.name, color: other?.color, avatar: other?.avatar || null,
    otherId: other?.id, online: other ? online.has(other.id) : undefined, members, unread: c.unread, last: c.last ? JSON.parse(c.last) : null,
    inCall: callers.get(c.id)?.size || 0, status: c.status || 'accepted', requestedBy: c.requested_by || null, blocked: other ? !!D.iBlocked.get(me, other.id) : false, blockedMe: other ? !!D.iBlocked.get(other.id, me) : false };
}
app.get('/api/chats', (req, res) => res.json(D.myChats.all(req.user.id).map(c => chatSummary(c, req.user.id)).sort((a, b) => (b.last?.ts || b.created || 0) - (a.last?.ts || a.created || 0))));
app.post('/api/chats/team', (req, res) => {
  const name = (req.body.name || '').trim(); if (!name) return bad(res, 400, 'name required');
  const r = D.insertChat.run('team', name, req.user.id, now());
  D.addMember.run(r.lastInsertRowid, req.user.id, now());
  for (const uid of req.body.memberIds || []) D.addMember.run(r.lastInsertRowid, +uid, now());
  const c = D.chatById.get(r.lastInsertRowid);
  for (const { user_id } of D.memberIds.all(c.id)) emitUser(user_id, 'chats:changed');
  res.json(chatSummary({ ...c, unread: 0 }, req.user.id));
});
app.post('/api/chats/dm', (req, res) => {
  const other = D.userById.get(+req.body.userId); if (!other || other.id === req.user.id) return bad(res, 400, 'bad user');
  if (D.isBlocked.get(req.user.id, other.id, other.id, req.user.id)) return bad(res, 403, 'unavailable');
  let id = D.findDm.get(req.user.id, other.id)?.id;
  if (!id) {
    const known = D.contacts.all(req.user.id, req.user.id, req.user.id, req.user.id).some(c => c.id === other.id);
    id = known ? D.insertChat.run('dm', null, req.user.id, now()).lastInsertRowid : D.insertDmRequest.run(req.user.id, now(), req.user.id).lastInsertRowid;
    D.addMember.run(id, req.user.id, now()); D.addMember.run(id, other.id, now()); emitUser(other.id, 'chats:changed');
  }
  res.json(chatSummary({ ...D.chatById.get(id), unread: 0 }, req.user.id));
});
app.post('/api/chats/:id/members', member, (req, res) => {
  const c = D.chatById.get(+req.params.id);
  const ids = [...new Set([].concat(req.body.userIds || [], req.body.userId ? [req.body.userId] : []).map(Number))].filter(id => D.userById.get(id));
  if (!ids.length) return bad(res, 404, 'no user');
  if (c.kind === 'team') {
    for (const id of ids) { D.addMember.run(c.id, id, now()); emitUser(id, 'chats:changed'); }
    emitChat(c.id, 'members:changed', { chatId: c.id }); return res.json({ ok: true, chatId: c.id });
  }
  // 1:1 chat → start a new group chat with everyone (like Teams)
  const all = [...new Set([...D.memberIds.all(c.id).map(m => m.user_id), ...ids])];
  const name = all.map(id => D.userById.get(id).name.split(' ')[0]).join(', ');
  const nid = D.insertChat.run('team', name, req.user.id, now()).lastInsertRowid;
  for (const id of all) { D.addMember.run(nid, id, now()); emitUser(id, 'chats:changed'); }
  res.json({ ok: true, chatId: nid, created: true });
});
app.post('/api/chats/:id/accept', member, (req, res) => { const c = D.chatById.get(+req.params.id); if (c.requested_by === req.user.id) return bad(res, 400, 'you sent this request'); D.setChatStatus.run('accepted', c.id); for (const { user_id } of D.memberIds.all(c.id)) emitUser(user_id, 'chats:changed'); res.json({ ok: true }); });
app.get('/api/chats/:id/messages', member, (req, res) => {
  const before = +req.query.before || Number.MAX_SAFE_INTEGER;
  res.json(D.messages.all(+req.params.id, before, 50).reverse().map(parseMsg));
});
app.post('/api/chats/:id/messages', member, notBlocked, (req, res) => {
  const text = (req.body.text || '').trim(); if (!text) return bad(res, 400, 'empty');
  const chatId = +req.params.id;
  const id = D.insertMessage.run(chatId, req.user.id, text, now()).lastInsertRowid;
  D.setRead.run(id, chatId, req.user.id, id);
  const m = parseMsg(D.messages.all(chatId, id + 1, 1)[0]);
  emitChat(chatId, 'message', m);
  for (const { user_id } of D.memberIds.all(chatId)) if (user_id !== req.user.id) emitUser(user_id, 'chats:changed');
  res.json(m);
});
app.patch('/api/messages/:mid', (req, res) => {
  const m = D.messageById.get(+req.params.mid); if (!m) return bad(res, 404, 'no message');
  const text = (req.body.text || '').trim(); if (!text) return bad(res, 400, 'empty');
  if (!D.editMessage.run(text, now(), m.id, req.user.id).changes) return bad(res, 403, 'not yours');
  emitChat(m.chat_id, 'message:edit', { id: m.id, chat_id: m.chat_id, text, edited: now() }); res.json({ ok: true });
});
app.delete('/api/messages/:mid', (req, res) => {
  const m = D.messageById.get(+req.params.mid); if (!m) return bad(res, 404, 'no message');
  if (!D.deleteMessage.run(m.id, req.user.id).changes) { if (req.user.role === 'admin') D.adminDeleteMessage.run(m.id); else return bad(res, 403, 'not yours'); }
  emitChat(m.chat_id, 'message:delete', { id: m.id, chat_id: m.chat_id }); res.json({ ok: true });
});
app.post('/api/messages/:mid/react', (req, res) => {
  const m = D.messageById.get(+req.params.mid); if (!m || !D.isMember.get(m.chat_id, req.user.id)) return bad(res, 404, 'no message');
  const emoji = String(req.body.emoji || '').slice(0, 8); if (!emoji) return bad(res, 400, 'emoji');
  if (D.hasReaction.get(m.id, req.user.id, emoji)) D.delReaction.run(m.id, req.user.id, emoji); else D.addReaction.run(m.id, req.user.id, emoji);
  emitChat(m.chat_id, 'message:react', { id: m.id, chat_id: m.chat_id, reactions: JSON.parse(D.reactionsOf.get(m.id).r) }); res.json({ ok: true });
});
app.post('/api/chats/:id/read', member, (req, res) => {
  const chatId = +req.params.id, upTo = +req.body.messageId || 0;
  if (D.setRead.run(upTo, chatId, req.user.id, upTo).changes) emitChat(chatId, 'read', { chatId, userId: req.user.id, messageId: upTo });
  res.json({ ok: true });
});

// ---------- calls ----------
const callers = new Map(); // chatId -> Set(userId) currently in call
const callInvites = new Map(); // chatId -> Set(userId) invited into a call without being chat members
const memberOrInvited = (req, res, next) => (D.isMember.get(+req.params.id, req.user.id) || callInvites.get(+req.params.id)?.has(req.user.id)) ? next() : bad(res, 403, 'not a member');
app.get('/api/chats/:id/call-token', memberOrInvited, async (req, res) => {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: String(req.user.id), name: req.user.name, ttl: '4h' });
  at.addGrant({ roomJoin: true, room: roomName(+req.params.id), canPublish: true, canSubscribe: true, canPublishData: true });
  const proto = req.protocol === 'https' ? 'wss' : 'ws';
  res.json({ token: await at.toJwt(), url: CLOUD ? LIVEKIT_URL : `${proto}://${req.get('host')}` });
});

// ---------- recordings ----------
app.use('/recordings/files', auth, express.static(RECORDINGS_DIR));
app.get('/api/recordings', (req, res) => res.json(D.myRecordings.all(req.user.id).map(r => ({ ...r, chat_name: r.kind === 'dm' ? 'Direct chat' : r.chat_name, url: `/recordings/files/${r.file}` }))));
app.post('/api/chats/:id/recordings', member, express.raw({ type: '*/*', limit: '2gb' }), (req, res) => {
  if (!req.body?.length) return bad(res, 400, 'empty');
  const chatId = +req.params.id, ext = req.query.ext === 'mp4' ? 'mp4' : 'webm', started = +req.query.startedAt || now();
  const file = `chat-${chatId}/${new Date(started).toISOString().replace(/[:.]/g, '-')}.${ext}`;
  fs.mkdirSync(path.join(RECORDINGS_DIR, `chat-${chatId}`), { recursive: true });
  fs.writeFileSync(path.join(RECORDINGS_DIR, file), req.body);
  D.insertRecording.run(chatId, req.user.id, file, started, now());
  const text = `🎞 Recording saved (${Math.round((now() - started) / 60000)} min)`;
  const id = D.insertMessage.run(chatId, req.user.id, text, now()).lastInsertRowid;
  emitChat(chatId, 'message', parseMsg(D.messages.all(chatId, id + 1, 1)[0]));
  res.json({ ok: true, file });
});

// ---------- Socket.IO ----------
io.use((socket, next) => {
  try { socket.user = verifyToken(socket.handshake.auth.token); if (!socket.user) throw 0; next(); } catch { next(new Error('unauthorised')); }
});
io.on('connection', (socket) => {
  const me = socket.user;
  socket.join(`user-${me.id}`);
  for (const c of D.myChats.all(me.id)) socket.join(roomName(c.id));
  online.set(me.id, (online.get(me.id) || 0) + 1);
  if (online.get(me.id) === 1) io.emit('presence', { userId: me.id, online: true });

  socket.on('join', (chatId) => { if (D.isMember.get(+chatId, me.id)) socket.join(roomName(+chatId)); });
  socket.on('typing', ({ chatId, typing }) => socket.to(roomName(+chatId)).emit('typing', { chatId: +chatId, userId: me.id, name: me.name, typing }));

  // Calls: ring members, track who's in the call
  socket.on('call:ring', ({ chatId, video = true }) => {
    if (!D.isMember.get(+chatId, me.id)) return;
    const c = D.chatById.get(+chatId); const name = c.kind === 'dm' ? me.name : c.name;
    for (const { user_id } of D.memberIds.all(+chatId)) if (user_id !== me.id && !callers.get(+chatId)?.has(user_id)) emitUser(user_id, 'call:incoming', { chatId: +chatId, from: me.name, fromId: me.id, name, kind: c.kind, video: !!video, avatar: me.avatar || null, color: me.color });
  });
  socket.on('call:invite', ({ chatId, userIds }) => {
    if (!D.isMember.get(+chatId, me.id) && !callInvites.get(+chatId)?.has(me.id)) return;
    const c = D.chatById.get(+chatId); const name = c.kind === 'dm' ? me.name : c.name;
    if (!callInvites.has(+chatId)) callInvites.set(+chatId, new Set());
    for (const uid of (userIds || []).map(Number)) {
      if (!D.userById.get(uid) || uid === me.id) continue;
      if (!D.isMember.get(+chatId, uid)) callInvites.get(+chatId).add(uid);
      emitUser(uid, 'call:incoming', { chatId: +chatId, from: me.name, fromId: me.id, name, kind: c.kind, video: true, avatar: me.avatar || null, color: me.color, invited: true });
    }
  });
  socket.on('call:joined', ({ chatId }) => { if (!callers.has(+chatId)) callers.set(+chatId, new Set()); callers.get(+chatId).add(me.id); socket.callChat = +chatId; emitChat(+chatId, 'call:state', { chatId: +chatId, count: callers.get(+chatId).size }); });
  const leave = () => { const c = socket.callChat; if (c == null) return; callers.get(c)?.delete(me.id); if (!callers.get(c)?.size) { callers.delete(c); callInvites.delete(c); } emitChat(c, 'call:state', { chatId: c, count: callers.get(c)?.size || 0 }); socket.callChat = null; };
  socket.on('call:left', leave);
  socket.on('call:decline', ({ chatId, toId }) => emitUser(toId, 'call:declined', { chatId, by: me.name }));

  socket.on('disconnect', () => {
    leave();
    online.set(me.id, online.get(me.id) - 1);
    if (online.get(me.id) <= 0) { online.delete(me.id); io.emit('presence', { userId: me.id, online: false }); }
  });
});

server.listen(PORT, () => console.log(`backend on http://localhost:${PORT}\n  LiveKit: ${LIVEKIT_URL} (${CLOUD ? 'cloud' : 'local docker'})\n  database: ${process.env.DB_FILE || path.join(__dirname, 'data.db')}\n  recordings: ${RECORDINGS_DIR}`));
