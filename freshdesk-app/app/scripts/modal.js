let client;

init();

async function init() {
  try {
    client = await app.initialized();
    wireClose();
    const ctx = await client.instance.context();
    const email = (ctx && ctx.data && ctx.data.email) || "";
    const userId = (ctx && ctx.data && ctx.data.userId) || "";
    wireTabs();
    await load(email, userId);
  } catch (e) {
    showError("Init failed: " + e.message);
  }
}

async function load(email, userId) {
  try {
    const resp = await client.request.invokeTemplate("getCustomer360", { context: { email: email, userId: userId || "" } });
    paint(parseBody(resp));
  } catch (e) {
    showError("Could not load records: " + (e && e.status ? "Backend returned " + e.status : (e && e.message) || "request failed"));
  }
}

function paint(d) {
  hide("m-loading"); hide("m-error");
  const u = d.user || {};

  document.getElementById("tab-user").innerHTML = `
    <div class="uw-card">
      <div class="uw-card-title">User account</div>
      ${row("Name", u.fullName)}
      ${row("Email", u.email)}
      ${row("User ID", u.userId)}
      ${row("Phone", u.phone)}
      ${row("Country", u.country)}
      ${row("Account status", u.accountStatus)}
      ${row("Member since", u.memberSince)}
      ${row("Failed logins", u.failedLoginAttempts)}
    </div>
    <div class="uw-summary">
      <span>Active subscriptions: <b>${d.activeSubscriptions ?? 0}</b></span>
      <span>Total paid: <b>$${Number(d.totalPaid || 0).toFixed(2)}</b></span>
    </div>`;

  const subs = d.subscriptions || [];
  document.getElementById("tab-subs").innerHTML = subs.length
    ? subs.map(s => `
      <div class="uw-card">
        <div class="uw-card-title">${esc(s.name)} <span class="uw-badge ${badge(s.status)}">${esc(s.status)}</span></div>
        ${row("Usage", (s.usagePercent ?? 0) + "%")}
        ${row("Purchased", s.purchaseDate)}
        ${row("Expires", s.expiryDate)}
        ${row("Amount paid", "$" + Number(s.amountPaid || 0).toFixed(2))}
        ${row("Activated", s.isActivated ? "Yes" : "No")}
        ${row("Auto-renew", s.autoRenew ? "On" : "Off")}
      </div>`).join("")
    : emptyCard("No subscriptions on record.");

  const pays = d.payments || [];
  document.getElementById("tab-pay").innerHTML = pays.length
    ? `<div class="uw-card"><div class="uw-card-title">Payment history</div>
        <table class="uw-table">
          <thead><tr><th>Date</th><th>Ref</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
          <tbody>${pays.map(p => `
            <tr class="${p.isDuplicate ? "uw-dup" : ""}">
              <td>${esc(p.date)}</td>
              <td>${esc(p.paymentId)}${p.isDuplicate ? ' <span class="uw-badge uw-b-red">dup</span>' : ""}</td>
              <td>$${Number(p.amount || 0).toFixed(2)}</td>
              <td>${esc(p.method)}</td>
              <td>${esc(p.status)}</td>
            </tr>`).join("")}</tbody>
        </table></div>`
    : emptyCard("No payments on record.");
}

// Close this popup (Freshworks instance API).
function wireClose() {
  const btn = document.getElementById("btnClose");
  if (btn) btn.onclick = () => client.instance.close();
}

function wireTabs() {
  const map = { user: "tab-user", subs: "tab-subs", pay: "tab-pay" };
  document.querySelectorAll(".uw-tab").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".uw-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      Object.values(map).forEach(id => hide(id));
      show(map[btn.dataset.tab]);
    };
  });
}

function row(k, v) {
  return `<div class="uw-row"><span class="uw-k">${esc(k)}</span>` +
         `<span class="uw-v">${esc(v === null || v === undefined || v === "" ? "—" : String(v))}</span></div>`;
}
function emptyCard(msg) { return `<div class="uw-card uw-muted">${esc(msg)}</div>`; }
function badge(status) {
  const s = (status || "").toLowerCase();
  return s === "active" ? "uw-b-green" : s === "expired" ? "uw-b-red" : "uw-b-grey";
}
function esc(s) { const d = document.createElement("div"); d.textContent = (s === null || s === undefined) ? "" : String(s); return d.innerHTML; }
function show(id) { document.getElementById(id).style.display = ""; }
function hide(id) { document.getElementById(id).style.display = "none"; }
function showError(m) { hide("m-loading"); const e = document.getElementById("m-error"); e.style.display = ""; e.textContent = m; }

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
