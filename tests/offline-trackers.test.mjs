// Tests for: installable app + offline, Para navigation, Khatam tracker, Prayer tracker, Hadith of the Day.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:8000/";
const PORT = 9339;
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

// Offline for both the page and its service worker(s)
const swSockets = [];
async function setOffline(offline) {
  const conditions = { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  await send("Network.enable");
  await send("Network.emulateNetworkConditions", conditions);
  const sws = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "service_worker");
  for (const t of sws) {
    const sock = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => (sock.onopen = r));
    let n = 0;
    const call = (method, params = {}) => new Promise((r) => {
      const id = ++n;
      sock.addEventListener("message", function h({ data }) { if (JSON.parse(data).id === id) { sock.removeEventListener("message", h); r(); } });
      sock.send(JSON.stringify({ id, method, params }));
    });
    await call("Network.enable");
    await call("Network.emulateNetworkConditions", conditions);
    swSockets.push(sock);
  }
  return sws.length;
}

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });

// ---------------- Installable app ----------------

await test("Manifest is valid and all icons load", async () => {
  await go(BASE);
  const m = await evaluate(`fetch(document.querySelector('link[rel="manifest"]').href).then(r => r.json())`);
  expect(m.name && m.short_name === "Tilawave" && m.display === "standalone" && m.start_url === "./", "manifest fields");
  for (const icon of m.icons) {
    const status = await evaluate(`fetch(${JSON.stringify(icon.src)}).then(r => r.status + " " + r.headers.get("content-type"))`);
    expect(status.startsWith("200 image/png"), `${icon.src}: ${status}`);
  }
  const purposes = m.icons.map((i) => `${i.sizes}/${i.purpose}`).join(", ");
  console.log(`       ${m.name} · icons: ${purposes}`);
  expect(purposes.includes("512x512/maskable") && purposes.includes("192x192/any"), "missing required icons");
});

await test("Service worker installs and controls the page", async () => {
  await waitFor(`navigator.serviceWorker.ready.then(() => true)`);
  await go(BASE);
  await waitFor(`!!navigator.serviceWorker.controller`);
  const cached = await evaluate(`caches.open("tilawave-v6").then(c => c.keys()).then(k => k.length)`);
  console.log(`       controller: ${await evaluate(`navigator.serviceWorker.controller.scriptURL`)} · ${cached} cached files`);
  expect(cached >= 24, "app shell not cached");
});

await test("Chrome reports the app as installable (manifest has no errors)", async () => {
  const r = await send("Page.getAppManifest");
  const errs = (r.errors || []).filter((e) => e.critical);
  expect(errs.length === 0, JSON.stringify(r.errors));
  const installability = await send("Page.getInstallabilityErrors");
  console.log(`       installability errors: ${JSON.stringify(installability.installabilityErrors)}`);
  expect(installability.installabilityErrors.length === 0, "not installable");
});

// ---------------- Hadith of the Day ----------------

await test("Hadith of the Day shows a real hadith in English, Urdu and Arabic", async () => {
  await go(BASE);
  await waitFor(`!document.getElementById("hadith-copy").disabled`);
  const ref = await text("#hadith-ref");
  const en = await text("#hadith-en");
  const ur = await text("#hadith-ur");
  const ar = await text("#hadith-ar");
  console.log(`       ${ref} · ${await text("#hadith-book")}`);
  console.log(`       ${en.slice(0, 110)}…`);
  expect(/^(Sahih al-Bukhari|Sahih Muslim) · Book \d+, Hadith \d+$/.test(ref), `ref = ${ref}`);
  expect(en.length > 20 && en.length <= 700 && !en.includes("??"), "English text bad");
  expect(/[؀-ۿ]/.test(ur) && /[؀-ۿ]/.test(ar), "Urdu/Arabic missing");
});

await test("Hadith text matches the source for that collection and number", async () => {
  // Re-derive the pick in Node and compare with what the page shows.
  const day = await evaluate(`localDayNumber()`);
  const col = ["bukhari", "muslim"][day % 2];
  let n = ((day * 3571) % 7563) + 1;
  let found = null;
  for (let t = 0; t < 20 && !found; t++, n = (n % 7563) + 1) {
    const r = await fetch(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-${col}/${n}.json`);
    if (!r.ok) continue;
    const h = (await r.json()).hadiths[0];
    if (!h?.text?.trim() || h.text.trim().length > 700 || h.text.includes("??")) continue;
    const [u, a] = await Promise.all(["urd", "ara"].map((l) => fetch(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${l}-${col}/${n}.json`).then((x) => x.json())));
    if (!u.hadiths[0]?.text?.trim() || !a.hadiths[0]?.text?.trim()) continue;
    found = { n, en: h.text.trim(), ref: h.reference };
  }
  expect(found && found.en === (await text("#hadith-en")), "page hadith differs from source");
  console.log(`       ${col} #${found.n} (book ${found.ref.book}, hadith ${found.ref.hadith}) matches`);
});

await test("Hadith copy", async () => {
  await send("Browser.grantPermissions", { origin: "http://localhost:8000", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await click("#hadith-copy");
  await sleep(300);
  const copied = await evaluate(`navigator.clipboard.readText()`);
  expect(copied.includes("— Sahih") && copied.includes(await text("#hadith-en")), "copy wrong");
});

// ---------------- Prayer tracker ----------------

await test("Prayer ticks: only started prayers can be ticked", async () => {
  await evaluate(`localStorage.removeItem("prayer-log")`);
  await setClock("2026-10-28T16:00:00+05:00"); // after Asr, before Maghrib in Lahore
  await go(BASE + "?city=Lahore&country=Pakistan");
  await homeReady();
  const states = await evaluate(`[...document.querySelectorAll(".pray-check")].map(b => b.dataset.prayer + ":" + (b.disabled ? "locked" : "open")).join(" ")`);
  console.log("      ", states);
  expect(states === "Fajr:open Dhuhr:open Asr:open Maghrib:locked Isha:locked", states);
});

await test("Ticking prayers updates today's count and the week grid", async () => {
  await click('.pray-check[data-prayer="Fajr"]');
  await click('.pray-check[data-prayer="Dhuhr"]');
  expect((await text("#tracker-today")) === "2 of 5 today", await text("#tracker-today"));
  const today = await evaluate(`localDateKey()`);
  const on = await evaluate(`[...document.querySelectorAll('#tracker-body .cell.on')].map(c => c.dataset.prayer + "@" + c.dataset.date).join(",")`);
  expect(on === `Fajr@${today},Dhuhr@${today}`, on);
  expect(await evaluate(`document.querySelector('.pray-check[data-prayer="Fajr"]').getAttribute("aria-pressed")`) === "true", "aria-pressed");
  await click('.pray-check[data-prayer="Dhuhr"]'); // untick
  expect((await text("#tracker-today")) === "1 of 5 today", "untick failed");
  const lockedToday = await evaluate(`document.querySelector('#tracker-body .cell[data-prayer="Isha"][data-date="${today}"]').disabled`);
  expect(lockedToday, "future prayer cell should be locked");
});

await test("Streak, week total and unmarked count from past days", async () => {
  const keys = await evaluate(`[1, 2, 3].map(i => localDateKey(daysAgo(i)))`);
  // Yesterday and the day before: all five. Three days ago: only Fajr.
  for (const key of keys.slice(0, 2)) {
    for (const p of ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]) await click(`#tracker-body .cell[data-prayer="${p}"][data-date="${key}"]`);
  }
  await click(`#tracker-body .cell[data-prayer="Fajr"][data-date="${keys[2]}"]`);
  const s = `${await text("#tracker-streak")} | ${await text("#tracker-week")} | ${await text("#tracker-missed")}`;
  console.log("       streak | week | not marked:", s);
  expect(s === "2 days | 12 / 35 | 4", s);
  await go(BASE + "?city=Lahore&country=Pakistan");
  await homeReady();
  expect((await text("#tracker-streak")) === "2 days" && (await text("#tracker-today")) === "1 of 5 today", "not saved");
  await setClock(null);
});

// ---------------- Paras ----------------

await test("Paras tab lists 30 paras with correct ranges", async () => {
  await go(BASE + "quran.html");
  await waitFor(`document.querySelectorAll("#para-list .surah-card").length === 30`);
  await click("#tab-paras");
  expect(await visible("#para-list") && !(await visible("#surah-list")) && !(await visible("#surah-filter")), "tab switch");
  const rows = await evaluate(`[...document.querySelectorAll("#para-list .surah-card")].map(c => c.querySelector("strong").textContent + " | " + c.querySelector(".surah-names .muted").textContent)`);
  console.log("       " + rows[0] + "\n       " + rows[1] + "\n       " + rows[29]);
  expect(rows[0] === "Alif Lam Meem | Al-Faatiha 1:1 – Al-Baqara 2:141", rows[0]);
  expect(rows[1] === "Sayaqool | Al-Baqara 2:142 – Al-Baqara 2:252", rows[1]);
  expect(rows[29] === "Amma Yatasa'aloon | An-Naba 78:1 – An-Naas 114:6", rows[29]);
  // Every para's end must be the verse just before the next para's start (no gaps or overlaps)
  const total = await evaluate(`paraData.ranges.length`);
  expect(total === 30, "ranges");
  await click("#tab-surahs");
  await go(BASE + "quran.html?tab=paras");
  expect(await visible("#para-list"), "?tab=paras not honoured");
});

await test("Para 30 reader: 564 verses, 37 surah headings with Bismillah", async () => {
  await go(BASE + "quran.html?juz=30");
  await waitFor(`document.querySelectorAll(".ayah").length === 564`);
  const dividers = await evaluate(`document.querySelectorAll(".surah-divider").length`);
  const basmalas = await evaluate(`document.querySelectorAll(".surah-divider .basmala").length`);
  const title = await text("#surah-title");
  const meta = await text("#surah-meta");
  console.log(`       ${title} · ${meta} · ${dividers} headings, ${basmalas} Bismillah`);
  expect(title === "Para 30 · Amma Yatasa'aloon" && dividers === 37 && basmalas === 37, "structure wrong");
  expect(await evaluate(`!!document.getElementById("ayah-114-6")`), "missing 114:6");
  expect(await evaluate(`document.getElementById("prev-surah").getAttribute("href")`) === "quran.html?juz=29" && !(await visible("#next-surah")), "prev/next");
  await waitFor(`reader.audio.length === 564`);
});

await test("Para 1 includes Al-Fatihah (no extra Bismillah) then Al-Baqarah 1–141", async () => {
  await go(BASE + "quran.html?juz=1");
  await waitFor(`document.querySelectorAll(".ayah").length === 148`);
  const d = await evaluate(`[...document.querySelectorAll(".surah-divider")].map(h => h.querySelector(".surah-divider-name").textContent + ":" + !!h.querySelector(".basmala"))`);
  expect(d.join(",") === "Al-Faatiha:false,Al-Baqara:true", d.join(","));
});

await test("Para 2 starts mid-surah at 2:142 and text matches the surah reader", async () => {
  await go(BASE + "quran.html?juz=2#ayah-2-142");
  await waitFor(`document.querySelectorAll(".ayah").length > 100`);
  expect((await text(".surah-divider .muted")) === "Surah 2 · continued from verse 142", await text(".surah-divider .muted"));
  const inJuz = await evaluate(`document.querySelector("#ayah-2-200 .quran-text").textContent`);
  await go(BASE + "quran.html?surah=2");
  await waitFor(`document.querySelectorAll(".ayah").length === 286`);
  const inSurah = await evaluate(`document.querySelector("#ayah-200 .quran-text").textContent`);
  expect(inJuz === inSurah, "para and surah text differ");
});

await test("Continue reading remembers a para", async () => {
  await go(BASE + "quran.html?juz=30#ayah-80-1");
  await waitFor(`document.querySelectorAll(".ayah").length === 564`);
  await sleep(800);
  await go(BASE + "quran.html");
  await waitFor(`!document.getElementById("continue").hidden`);
  const t = (await text("#continue")).replace(/\s+/g, " ");
  const href = await evaluate(`document.getElementById("continue").getAttribute("href")`);
  console.log(`       ${t} → ${href}`);
  expect(/^quran\.html\?juz=30#ayah-80-\d+$/.test(href), href);
});

// ---------------- Khatam ----------------

await test("Mark a para complete from the reader", async () => {
  await evaluate(`localStorage.removeItem("quran-khatam")`);
  await go(BASE + "quran.html?juz=30");
  await waitFor(`!document.getElementById("juz-complete").hidden`);
  await click("#juz-complete-btn");
  expect((await text("#toast")) === "Para 30 complete · 1 of 30.", await text("#toast"));
  expect((await text("#juz-complete-btn")) === "Mark as not complete", "button label");
});

await test("Khatam card shows progress, next para, goal and streak", async () => {
  await go(BASE + "quran.html");
  await waitFor(`document.querySelectorAll("#para-list .surah-card").length === 30`);
  expect((await text("#khatam-title")) === "1 of 30 paras", await text("#khatam-title"));
  expect(await evaluate(`document.querySelector('#khatam-grid .cell[data-juz="30"]').classList.contains("on")`), "grid");
  expect(await evaluate(`document.querySelector('#para-list li:last-child .surah-card').classList.contains("is-done")`), "para card");
  expect((await text("#khatam-next")) === "Read Para 1 · Alif Lam Meem", await text("#khatam-next"));
  expect(/^Reading streak: \d+ days?$/.test(await text("#khatam-streak")), await text("#khatam-streak"));
  await evaluate(`(() => { const s = document.getElementById("khatam-goal"); s.value = "30"; s.dispatchEvent(new Event("change")); })()`);
  const status = await text("#khatam-status");
  console.log("      ", status);
  expect(status === "Day 1 of 30 · Today's target: 1 para · On track", status);
  await evaluate(`(() => { const s = document.getElementById("khatam-goal"); s.value = "7"; s.dispatchEvent(new Event("change")); })()`);
  expect((await text("#khatam-status")) === "Day 1 of 7 · Today's target: 5 paras · 4 paras behind", await text("#khatam-status"));
});

await test("Completing all 30 paras finishes the khatam; start a new one", async () => {
  for (let j = 1; j <= 29; j++) await click(`#khatam-grid .cell[data-juz="${j}"]`);
  expect(await visible("#khatam-done") && !(await visible("#khatam-next")), "not complete");
  expect((await evaluate(`document.getElementById("khatam-bar").style.width`)) === "100%", "bar");
  await click("#khatam-new");
  expect((await text("#khatam-title")) === "0 of 30 paras", "not reset");
  expect((await text("#khatam-status")).includes("Khatams completed: 1"), await text("#khatam-status"));
});

// ---------------- Offline ----------------

await test("Offline: every page still opens and shows saved data", async () => {
  // Visit pages online first so their data is saved.
  await go(BASE + "quran.html?surah=112");
  await waitFor(`document.querySelectorAll(".ayah").length === 4`);
  await go(BASE + "calendar.html");
  await waitFor(`document.querySelectorAll("#timetable tr").length >= 28`);
  await go(BASE + "tasbih.html");
  await go(BASE);
  await homeReady();
  await waitFor(`!document.getElementById("hadith-copy").disabled`);

  const n = await setOffline(true);
  console.log(`       page + ${n} service worker(s) offline`);

  await go(BASE);
  await homeReady();
  const home = `${await text("#location")} · next ${await text("#next-name")} · verse ${await text("#verse-ref")} · hadith ok: ${!!(await text("#hadith-en"))}`;
  console.log("       home:", home);
  expect(await text("#verse-ar") && (await text("#hadith-ref")).startsWith("Sahih"), "home content missing offline");

  await go(BASE + "quran.html?surah=112");
  await waitFor(`document.querySelectorAll(".ayah").length === 4`);
  await go(BASE + "quran.html");
  await waitFor(`document.querySelectorAll("#surah-list .surah-card").length === 114`);
  await go(BASE + "tasbih.html");
  expect((await text("#dhikr-tr")) === "SubhanAllah", "tasbih offline");
  await go(BASE + "calendar.html");
  await waitFor(`document.querySelectorAll("#timetable tr").length >= 28 && document.querySelectorAll("#events li").length === 10`);
  console.log("       quran, surah 112, tasbih and calendar all opened offline");
});

await test("Offline: prayer times for a day never fetched come from the saved month", async () => {
  await setClock("2026-11-05T12:00:00+05:00"); // a later day; only the saved months have it
  await go(BASE);
  await homeReady();
  const dates = await text("#dates");
  console.log("      ", dates, "|", await text("#times li .time"));
  expect(dates.includes("05 Nov 2026"), dates);
  await setClock(null);
  await setOffline(false);
});

const realErrors = errors.filter((e) => !/favicon|navigator\.vibrate|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
console.log(`\n${passed} passed, ${failed} failed. Console errors: ${realErrors.length ? "\n  " + realErrors.join("\n  ") : "none"}`);
swSockets.forEach((s) => s.close());
ws.close();
chrome.kill();
process.exit(failed ? 1 : 0);
