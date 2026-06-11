# ⚡ LogiParalel — Parallel Computing Logistics System

> **University Project: Parallel & Distributed Systems**
> Architecture: 1 Server Backend (Render) + 2 Separate Frontends (GitHub Pages) + Firebase Realtime Database

---

## 📐 System Architecture

```
┌──────────────────┐     ┌────────────────────────┐     ┌──────────────────┐
│   Customer App   │     │   Firebase Realtime DB  │     │   Courier App    │
│  (GitHub Pages)  │◄───►│     (Cloud Broker)      │◄───►│  (GitHub Pages)  │
│   HTML/CSS/JS    │     │                        │     │   HTML/CSS/JS    │
└────────┬─────────┘     └────────────┬───────────┘     └────────┬─────────┘
         │                            │                          │
         │         ┌──────────────────┴─────────────┐            │
         └────────►│    Express.js Backend API      │◄───────────┘
                   │       (Render.com)             │
                   │  Firebase Admin SDK + CORS     │
                   └────────────────────────────────┘
```

## 🧪 Parallel Computing Concepts Demonstrated

| Concept | Implementation | File(s) |
|---------|---------------|---------|
| **Fork-Join (Promise.all)** | 3 independent Firebase writes executed in parallel | `server-side/index.js` — `POST /api/create-order` |
| **Atomic CAS Transaction** | Firebase `ref.transaction()` for race-condition-safe wallet updates | `server-side/index.js` — `POST /api/topup-wallet` |
| **Non-Blocking I/O** | `async/await` + `fetch()` never blocks the UI thread | Both client `script.js` files |
| **Pub/Sub Data Streaming** | GPS data pushed by courier, received by customer via Firebase `onValue()` | `client-courier/script.js` + `client-customer/script.js` |
| **Timer-Driven Producer** | `setInterval()` simulates hardware GPS interrupt broadcasting | `client-courier/script.js` — Section 10 |
| **I/O Multiplexing** | Multiple Firebase listeners (wallet + tracking + chat) run concurrently | `client-customer/script.js` — Section 14 |
| **Event-Driven Concurrency** | Browser Event Loop processes UI, network, and timer callbacks on one thread | All client files |

---

## 📁 Repository Structure

```
logistik_kurir/
├── firebase-database-structure.json   # Firebase RTDB schema
├── render.yaml                        # Render.com deployment blueprint
├── .gitignore
├── README.md
│
├── server-side/                       # Backend API (Render.com)
│   ├── package.json
│   ├── .env.example
│   └── index.js                       # Express.js server
│
├── client-customer/                   # Frontend 1 (GitHub Pages)
│   ├── index.html
│   ├── style.css
│   └── script.js
│
└── client-courier/                    # Frontend 2 (GitHub Pages)
    ├── index.html
    ├── style.css
    └── script.js
```

---

## 🚀 Setup & Deployment

### 1. Firebase Setup
1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Realtime Database** (Asia-Southeast1 region recommended)
3. Import `firebase-database-structure.json` to seed initial data
4. Get your **Web App config** (Project Settings → General → Your Apps)
5. Generate a **Service Account key** (Project Settings → Service Accounts)

### 2. Backend (Render.com)
```bash
cd server-side
cp .env.example .env
# Fill in your Firebase service account credentials in .env
npm install
npm run dev    # Local development
```

Then deploy to Render:
- Link your GitHub repo in the Render dashboard
- Render will auto-detect `render.yaml` and configure the service
- Set your environment variables in the Render dashboard

### 3. Client Apps (GitHub Pages)
1. Update `FIREBASE_CONFIG` in both `client-customer/script.js` and `client-courier/script.js`
2. Update `BACKEND_URL` to your Render deployment URL
3. Push each client folder to separate GitHub repos
4. Enable GitHub Pages (Settings → Pages → Branch: main)

---

## 🔑 Configuration Checklist

- [ ] Firebase project created
- [ ] Realtime Database enabled & rules configured
- [ ] Initial data imported from `firebase-database-structure.json`
- [ ] Service Account JSON downloaded
- [ ] `server-side/.env` configured with Firebase credentials
- [ ] `BACKEND_URL` updated in both client `script.js` files
- [ ] `FIREBASE_CONFIG` updated in both client `script.js` files
- [ ] Backend deployed to Render.com
- [ ] `ALLOWED_ORIGINS` env var set on Render with GitHub Pages URLs
- [ ] Both client apps deployed to GitHub Pages

---

## 📜 License

MIT — University Parallel Computing Project
