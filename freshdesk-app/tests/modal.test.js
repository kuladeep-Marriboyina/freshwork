import { loadBody, flush, ok, fail } from "./helpers.js";

const C360 = {
  user: {
    fullName: "Test User", email: "a@b.com", userId: 7, phone: "", country: "IN",
    accountStatus: "Active", memberSince: "2024-01-01", failedLoginAttempts: 0
  },
  activeSubscriptions: 1, totalPaid: 319,
  subscriptions: [
    { name: "Qbank", status: "Active", usagePercent: 78, purchaseDate: "2026-10-13", expiryDate: "2027-10-13", amountPaid: 319, isActivated: true, autoRenew: false },
    { name: "Old", status: "Expired", isActivated: false, autoRenew: true },
    { name: "Trial", status: "Pending" }
  ],
  payments: [
    { date: "2026-10-13", paymentId: "P1", amount: 319, method: "Card", status: "Paid", isDuplicate: false },
    { date: "2026-10-13", paymentId: "P2", amount: 319, method: "Card", status: "Paid", isDuplicate: true }
  ]
};

let invoke;

async function boot({ ctx = { data: { email: "a@b.com" } }, invokeImpl = () => ok(C360), initFails = false } = {}) {
  vi.resetModules();
  loadBody("modal.html");
  invoke = vi.fn(invokeImpl);
  const client = {
    instance: { context: vi.fn(() => Promise.resolve(ctx)), close: vi.fn() },
    request: { invokeTemplate: invoke }
  };
  global.app = {
    initialized: vi.fn(() => (initFails ? Promise.reject(new Error("nope")) : Promise.resolve(client)))
  };
  await import("../app/scripts/modal.js");
  await flush(); await flush();
}

const $ = id => document.getElementById(id);

describe("Customer 360 modal.js", () => {
  test("loads and renders user, subscriptions and payments", async () => {
    await boot();
    expect(invoke).toHaveBeenCalledWith("getCustomer360", { context: { email: "a@b.com", userId: "" } });
    expect($("m-loading").style.display).toBe("none");
    expect($("tab-user").textContent).toContain("Test User");
    expect($("tab-user").textContent).toContain("$319.00");
    expect($("tab-subs").innerHTML).toContain("uw-b-green");
    expect($("tab-subs").innerHTML).toContain("uw-b-red");
    expect($("tab-subs").innerHTML).toContain("uw-b-grey");
    expect($("tab-pay").querySelectorAll("tr.uw-dup").length).toBe(1);
  });

  test("empty records show placeholder cards", async () => {
    await boot({ ctx: null, invokeImpl: () => ok({}) });
    expect(invoke.mock.calls[0][1].context.email).toBe("");
    expect($("tab-subs").textContent).toContain("No subscriptions on record.");
    expect($("tab-pay").textContent).toContain("No payments on record.");
    expect($("tab-user").textContent).toContain("$0.00");
  });

  test("passes the user ID handed over by the sidebar", async () => {
    await boot({ ctx: { data: { email: "inbox@x.com", userId: "9000003" } } });
    expect(invoke).toHaveBeenCalledWith("getCustomer360", { context: { email: "inbox@x.com", userId: "9000003" } });
  });

  test("backend error is shown", async () => {
    await boot({ invokeImpl: () => fail(404) });
    expect($("m-error").textContent).toContain("Backend returned 404");
  });

  test("errors without a status are shown", async () => {
    await boot({ invokeImpl: () => Promise.reject(new Error("timeout")) });
    expect($("m-error").textContent).toContain("timeout");
    await boot({ invokeImpl: () => Promise.reject(null) });
    expect($("m-error").textContent).toContain("request failed");
  });

  test("init error is shown", async () => {
    await boot({ initFails: true });
    expect($("m-error").textContent).toContain("Init failed: nope");
  });

  test("has no Close button (Freshdesk's own close is used)", async () => {
    await boot();
    expect($("btnClose")).toBeNull();
  });

  test("tabs switch the visible panel", async () => {
    await boot();
    const tabs = [...document.querySelectorAll(".uw-tab")];
    expect(tabs.length).toBeGreaterThan(0);
    const pay = tabs.find(t => t.dataset.tab === "pay");
    pay.click();
    expect(pay.classList.contains("active")).toBe(true);
    expect($("tab-pay").style.display).toBe("");
    expect($("tab-user").style.display).toBe("none");
  });
});

describe("modal.js response parsing", () => {
  test("handles object, string and empty bodies", async () => {
    await boot({ invokeImpl: () => Promise.resolve({ status: 200, response: C360 }) });
    expect(document.getElementById("tab-user").textContent).toContain("Test User");
    await boot({ invokeImpl: () => Promise.resolve(JSON.stringify(C360)) });
    expect(document.getElementById("tab-user").textContent).toContain("Test User");
    await boot({ invokeImpl: () => Promise.resolve({ body: JSON.stringify(C360) }) });
    expect(document.getElementById("tab-user").textContent).toContain("Test User");
    await boot({ invokeImpl: () => Promise.resolve({ data: C360 }) });
    expect(document.getElementById("tab-user").textContent).toContain("Test User");
    await boot({ invokeImpl: () => Promise.resolve({ status: 200 }) });
    expect(document.getElementById("m-error").textContent).toContain("no data in response (status 200");
    await boot({ invokeImpl: () => Promise.resolve({}) });
    expect(document.getElementById("m-error").textContent).toContain("status ?, fields: none");
    await boot({ invokeImpl: () => Promise.resolve(undefined) });
    expect(document.getElementById("m-error").textContent).toContain("empty response");
  });
});
