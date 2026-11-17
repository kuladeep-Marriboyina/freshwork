// Global CTI sidebar: look up any UWorld customer by email from any Freshservice page
// (e.g. while on a call), with an optional policy decision for what they are asking.
let client;

const ACTIONS = {
  AutoResolve: ["Auto-resolved", "uw-auto"],
  AutoApprove: ["Auto-approved", "uw-auto"],
  AutoDeny: ["Auto-denied (policy)", "uw-deny"],
  AgentReview: ["Needs your review", "uw-review"]
};

init();

async function init() {
  try {
    client = await app.initialized();
    document.getElementById("lookupForm").onsubmit = onSubmit;
  } catch (e) {
    showError("Failed to initialize app: " + e.message);
  }
}

function onSubmit(ev) {
  if (ev) ev.preventDefault();
  return lookup(
    document.getElementById("email").value.trim(),
    document.getElementById("ask").value.trim()
  );
}

async function lookup(email, ask) {
  if (!email) return showError("Enter the customer's email.");
  hide("c-error"); hide("c-result"); show("c-loading");
  try {
    const c360 = parseBody(await client.request.invokeTemplate("getCustomer360", { context: { email: email, userId: "" } }));
    let decision = null;
    if (ask) {
      decision = parseBody(await client.request.invokeTemplate("getInsights", {
        context: { email: email, ticketId: "", subject: ask, description: ask }
      }));
    }
    paint(c360, decision);
  } catch (e) {
    const status = e && e.status;
    showError(status === 404 ? "No UWorld customer found for " + email + "."
      : "Lookup failed: " + (status ? "Backend returned " + status : (e && e.message) || "request failed"));
  }
}

function paint(d, decision) {
  hide("c-loading");
  show("c-result");

  const box = document.getElementById("c-decision");
  if (decision) {
    const key = typeof decision.recommendedAction === "string"
      ? decision.recommendedAction
      : Object.keys(ACTIONS)[decision.recommendedAction];
    const [label, cls] = ACTIONS[key] || ACTIONS.AgentReview;
    box.className = "uw-decision " + cls;
    box.innerHTML =
      `<div class="uw-decision-label">${label}</div>` +
      `<div class="uw-decision-sub">Intent: <b>${esc(decision.intent)}</b> · ` +
      `Confidence: <b>${Math.round((decision.confidence || 0) * 100)}%</b></div>` +
      `<div class="uw-decision-reason">${esc(decision.reason || "")}</div>`;
    box.style.display = "";
  } else {
    box.style.display = "none";
  }

  const u = d.user || {};
  document.getElementById("c-user").innerHTML =
    `<div class="uw-card-title">Customer</div>` +
    row("Name", u.fullName) + row("Email", u.email) + row("User ID", u.userId) +
    row("Account status", u.accountStatus) + row("Failed logins", u.failedLoginAttempts) +
    row("Active subscriptions", d.activeSubscriptions ?? 0) +
    row("Total paid", "$" + Number(d.totalPaid || 0).toFixed(2));

  const subs = d.subscriptions || [];
  document.getElementById("c-subs").innerHTML = subs.length
    ? `<div class="uw-card"><div class="uw-card-title">Subscriptions</div>` +
      subs.map(s => row(s.name, `${s.status || ""} · ${s.usagePercent ?? 0}% used`)).join("") + `</div>`
    : `<div class="uw-card uw-muted">No subscriptions on record.</div>`;

  const pays = d.payments || [];
  document.getElementById("c-pay").innerHTML = pays.length
    ? `<div class="uw-card"><div class="uw-card-title">Payments</div>` +
      pays.map(p => row(`${p.date || ""}${p.isDuplicate ? " (duplicate)" : ""}`,
        "$" + Number(p.amount || 0).toFixed(2) + " · " + (p.status || ""))).join("") + `</div>`
    : `<div class="uw-card uw-muted">No payments on record.</div>`;
}

function row(k, v) {
  return `<div class="uw-row"><span class="uw-k">${esc(k)}</span>` +
         `<span class="uw-v">${esc(v === null || v === undefined || v === "" ? "—" : String(v))}</span></div>`;
}
function esc(s) { const d = document.createElement("div"); d.textContent = (s === null || s === undefined) ? "" : String(s); return d.innerHTML; }
function show(id) { document.getElementById(id).style.display = ""; }
function hide(id) { document.getElementById(id).style.display = "none"; }
function showError(m) { hide("c-loading"); const e = document.getElementById("c-error"); e.style.display = ""; e.textContent = m; }

// Accept the request-template response in any shape the host returns
// (see parseBody in app.js).
function parseBody(resp) {
  if (resp === null || resp === undefined) throw new Error("empty response from Freshworks proxy");
  if (typeof resp === "string") return JSON.parse(resp);
  const body = resp.response !== undefined ? resp.response
    : resp.body !== undefined ? resp.body : resp.data;
  if (body !== null && typeof body === "object") return body;
  if (typeof body === "string" && body.trim()) return JSON.parse(body);
  throw new Error("no data in response (status " + (resp.status === undefined ? "?" : resp.status) +
    ", fields: " + (Object.keys(resp).join(",") || "none") + ")");
}
