// Point this at your backend. On a physical phone use your machine's LAN IP, not localhost.
export const API = 'http://192.168.1.10:4000';

const j = (r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error || r.status))));

export const api = {
  token: (identity, name, room) =>
    fetch(`${API}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity, name, room }) }).then(j),
  rooms: () => fetch(`${API}/rooms`).then(j),
  createRoom: (name) =>
    fetch(`${API}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(j),
  chat: (room) => fetch(`${API}/chat/${room}`).then(j),
  send: (room, from, text) =>
    fetch(`${API}/chat/${room}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, text }) }).then(j),
  startRecording: (room, startedBy) =>
    fetch(`${API}/recordings/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, startedBy }) }).then(j),
  stopRecording: (room) =>
    fetch(`${API}/recordings/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room }) }).then(j),
  recordings: (room) => fetch(`${API}/recordings${room ? `?room=${room}` : ''}`).then(j),
};
