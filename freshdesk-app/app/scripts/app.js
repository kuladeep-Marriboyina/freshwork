let client;
let currentEmail = "";
let currentTicketId = null;
let backendBase = "";

const ACTION_META = {
  AutoResolve:  { label: "Auto-resolved",         cls: "uw-auto",   note: "Handled automatically — reply sent." },
  AutoApprove:  { label: "Auto-approved",         cls: "uw-auto",   note: "Handled automatically — reply sent." },
  AutoDeny:     { label: "Auto-denied (policy)",  cls: "uw-deny",   note: "Denial sent automatically per policy." },
  AgentReview:  { label: "Needs your review",     cls: "uw-review", note: "Low confidence — please decide using the info below." }
};

init();

async function init() {
  try {
    client = await app.initialized();
    client.events.on("app.activated", render);
  } catch (e) {
    showError("Failed to initialize app: " + e.message);
  }
}

async function render() {
  try {
    const ticketData = await client.data.get("ticket");
    const ticket = ticketData.ticket;

    const email =
      ticket.requester && (ticket.requester.email || ticket.email)
        ? (ticket.requester.email || ticket.email)
        : (ticket.email || "");

    currentEmail = email;
    currentTicketId = ticket.id;

    const iparams = await client.iparams.get();
    const base = (iparams.backend_base_url || "").replace(/\/+$/, "");
    backendBase = base;

    const qs = new URLSearchParams({
      email: email,
      ticketId: String(ticket.id || ""),
      subject: ticket.subject || "",
      description: stripHtml(ticket.description || ticket.description_text || "")
    });

    const resp = await fetch(`${base}/api/insights?${qs.toString()}`, {
      headers: { "Accept": "application/json" }
    });
    if (!resp.ok) throw new Error("Backend returned " + resp.status);
    const data = await resp.json();

    paint(data);
  } catch (e) {
    showError("Could not load insights: " + e.message);
  }
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
  decision.innerHTML =
    `<div class="uw-decision-label">${meta.label}</div>` +
    `<div class="uw-decision-sub">Intent: <b>${escapeHtml(data.intent)}</b> · ` +
    `Confidence: <b>${Math.round((data.confidence || 0) * 100)}%</b></div>` +
    `<div class="uw-decision-reason">${escapeHtml(data.reason || "")}</div>` +
    `<div class="uw-decision-note">${meta.note}</div>`;

  const btn = document.getElementById("view360");
  if (btn) btn.onclick = openCustomer360;

  // Prefill the reply box with the suggested reply and wire the action buttons.
  const replyBox = document.getElementById("replyBox");
  if (replyBox) replyBox.value = stripHtml(data.suggestedReplyHtml || "");
  document.getElementById("btnInsert").onclick = () => insertIntoReply(document.getElementById("replyBox").value);
  document.getElementById("btnSend").onclick = sendReply;
  document.getElementById("btnNote").onclick = addNote;

  const c = data.customer || {};
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
    kv("Amount paid", c.amountPaid != null ? "$" + Number(c.amountPaid).toFixed(2) : "—")
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
}

function openCustomer360() {
  client.interface.trigger("showModal", {
    title: "UWorld Customer 360",
    template: "modal.html",
    data: { email: currentEmail }
  }).catch(e => showError("Could not open module: " + e.message));
}

function insertIntoReply(text) {
  // Pushes text into Freshservice's own reply editor (agent clicks Send).
  client.interface.trigger("setValue", { id: "cliReplyEditor", text: text })
    .then(() => flash("Inserted into the reply editor.", false))
    .catch(() => client.interface.trigger("click", { id: "reply" })
      .then(() => flash("Opened the reply editor — paste your text.", false))
      .catch(() => flash("Could not reach the reply editor.", true)));
}

async function sendReply() {
  const text = document.getElementById("replyBox").value.trim();
  if (!text) return flash("Reply is empty.", true);
  if (!currentTicketId) return flash("No ticket in context.", true);
  const resolve = document.getElementById("resolveToo").checked;
  busy("btnSend", true);
  try {
    const resp = await fetch(`${backendBase}/api/ticket/${currentTicketId}/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: toHtml(text), resolve })
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    flash(resolve ? "Reply sent and ticket resolved." : "Reply sent to customer.", false);
  } catch (e) { flash("Send failed: " + e.message, true); }
  finally { busy("btnSend", false); }
}

async function addNote() {
  const text = document.getElementById("noteBox").value.trim();
  if (!text) return flash("Note is empty.", true);
  if (!currentTicketId) return flash("No ticket in context.", true);
  busy("btnNote", true);
  try {
    const resp = await fetch(`${backendBase}/api/ticket/${currentTicketId}/note`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: toHtml(text) })
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    flash("Private note added.", false);
    document.getElementById("noteBox").value = "";
  } catch (e) { flash("Note failed: " + e.message, true); }
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
         `<span class="uw-v">${escapeHtml(v == null || v === "" ? "—" : String(v))}</span></div>`;
}
function stripHtml(s) { const d = document.createElement("div"); d.innerHTML = s; return d.textContent || ""; }
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
function show(id) { document.getElementById(id).style.display = ""; }
function hide(id) { document.getElementById(id).style.display = "none"; }
function showError(msg) { hide("loading"); hide("content"); const e = document.getElementById("error"); e.style.display = ""; e.textContent = msg; }
