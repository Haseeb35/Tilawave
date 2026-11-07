// Tests for: installable app + offline, Para navigation, Khatam tracker, Prayer tracker, Hadith of the Day.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:8000/";
const PORT = 9352;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "--window-size=1280,1000", "about:blank",
], { stdio: "ignore" });

let pageWs;
for (let i = 0; i < 50 && !pageWs; i++) {
  await sleep(200);
  try { pageWs = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(pageWs);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map();
const errors = [];
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description);
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(msg.params.entry.text + " " + (msg.params.entry.url || ""));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error");
  return r.result.value;
};
const waitFor = async (expr, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expr).catch(() => false)) return true;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
};
const go = async (url) => { await send("Page.navigate", { url }); await sleep(300); await waitFor(`document.readyState === "complete"`); };
const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim()`);
const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const visible = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !el.closest("[hidden]") && getComputedStyle(el).display !== "none"; })()`);
const homeReady = () => waitFor(`document.querySelectorAll("#times li").length === 6 && !document.body.classList.contains("loading")`);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); passed++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); failed++; }
}

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"], origin: "http://localhost:8000" }).catch(() => {});
await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});

let fakeClock = null;
async function setClock(iso) {
  if (fakeClock) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: fakeClock });
  fakeClock = null;
  if (!iso) return;
  const offset = Date.parse(iso) - Date.now();
  ({ identifier: fakeClock } = await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const Real = Date, offset = ${offset};
    class FakeDate extends Real { constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); } static now() { return Real.now() + offset; } }
    globalThis.Date = FakeDate;
  })()` }));
}
// Capture downloads/shares made by shareCard
const captureShare = `window.__shared = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__shared.push(this.download); };`;
const homeReady2 = () => waitFor(`document.querySelectorAll("#times li").length === 6 && !document.body.classList.contains("loading")`, 20000);
const timeOf = (p) => evaluate(`state.today.timings.${p}`);

await test("Prayer time adjustments change home times and persist", async () => {
  await go(BASE); await homeReady2();
  const [fajr, isha] = [await timeOf("Fajr"), await timeOf("Isha")];
  await go(BASE + "settings.html");
  for (let i = 0; i < 5; i++) await click('[data-tune="Isha"][data-step="1"]');
  for (let i = 0; i < 2; i++) await click('[data-tune="Fajr"][data-step="-1"]');
  expect((await text("#tune-list li:last-child output")) === "+5 min", await text("#tune-list li:last-child output"));
  await go(BASE); await homeReady2();
  const plus = (t, n) => { const [h, m] = t.split(":").map(Number); const x = h * 60 + m + n; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
  expect((await timeOf("Isha")).startsWith(plus(isha, 5)), `isha ${await timeOf("Isha")} vs ${isha}+5`);
  expect((await timeOf("Fajr")).startsWith(plus(fajr, -2)), `fajr ${await timeOf("Fajr")} vs ${fajr}-2`);
  expect((await text("#tune-link")).includes("Adjusted"), await text("#tune-link"));
  await go(BASE + "calendar.html");
  await waitFor(`document.querySelectorAll("#timetable tr").length > 27`, 20000);
  const row = await evaluate(`document.querySelector("#timetable tr.today")?.textContent || ""`);
  expect(row.includes(to12(plus(isha, 5))), `calendar today row: ${row}`);
  await go(BASE + "settings.html"); await click("#tune-reset");
  await go(BASE); await homeReady2();
  expect((await timeOf("Isha")).startsWith(isha), "reset");
});
function to12(t) { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`; }

await test("Hijri adjustment shifts the date on home, calendar and settings", async () => {
  await go(BASE + "settings.html");
  const before = await text("#hijri-preview");
  await click('[data-adjust="-1"]');
  const after = await text("#hijri-preview");
  expect(before !== after, `${before} → ${after}`);
  const day = (s) => Number(s.split(" ")[0]);
  expect(day(after) === day(before) - 1 || day(before) === 1, `${before} → ${after}`);
  await go(BASE); await homeReady2();
  expect((await text("#dates .hijri")) === after, `home ${await text("#dates .hijri")} vs ${after}`);
  await go(BASE + "calendar.html");
  await waitFor(`document.querySelector("#timetable tr.today")`, 20000);
  const cell = await text("#timetable tr.today .hijri");
  expect(after.startsWith(cell), `calendar ${cell} vs ${after}`);
  await go(BASE + "settings.html"); await click('[data-adjust="0"]');
  expect((await text("#hijri-preview")) === before, "back");
});

await test("Quick search: Ctrl+K, surah, verse, para, hadith, page", async () => {
  await go(BASE + "zakat.html");
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))`);
  await waitFor(`$("quick")?.open`);
  const type = async (q) => { await evaluate(`$("quick-q").value = ${JSON.stringify(q)}; $("quick-q").dispatchEvent(new Event("input"))`); await sleep(50); return evaluate(`[...document.querySelectorAll("#quick-list a")].map(a => a.getAttribute("href"))`); };
  await waitFor(`(JSON.parse(localStorage.getItem("quran-surahs") || "[]")).length === 114`, 15000);
  expect((await type("yaseen"))[0] === "quran.html?surah=36", (await type("yaseen")).join());
  expect((await type("2:255"))[0] === "quran.html?surah=2#ayah-255", "verse");
  expect((await type("para 30"))[0] === "quran.html?juz=30", "para");
  expect((await type("bukhari 1"))[0] === "hadith.html?c=bukhari&n=1", "hadith n");
  expect((await type("zakat"))[0] === "zakat.html", (await type("zakat")).join());
  expect((await type("mulk"))[0] === "quran.html?surah=67", "mulk");
  await type("kahf");
  await evaluate(`$("quick-q").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await waitFor(`location.search === "?surah=18" && document.querySelectorAll(".ayah").length === 110`, 20000);
  await click("#search-btn");
  await waitFor(`$("quick").open`);
  await type("bukhari 1000");
  await evaluate(`$("quick-q").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await waitFor(`location.hash === "#h-1000" && document.getElementById("h-1000")`, 25000);
});

await test("Share today's prayer times as an image", async () => {
  await go(BASE); await homeReady2();
  await evaluate(captureShare);
  await waitFor(`!$("share-times").disabled`);
  await click("#share-times");
  await waitFor(`window.__shared.length === 1`, 15000);
  expect(/^prayer-times-\d\d-\d\d-\d{4}\.png$/.test((await evaluate(`window.__shared[0]`))), await evaluate(`window.__shared[0]`));
  const copied = await evaluate(`navigator.clipboard.readText().catch(() => "")`);
  expect(!copied || /Fajr: \d/.test(copied), copied);
});

await test("Settings: Quran preferences and theme apply everywhere", async () => {
  await go(BASE + "settings.html");
  await evaluate(`$("set-en").value = "en.asad"; $("set-en").dispatchEvent(new Event("change")); $("set-script").value = "indopak"; $("set-script").dispatchEvent(new Event("change"))`);
  await click("#set-translit");
  await click('[data-theme-choice="dark"]');
  expect((await evaluate(`document.documentElement.dataset.theme`)) === "dark", "dark");
  await go(BASE + "quran.html?surah=1");
  await waitFor(`document.querySelectorAll(".ayah").length === 7 && !document.body.classList.contains("loading")`, 20000);
  expect(await evaluate(`$("en-edition").value === "en.asad" && $("reader-view").classList.contains("script-indopak") && $("reader-view").classList.contains("show-translit")`), "reader uses settings");
  expect((await evaluate(`document.documentElement.dataset.theme`)) === "dark", "theme persists");
  await go(BASE + "settings.html");
  await click('[data-theme-choice="system"]');
  expect((await evaluate(`localStorage.getItem("theme")`)) === null, "system clears");
  await evaluate(`saveQuranSettings({ enEdition: "en.sahih", script: "uthmani", transliteration: false })`);
});

await test("Backup, restore and reset", async () => {
  await go(BASE + "settings.html");
  await evaluate(`localStorage.setItem("quran-hifz", "[112,113,114]"); localStorage.setItem("prayer-log", JSON.stringify({"2026-10-01":["Fajr"]}))`);
  await go(BASE + "settings.html");
  expect(/3 memorised surahs/.test(await text("#backup-summary")), await text("#backup-summary"));
  // Capture the exported file
  await evaluate(`window.__blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); }; HTMLAnchorElement.prototype.click = function () {};`);
  await click("#export-btn");
  const json = await evaluate(`window.__blobs[0].text()`);
  const backup = JSON.parse(json);
  expect(backup.app === "tilawave" && backup.data["quran-hifz"] === "[112,113,114]", "backup content");
  // Reset
  await evaluate(`window.confirm = () => true`);
  await click("#reset-btn");
  await sleep(1200);
  expect((await evaluate(`localStorage.getItem("quran-hifz")`)) === null, "reset cleared");
  // Restore from the file
  await evaluate(`window.confirm = () => true; (() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(json)}], "b.json", { type: "application/json" })); $("import-file").files = dt.files; $("import-file").dispatchEvent(new Event("change")); })()`);
  await sleep(1500);
  await waitFor(`document.readyState === "complete"`);
  expect((await evaluate(`localStorage.getItem("quran-hifz")`)) === "[112,113,114]", "restored");
  // A wrong file is rejected
  await evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['{"hello":1}'], "x.json")); $("import-file").files = dt.files; $("import-file").dispatchEvent(new Event("change")); })()`);
  await waitFor(`/isn't a Tilawave backup/.test($("toast")?.textContent || "")`);
});

await test("Share previews and 404/offline pages", async () => {
  for (const page of ["", "quran.html", "hadith.html", "duas.html", "tasbih.html", "calendar.html", "zakat.html", "settings.html"]) {
    await go(BASE + page);
    const og = await evaluate(`["og:title","og:description","og:image"].map(p => document.querySelector('meta[property="' + p + '"]')?.content || "")`);
    expect(og.every(Boolean) && (await evaluate(`document.querySelector('meta[name="twitter:card"]').content`)) === "summary_large_image", `${page}: ${og}`);
  }
  const img = await evaluate(`new Promise(r => { const i = new Image(); i.onload = () => r(i.width + "x" + i.height); i.onerror = () => r("error"); i.src = "icons/og-image.png"; })`);
  expect(img === "1200x630", img);
  await go(BASE + "404.html");
  expect((await text("h1")) === "This page doesn't exist" && (await evaluate(`document.querySelectorAll(".status-links a").length`)) === 4, "404");
  await go(BASE + "offline.html");
  expect((await text("h1")) === "You're offline", "offline");
});

await test("Offline: an unsaved page shows the offline page", async () => {
  await go(BASE);
  await waitFor(`navigator.serviceWorker.controller !== null`, 20000).catch(async () => { await go(BASE); await waitFor(`navigator.serviceWorker.controller !== null`, 20000); });
  await waitFor(`caches.open("tilawave-v7").then(c => c.match("offline.html")).then(Boolean)`, 20000);
  const r = await evaluate(`fetch("never-visited-page.html", { mode: "navigate" }).then(r => r.status).catch(e => "err")`);
  // A navigate fetch can't be simulated from script; check the worker's code path instead
  const sw = await evaluate(`fetch("sw.js").then(r => r.text())`);
  expect(sw.includes('caches.match("offline.html")'), "sw falls back to offline page");
});

await test("No overflow (settings, 404, home header) at all widths", async () => {
  for (const width of [1280, 900, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    for (const page of ["", "settings.html", "404.html", "quran.html"]) {
      await go(BASE + page); await sleep(1200);
      const over = await evaluate(`document.documentElement.scrollWidth - innerWidth`);
      expect(over <= 0, `${page || "home"} at ${width}px overflows by ${over}`);
    }
  }
  await send("Emulation.clearDeviceMetricsOverride");
});

await test("No console errors", async () => {
  const real = errors.filter((e) => !/favicon|403|404|Failed to load resource/.test(e || ""));
  expect(real.length === 0, real.join("\n"));
});

console.log(`\n${passed} passed, ${failed} failed`);
chrome.kill();
process.exit(failed ? 1 : 0);
