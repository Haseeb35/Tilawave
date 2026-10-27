// With animations on: scroll every page to the bottom and make sure nothing stays hidden,
// nothing overflows sideways, and tilt reacts to the pointer.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = 9342;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {} }
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result.value;
await send("Page.enable"); await send("Runtime.enable");
let fails = 0;
for (const [w, mobile] of [[1280, false], [390, true]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 850, deviceScaleFactor: 1, mobile });
  for (const p of ["", "quran.html", "quran.html?juz=30", "tasbih.html", "calendar.html"]) {
    await send("Page.navigate", { url: "http://localhost:8000/" + p }); await sleep(4500);
    await ev(`(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 1200)); })()`);
    const hidden = await ev(`[...document.querySelectorAll(".reveal:not(.is-visible)")].filter(el => el.offsetParent !== null && el.getBoundingClientRect().top < innerHeight).length`);
    const totalReveal = await ev(`document.querySelectorAll(".reveal").length`);
    const overflow = await ev(`document.documentElement.scrollWidth - innerWidth`);
    const ok = hidden === 0 && overflow <= 0;
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${w}px ${p || "home"}: ${totalReveal} animated sections, ${hidden} stuck hidden in view, sideways overflow ${overflow}px`);
  }
}
// Tilt responds to the pointer on desktop
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://localhost:8000/quran.html" }); await sleep(4000);
const r = await ev(`(() => { const c = document.querySelector(".surah-card"); c.scrollIntoView({block:"center"}); const b = c.getBoundingClientRect(); return [b.left + b.width * 0.9, b.top + b.height * 0.1]; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] });
await sleep(300);
const t = await ev(`(() => { const c = document.querySelector(".surah-card"); return c.classList.contains("tilt") + " " + c.style.getPropertyValue("--rx") + " " + c.style.getPropertyValue("--ry"); })()`);
console.log(`${t.startsWith("true") && !t.endsWith(" ") ? "PASS" : "FAIL"}  surah card tilt follows pointer: ${t}`);
console.log(`\n${fails} failing pages · JS errors: ${errors.length ? errors.join(" | ") : "none"}`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
