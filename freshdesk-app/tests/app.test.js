import { loadBody, flush, ok, fail } from "./helpers.js";

const INSIGHTS = {
  customer: {
    email: "a@b.com", fullName: "Test User", subscriptionName: "Step 1 Qbank",
    subscriptionStatus: "Active", usagePercent: 78, purchaseDate: "2026-10-13",
    refundWindowDays: 14, isActivated: true, failedLoginAttempts: 0,
    hasDuplicateCharge: false, amountPaid: 319
  },
  intent: "refund", recommendedAction: 2, confidence: 0.93,
  reason: "Usage above <limit>", suggestedReplyHtml: "<p>Hello</p>",
  suggestedSteps: [{ order: 2, text: "Second" }, { order: 1, text: "First" }]
};

let client, activated, trigger, invoke;

function makeClient({ ticket, requester } = {}, invokeImpl) {
  activated = null;
  trigger = vi.fn(() => Promise.resolve());
  invoke = vi.fn(invokeImpl);
  client = {
    events: { on: vi.fn((name, cb) => { activated = cb; }) },
    data: {
      get: vi.fn(name => {
        if (name === "requester") {
          return requester instanceof Error ? Promise.reject(requester) : Promise.resolve(requester);
        }
        return Promise.resolve({
          ticket: ticket || {
            id: 3, subject: "Refund", description: "<p>I want a refund</p>",
            requester: { email: "a@b.com" }
          }
        });
      })
    },
    request: { invokeTemplate: invoke },
    interface: { trigger },
    instance: { resize: vi.fn() }
  };
  return client;
}

async function boot(opts, invokeImpl = () => ok(INSIGHTS)) {
  vi.resetModules();
  loadBody("template.html");
  makeClient(opts, invokeImpl);
  global.app = { initialized: vi.fn(() => Promise.resolve(client)) };
  await import("../app/scripts/app.js");
  await flush();
  await activated();
  await flush();
}

const $ = id => document.getElementById(id);
const lastCall = () => invoke.mock.calls.at(-1);

describe("sidebar app.js", () => {
  test("registers app.activated and renders insights via the getInsights template", async () => {
    await boot();
    expect(client.events.on).toHaveBeenCalledWith("app.activated", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("getInsights", {
      context: { email: "a@b.com", ticketId: "3", subject: "Refund", description: "I want a refund" }
    });
    expect($("content").style.display).toBe("");
    expect($("loading").style.display).toBe("none");
    expect($("decision").textContent).toContain("Auto-denied");
    expect($("decision").textContent).toContain("93%");
    expect($("decision").innerHTML).toContain("&lt;limit&gt;");
    expect($("profile").textContent).toContain("$319.00");
    expect($("replyBox").value).toBe("Hello");
    const items = [...$("steps").querySelectorAll("li")].map(li => li.firstChild.textContent);
    expect(items).toEqual(["First", "Second"]);
  });

  test("resizes the sidebar panel to fit the card, within 400-700px", async () => {
    await boot();
    expect(client.instance.resize).toHaveBeenCalled();
    const h = parseInt(client.instance.resize.mock.calls.at(-1)[0].height, 10);
    expect(h).toBeGreaterThanOrEqual(400);
    expect(h).toBeLessThanOrEqual(700);
  });

  test("keeps working when resize is not supported", async () => {
    await boot(undefined, () => fail(500));
    client.instance.resize.mockImplementation(() => { throw new Error("unsupported"); });
    await activated();
    await flush();
    expect($("error").textContent).toContain("Backend returned 500");
  });

  test("string action, missing customer fields and no steps", async () => {
    await boot(undefined, () => ok({ recommendedAction: "Unknown", intent: "x" }));
    expect($("decision").textContent).toContain("Needs your review");
    expect($("decision").textContent).toContain("0%");
    expect($("profile").textContent).toContain("—");
    expect($("steps-card").style.display).toBe("none");
  });

  test("uses ticket.email when requester has none", async () => {
    await boot({ ticket: { id: 9, email: "t@x.com" } });
    expect(invoke.mock.calls[0][1].context.email).toBe("t@x.com");
    expect(invoke.mock.calls[0][1].context.ticketId).toBe("9");
  });

  test("Freshservice ticket without email: falls back to the requester object", async () => {
    await boot({ ticket: { id: 3, requester_id: 42, subject: "Refund" }, requester: { requester: { email: "fs@x.com" } } });
    expect(client.data.get).toHaveBeenCalledWith("requester");
    expect(invoke.mock.calls[0][1].context.email).toBe("fs@x.com");

    await boot({ ticket: { id: 3 }, requester: { requester: { primary_email: "p@x.com" } } });
    expect(invoke.mock.calls[0][1].context.email).toBe("p@x.com");
  });

  test("no email anywhere: shows a clear error and makes no backend call", async () => {
    await boot({ ticket: { id: 3 }, requester: {} });
    expect(invoke).not.toHaveBeenCalledWith("getInsights", expect.anything());
    expect($("error").textContent).toContain("could not find the requester's email");

    await boot({ ticket: { id: 3 }, requester: new Error("unsupported") });
    expect(invoke).not.toHaveBeenCalledWith("getInsights", expect.anything());
    expect($("error").textContent).toContain("could not find the requester's email");

    await boot({ ticket: { id: 3 }, requester: { requester: {} } });
    expect($("error").textContent).toContain("could not find the requester's email");
  });

  test("accepts response bodies in any shape the host returns", async () => {
    await boot(undefined, () => Promise.resolve({ status: 200, response: INSIGHTS }));
    expect($("decision").textContent).toContain("Auto-denied");
    await boot(undefined, () => Promise.resolve({ status: 200, body: JSON.stringify(INSIGHTS) }));
    expect($("decision").textContent).toContain("Auto-denied");
    await boot(undefined, () => Promise.resolve({ data: INSIGHTS }));
    expect($("decision").textContent).toContain("Auto-denied");
    await boot(undefined, () => Promise.resolve(JSON.stringify(INSIGHTS)));
    expect($("decision").textContent).toContain("Auto-denied");
  });

  test("reports exactly what came back when there is no data", async () => {
    await boot(undefined, () => Promise.resolve({ status: 200, headers: {} }));
    expect($("error").textContent).toContain("no data in response (status 200, fields: status,headers)");
    await boot(undefined, () => Promise.resolve({}));
    expect($("error").textContent).toContain("status ?, fields: none");
    await boot(undefined, () => Promise.resolve({ status: 204, response: "  " }));
    expect($("error").textContent).toContain("status 204");
    await boot(undefined, () => Promise.resolve(undefined));
    expect($("error").textContent).toContain("empty response from Freshworks proxy");
  });

  test("load errors include a self-test of the host setting and /health", async () => {
    await boot(undefined, name => name === "getInsights" ? Promise.resolve({ attempts: 1 })
      : name === "pingConfigured" ? Promise.resolve({ attempts: 1 })
      : Promise.resolve({ status: 200, response: "{}" }));
    expect($("error").textContent).toContain("host setting: (not readable)");
    expect($("error").textContent).toContain("health via setting: no reply (attempts)");
    expect($("error").textContent).toContain("health via fixed host: HTTP 200");

    vi.resetModules();
    loadBody("template.html");
    makeClient(undefined, name => name === "getInsights" ? fail(500)
      : name === "pingConfigured" ? fail(401, "denied") : Promise.reject(null));
    client.iparams = { get: vi.fn(() => Promise.resolve({ backend_host: "x.devtunnels.ms" })) };
    global.app = { initialized: vi.fn(() => Promise.resolve(client)) };
    await import("../app/scripts/app.js");
    await flush(); await activated(); await flush(); await flush();
    expect($("error").textContent).toContain("host setting: x.devtunnels.ms");
    expect($("error").textContent).toContain("health via setting: failed HTTP 401 denied");
    expect($("error").textContent).toContain("health via fixed host: failed");

    client.iparams.get.mockResolvedValue({});
    client.request.invokeTemplate.mockImplementation(name => name === "getInsights" ? fail(500) : Promise.resolve(null));
    await activated(); await flush(); await flush();
    expect($("error").textContent).toContain("host setting: (empty)");
    expect($("error").textContent).toContain("no reply ()");
  });

  test("shows an error when the backend rejects the request", async () => {
    await boot(undefined, () => fail(401));
    expect($("error").textContent).toContain("Backend returned 401");
    expect($("content").style.display).toBe("none");
  });

  test("shows a message for errors without a status", async () => {
    await boot(undefined, () => Promise.reject(new Error("timeout")));
    expect($("error").textContent).toContain("timeout");
    await boot(undefined, () => Promise.reject(null));
    expect($("error").textContent).toContain("request failed");
    await boot(undefined, () => Promise.reject({}));
    expect($("error").textContent).toContain("request failed");
  });

  test("shows an error when init fails", async () => {
    vi.resetModules();
    loadBody("template.html");
    global.app = { initialized: vi.fn(() => Promise.reject(new Error("nope"))) };
    await import("../app/scripts/app.js");
    await flush();
    expect($("error").textContent).toContain("Failed to initialize app: nope");
  });

  test("Customer 360 opens the modal and reports failures", async () => {
    await boot();
    $("view360").click();
    expect(trigger).toHaveBeenCalledWith("showModal",
      expect.objectContaining({ template: "modal.html", data: { email: "a@b.com", userId: "" } }));
    trigger.mockImplementationOnce(() => Promise.reject(new Error("blocked")));
    $("view360").click();
    await flush();
    expect($("error").textContent).toContain("Could not open module: blocked");
  });

  test("insert into editor: opens Freshservice reply editor with the text", async () => {
    await boot();
    $("btnInsert").click();
    await flush();
    expect(trigger).toHaveBeenCalledWith("click", { id: "reply", text: "Hello" });
    expect(trigger).toHaveBeenCalledWith("setValue", { id: "editor", text: "Hello", replace: true });
    expect($("actionMsg").textContent).toBe("Inserted into the reply editor.");

    // second insert after editing replaces the open editor's text
    $("replyBox").value = "Edited reply";
    $("btnInsert").click();
    await flush(); await flush();
    expect(trigger).toHaveBeenLastCalledWith("setValue", { id: "editor", text: "Edited reply", replace: true });

    $("steps").querySelector("button").click();
    await flush();
    expect(trigger).toHaveBeenCalledWith("click", { id: "reply", text: "First" });
  });

  test("editor already open: click is rejected, text is replaced via setValue", async () => {
    await boot();
    trigger.mockImplementation(name => name === "click" ? Promise.reject(new Error("editor open")) : Promise.resolve());
    $("replyBox").value = "Second version";
    $("btnInsert").click();
    await flush(); await flush();
    expect(trigger).toHaveBeenLastCalledWith("setValue", { id: "editor", text: "Second version", replace: true });
    expect($("actionMsg").textContent).toBe("Inserted into the reply editor.");
  });

  test("insert still succeeds if setValue on the editor is refused", async () => {
    await boot();
    trigger.mockImplementation(name => name === "setValue" ? Promise.reject(new Error("no")) : Promise.resolve());
    $("btnInsert").click();
    await flush(); await flush();
    expect($("actionMsg").textContent).toBe("Inserted into the reply editor.");
  });

  test("insert into editor: clipboard fallback and failure", async () => {
    await boot();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    trigger.mockImplementation(() => Promise.reject(new Error("no editor")));
    $("btnInsert").click();
    await flush(); await flush(); await flush();
    expect(writeText).toHaveBeenCalledWith("Hello");
    expect($("actionMsg").textContent).toContain("Copied");

    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    $("btnInsert").click();
    await flush(); await flush(); await flush();
    expect($("actionMsg").textContent).toBe("Could not reach the reply editor.");
    expect($("actionMsg").className).toContain("uw-err-msg");
  });

  test("uses the ticket number (display_id) for actions", async () => {
    await boot({ ticket: { id: 30004514124, display_id: 3, requester: { email: "a@b.com" } } });
    $("noteBox").value = "x";
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnNote").onclick();
    expect(lastCall()[1].context).toEqual({ ticketId: "3" });
  });

  test("send reply: empty, success with resolve, and failure", async () => {
    await boot();
    $("replyBox").value = "  ";
    await $("btnSend").onclick();
    expect($("actionMsg").textContent).toBe("Reply is empty.");

    $("replyBox").value = "Line1\nLine2\n\nPara <2>";
    $("resolveToo").checked = true;
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnSend").onclick();
    const [name, opts] = lastCall();
    expect(name).toBe("postReply");
    expect(opts.context).toEqual({ ticketId: "3" });
    expect(JSON.parse(opts.body)).toEqual({ html: "<p>Line1<br/>Line2</p><p>Para &lt;2&gt;</p>", resolve: true });
    expect($("actionMsg").textContent).toBe("Reply sent and ticket resolved.");
    expect($("btnSend").disabled).toBe(false);

    $("resolveToo").checked = false;
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnSend").onclick();
    expect($("actionMsg").textContent).toBe("Reply sent to customer.");

    invoke.mockImplementationOnce(() => fail(502));
    await $("btnSend").onclick();
    expect($("actionMsg").textContent).toBe("Send failed: Backend returned 502");
  });

  test("add note: empty, success, and failure", async () => {
    await boot();
    await $("btnNote").onclick();
    expect($("actionMsg").textContent).toBe("Note is empty.");

    $("noteBox").value = "internal";
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnNote").onclick();
    expect(lastCall()[0]).toBe("postNote");
    expect(lastCall()[1].context).toEqual({ ticketId: "3" });
    expect($("actionMsg").textContent).toBe("Private note added.");
    expect($("noteBox").value).toBe("");

    $("noteBox").value = "again";
    invoke.mockImplementationOnce(() => fail(502));
    await $("btnNote").onclick();
    await flush();
    expect(trigger).toHaveBeenCalledWith("click", { id: "note", text: "again", isPublic: false });
    expect($("actionMsg").textContent).toBe("Inserted into the note editor.");
  });

  test("Freshdesk: email comes from the contact object when requester has none", async () => {
    await boot({ ticket: { id: 5 }, requester: { requester: {} } });
    client.data.get.mockImplementation(name => {
      if (name === "requester") return Promise.resolve({ requester: {} });
      if (name === "contact") return Promise.resolve({ contact: { email: "c@x.com" } });
      return Promise.resolve({ ticket: { id: 5, subject: "s" } });
    });
    invoke.mockClear();
    await activated();
    await flush();
    expect(invoke.mock.calls[0][1].context.email).toBe("c@x.com");
  });

  test("after a successful reply or note, the ticket page is reloaded", async () => {
    await boot({ ticket: { id: 4, requester: { email: "a@b.com" } } });
    $("replyBox").value = "hi";
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnSend").onclick();
    expect(trigger).toHaveBeenCalledWith("click", { id: "ticket", value: 4 });

    trigger.mockClear();
    $("noteBox").value = "n";
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnNote").onclick();
    expect(trigger).toHaveBeenCalledWith("click", { id: "ticket", value: 4 });

    trigger.mockClear();
    invoke.mockImplementationOnce(() => fail(502));
    await $("btnSend").onclick();
    expect(trigger).not.toHaveBeenCalledWith("click", { id: "ticket", value: 4 });

    trigger.mockImplementation(() => Promise.reject(new Error("nav blocked")));
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnSend").onclick();
    expect($("actionMsg").textContent).toBe("Reply sent to customer.");
  });

  test("reply and note need a ticket in context", async () => {
    await boot({ ticket: { id: null, email: "t@x.com" } });
    $("replyBox").value = "hi";
    await $("btnSend").onclick();
    expect($("actionMsg").textContent).toBe("No ticket in context.");
    $("noteBox").value = "hi";
    await $("btnNote").onclick();
    expect($("actionMsg").textContent).toBe("No ticket in context.");
  });
});
