import { loadBody, flush, ok } from "./helpers.js";

const INSIGHTS = {
  customer: { email: "a@b.com", fullName: "Test User", amountPaid: 10 },
  intent: "refund", recommendedAction: "AutoDeny", confidence: 0.9, reason: "policy",
  suggestedReplyHtml: "<p>Hi</p>", suggestedSteps: []
};

const C360 = {
  user: { fullName: "Test User", email: "a@b.com", userId: 7 }, activeSubscriptions: 1, totalPaid: 319,
  subscriptions: [{ name: "Qbank", status: "Active", usagePercent: 78, amountPaid: 319, isActivated: true, autoRenew: true }, { name: "Old", status: "Expired" }],
  payments: [{ date: "2026-10-13", paymentId: "P1", amount: 319, method: "Card", status: "Paid" }, { isDuplicate: true }]
};

async function bootModal(context) {
  vi.resetModules();
  loadBody("copilot.html");
  const invoke = vi.fn(name => ok(name === "getCustomer360" ? C360 : INSIGHTS));
  const client = {
    events: { on: vi.fn() },
    data: { get: vi.fn(() => Promise.resolve({ ticket: { id: 99, display_id: 9, requester: { email: "fromdata@x.com" } } })) },
    instance: { context: context, resize: vi.fn(), close: vi.fn(), send: vi.fn() },
    request: { invokeTemplate: invoke },
    interface: { trigger: vi.fn(() => Promise.resolve()) }
  };
  global.app = { initialized: vi.fn(() => Promise.resolve(client)) };
  await import("../app/scripts/app.js");
  await flush(); await flush(); await flush();
  return { client, invoke };
}

const $ = id => document.getElementById(id);

describe("large Copilot modal (copilot.html)", () => {
  test("renders immediately from the ticket passed by the top-bar button", async () => {
    const { client, invoke } = await bootModal(vi.fn(() => Promise.resolve({
      data: { email: "passed@x.com", ticket: { id: 30004514124, display_id: 3, subject: "Refund", description: "<p>x</p>" } }
    })));
    expect(client.events.on).not.toHaveBeenCalled();
    expect(client.data.get).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("getInsights", expect.objectContaining({
      context: expect.objectContaining({ email: "passed@x.com", ticketId: "30004514124", subject: "Refund" })
    }));
    expect($("decision").textContent).toContain("Auto-denied");
    expect($("view360").style.display).toBe("none");
    expect(client.instance.resize).not.toHaveBeenCalled();
    $("btnClose").click();
    expect(client.instance.close).toHaveBeenCalled();

    $("noteBox").value = "n";
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnNote").onclick();
    expect(invoke.mock.calls.at(-1)[1].context).toEqual({ ticketId: "3" });
  });

  test("falls back to page data when no context is available", async () => {
    const { invoke, client } = await bootModal(vi.fn(() => Promise.reject(new Error("no ctx"))));
    expect(client.data.get).toHaveBeenCalledWith("ticket");
    expect(invoke.mock.calls[0][1].context.email).toBe("fromdata@x.com");
  });

  test("falls back to page data when context has no data", async () => {
    const { invoke } = await bootModal(vi.fn(() => Promise.resolve(null)));
    expect(invoke.mock.calls[0][1].context.email).toBe("fromdata@x.com");
  });

  test("insert from the modal hands the text to the top-bar instance and stays open", async () => {
    const { client } = await bootModal(vi.fn(() => Promise.resolve({ data: { email: "p@x.com", ticket: { id: 4 } } })));
    $("btnInsert").click();
    expect(client.instance.send).toHaveBeenCalledWith({ message: { action: "openEditor", id: "reply", text: "Hi" } });
    expect(client.instance.close).not.toHaveBeenCalled();
    $("replyBox").value = "Edited";
    $("btnInsert").click();
    expect(client.instance.send).toHaveBeenLastCalledWith({ message: { action: "openEditor", id: "reply", text: "Edited" } });
    expect(client.interface.trigger).not.toHaveBeenCalled();
    expect($("actionMsg").textContent).toBe("Inserted into the reply editor.");
  });

  test("falls back to the normal path when messaging is unavailable", async () => {
    const { client } = await bootModal(vi.fn(() => Promise.resolve({ data: { email: "p@x.com", ticket: { id: 4 } } })));
    client.instance.send.mockImplementation(() => { throw new Error("unsupported"); });
    $("btnInsert").click();
    await flush();
    expect(client.interface.trigger).toHaveBeenCalledWith("click", { id: "reply", text: "Hi" });
  });

  test("shows Customer 360 tabs inline (user, subscriptions, payments)", async () => {
    const { invoke } = await bootModal(vi.fn(() => Promise.resolve({ data: { email: "p@x.com", ticket: { id: 4 } } })));
    expect(invoke).toHaveBeenCalledWith("getCustomer360", { context: { email: "a@b.com", userId: "" } });
    await flush();
    expect($("c360-card").style.display).toBe("");
    expect($("c360-user").textContent).toContain("Test User");
    expect($("c360-user").textContent).toContain("$319.00");
    expect($("c360-subs").textContent).toContain("Qbank · Active");
    expect($("c360-subs").textContent).toContain("On");
    expect($("c360-pay").textContent).toContain("(duplicate)");
    const subsTab = [...document.querySelectorAll(".c360-tab")].find(t => t.dataset.pane === "c360-subs");
    subsTab.click();
    expect($("c360-subs").style.display).toBe("");
    expect($("c360-user").style.display).toBe("none");
    expect(subsTab.classList.contains("active")).toBe(true);
  });

  test("Customer 360 asks for the same user the decision was made for", async () => {
    vi.resetModules();
    loadBody("copilot.html");
    const invoke = vi.fn(name => ok(name === "getCustomer360" ? C360
      : { ...INSIGHTS, customer: { email: "inbox@x.com", userId: 9000003, fullName: "Kiran Reddy" } }));
    const client = {
      events: { on: vi.fn() }, data: { get: vi.fn() },
      instance: { context: vi.fn(() => Promise.resolve({ data: { email: "inbox@x.com", ticket: { id: 4 } } })), close: vi.fn(), send: vi.fn() },
      request: { invokeTemplate: invoke }, interface: { trigger: vi.fn(() => Promise.resolve()) }
    };
    global.app = { initialized: vi.fn(() => Promise.resolve(client)) };
    await import("../app/scripts/app.js");
    await flush(); await flush(); await flush();
    expect(invoke).toHaveBeenCalledWith("getCustomer360", { context: { email: "inbox@x.com", userId: "9000003" } });
  });

  test("Customer 360: empty records, not found, and errors", async () => {
    const ctx = vi.fn(() => Promise.resolve({ data: { email: "p@x.com", ticket: { id: 4 } } }));
    let r = await bootModal(ctx);
    r.invoke.mockImplementation(name => ok(name === "getCustomer360" ? {} : { ...INSIGHTS, customer: {} }));
    await r.client.request.invokeTemplate; // no-op
    vi.resetModules();
    loadBody("copilot.html");
    const client = r.client;
    global.app = { initialized: vi.fn(() => Promise.resolve(client)) };
    await import("../app/scripts/app.js");
    await flush(); await flush(); await flush();
    expect($("c360-subs").textContent).toContain("No subscriptions on record.");
    expect($("c360-pay").textContent).toContain("No payments on record.");
    expect($("c360-user").textContent).toContain("$0.00");

    for (const [impl, text] of [
      [() => Promise.reject({ status: 404 }), "No full UWorld records found"],
      [() => Promise.reject({ status: 500 }), "Customer 360 not available: Backend returned 500"]
    ]) {
      vi.resetModules();
      loadBody("copilot.html");
      client.request.invokeTemplate = vi.fn(name => name === "getCustomer360" ? impl() : ok(INSIGHTS));
      await import("../app/scripts/app.js");
      await flush(); await flush(); await flush();
      expect($("c360-msg").textContent).toContain(text);
    }
  });

  test("from the modal, a successful reply asks the top-bar instance to reload the ticket", async () => {
    const { client, invoke } = await bootModal(vi.fn(() => Promise.resolve({ data: { email: "p@x.com", ticket: { id: 4 } } })));
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnSend").onclick();
    expect(client.instance.send).toHaveBeenCalledWith({ message: { action: "refreshTicket", id: 4 } });

    client.instance.send.mockImplementation(() => { throw new Error("unsupported"); });
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnSend").onclick();
    expect($("actionMsg").textContent).toBe("Reply sent to customer.");
  });

  test("no reload without a ticket number", async () => {
    const { client, invoke } = await bootModal(vi.fn(() => Promise.resolve({ data: { email: "p@x.com", ticket: { id: "abc" } } })));
    invoke.mockImplementationOnce(() => ok({}));
    await $("btnSend").onclick();
    expect(client.instance.send).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ action: "refreshTicket" }) }));
  });
});
