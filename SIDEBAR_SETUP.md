# Show the UWorld Copilot suggestion beside the ticket in Freshservice

The suggestion card lives in `freshdesk-app/` (FDK app, `ticket_sidebar` placement). Follow these
steps to see it beside the ticket on `pushpasoftwaresolutions.freshservice.com`.

## Prerequisites (one-time)
1. **Node 18** — check with `node --version` (should be v18.x). If not, install Node 18 LTS.
2. **Freshworks FDK CLI**:
   ```powershell
   npm install -g @freshworks/fdk
   fdk version
   ```

## Step 1 — start the backend
```powershell
cd C:\Users\kmarriboyina\source\repos\uworld-freshdesk-copilot\backend
dotnet run --urls http://localhost:5090
```

## Step 2 — expose the backend with ngrok
In a second terminal:
```powershell
ngrok http 5090
```
Copy the HTTPS forwarding URL, e.g. `https://ab12cd34.ngrok-free.app`.
(The manifest already whitelists `*.ngrok-free.app`, so the app may call it.)

## Step 3 — run the FDK app
In a third terminal:
```powershell
cd C:\Users\kmarriboyina\source\repos\uworld-freshdesk-copilot\freshdesk-app
fdk validate
fdk run
```
`fdk run` serves the app locally (http://localhost:10001) for testing.

## Step 4 — open a ticket in test mode
1. Go to `https://pushpasoftwaresolutions.freshservice.com` and open any ticket
   (e.g. ticket #3), then append **`?dev=true`** to the URL:
   `https://pushpasoftwaresolutions.freshservice.com/a/tickets/3?dev=true`
2. A prompt appears to load unsafe/local scripts — **accept it** (allow).
3. On first load the app asks for the installation parameter **backend_base_url** —
   paste your ngrok URL from Step 2 (no trailing slash).

## Step 5 — see it
The **UWorld Copilot** card now renders **beside the ticket**, showing:
- the copilot decision (auto-resolve / auto-deny / needs review) with intent + confidence,
- the customer's UWorld data,
- suggested steps (with "Insert" buttons),
- a **📊 View full records (Customer 360)** button that opens the User / Subscriptions / Payments modal.

## Troubleshooting
- **Card is blank / network error** → the ngrok URL in `backend_base_url` is wrong or the backend
  isn't running. Re-check Steps 1–2. Confirm `https://<ngrok>/health` returns `{"status":"ok"}`.
- **"Refused to connect" in console** → the backend domain isn't whitelisted. It must match
  `*.ngrok-free.app` (or add your domain to `whitelisted-domains` in `manifest.json`).
- **No `?dev=true` prompt** → make sure `fdk run` is still running in its terminal.
- **Requester email not found** → the sidebar looks the customer up by requester email. For the
  mock data, set the ticket's requester to one of the sample emails (e.g. a `@example.com` user
  from `/users.html`) or keep `pushpabaivadithe522@gmail.com` for ticket #3.

## Going live (optional)
To have it always available (not just `?dev=true`), pack and install the app:
```powershell
fdk pack
```
Then upload the `dist/` package via Freshservice → Admin → Apps → "Manage Apps" → Custom Apps.
