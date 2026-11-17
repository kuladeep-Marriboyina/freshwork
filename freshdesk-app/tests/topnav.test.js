import { loadBody, flush } from "./helpers.js";

let client, activated, received;

async function boot({ ticket, requester, trigger, initFails = false } = {}) {
  vi.resetModules();
  loadBody("topnav.html");
  activated = null;
  client = {
    events: { on: vi.fn((name, cb) => { activated = cb; }) },
    data: {
      get: vi.fn(name => {
        if (name === "requester") {
          return requester instanceof Error ? Promise.reject(requester) : Promise.resolve(requester);
        }
        return Promise.resolve({ ticket: ticket || { id: 30004514124, display_id: 3, subject: "Refund", description: "<p>x</p>", requester: { email: "a@b.com" } } });
      })
    },
    interface: { trigger: trigger || vi.fn(() => Promise.resolve()) },
    instance: { receive: vi.fn(cb => { received = cb; }) }
  };
  global.app = { initialized: vi.fn(() => (initFails ? Promise.reject(new Error("nope")) : Promise.resolve(client))) };
  await import("../app/scripts/topnav.js");
  await flush();
}

const $ = id => document.getElementById(id);

describe("top-bar button (topnav.js)", () => {
  test("opens the large Copilot modal with the ticket and email on activation", async () => {
    await boot();
    expect(client.events.on).toHaveBeenCalledWith("app.activated", expect.any(Function));
    await activated();
    expect(client.interface.trigger).toHaveBeenCalledWith("showModal", {
      title: "UWorld Copilot",
      template: "copilot.html",
      data: {
        email: "a@b.com",
        ticket: { id: 30004514124, display_id: 3, subject: "Refund", description: "<p>x</p>", description_text: undefined }
      }
    });
    expect($("msg").textContent).toBe("");
  });

  test("the button also opens it, using the requester object for the email", async () => {
    await boot({ ticket: { id: 1 }, requester: { requester: { primary_email: "p@x.com" } } });
    await $("openCopilot").onclick();
    expect(client.interface.trigger.mock.calls[0][1].data.email).toBe("p@x.com");
  });

  test("email lookups that fail leave the email empty", async () => {
    await boot({ ticket: { id: 1 }, requester: new Error("unsupported") });
    await activated();
    expect(client.interface.trigger.mock.calls[0][1].data.email).toBe("");
    await boot({ ticket: { id: 1 }, requester: null });
    await activated();
    expect(client.interface.trigger.mock.calls[0][1].data.email).toBe("");
    await boot({ ticket: { id: 1 }, requester: { requester: { email: "e@x.com" } } });
    await activated();
    expect(client.interface.trigger.mock.calls[0][1].data.email).toBe("e@x.com");
  });

  test("shows a message when the modal cannot open", async () => {
    await boot({ trigger: vi.fn(() => Promise.reject(new Error("blocked"))) });
    await activated();
    expect($("msg").textContent).toBe("Could not open UWorld Copilot: blocked");
    await boot({ trigger: vi.fn(() => Promise.reject(null)) });
    await activated();
    expect($("msg").textContent).toBe("Could not open UWorld Copilot: unknown error");
  });

  test("shows a message when init fails", async () => {
    await boot({ initFails: true });
    expect($("msg").textContent).toBe("Failed to initialize app: nope");
  });

  test("opens the editor when the large modal sends text", async () => {
    await boot();
    const ev = m => ({ helper: { getData: () => m } });
    await received(ev({ message: { action: "openEditor", id: "reply", text: "Hi" } }));
    expect(client.interface.trigger).toHaveBeenCalledWith("click", { id: "reply", text: "Hi" });
    expect(client.interface.trigger).toHaveBeenCalledWith("setValue", { id: "editor", text: "Hi", replace: true });
    client.interface.trigger.mockImplementation(name => name === "setValue" ? Promise.reject(new Error("x")) : Promise.resolve());
    await received(ev({ message: { action: "openEditor", id: "reply", text: "Again" } }));
    expect($("msg").textContent).toBe("");
    client.interface.trigger.mockImplementation(() => Promise.resolve());
    await received(ev({ action: "openEditor", id: "note", text: "N" }));
    expect(client.interface.trigger).toHaveBeenCalledWith("click", { id: "note", text: "N", isPublic: false });
    client.interface.trigger.mockClear();
    await received(ev({ message: { action: "other" } }));
    await received({});
    await received(ev(null));
    expect(client.interface.trigger).not.toHaveBeenCalled();
    client.interface.trigger.mockImplementation(name => name === "click" ? Promise.reject(new Error("open")) : Promise.resolve());
    await received(ev({ message: { action: "openEditor", id: "reply", text: "Replaced" } }));
    expect(client.interface.trigger).toHaveBeenLastCalledWith("setValue", { id: "editor", text: "Replaced", replace: true });
    expect($("msg").textContent).toBe("");
    client.interface.trigger.mockImplementation(() => Promise.reject(new Error("no")));
    await received(ev({ message: { action: "openEditor", id: "reply", text: "x" } }));
    expect($("msg").textContent).toBe("Could not open the editor: no");
    client.interface.trigger.mockImplementation(() => Promise.reject(null));
    await received(ev({ message: { action: "openEditor", id: "reply", text: "x" } }));
    expect($("msg").textContent).toBe("Could not open the editor: unknown error");
  });

  test("reloads the ticket when the modal asks", async () => {
    await boot();
    const ev = m => ({ helper: { getData: () => m } });
    await received(ev({ message: { action: "refreshTicket", id: 4 } }));
    expect(client.interface.trigger).toHaveBeenCalledWith("click", { id: "ticket", value: 4 });
    client.interface.trigger.mockImplementation(() => Promise.reject(new Error("blocked")));
    await expect(received(ev({ message: { action: "refreshTicket", id: 4 } }))).resolves.toBeNull();
    client.interface.trigger.mockClear();
    await received(ev({ message: { action: "refreshTicket" } }));
    expect(client.interface.trigger).not.toHaveBeenCalled();
  });
});
