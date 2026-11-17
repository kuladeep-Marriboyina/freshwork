import { loadBody, flush, ok, fail } from "./helpers.js";

const C360 = {
  user: { fullName: "Test User", email: "a@b.com", userId: 7, accountStatus: "Active", failedLoginAttempts: 0 },
  activeSubscriptions: 1, totalPaid: 319,
  subscriptions: [{ name: "Qbank", status: "Active", usagePercent: 78 }, { name: "Old" }],
  payments: [{ date: "2026-10-13", amount: 319, status: "Paid" }, { amount: 5, isDuplicate: true }]
};

let invoke;

async function boot({ invokeImpl, initFails = false } = {}) {
  vi.resetModules();
  loadBody("cti.html");
  invoke = vi.fn(invokeImpl || ((name) => ok(name === "getInsights"
    ? { intent: "refund", recommendedAction: 2, confidence: 0.93, reason: "usage <78%>" }
    : C360)));
  const client = { request: { invokeTemplate: invoke } };
  global.app = { initialized: vi.fn(() => (initFails ? Promise.reject(new Error("nope")) : Promise.resolve(client))) };
  await import("../app/scripts/cti.js");
  await flush();
}

const $ = id => document.getElementById(id);
async function submit(email, ask = "") {
  $("email").value = email;
  $("ask").value = ask;
  await $("lookupForm").onsubmit({ preventDefault: vi.fn() });
}

describe("CTI global sidebar (cti.js)", () => {
  test("email only: shows customer, subscriptions and payments, no decision", async () => {
    await boot();
    await submit(" a@b.com ");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("getCustomer360", { context: { email: "a@b.com", userId: "" } });
    expect($("c-result").style.display).toBe("");
    expect($("c-decision").style.display).toBe("none");
    expect($("c-user").textContent).toContain("Test User");
    expect($("c-user").textContent).toContain("$319.00");
    expect($("c-subs").textContent).toContain("78% used");
    expect($("c-subs").textContent).toContain("0% used");
    expect($("c-pay").textContent).toContain("(duplicate)");
  });

  test("with a request: also shows the policy decision", async () => {
    await boot();
    await submit("a@b.com", "I want a refund");
    expect(invoke).toHaveBeenCalledWith("getInsights", {
      context: { email: "a@b.com", ticketId: "", subject: "I want a refund", description: "I want a refund" }
    });
    expect($("c-decision").style.display).toBe("");
    expect($("c-decision").textContent).toContain("Auto-denied");
    expect($("c-decision").textContent).toContain("93%");
    expect($("c-decision").innerHTML).toContain("&lt;78%&gt;");
  });

  test("string and unknown actions, empty records", async () => {
    await boot({ invokeImpl: (name) => ok(name === "getInsights" ? { recommendedAction: "Weird" } : {}) });
    await submit("a@b.com", "help");
    expect($("c-decision").textContent).toContain("Needs your review");
    expect($("c-decision").textContent).toContain("0%");
    expect($("c-subs").textContent).toContain("No subscriptions on record.");
    expect($("c-pay").textContent).toContain("No payments on record.");
    expect($("c-user").textContent).toContain("—");
  });

  test("validation and errors", async () => {
    await boot();
    await submit("  ");
    expect($("c-error").textContent).toBe("Enter the customer's email.");
    expect(invoke).not.toHaveBeenCalled();

    invoke.mockImplementationOnce(() => fail(404));
    await submit("x@y.com");
    expect($("c-error").textContent).toBe("No UWorld customer found for x@y.com.");

    invoke.mockImplementationOnce(() => fail(401));
    await submit("x@y.com");
    expect($("c-error").textContent).toBe("Lookup failed: Backend returned 401");

    invoke.mockImplementationOnce(() => Promise.reject(new Error("timeout")));
    await submit("x@y.com");
    expect($("c-error").textContent).toBe("Lookup failed: timeout");

    invoke.mockImplementationOnce(() => Promise.reject(null));
    await submit("x@y.com");
    expect($("c-error").textContent).toBe("Lookup failed: request failed");
    expect($("c-loading").style.display).toBe("none");
  });

  test("submit without an event object still works", async () => {
    await boot();
    $("email").value = "a@b.com";
    await $("lookupForm").onsubmit();
    expect(invoke).toHaveBeenCalled();
  });

  test("init failure is shown", async () => {
    await boot({ initFails: true });
    expect($("c-error").textContent).toBe("Failed to initialize app: nope");
  });
});

describe("cti.js response parsing", () => {
  test("handles object, string and empty bodies", async () => {
    await boot({ invokeImpl: () => Promise.resolve({ status: 200, response: C360 }) });
    await submit("a@b.com");
    expect(document.getElementById("c-user").textContent).toContain("Test User");
    await boot({ invokeImpl: () => Promise.resolve(JSON.stringify(C360)) });
    await submit("a@b.com");
    expect(document.getElementById("c-user").textContent).toContain("Test User");
    await boot({ invokeImpl: () => Promise.resolve({ body: JSON.stringify(C360) }) });
    await submit("a@b.com");
    expect(document.getElementById("c-user").textContent).toContain("Test User");
    await boot({ invokeImpl: () => Promise.resolve({ data: C360 }) });
    await submit("a@b.com");
    expect(document.getElementById("c-user").textContent).toContain("Test User");
    await boot({ invokeImpl: () => Promise.resolve({ status: 200 }) });
    await submit("a@b.com");
    expect(document.getElementById("c-error").textContent).toContain("no data in response (status 200");
    await boot({ invokeImpl: () => Promise.resolve({}) });
    await submit("a@b.com");
    expect(document.getElementById("c-error").textContent).toContain("status ?, fields: none");
    await boot({ invokeImpl: () => Promise.resolve(undefined) });
    await submit("a@b.com");
    expect(document.getElementById("c-error").textContent).toContain("empty response");
  });
});
