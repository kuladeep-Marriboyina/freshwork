// Ticket top-bar button: opens the full UWorld Copilot view in a large modal.
let client;

init();

async function init() {
  try {
    client = await app.initialized();
    client.events.on("app.activated", openCopilot);
    document.getElementById("openCopilot").onclick = openCopilot;
    // The large modal cannot open the reply/note editor itself, so it sends the
    // text here and this (non-modal) instance opens the editor.
    client.instance.receive(onModalMessage);
  } catch (e) {
    setMsg("Failed to initialize app: " + e.message);
  }
}

async function openCopilot() {
  try {
    const ticket = (await client.data.get("ticket")).ticket;
    const email = await requesterEmail(ticket);
    await client.interface.trigger("showModal", {
      title: "UWorld Copilot",
      template: "copilot.html",
      data: {
        email: email,
        ticket: {
          id: ticket.id,
          display_id: ticket.display_id,
          subject: ticket.subject,
          description: ticket.description,
          description_text: ticket.description_text
        }
      }
    });
    setMsg("");
  } catch (e) {
    setMsg("Could not open UWorld Copilot: " + ((e && e.message) || "unknown error"));
  }
}

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

function onModalMessage(event) {
  const data = (event && event.helper && event.helper.getData()) || {};
  const msg = data.message || data;
  if (msg && msg.action === "refreshTicket" && msg.id) {
    // reopen the current ticket so the new reply/note shows
    return client.interface.trigger("click", { id: "ticket", value: msg.id }).catch(() => null);
  }
  if (!msg || msg.action !== "openEditor") return Promise.resolve();
  const args = msg.id === "note"
    ? { id: "note", text: msg.text, isPublic: false }
    : { id: "reply", text: msg.text };
  // click opens the editor; if it is already open Freshdesk rejects the click, so
  // replace the open editor's text instead (same logic as putInEditor in app.js).
  const replace = () => client.interface.trigger("setValue", { id: "editor", text: msg.text, replace: true });
  return client.interface.trigger("click", args)
    .then(() => replace().catch(() => null), () => replace())
    .then(() => setMsg(""))
    .catch(e => setMsg("Could not open the editor: " + ((e && e.message) || "unknown error")));
}

function setMsg(text) { document.getElementById("msg").textContent = text; }
