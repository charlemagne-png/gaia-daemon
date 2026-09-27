// @ts-nocheck — native bridge behavior + source seams; no visible shell/browser.
import { expect, test } from "bun:test";

const documentListeners = {};
globalThis.document = {
  createElement: (tag) => ({ tag, listeners: {}, addEventListener() {}, setAttribute() {}, append() {} }),
  createTextNode: (text) => ({ text }),
  addEventListener: (type, listener) => { documentListeners[type] = listener; },
  body: { classList: { toggle() {} } },
};
globalThis.location = { href: "http://localhost/", origin: "http://localhost", search: "", hash: "" };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const opened = [];
globalThis.window = { open: (...args) => opened.push(args), addEventListener() {}, location: globalThis.location };

const { openExternalUrl, installOpenModifierTracking } = await import("./links.js");
const linksSource = await Bun.file(new URL("./links.js", import.meta.url)).text();
const shellSource = await Bun.file(new URL("../../src-tauri/src/lib.rs", import.meta.url)).text();
installOpenModifierTracking();

function nativeFetch(requests) {
  globalThis.window.__TAURI__ = {};
  globalThis.fetch = async (url, options) => {
    requests.push([url, options]);
    return { ok: true, json: async () => ({}) };
  };
}

test("browser mode opens external links in a new tab, never a floating window", () => {
  delete globalThis.window.__TAURI__;
  opened.length = 0;
  void openExternalUrl("https://example.com/docs");
  expect(opened).toEqual([["https://example.com/docs", "_blank", "noopener,noreferrer"]]);
});

test("native mode routes external links to the OS browser via the daemon", () => {
  const requests = [];
  nativeFetch(requests);
  opened.length = 0;
  void openExternalUrl("https://example.com/docs");
  expect(opened).toEqual([]);
  expect(requests).toEqual([["/api/open-target", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "https://example.com/docs" }),
  }]]);
});

test("native captures raw http(s) anchors but leaves relative/attachment links alone", () => {
  const requests = [];
  nativeFetch(requests);
  const anchor = {
    closest: (selector) => (selector === "a[href]" ? anchor : null),
    getAttribute: (name) => (name === "href" ? "https://example.com/sign-in" : null),
  };
  const click = { target: anchor, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  documentListeners.click(click);
  expect(click.prevented).toBe(true);
  expect(click.stopped).toBe(true);
  expect(requests).toEqual([["/api/open-target", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "https://example.com/sign-in" }),
  }]]);

  const attachment = {
    closest: () => attachment,
    getAttribute: () => "/api/attachments/a.png",
  };
  const attachmentClick = { target: attachment, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  documentListeners.click(attachmentClick);
  expect(attachmentClick.prevented).toBeUndefined();
  expect(requests).toHaveLength(1);
});

test("links.js keeps external links off the floating-window IPC", () => {
  expect(linksSource).toContain('api("/api/open-target"');
  expect(linksSource).not.toContain("openWebWindow");
});

test("Rust secondary windows never focus or restore over main", () => {
  expect(shellSource).toContain("fn open_web_window(app: tauri::AppHandle, url: String)");
  expect(shellSource).toContain('format!("web-{}", WINDOW_SEQ.fetch_add(1, Ordering::Relaxed))');
  expect(shellSource).toContain("WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))");
  expect(shellSource).toContain('matches!(parsed.scheme(), "http" | "https")');
  expect(shellSource).toContain(".focused(false)");
  expect(shellSource).toContain("disable_window_restoration(&window)");
  expect(shellSource).toContain("setRestorable: false");
  expect(shellSource).toContain("fn close_secondary_windows(app: &tauri::AppHandle)");
  expect(shellSource).toContain('if label != "main"');
  expect(shellSource.match(/close_secondary_windows\([^)]*\)/g)?.length).toBeGreaterThanOrEqual(2);

  const gaiaWindow = shellSource.slice(
    shellSource.indexOf("fn open_window("),
    shellSource.indexOf("fn close_secondary_windows"),
  );
  expect(gaiaWindow).toContain(".focused(false)");
  expect(gaiaWindow).toContain("disable_window_restoration(&window)");
});
