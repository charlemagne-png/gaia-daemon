// @ts-nocheck — native bridge behavior + source seams; no visible shell/browser.
import { expect, test } from "bun:test";

const calls = [];
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, args) {
        calls.push({ command, args });
        return Promise.resolve("web-7");
      },
    },
  },
};

const { openWebWindow } = await import("./native.js");
const linksSource = await Bun.file(new URL("./links.js", import.meta.url)).text();
const shellSource = await Bun.file(new URL("../../src-tauri/src/lib.rs", import.meta.url)).text();

test("native web links use the dedicated new-window IPC", async () => {
  expect(await openWebWindow("https://example.com/path")).toBe("web-7");
  expect(calls).toEqual([
    { command: "open_web_window", args: { url: "https://example.com/path" } },
  ]);
});

test("link tokens retain local open-target and route native web targets separately", () => {
  expect(linksSource).toContain('api("/api/open-target"');
  expect(linksSource).toContain("await openWebWindow(url);");
  expect(linksSource).toContain('window.open(url, "_blank", "popup,noopener,noreferrer")');
});

test("modified real anchors are captured only in the native shell", () => {
  expect(linksSource).toContain('clicked?.closest("a[href]")');
  expect(linksSource).toContain("if (!isNative() || !isOpenModifier(event)) return;");
  expect(linksSource).toContain('document.addEventListener(\n    "click"');
  expect(linksSource).toContain("    true,\n  );");
});

test("Rust command creates a disposable, non-focusing external WebviewWindow", () => {
  expect(shellSource).toContain("fn open_web_window(app: tauri::AppHandle, url: String)");
  expect(shellSource).toContain('format!("web-{}", WINDOW_SEQ.fetch_add(1, Ordering::Relaxed))');
  expect(shellSource).toContain("WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))");
  expect(shellSource).toContain('matches!(parsed.scheme(), "http" | "https")');
  expect(shellSource).toContain(".focused(false)");
  expect(shellSource).toContain("disable_window_restoration(&window)");
  expect(shellSource).toContain("setRestorable: false");
  expect(shellSource.match(/close_disposable_windows\([^)]*\)/g)?.length).toBeGreaterThanOrEqual(3);
});
