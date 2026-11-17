let client;
let currentEmail = "";
let currentUserId = ""; // which UWorld user (several can share an email)
let currentTicketId = null;

const ACTION_META = {
  AutoResolve:  { label: "Auto-resolved",         cls: "uw-auto",   note: "Handled automatically — reply sent." },
  AutoApprove:  { label: "Auto-approved",         cls: "uw-auto",   note: "Handled automatically — reply sent." },
  AutoDeny:     { label: "Auto-denied (policy)",  cls: "uw-deny",   note: "Denial sent automatically per policy." },
  AgentReview:  { label: "Need your review",      cls: "uw-review", note: "Low confidence — please decide using the info below." }
};

init();

async function init() {
  try {
    client = await app.initialized();
    // Large modal view (opened from the top-bar button) renders immediately;
    // the sidebar card renders when the agent opens it.
    if (isModal()) {
      const closeBtn = document.getElementById("btnClose");
      if (closeBtn) closeBtn.onclick = () => client.instance.close();
      render();
    } else {
      client.events.on("app.activated", render);
    }
  } catch (e) {
    showError("Failed to initialize app: " + e.message);
  }
}

async function render() {
  try {
    const passed = isModal() ? await modalData() : null;
    const ticket = passed && passed.ticket ? passed.ticket : (await client.data.get("ticket")).ticket;

    const email = (passed && passed.email) || await requesterEmail(ticket);
    if (!email) throw new Error("could not find the requester's email on this ticket");

    currentEmail = email;
    // Freshservice's REST API addresses tickets by their number (display_id, e.g. 3),
    // not the internal id (e.g. 30004514124).
    currentTicketId = ticket.display_id || ticket.id;

    // Goes through Freshworks request templates (config/requests.json): the
    // backend host and the secret key stay in the app's settings, not the browser.
    const resp = await client.request.invokeTemplate("getInsights", {
      context: {
        email: email,
        ticketId: String(ticket.id || ""),
        subject: ticket.subject || "",
        description: stripHtml(ticket.description || ticket.description_text || "")
      }
    });
    paint(parseBody(resp));
  } catch (e) {
    showError("Could not load insights: " + errMsg(e));
    showError("Could not load insights: " + errMsg(e) + " | " + await diagnose());
  }
}

// Self-test shown with load errors: which host the app read from its settings, and
// whether Freshworks can reach the backend's /health via that setting and via the
// tunnel host written directly into the app.
async function diagnose() {
  let host = "?";
  try { host = ((await client.iparams.get()) || {}).backend_host || "(empty)"; } catch { host = "(not readable)"; }
  const ping = async name => {
    try {
      const r = await client.request.invokeTemplate(name, {});
      return r && r.status ? "HTTP " + r.status : "no reply (" + Object.keys(r || {}).join(",") + ")";
    } catch (err) {
      return "failed" + (err && err.status ? " HTTP " + err.status : "") + (err && err.message ? " " + err.message : "");
    }
  };
  return "host setting: " + host + " | health via setting: " + await ping("pingConfigured") +
         " | health via fixed host: " + await ping("pingFixedHost");
}

// Request-template responses are { status, headers, response: "<json text>" }, but
// hosts differ slightly; accept a parsed object or text in response/body/data, and
// otherwise report what actually came back.
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

function isModal() { return document.body.getAttribute("data-mode") === "modal"; }

// Data handed over by the top-bar button through showModal({ data }).
async function modalData() {
  try {
    const ctx = await client.instance.context();
    return (ctx && ctx.data) || null;
  } catch {
    return null;
  }
}

// The ticket object carries only requester_id, so read the email from the
// "requester" data object, then the "contact" object (Freshdesk data methods).
async function requesterEmail(ticket) {
  const direct = (ticket.requester && ticket.requester.email) || ticket.email || ticket.requester_email;
  if (direct) return direct;
  for (const name of ["requester", "contact"]) {
    try {
      const r = ((await client.data.get(name)) || {})[name] || {};
      const email = r.email || r.primary_email;
      if (email) return email;
    } catch {
      // object not available on this page — try the next one
    }
  }
  return "";
}

function errMsg(e) {
  if (!e) return "request failed";
  if (e.status) return "Backend returned " + e.status;
  return e.message || "request failed";
}

function paint(data) {
  hide("loading");
  hide("error");
  show("content");

  const actionKey = typeof data.recommendedAction === "string"
    ? data.recommendedAction
    : ["AutoResolve", "AutoApprove", "AutoDeny", "AgentReview"][data.recommendedAction];
  const meta = ACTION_META[actionKey] || ACTION_META.AgentReview;

  const decision = document.getElementById("decision");
  decision.className = "uw-decision " + meta.cls;
  const pct = Math.round((data.confidence || 0) * 100) + "%";
  // Every banner: just the decision and the confidence — details are in the card below.
  decision.innerHTML = `<div class="uw-decision-label">${meta.label} · Confidence: ${pct}</div>`;

  const btn = document.getElementById("view360");
  // A modal cannot open another modal, so Customer 360 stays in the sidebar card.
  if (btn && isModal()) btn.style.display = "none";
  else if (btn) btn.onclick = openCustomer360;

  // Prefill the reply box with the suggested reply and wire the action buttons.
  const replyBox = document.getElementById("replyBox");
  if (replyBox) replyBox.value = stripHtml(data.suggestedReplyHtml || "");
  document.getElementById("btnInsert").onclick = () => insertIntoReply(document.getElementById("replyBox").value);
  document.getElementById("btnSend").onclick = sendReply;
  document.getElementById("btnNote").onclick = addNote;

  const c = data.customer || {};
  currentUserId = c.userId ? String(c.userId) : "";
  const profile = document.getElementById("profile");
  profile.innerHTML = [
    kv("Name", c.fullName),
    kv("Email", c.email),
    kv("Subscription", c.subscriptionName),
    kv("Status", c.subscriptionStatus),
    kv("Usage", (c.usagePercent ?? 0) + "%"),
    kv("Purchased", c.purchaseDate),
    kv("Refund window", (c.refundWindowDays ?? 0) + " days"),
    kv("Activated", c.isActivated ? "Yes" : "No"),
    kv("Failed logins", c.failedLoginAttempts),
    kv("Duplicate charge", c.hasDuplicateCharge ? "Yes" : "No"),
    kv("Amount paid", (c.amountPaid !== null && c.amountPaid !== undefined) ? "$" + Number(c.amountPaid).toFixed(2) : "—")
  ].join("");

  const steps = data.suggestedSteps || [];
  if (steps.length) {
    show("steps-card");
    const ol = document.getElementById("steps");
    ol.innerHTML = "";
    steps
      .sort((a, b) => a.order - b.order)
      .forEach(s => {
        const li = document.createElement("li");
        li.textContent = s.text;
        const btn = document.createElement("button");
        btn.className = "uw-copy";
        btn.textContent = "Insert";
        btn.onclick = () => insertIntoReply(s.text);
        li.appendChild(btn);
        ol.appendChild(li);
      });
  } else {
    hide("steps-card");
  }
  if (isModal()) load360(c.email || currentEmail);
  fitToContent();
}

// ── Inline Customer 360 (large modal only) ───────────────────────────────────
async function load360(email) {
  const card = document.getElementById("c360-card");
  if (!card) return;
  card.style.display = "";
  wire360Tabs();
  try {
    const resp = await client.request.invokeTemplate("getCustomer360", { context: { email: email, userId: currentUserId } });
    paint360(parseBody(resp));
  } catch (e) {
    const msg = document.getElementById("c360-msg");
    msg.style.display = "";
    msg.textContent = e && e.status === 404
      ? "No full UWorld records found for this customer."
      : "Customer 360 not available: " + errMsg(e);
  }
}

function paint360(d) {
  const u = d.user || {};
  document.getElementById("c360-user").innerHTML =
    kv("Name", u.fullName) + kv("Email", u.email) + kv("User ID", u.userId) + kv("Phone", u.phone) +
    kv("Country", u.country) + kv("Account status", u.accountStatus) + kv("Member since", u.memberSince) +
    kv("Failed logins", u.failedLoginAttempts) + kv("Active subscriptions", d.activeSubscriptions ?? 0) +
    kv("Total paid", "$" + Number(d.totalPaid || 0).toFixed(2));

  const subs = d.subscriptions || [];
  document.getElementById("c360-subs").innerHTML = subs.length
    ? subs.map(s =>
        `<div class="uw-sub"><div class="uw-sub-title">${escapeHtml(s.name)} · ${escapeHtml(s.status)}</div>` +
        kv("Usage", (s.usagePercent ?? 0) + "%") + kv("Purchased", s.purchaseDate) + kv("Expires", s.expiryDate) +
        kv("Amount paid", "$" + Number(s.amountPaid || 0).toFixed(2)) + kv("Activated", s.isActivated ? "Yes" : "No") +
        kv("Auto-renew", s.autoRenew ? "On" : "Off") + `</div>`).join("")
    : `<div class="uw-muted">No subscriptions on record.</div>`;

  const pays = d.payments || [];
  document.getElementById("c360-pay").innerHTML = pays.length
    ? pays.map(p => kv(`${p.date || ""} · ${p.paymentId || ""}${p.isDuplicate ? " (duplicate)" : ""}`,
        "$" + Number(p.amount || 0).toFixed(2) + " · " + (p.method || "") + " · " + (p.status || ""))).join("")
    : `<div class="uw-muted">No payments on record.</div>`;
}

function wire360Tabs() {
  document.querySelectorAll(".c360-tab").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".c360-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".c360-pane").forEach(p => { p.style.display = "none"; });
      document.getElementById(btn.dataset.pane).style.display = "";
    };
  });
}

// Grow the sidebar panel to fit the card (Freshservice caps the height), so the
// agent sees the decision and customer details without an inner scrollbar.
function fitToContent() {
  if (isModal()) return; // the modal is sized by Freshservice
  const root = document.getElementById("app");
  const height = Math.min(Math.max(root ? root.scrollHeight + 24 : 0, 400), 700);
  try {
    client.instance.resize({ height: height + "px" });
  } catch {
    // resize not available (older host) — keep the default size
  }
}

function openCustomer360() {
  client.interface.trigger("showModal", {
    title: "UWorld Customer 360",
    template: "modal.html",
    data: { email: currentEmail, userId: currentUserId }
  }).catch(e => showError("Could not open module: " + e.message));
}

// Opens Freshdesk's own reply editor with the text filled in (agent clicks Send).
// Freshdesk ticket-page click ids (App SDK v3.0 interface methods):
//   "reply" = Reply editor { text }, "note" = Add note editor { text, isPublic }.
// If the host refuses (e.g. inside a modal), copy the text so the agent can paste it.
function insertIntoReply(text) {
  return openEditor("reply", text, "reply");
}

function openEditor(id, text, label) {
  // Inside the large modal, Freshdesk does not allow interface methods. Hand the
  // text to the top-bar instance that opened the modal (topnav.js), which puts it
  // in the editor. The modal stays open so the agent can keep editing.
  if (isModal()) {
    try {
      client.instance.send({ message: { action: "openEditor", id: id, text: text } });
      flash("Inserted into the " + label + " editor.", false);
      return Promise.resolve();
    } catch {
      // messaging unavailable — fall through to the normal path / clipboard
    }
  }
  return putInEditor(client, id, text)
    .then(() => flash("Inserted into the " + label + " editor.", false))
    .catch(() => copyText(text)
      .then(() => flash("Copied — open the " + label + " editor and press Ctrl+V.", false))
      .catch(() => flash("Could not reach the " + label + " editor.", true)));
}

// "click" opens the reply/note editor with the text. When that editor is already
// open, Freshdesk rejects (or ignores) the click, so we always follow up with
// setValue(replace) on the open editor:
//   click ok    -> setValue is best effort (editor just opened with the text)
//   click fails -> setValue must succeed (editor already open: replace its text)
function putInEditor(c, id, text) {
  const args = id === "note"
    ? { id: "note", text: text, isPublic: false } // copilot notes are internal
    : { id: "reply", text: text };
  const replace = () => c.interface.trigger("setValue", { id: "editor", text: text, replace: true });
  return c.interface.trigger("click", args)
    .then(() => replace().catch(() => null), () => replace());
}

// Reload the ticket page so the new reply/note and status show (Freshdesk does not
// refresh by itself). Freshdesk's click "ticket" opens a ticket's page; opening the
// current one re-renders it. From the modal, ask the top-bar instance to do it.
function refreshTicket() {
  const id = Number(currentTicketId);
  if (!id) return Promise.resolve();
  if (isModal()) {
    try {
      client.instance.send({ message: { action: "refreshTicket", id: id } });
    } catch {
      // messaging unavailable — the agent can press F5
    }
    return Promise.resolve();
  }
  return client.interface.trigger("click", { id: "ticket", value: id }).catch(() => null);
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("clipboard unavailable"));
}

async function sendReply() {
  const text = document.getElementById("replyBox").value.trim();
  if (!text) return flash("Reply is empty.", true);
  if (!currentTicketId) return flash("No ticket in context.", true);
  const resolve = document.getElementById("resolveToo").checked;
  busy("btnSend", true);
  try {
    await client.request.invokeTemplate("postReply", {
      context: { ticketId: String(currentTicketId) },
      body: JSON.stringify({ html: toHtml(text), resolve })
    });
    flash(resolve ? "Reply sent and ticket resolved." : "Reply sent to customer.", false);
    refreshTicket();
  } catch (e) { flash("Send failed: " + errMsg(e), true); }
  finally { busy("btnSend", false); }
}

async function addNote() {
  const text = document.getElementById("noteBox").value.trim();
  if (!text) return flash("Note is empty.", true);
  if (!currentTicketId) return flash("No ticket in context.", true);
  busy("btnNote", true);
  try {
    await client.request.invokeTemplate("postNote", {
      context: { ticketId: String(currentTicketId) },
      body: JSON.stringify({ html: toHtml(text) })
    });
    flash("Private note added.", false);
    document.getElementById("noteBox").value = "";
    refreshTicket();
  } catch (e) {
    // Backend could not post it (e.g. no Freshservice API key) — open
    // Freshservice's own note editor with the text so the agent can save it.
    flash("Note failed: " + errMsg(e) + " — opening the note editor instead.", true);
    await openEditor("note", text, "note");
  }
  finally { busy("btnNote", false); }
}

function toHtml(text) {
  return text.split(/\n{2,}/).map(p => "<p>" + escapeHtml(p).replace(/\n/g, "<br/>") + "</p>").join("");
}
function flash(msg, isError) {
  const el = document.getElementById("actionMsg");
  el.style.display = ""; el.textContent = msg;
  el.className = "uw-actionmsg " + (isError ? "uw-err-msg" : "uw-ok-msg");
}
function busy(id, on) { const b = document.getElementById(id); if (b) { b.disabled = on; b.style.opacity = on ? ".6" : "1"; } }

// ── helpers ──────────────────────────────────────────────────────────────────
function kv(k, v) {
  return `<div class="uw-row"><span class="uw-k">${escapeHtml(k)}</span>` +
         `<span class="uw-v">${escapeHtml(v === null || v === undefined || v === "" ? "—" : String(v))}</span></div>`;
}
function stripHtml(s) { const d = document.createElement("div"); d.innerHTML = s; return d.textContent || ""; }
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = (s === null || s === undefined) ? "" : String(s); return d.innerHTML; }
function show(id) { document.getElementById(id).style.display = ""; }
function hide(id) { document.getElementById(id).style.display = "none"; }
function showError(msg) {
  hide("loading"); hide("content");
  const e = document.getElementById("error"); e.style.display = ""; e.textContent = msg;
  if (client) fitToContent();
}
