# UWorld Copilot for Freshservice — Demo

A customer-support copilot that plugs into **Freshservice**
(`pushpasoftwaresolutions.freshservice.com`). Two surfaces:

1. **Auto-resolve / auto-decide (no human).** On a new ticket, the backend detects intent, looks
   up the customer in the UWorld DB, runs a policy rule catalog, and when the decision is clear
   and high-confidence it **emails the customer automatically** via the Freshservice reply API —
   in both directions (e.g. password reset → temp password; refund on a used subscription →
   **denial** with the reason).
2. **Agent-assist sidebar (low confidence).** For discretionary cases, a Freshservice app renders
   **beside the ticket** showing the customer's UWorld DB data + suggested resolution steps.

```
uworld-freshdesk-copilot/
├─ backend/           .NET 8 minimal API (webhook + insights API + policy engine)
└─ freshdesk-app/     Freshservice FDK app (ticket_sidebar placement)
```

> The UWorld model isn't deployed yet, so intent detection + policy are a stub behind interfaces.
> Customer data is **mock** (`UWorldDb:UseMockData = true`); a parameterized ADO.NET
> implementation (`SqlUWorldDataService`) is ready to switch on later.

---

## 1. Run the backend

```powershell
cd backend
dotnet run --urls http://localhost:5090
```

Health check: `http://localhost:5090/health` → `{"status":"ok",...}`

### Configure (backend/appsettings.json)
- `Freshdesk:Domain` → `pushpasoftwaresolutions.freshservice.com`
- `Freshdesk:ApiKey` → your Freshservice API key
  (Freshservice → **Profile settings → API Key**). Don't commit it — prefer user-secrets:
  `dotnet user-secrets set "Freshdesk:ApiKey" "<key>"`.
- `Policy:*` thresholds are tweakable live (refund usage %, refund window, confidence gate…).

## 2. Expose the backend with ngrok (so Freshservice can reach the webhook)

```powershell
ngrok http 5090
```
Copy the `https://....ngrok-free.app` URL — used in both the automation webhook and the app's
install parameter.

## 3. Wire the Freshservice automation (auto-send path)

Freshservice **Admin → Workflow Automator** (or **Admin → Automations**) → new rule on
**Ticket raised** → add a **Trigger Webhook** action:
- Method: `POST`, Content: `JSON`
- URL: `https://<ngrok>/webhook/ticket`
- Body:
  ```json
  {
    "ticketId": {{ticket.id}},
    "subject": "{{ticket.subject}}",
    "description": "{{ticket.description}}",
    "email": "{{ticket.requester.email}}"
  }
  ```

## 4. Run the sidebar app (agent-assist path)

```powershell
npm install -g @freshworks/fdk     # one-time; needs Node 18
cd freshdesk-app
fdk run
```
Open a ticket on `pushpasoftwaresolutions.freshservice.com` with `?dev=true` appended to the URL.
Accept the local-asset prompt → the **UWorld Copilot** card appears **beside the ticket**.
Set the app's install param `backend_base_url` to your ngrok URL.

> Placement is `ticket_sidebar` (beside the ticket). To make it a top banner instead, change the
> location in `manifest.json` to `ticket_top_navigation`.

---

## Demo script

Use these mock customers (match by requester email on the ticket):

| Scenario | Requester email | What to type in the ticket | Result |
|---|---|---|---|
| Password reset | `fresh.customer@example.com` | "I forgot my password, please reset" | **Auto-resolve** → temp password emailed, ticket resolved |
| Refund — used sub | `used.customer@example.com` | "I want a refund" | **Auto-deny** → denial email with reason |
| Duplicate charge | `duplicate.customer@example.com` | "I was charged twice, duplicate charge" | **Auto-approve** → duplicate refunded |
| Cancel before activation | `notactivated.customer@example.com` | "please cancel subscription and refund" | **Auto-approve** → full refund |
| Account locked | `locked.customer@example.com` | "my account is locked, too many attempts" | **Auto-resolve** → unlocked + notified |
| Refund — borderline | `borderline.customer@example.com` | "refund, I barely used it" | **Agent review** → sidebar shows facts + steps |
| Billing dispute | any | "I'll file a chargeback and call my lawyer" | **Agent review** (safety: never auto-answered) |

For auto-send scenarios the customer gets an email + the ticket auto-resolves with a private note
`copilot-auto-sent`. For agent-review scenarios, open the ticket → the sidebar shows the UWorld DB
profile and suggested steps.

---

## Verify without Freshservice (pure backend)

```bash
# health
curl http://localhost:5090/health

# insights (what the sidebar shows)
curl "http://localhost:5090/api/insights?email=borderline.customer@example.com&subject=Refund&description=refund%20barely%20used"

# webhook (what the automation calls) — emailSent:false until a real API key is set
curl -X POST http://localhost:5090/webhook/ticket -H "Content-Type: application/json" \
  -d '{"ticketId":3,"subject":"Password reset","description":"I forgot my password","email":"fresh.customer@example.com"}'
```

---

## Browser demo UI (no Freshservice needed)

With the backend running, open:
- **`http://localhost:5090/demo.html`** — analyzer: pick/enter a customer, see the copilot decision
  (sidebar view) + Customer 360 tabs side by side.
- **`http://localhost:5090/users.html`** — directory of **all sample users** with their user /
  subscription / payment data **and the expected copilot decision** for each — handy for validating
  suggestions live during a demo. "Open in analyzer →" deep-links each user into demo.html.

Endpoint behind the directory: `GET /api/samples` → every demo user + their 360 data + expected
action/intent/confidence/reason.

## Customer 360 module (user + subscriptions + payments)

A separate data module shows the full customer record, opened from a **"View full records
(Customer 360)"** button in the sidebar. It renders a modal with three tabs:
- **User** — account profile (name, email, user ID, phone, country, status, member since).
- **Subscriptions** — every subscription with status badge, usage %, purchase/expiry, amount, auto-renew.
- **Payments** — full payment history table; duplicate charges are flagged.

Backend endpoint (read-only): `GET /api/customer/360?email=<email>` → `{ user, subscriptions[], payments[], totalPaid, activeSubscriptions }`.

```bash
curl "http://localhost:5090/api/customer/360?email=pushpabaivadithe522@gmail.com"
```

## Switching to the real UWorld DB (later)
1. Set `UWorldDb:UseMockData = false` and fill `UWorldDb:ConnectionString`.
2. Adjust the query/column mapping in `SqlUWorldDataService.GetCustomerByEmailAsync` (policy lookup)
   and `Sql360DataService.GetCustomer360Async` (the three user/subscriptions/payments queries) to
   your schema. Everything else (rules, endpoints, app) stays the same.

## Adding a new policy rule
Create a class implementing `IPolicyRule` in `backend/Services/Rules/RuleCatalog.cs` and register
it in `Program.cs` (order = priority, first match wins; keep `BillingDisputeRule` first).
