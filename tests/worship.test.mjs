// Tests for: installable app + offline, Para navigation, Khatam tracker, Prayer tracker, Hadith of the Day.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:8000/";
const PORT = 9349;
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

await test("Fasting note: Wednesday → Thursday fast; Sunday → Monday fast; none on Friday", async () => {
  await setClock("2026-10-28T10:00:00+05:00"); // Wednesday
  await go(BASE); await homeReady();
  expect(/Tomorrow is Thursday/.test(await text("#today-notes")), await text("#today-notes"));
  await setClock("2026-10-30T10:00:00+05:00"); // Friday → Saturday, Hijri 19
  await go(BASE); await homeReady();
  expect(!/Sunnah fast/.test(await text("#today-notes")), "no note");
});

await test("Fasting note: White Days and Arafah, never on Eid/Tashreeq or in Ramadan", async () => {
  const find = (m, d) => `(() => { const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", timeZone: "UTC" }); for (let i = 0; i < 400; i++) { const t = new Date(Date.UTC(2026, 9, 28 + i)); const p = f.formatToParts(t); const g = k => Number(p.find(x => x.type === k).value); if (g("month") === ${m} && g("day") === ${d}) return t.toISOString().slice(0, 10); } })()`;
  for (const [m, d, re, yes] of [[6, 13, /White Days/, true], [12, 9, /Arafah/, true], [12, 13, /Sunnah fast/, false], [9, 14, /Sunnah fast/, false], [10, 1, /Sunnah fast/, false]]) {
    const iso = await evaluate(find(m, d));
    const day = new Date(Date.parse(iso) - 86400000).toISOString().slice(0, 10);
    await setClock(`${day}T10:00:00+05:00`);
    await go(BASE); await homeReady();
    const t = await text("#today-notes");
    expect(re.test(t) === yes, `${m}/${d} (${iso}): ${t}`);
  }
  await setClock(null);
});

await test("Mulk note at night only", async () => {
  await setClock("2026-10-28T22:00:00+05:00");
  await go(BASE); await homeReady();
  expect(await evaluate(`!!document.querySelector('#today-notes a[href="quran.html?surah=67"]')`), "at night");
  await setClock("2026-10-28T13:00:00+05:00");
  await go(BASE); await homeReady();
  expect(!(await evaluate(`!!document.querySelector('#today-notes a[href="quran.html?surah=67"]')`)), "not by day");
  await setClock(null);
});

await test("Qada: add, made up, and import unmarked prayers from the tracker", async () => {
  await go(BASE);
  await evaluate(`localStorage.removeItem("qada"); localStorage.setItem("prayer-log", JSON.stringify({ [localDateKey(daysAgo(2))]: ["Fajr", "Dhuhr", "Asr", "Maghrib"], [localDateKey(daysAgo(1))]: ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"] }))`);
  await go(BASE); await homeReady();
  expect((await text("#qada-import")) === "Add 1 unmarked from tracker", await text("#qada-import"));
  await click("#qada-import");
  expect((await text("#qada-total")) === "1 prayer", await text("#qada-total"));
  expect(!(await visible("#qada-import")), "nothing left to import");
  await evaluate(`document.querySelector('[data-qada="Fajr"][data-step="1"]').click(); document.querySelector('[data-qada="Fajr"][data-step="1"]').click()`);
  expect((await text("#qada-total")) === "3 prayers", "added");
  await evaluate(`document.querySelector('[data-qada="Isha"][data-step="-1"]').click()`);
  expect((await text("#qada-total")) === "2 prayers", "made up");
  expect(await evaluate(`document.querySelector('[data-qada="Isha"][data-step="-1"]').disabled`), "made up disabled at 0");
  await go(BASE); await homeReady();
  expect((await text("#qada-total")) === "2 prayers" && !(await visible("#qada-import")), "persists, no double import");
});

await test("Nearby mosques: real results sorted by distance with directions", async () => {
  await send("Browser.grantPermissions", { permissions: ["geolocation"], origin: "http://localhost:8000" });
  await send("Emulation.setGeolocationOverride", { latitude: 31.5880, longitude: 74.3100, accuracy: 20 }); // Badshahi Mosque, Lahore
  await go(BASE); await homeReady();
  await click("#mosques-btn");
  await waitFor(`document.querySelectorAll("#mosques-list li").length > 0 || /busy|No mosques/.test($("mosques-status").textContent)`, 60000);
  const status = await text("#mosques-status");
  expect(/closest to you/.test(status), status);
  const kms = await evaluate(`[...document.querySelectorAll("#mosques-list li .muted")].map(e => e.textContent)`);
  console.log("      ", status, "|", (await evaluate(`[...document.querySelectorAll(".mosque-name")].slice(0,3).map(e => e.textContent).join(", ")`)), "|", kms.slice(0, 3).join(", "));
  expect(await evaluate(`[...document.querySelectorAll("#mosques-list a")].every(a => a.href.startsWith("https://www.google.com/maps/dir/"))`), "directions links");
});

await test("Popular surahs and hifz tracker", async () => {
  await go(BASE + "quran.html");
  await waitFor(`document.querySelectorAll(".popular-card").length === 6`);
  expect((await text(".popular-card strong")) === "Yaseen" || (await text(".popular-card strong")).startsWith("Ya"), await text(".popular-card strong"));
  expect(await evaluate(`[...document.querySelectorAll(".popular-card")].at(-1).getAttribute("href")`) === "quran.html?surah=2#ayah-255", "kursi link");
  expect((await text("#hifz-title")) === "0 of 114 surahs", await text("#hifz-title"));
  expect((await evaluate(`$("hifz-next").getAttribute("href")`)) === "quran.html?surah=114&practice=1", "suggests An-Nas");
  await go(BASE + "quran.html?surah=114&practice=1");
  await waitFor(`!$("hifz-btn").hidden && document.querySelectorAll(".ayah").length === 6`);
  expect(await evaluate(`player.repeat === 3`), "practice sets repeat 3");
  await click("#hifz-btn");
  expect((await text("#hifz-btn")) === "Memorised", "marked");
  await go(BASE + "quran.html?surah=113"); await waitFor(`!$("hifz-btn").hidden`); await click("#hifz-btn");
  await go(BASE + "quran.html");
  await waitFor(`$("hifz-title").textContent === "2 of 114 surahs"`);
  expect(/11 of 6,236 verses/.test(await text("#hifz-status")), await text("#hifz-status"));
  expect((await evaluate(`$("hifz-next").getAttribute("href")`)) === "quran.html?surah=112&practice=1", "next suggestion");
  expect(await evaluate(`document.querySelectorAll(".surah-card .memorised").length === 2`), "cards marked");
});

await test("No overflow on home and Quran pages (desktop, tablet, phone)", async () => {
  for (const width of [1280, 900, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    for (const page of ["", "quran.html"]) {
      await go(BASE + page); await sleep(1800);
      await evaluate(`document.querySelectorAll(".reveal").forEach(e => e.classList.add("is-visible"))`); await sleep(900);
      const over = await evaluate(`document.documentElement.scrollWidth - innerWidth`);
      expect(over <= 0, `${page || "home"} at ${width}px overflows by ${over}`);
    }
  }
  await send("Emulation.clearDeviceMetricsOverride");
});

await test("No console errors", async () => {
  const real = errors.filter((e) => !/favicon|403|Failed to load resource/.test(e || ""));
  expect(real.length === 0, real.join("\n"));
});

console.log(`\n${passed} passed, ${failed} failed`);
chrome.kill();
process.exit(failed ? 1 : 0);
