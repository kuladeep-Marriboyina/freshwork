import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load the <body> of an app HTML page into jsdom (scripts stripped).
export function loadBody(file) {
  const html = readFileSync(resolve(__dirname, "../app", file), "utf8");
  const m = html.match(/<body([^>]*)>([\s\S]*)<\/body>/i);
  document.body.removeAttribute("data-mode");
  document.body.className = "";
  const mode = m[1].match(/data-mode="([^"]*)"/);
  if (mode) document.body.setAttribute("data-mode", mode[1]);
  document.body.innerHTML = m[2].replace(/<script[\s\S]*?<\/script>/gi, "");
}

export const flush = () => new Promise(r => setTimeout(r, 0));

// Shapes returned by client.request.invokeTemplate.
export function ok(data) {
  return Promise.resolve({ status: 200, headers: {}, response: JSON.stringify(data) });
}
export function fail(status, message = "error") {
  return Promise.reject({ status, message });
}
