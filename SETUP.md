# Setup — UWorld Copilot for Freshservice

What to install and how to run the two parts of the demo:
- **A. Browser demo** (`demo.html`, `users.html`) — needs only .NET.
- **B. In-Freshservice sidebar** (card beside the ticket) — needs Node 18 + FDK + ngrok.

---

## Prerequisites

| Tool | Purpose | Needed for | Install |
|---|---|---|---|
| **.NET 8+ SDK** | Runs the backend (API, policy engine, data) | A & B | https://dotnet.microsoft.com/download (.NET 8 or newer; .NET 9 SDK also builds it) |
| **Node.js 18 LTS** | Required by the Freshworks FDK CLI | B only | https://nodejs.org (v18.x — **v16 is too old for FDK 9.x**) |
| **Freshworks FDK CLI** | Runs the sidebar app inside Freshservice | B only | `npm install -g @freshworks/fdk` |
| **ngrok** | Public tunnel so Freshservice can reach the local backend | B only | https://ngrok.com/download or `winget install ngrok.ngrok` |
| **Freshservice API key** | Backend posts replies / notes / status | A (send) & B | Freshservice → Profile Settings → "Your API Key" |

> **No database required** — the demo ships 307 in-memory sample users. SQL Server is only needed
> if you flip `UWorldDb:UseMockData` to `false` to use the real UWorld DB.

### Check what you already have
```powershell
dotnet --version     # want 8.x or 9.x
node --version       # want v18.x  (upgrade if v16)
fdk version          # install if missing
ngrok --version      # install if missing
```

### Upgrade Node to 18 (if needed)
Download the Node 18 LTS installer from nodejs.org, **or** with nvm-windows:
```powershell
nvm install 18.20.4
nvm use 18.20.4
```

---

## Configure the backend (one-time)

Store the Freshservice API key with user-secrets (keeps it out of source control):
```powershell
cd backend
dotnet user-secrets init
dotnet user-secrets set "Freshdesk:ApiKey" "<your-freshservice-api-key>"
```
`backend/appsettings.json` already points `Freshdesk:Domain` at
`pushpasoftwaresolutions.freshservice.com`.

---

## A. Run the browser demo (zero extra installs)

```powershell
cd backend
dotnet run --urls http://localhost:5090
```
Open:
- http://localhost:5090/demo.html — analyzer: decision (sidebar view) + Customer 360
- http://localhost:5090/users.html — all 307 sample users, searchable by email / name / ID

---

## B. Run the in-Freshservice sidebar (card beside the ticket)

**Terminal 1 — backend**
```powershell
cd backend
dotnet run --urls http://localhost:5090
```

**Terminal 2 — public tunnel**
```powershell
ngrok http 5090
```
Copy the HTTPS URL, e.g. `https://ab12cd34.ngrok-free.app`.
(The app manifest already whitelists `*.ngrok-free.app`.)

**Terminal 3 — the app**
```powershell
cd freshdesk-app
fdk validate
fdk run
```

**In the browser**
1. Open a ticket and append `?dev=true`:
   `https://pushpasoftwaresolutions.freshservice.com/a/tickets/3?dev=true`
2. Accept the "load unsafe scripts" prompt.
3. When asked for **backend_base_url**, paste your ngrok URL (no trailing slash).

The **UWorld Copilot** card appears beside the ticket: the decision + confidence, the customer's
UWorld data, suggested steps, a **📊 Customer 360** button, and **Reply / Insert / Add note /
Resolve** actions that act on the ticket through the backend.

---

## Verify (no Freshservice needed)
```powershell
curl http://localhost:5090/health
curl "http://localhost:5090/api/insights?email=pushpabaivadithe522@gmail.com&subject=Refund&description=I%20want%20a%20refund"
curl "http://localhost:5090/api/samples?q=pushpa"
curl "http://localhost:5090/api/customer/360?email=pushpabaivadithe522@gmail.com"
```

## Troubleshooting
- **Sidebar card blank / network error** → backend not running or `backend_base_url` is a stale
  ngrok URL. Confirm `https://<ngrok>/health` returns `{"status":"ok"}`.
- **"Refused to connect" in console** → backend domain not whitelisted; it must match
  `*.ngrok-free.app` (or add yours to `whitelisted-domains` in `freshdesk-app/manifest.json`).
- **FDK errors on install/run** → you're probably on Node 16; upgrade to Node 18.
- **403 from Freshservice** → the API key is wrong or lacks permission; re-copy it from Profile Settings.
