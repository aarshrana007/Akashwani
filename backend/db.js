// SQLite persistence (Node's built-in node:sqlite — no native deps). File: backend/data.db
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'data.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    pass_hash TEXT NOT NULL, salt TEXT NOT NULL, color TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('team','dm')), name TEXT,
    created_by INTEGER REFERENCES users(id), created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read INTEGER NOT NULL DEFAULT 0, joined INTEGER NOT NULL, PRIMARY KEY (chat_id, user_id));
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL, ts INTEGER NOT NULL,
    edited INTEGER, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji));
  CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id), file TEXT NOT NULL,
    started INTEGER NOT NULL, ended INTEGER NOT NULL);
`);

// migrations (idempotent)
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
for (const [t, c, def] of [
  ['users', 'bio', "TEXT NOT NULL DEFAULT ''"], ['users', 'phone', "TEXT NOT NULL DEFAULT ''"], ['users', 'title', "TEXT NOT NULL DEFAULT ''"], ['users', 'avatar', 'TEXT'],
  ['messages', 'file', 'TEXT'], ['messages', 'file_name', 'TEXT'], ['messages', 'file_size', 'INTEGER'], ['messages', 'file_mime', 'TEXT'], ['messages', 'duration', 'INTEGER'],
]) if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);

const q = (sql) => db.prepare(sql);
module.exports = {
  db,
  // users
  insertUser: q('INSERT INTO users (email,name,pass_hash,salt,color,created) VALUES (?,?,?,?,?,?)'),
  userByEmail: q('SELECT * FROM users WHERE email = ?'),
  updatePassword: q('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?'),
  userById: q('SELECT id,email,name,color,bio,phone,title,avatar FROM users WHERE id = ?'),
  allUsers: q('SELECT id,email,name,color,bio,phone,title,avatar FROM users ORDER BY name'),
  updateProfile: q('UPDATE users SET name = ?, bio = ?, phone = ?, title = ? WHERE id = ?'),
  updateAvatar: q('UPDATE users SET avatar = ? WHERE id = ?'),
  // chats
  insertChat: q('INSERT INTO chats (kind,name,created_by,created) VALUES (?,?,?,?)'),
  addMember: q('INSERT OR IGNORE INTO chat_members (chat_id,user_id,joined) VALUES (?,?,?)'),
  isMember: q('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'),
  chatById: q('SELECT * FROM chats WHERE id = ?'),
  membersOf: q('SELECT u.id,u.name,u.color,u.email,u.bio,u.phone,u.title,u.avatar,m.last_read FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? ORDER BY u.name'),
  memberIds: q('SELECT user_id FROM chat_members WHERE chat_id = ?'),
  myChats: q(`
    SELECT c.id, c.kind, c.name, c.created,
      (SELECT COUNT(*) FROM messages x WHERE x.chat_id = c.id AND x.id > m.last_read AND x.user_id != m.user_id AND x.deleted = 0) AS unread,
      (SELECT json_object('text', y.text, 'ts', y.ts, 'user_id', y.user_id, 'deleted', y.deleted, 'file_name', y.file_name, 'duration', y.duration, 'user_name', (SELECT name FROM users WHERE id = y.user_id)) FROM messages y WHERE y.chat_id = c.id ORDER BY y.id DESC LIMIT 1) AS last
    FROM chats c JOIN chat_members m ON m.chat_id = c.id WHERE m.user_id = ?`),
  findDm: q(`SELECT c.id FROM chats c
    JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
    JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
    WHERE c.kind = 'dm' LIMIT 1`),
  // messages
  insertMessage: q('INSERT INTO messages (chat_id,user_id,text,ts) VALUES (?,?,?,?)'),
  insertFileMessage: q('INSERT INTO messages (chat_id,user_id,text,ts,file,file_name,file_size,file_mime,duration) VALUES (?,?,?,?,?,?,?,?,?)'),
  chatFiles: q('SELECT m.id,m.ts,m.file,m.file_name,m.file_size,m.file_mime,m.duration,u.name AS user_name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? AND m.file IS NOT NULL AND m.deleted = 0 ORDER BY m.id DESC'),
  myFiles: q('SELECT m.id,m.ts,m.chat_id,m.file,m.file_name,m.file_size,m.file_mime,m.duration,u.name AS user_name,c.kind,c.name AS chat_name FROM messages m JOIN users u ON u.id = m.user_id JOIN chats c ON c.id = m.chat_id WHERE m.file IS NOT NULL AND m.deleted = 0 AND m.chat_id IN (SELECT chat_id FROM chat_members WHERE user_id = ?) ORDER BY m.id DESC LIMIT 200'),
  messageById: q('SELECT * FROM messages WHERE id = ?'),
  messages: q(`SELECT m.*, u.name AS user_name, u.color AS user_color, u.avatar AS user_avatar,
      (SELECT json_group_array(json_object('user_id', r.user_id, 'emoji', r.emoji)) FROM reactions r WHERE r.message_id = m.id) AS reactions
    FROM messages m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`),
  editMessage: q('UPDATE messages SET text = ?, edited = ? WHERE id = ? AND user_id = ?'),
  deleteMessage: q("UPDATE messages SET deleted = 1, text = '' WHERE id = ? AND user_id = ?"),
  setRead: q('UPDATE chat_members SET last_read = ? WHERE chat_id = ? AND user_id = ? AND last_read < ?'),
  // reactions
  hasReaction: q('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'),
  addReaction: q('INSERT INTO reactions (message_id,user_id,emoji) VALUES (?,?,?)'),
  delReaction: q('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'),
  reactionsOf: q("SELECT json_group_array(json_object('user_id', user_id, 'emoji', emoji)) AS r FROM reactions WHERE message_id = ?"),
  // recordings
  insertRecording: q('INSERT INTO recordings (chat_id,user_id,file,started,ended) VALUES (?,?,?,?,?)'),
  myRecordings: q(`SELECT r.*, c.name AS chat_name, c.kind, u.name AS user_name FROM recordings r
    JOIN chats c ON c.id = r.chat_id JOIN users u ON u.id = r.user_id
    WHERE r.chat_id IN (SELECT chat_id FROM chat_members WHERE user_id = ?) ORDER BY r.id DESC`),
};
