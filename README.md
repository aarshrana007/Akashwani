# Akashwani — chat, video calls and call recording

## What's in v3
- Akashwani design: navy/saffron/cream, logo, split login with illustration, nav rail (Chat · Teams · Meetings · Files · People), top search bar with notifications
- Profiles: photo, title, bio, phone (click your avatar) · details panel with About / Files / Linked channels tabs
- File sharing (paperclip, up to 100 MB) with file cards, inline images, Files section across all chats
- Voice notes (mic button) with waveform player · emoji picker · audio calls as well as video calls

## What's in v2
- Accounts: email + password sign-up/sign-in (JWT), persistent SQLite database (`backend/data.db`)
- Chats: teams (group) and direct 1:1 chats, People tab with online presence
- Realtime (Socket.IO): messages, typing indicator, read receipts ("Seen"), reactions, edit/delete, unread badges
- Calls (LiveKit): video, mute/camera/flip, **screen share** (desktop), **raise hand**, "N in call" badge
- Incoming-call ring with Join/Decline, browser notifications for messages and calls
- Recording in the browser (⏺ on the laptop) → uploaded to `backend/recordings/`, listed under 🎞, playable in-app
- Responsive: phone layout (list ↔ chat) and desktop split view; Add to Home Screen on iPhone

## Run (LiveKit Cloud mode — works across networks)
```powershell
cd backend
.\start-cloud.ps1     # installs deps, starts http://localhost:4000 (edit .env with your LiveKit URL/key/secret first)
ngrok http 4000        # second window → share the https URL
```
First user to open it creates an account; everyone else does the same, then they appear under People.

---
(Original local-Docker notes below still apply for fully-offline LAN use.)


Web app (works on iPhone Safari) + optional native Expo app. Calls run on a **local LiveKit** server in Docker;
recordings are produced by the local **LiveKit Egress** container and saved as MP4 in `backend/recordings/`.

```
teams-clone/
├── backend/
│   ├── server.js            API + serves the web app + proxies LiveKit signalling (one URL for everything)
│   ├── web/                 the app (open in any browser / Add to Home Screen on iPhone)
│   ├── docker-compose.yml   livekit-server + egress (recorder) + redis
│   ├── livekit.yaml / egress.yaml
│   ├── start.ps1            one-shot start for Windows
│   └── recordings/          MP4s land here
└── mobile/                  native Expo app (optional, needs Mac/EAS for iOS)
```

## Setup (Windows)
1. Install **Docker Desktop** (https://www.docker.com/products/docker-desktop) and start it.
2. Install **Node.js LTS** (https://nodejs.org).
3. For the iPhone: install **ngrok** (https://ngrok.com/download), sign up free, run `ngrok config add-authtoken <token>` once.
   (iPhone Safari only allows camera/mic over HTTPS; ngrok gives your laptop an HTTPS URL.)

## Run
```powershell
cd teams-clone\backend
.\start.ps1              # starts Docker containers, installs deps, starts the backend on http://localhost:4000
```
In a second PowerShell window:
```powershell
ngrok http 4000          # prints https://xxxx.ngrok-free.app
```
- Laptop: open http://localhost:4000 in Chrome/Edge.
- iPhone (same Wi-Fi): open the ngrok https URL in Safari → Share → **Add to Home Screen**.
- Sign in on both with different names, create a team, tap 📹 on both → two-way call. Tap ⏺ to record.
- Recordings tab → ▶ Play once the file is written (a few seconds after stopping). Files: `backend\recordings\<room>\*.mp4`.

Stop everything: Ctrl+C in both windows, then `docker compose down` in `backend`.

## Notes
- Phones must be on the same Wi-Fi as the laptop (media goes laptop ↔ phone directly; ngrok only carries signalling).
- If PowerShell blocks start.ps1: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- If calls connect but show no video, Windows Firewall is blocking UDP 50000-50050 / TCP 7881 — allow Docker Desktop through the firewall.
- To take it off the laptop later: point `LIVEKIT_URL` at LiveKit Cloud and swap `EncodedFileOutput` to an Azure/S3 upload — the app doesn't change.

## API
| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | /token | identity, name, room | LiveKit join token |
| GET/POST | /rooms | name | List / create rooms |
| GET/POST | /chat/:room | from, text | Chat history / send |
| POST | /recordings/start | room, startedBy | Start composite (grid) recording → local MP4 |
| POST | /recordings/stop | room | Stop recording |
| GET | /recordings | | List with playback URLs |
| POST | /webhooks/livekit | | LiveKit egress events |

