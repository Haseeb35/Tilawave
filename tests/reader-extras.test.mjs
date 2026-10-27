// Tests for: installable app + offline, Para navigation, Khatam tracker, Prayer tracker, Hadith of the Day.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:8000/";
const PORT = 9345;
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

// ---------- Home notes ----------
await test("Jummah note shows on Friday (and not on Thursday)", async () => {
  await setClock("2026-10-30T09:00:00+05:00"); // Friday, Lahore morning
  await go(BASE);
  await waitFor(`document.querySelectorAll("#times li").length === 6`);
  expect(/Al-Kahf/.test(await text("#today-notes")), await text("#today-notes"));
  expect(await evaluate(`document.querySelector('#today-notes a[href="quran.html?surah=18"]') !== null`), "link");
  await setClock("2026-10-29T09:00:00+05:00");
  await go(BASE);
  await waitFor(`document.querySelectorAll("#times li").length === 6`);
  expect(!/Al-Kahf/.test(await text("#today-notes")), "no note Thursday");
});

await test("Daily reading plan follows the khatam goal", async () => {
  await evaluate(`localStorage.setItem("quran-khatam", JSON.stringify({ completed: [1, 2], goalDays: 30, goalStart: localDateKey(daysAgo(4)), khatams: 0 }))`);
  await go(BASE);
  await waitFor(`/Today's reading/i.test($("today-notes").textContent)`);
  // day 5 of 30 → target 5, done 2 → 3 left; next para is 3
  expect(/Read 3 paras today to stay on your 30-day khatam/.test(await text("#today-notes")), await text("#today-notes"));
  expect(await evaluate(`!!document.querySelector('#today-notes a[href="quran.html?juz=3"]')`), "next para link");
});

await test("Tracker reminder after Isha lists unmarked prayers", async () => {
  await setClock("2026-10-29T21:30:00+05:00");
  await evaluate(`localStorage.setItem("prayer-log", JSON.stringify({ [localDateKey()]: ["Fajr", "Dhuhr"] }))`);
  await go(BASE);
  await waitFor(`document.querySelectorAll("#times li").length === 6 && /marked/.test($("today-notes").textContent)`);
  expect(/You haven't marked Asr, Maghrib and Isha today/.test(await text("#today-notes")), await text("#today-notes"));
  await evaluate(`document.querySelector('#tracker-body button[data-prayer="Asr"][data-date="' + localDateKey() + '"]').click()`);
  expect(/Maghrib and Isha/.test(await text("#today-notes")), "updates on tick");
  await setClock("2026-10-29T14:00:00+05:00");
  await go(BASE);
  await waitFor(`document.querySelectorAll("#times li").length === 6`);
  expect(!/marked/.test(await text("#today-notes")), "not before Isha");
  await setClock(null);
});

await test("Share verse and hadith of the day as an image", async () => {
  await go(BASE);
  await evaluate(captureShare);
  await waitFor(`!$("verse-share").disabled && !$("hadith-share").disabled`, 30000);
  await click("#verse-share");
  await waitFor(`window.__shared.length === 1`);
  await click("#hadith-share");
  await waitFor(`window.__shared.length === 2`);
  const names = await evaluate(`window.__shared`);
  expect(names.every((n) => /^tilawave-.*\.png$/.test(n)), names.join());
});

// ---------- Quran ----------
await test("Search history keeps the last 5 and repeats a search", async () => {
  await go(BASE + "quran.html");
  for (const q of ["mercy", "patience", "light", "prayer", "night", "mercy"]) {
    await evaluate(`$("search-q").value = ${JSON.stringify(q)}; $("search-form").requestSubmit()`);
    await sleep(100);
  }
  const chips = await evaluate(`[...document.querySelectorAll("#recent-searches .chip")].map(c => c.textContent)`);
  expect(chips.join() === "mercy,night,prayer,light,patience", chips.join());
  await go(BASE + "quran.html");
  await evaluate(`[...document.querySelectorAll("#recent-searches .chip")][1].click()`);
  await waitFor(`/found for “night”/.test($("results-summary").textContent)`, 20000);
  await click("#recent-searches [data-clear]");
  expect(!(await visible("#recent-searches")), "cleared");
});

await test("Keyboard: arrows, B, T, S, Space", async () => {
  await go(BASE + "quran.html?surah=112");
  await waitFor(`document.querySelectorAll(".ayah").length === 4 && reader.audio.length === 4`, 20000);
  await evaluate(captureShare);
  const key = (k) => evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
  await key("b");
  expect(await evaluate(`isBookmarked(112, 1)`), "bookmarked first verse");
  await key("b");
  await key("t");
  await waitFor(`$("tafsir").open && $("tafsir-title").textContent.includes("112:1")`);
  await evaluate(`$("tafsir").close()`);
  await key("s");
  await waitFor(`window.__shared.length === 1`);
  await key(" ");
  await waitFor(`player.index === 0 && !player.audio.paused`, 15000);
  await key("ArrowRight");
  await waitFor(`player.index === 1`);
  await key("ArrowLeft");
  await waitFor(`player.index === 0`);
  await key(" ");
  await waitFor(`player.audio.paused`);
});

await test("Repeat a verse 3 times before moving on", async () => {
  await click("#player-repeat");
  expect((await text("#repeat-label")) === "1 of 3", await text("#repeat-label"));
  await evaluate(`playAyah(2)`);
  await waitFor(`!player.audio.paused`, 15000);
  await evaluate(`player.audio.dispatchEvent(new Event("ended"))`);
  expect(await evaluate(`player.index === 2 && player.plays === 2`), "replays same verse");
  await evaluate(`player.audio.dispatchEvent(new Event("ended"))`);
  await evaluate(`player.audio.dispatchEvent(new Event("ended"))`);
  await waitFor(`player.index === 3`);
  expect((await text("#repeat-label")) === "1 of 3", "count resets on next verse");
  for (let i = 0; i < 3; i++) await click("#player-repeat");
  expect((await text("#repeat-label")) === "1×", "cycles back to off");
});

await test("Sleep timer cycles and pauses recitation when it ends", async () => {
  await click("#player-sleep");
  expect((await text("#sleep-label")) === "15 min", await text("#sleep-label"));
  await click("#player-sleep");
  expect((await text("#sleep-label")) === "30 min", "30");
  await evaluate(`player.audio.play().catch(() => {}); sleep.endsAt = Date.now() - 1`);
  await waitFor(`player.audio.paused && $("sleep-label").textContent === "Off"`, 20000);
  await evaluate(`stopPlayer()`);
});

await test("Indo-Pak script loads real text from Quran.com and persists", async () => {
  await go(BASE + "quran.html?surah=2");
  await waitFor(`document.querySelectorAll(".ayah").length === 286`, 30000);
  await evaluate(`$("script").value = "indopak"; $("script").dispatchEvent(new Event("change"))`);
  await waitFor(`$("reader-view").classList.contains("script-indopak") && !document.body.classList.contains("loading") && reader.items[1].ar.includes("ۡ")`, 20000);
  const api = await evaluate(`fetch("https://api.quran.com/api/v4/quran/verses/indopak?verse_key=2:2").then(r => r.json()).then(j => j.verses[0].text_indopak.replace(/[\\u200e\\u200f\\ue000-\\uf8ff]/g, "").trim())`);
  expect((await evaluate(`reader.items[1].ar`)) === api, "matches API");
  expect((await evaluate(`getComputedStyle(document.querySelector("#ayah-2 .quran-text")).fontFamily`)).includes("IndoPak"), "font");
  expect(await evaluate(`document.fonts.check('30px "IndoPak"')`), "font loaded");
  expect((await text("#basmala")).includes("بِسۡمِ"), await text("#basmala"));
  await go(BASE + "quran.html?juz=30");
  await waitFor(`document.querySelectorAll(".ayah").length > 500`, 30000);
  expect(await evaluate(`reader.items[0].ar.includes("ۡ") && $("reader-view").classList.contains("script-indopak")`), "para in indo-pak");
  await evaluate(`saveQuranSettings({ script: "uthmani" })`);
});

// ---------- Duas, hadith: share and print ----------
await test("Share a dua and a hadith; print buttons", async () => {
  await go(BASE + "duas.html");
  await waitFor(`document.querySelectorAll(".dua").length === 10`, 30000);
  await evaluate(captureShare + ` window.print = () => (window.__printed = true);`);
  await evaluate(`document.querySelector('.dua [data-action="share"]').click()`);
  await waitFor(`window.__shared.length === 1`);
  await click("#print-duas");
  expect(await evaluate(`window.__printed === true`), "print called");
  await go(BASE + "hadith.html?c=nawawi");
  await waitFor(`document.querySelectorAll(".hadith-item").length === 42`);
  await evaluate(captureShare + ` window.print = () => (window.__printed = true);`);
  await evaluate(`document.querySelector('.hadith-item [data-action="share"]').click()`);
  await waitFor(`window.__shared.length === 1`);
  await click("#print-book");
  await waitFor(`window.__printed === true`);
});

await test("Print layout hides controls", async () => {
  await send("Emulation.setEmulatedMedia", { media: "print" });
  expect(!(await visible(".hadith-tools")) && !(await visible(".topbar")) && !(await visible(".hadith-actions")), "controls hidden");
  await send("Emulation.setEmulatedMedia", { media: "" });
});

await test("No console errors", async () => {
  const real = errors.filter((e) => !/favicon|403|Failed to load resource/.test(e || ""));
  expect(real.length === 0, real.join("\n"));
});

console.log(`\n${passed} passed, ${failed} failed`);
chrome.kill();
process.exit(failed ? 1 : 0);
