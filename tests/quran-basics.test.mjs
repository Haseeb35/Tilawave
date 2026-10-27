// End-to-end tests for Verse of the Day, alerts, Ramadan, Quran reader/search/bookmarks, Tasbih and Calendar.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:8000/";
const PORT = 9336;
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

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });

// ---------------- Home page ----------------

await test("Navigation links on every page", async () => {
  for (const [page, file] of [["home", ""], ["quran", "quran.html"], ["hadith", "hadith.html"], ["duas", "duas.html"], ["tasbih", "tasbih.html"], ["calendar", "calendar.html"], ["zakat", "zakat.html"]]) {
    await go(BASE + file);
    const links = await evaluate(`[...document.querySelectorAll(".nav a")].map(a => a.getAttribute("href")).join(",")`);
    const current = await evaluate(`document.querySelector('.nav a[aria-current="page"]')?.dataset.page`);
    expect(links === "./,quran.html,hadith.html,duas.html,tasbih.html,calendar.html,zakat.html", `${page}: links ${links}`);
    expect(current === page, `${page}: current = ${current}`);
  }
});

await test("Verse of the Day loads real Arabic, English and Urdu", async () => {
  await go(BASE);
  await waitFor(`!document.getElementById("verse-play").disabled`);
  const ref = await text("#verse-ref");
  const ar = await text("#verse-ar");
  const en = await text("#verse-en");
  const ur = await text("#verse-ur");
  const link = await evaluate(`document.getElementById("verse-link").getAttribute("href")`);
  const audio = await evaluate(`verseAudio.src`);
  console.log(`       ${ref} | ${ar.slice(0, 40)}… | ${en.slice(0, 50)}…`);
  expect(/^[\w'\- ]+ \d+:\d+$/.test(ref), `ref = ${ref}`);
  expect(/[؀-ۿ]/.test(ar) && !ar.includes("﻿"), "Arabic missing");
  expect(en.length > 5 && /[؀-ۿ]/.test(ur), "translations missing");
  expect(/^quran\.html\?surah=\d+#ayah-\d+$/.test(link), `link = ${link}`);
  expect(/^https:\/\/cdn\.islamic\.network\/quran\/audio\/.+\.mp3$/.test(audio), `audio = ${audio}`);
});

await test("Verse of the Day matches the API verse for that number", async () => {
  const n = await evaluate(`verseOfTheDayNumber()`);
  const api = await (await fetch(`https://api.alquran.cloud/v1/ayah/${n}/en.sahih`)).json();
  const en = await text("#verse-en");
  expect(api.data.text === en, `page "${en.slice(0, 40)}" vs api "${api.data.text.slice(0, 40)}"`);
  expect((await text("#verse-ref")).endsWith(`${api.data.surah.number}:${api.data.numberInSurah}`), "reference mismatch");
});

await test("Verse recitation plays and pauses", async () => {
  await click("#verse-play");
  await waitFor(`!verseAudio.paused`, 15000);
  expect((await text("#verse-play")) === "Pause recitation", "label not updated");
  await click("#verse-play");
  await waitFor(`verseAudio.paused`);
  expect((await text("#verse-play")) === "Play recitation", "label not reset");
});

await test("Prayer alert fires at prayer time (banner + test button)", async () => {
  await evaluate(`localStorage.setItem("prayer-alerts", "true")`);
  await setClock("2026-10-28T15:39:58+05:00"); // Asr in Lahore is 15:40
  await go(BASE + "?city=Lahore&country=Pakistan");
  await waitFor(`document.querySelectorAll("#times li").length === 6`);
  expect((await text("#alerts-btn")) === "Prayer alerts: On", "alerts not on");
  expect(await visible("#alerts-test"), "test button hidden");
  await waitFor(`!document.getElementById("prayer-banner").hidden`, 10000);
  console.log("      ", await text("#prayer-banner-text"));
  expect((await text("#prayer-banner-text")).includes("Asr"), "banner wrong");
  await click("#prayer-banner-close");
  expect(!(await visible("#prayer-banner")), "banner did not close");
  await setClock(null);
});

await test("Prayer alerts toggle off and is remembered", async () => {
  await go(BASE);
  await waitFor(`document.querySelectorAll("#times li").length === 6`);
  await click("#alerts-btn");
  await sleep(300);
  expect((await text("#alerts-btn")) === "Prayer alerts: Off", "did not turn off");
  await go(BASE);
  expect((await text("#alerts-btn")) === "Prayer alerts: Off", "not remembered");
});

await test("Ramadan strip shows Sehri and Iftar during Ramadan", async () => {
  await setClock("2027-02-20T10:00:00+05:00");
  await go(BASE + "?city=Lahore&country=Pakistan");
  await waitFor(`!document.getElementById("ramadan").hidden`, 15000);
  const t = await text("#ramadan");
  console.log("      ", t);
  expect(/Ramadan day \d+ · Sehri ends \d+:\d\d AM · Iftar \d+:\d\d PM/.test(t), t);
  await setClock(null);
  await go(BASE);
  await waitFor(`document.querySelectorAll("#times li").length === 6`);
  expect(!(await visible("#ramadan")), "Ramadan strip visible outside Ramadan");
});

// ---------------- Quran ----------------

await test("Quran index lists all 114 surahs", async () => {
  await go(BASE + "quran.html");
  await waitFor(`document.querySelectorAll("#surah-list .surah-card").length === 114`);
  const first = await text(".surah-card");
  console.log("      ", first.replace(/\s+/g, " "));
});

await test("Surah filter by name and number", async () => {
  const filter = async (q) => {
    await evaluate(`(() => { const f = document.getElementById("surah-filter"); f.value = ${JSON.stringify(q)}; f.dispatchEvent(new Event("input")); })()`);
    return evaluate(`[...document.querySelectorAll("#surah-list .surah-card strong")].map(s => s.textContent)`);
  };
  const a = await filter("baqarah");
  const b = await filter("112");
  const c = await filter("fatiha");
  const d = await filter("the cow");
  console.log("       baqarah →", a, "| 112 →", b, "| fatiha →", c, "| the cow →", d);
  expect(a.includes("Al-Baqara") && b.length === 1 && b[0] === "Al-Ikhlaas" && c[0] === "Al-Faatiha" && d.includes("Al-Baqara"), "filter wrong");
  await filter("");
});

await test("Search in English highlights matches", async () => {
  await evaluate(`(() => { document.getElementById("search-q").value = "patience"; document.getElementById("search-form").requestSubmit(); })()`);
  await waitFor(`document.querySelectorAll("#results-list li").length > 0`);
  const summary = await text("#results-summary");
  const marks = await evaluate(`document.querySelectorAll("#results-list mark").length`);
  const href = await evaluate(`document.querySelector("#results-list a").getAttribute("href")`);
  console.log("      ", summary, "| first →", href);
  expect(marks > 0 && /^quran\.html\?surah=\d+#ayah-\d+$/.test(href), "no highlights/links");
  expect((await evaluate(`location.search`)) === "?q=patience&lang=en.sahih", "URL not updated");
});

await test("Search in Urdu", async () => {
  await evaluate(`(() => { document.getElementById("search-q").value = "صبر"; document.getElementById("search-lang").value = "ur.jalandhry"; document.getElementById("search-form").requestSubmit(); })()`);
  await waitFor(`document.querySelector("#results-list .urdu")`);
  console.log("      ", await text("#results-summary"));
});

await test("Search with no matches says so", async () => {
  await evaluate(`(() => { document.getElementById("search-q").value = "qwxyzzq"; document.getElementById("search-lang").value = "en.sahih"; document.getElementById("search-form").requestSubmit(); })()`);
  await waitFor(`document.getElementById("results-summary").textContent.startsWith("No verses")`);
  await click("#results-clear");
  expect(!(await visible("#results")), "results not cleared");
});

await test("Reader: Al-Baqarah has 286 verses with Bismillah heading", async () => {
  await go(BASE + "quran.html?surah=2");
  await waitFor(`document.querySelectorAll(".ayah").length === 286`);
  const basmala = await text("#basmala");
  const first = await evaluate(`document.querySelector("#ayah-1 .quran-text").firstChild.textContent.trim()`);
  const en = await text("#ayah-1 .tr-en");
  const title = await text("#surah-title");
  console.log("      ", title, "|", basmala, "|", first, "|", en);
  expect(await visible("#basmala") && basmala.startsWith("بِسْمِ"), "basmala heading missing");
  expect(first === "الٓمٓ", `verse 1 = ${first}`);
  expect(en === "Alif, Lam, Meem.", `en = ${en}`);
});

await test("Reader: Al-Fatihah verse 1 is the Bismillah, no separate heading", async () => {
  await go(BASE + "quran.html?surah=1");
  await waitFor(`document.querySelectorAll(".ayah").length === 7`);
  const v1 = await evaluate(`document.querySelector("#ayah-1 .quran-text").firstChild.textContent`);
  expect(!(await visible("#basmala")), "heading shown for Al-Fatihah");
  expect(v1.trim().startsWith("بِسْمِ") && !v1.includes("﻿"), `v1 = ${JSON.stringify(v1)}`);
});

await test("Reader: At-Tawbah has no Bismillah", async () => {
  await go(BASE + "quran.html?surah=9");
  await waitFor(`document.querySelectorAll(".ayah").length === 129`);
  expect(!(await visible("#basmala")), "heading shown for At-Tawbah");
});

await test("Reader: every surah's verse 1 text matches the API exactly after splitting", async () => {
  // Spot-check surahs including the two that spell the Bismillah differently.
  const full = await (await fetch("https://api.alquran.cloud/v1/quran/quran-uthmani")).json();
  for (const s of full.data.surahs) {
    const t = s.ayahs[0].text;
    const r = await evaluate(`splitBasmala(${JSON.stringify(t)}, ${s.number}, 1)`);
    const rejoined = r.basmala ? `${r.basmala} ${r.text}` : r.text;
    expect(rejoined === t.replace(/﻿/g, ""), `surah ${s.number}: text changed`);
    expect((s.number === 1 || s.number === 9) === !r.basmala, `surah ${s.number}: basmala=${!!r.basmala}`);
  }
});

await test("Reader: deep link scrolls to verse and prev/next links", async () => {
  await go(BASE + "quran.html?surah=18#ayah-10");
  await waitFor(`document.querySelectorAll(".ayah").length === 110`);
  await sleep(500);
  const top = await evaluate(`Math.round(document.getElementById("ayah-10").getBoundingClientRect().top)`);
  const prev = await evaluate(`document.getElementById("prev-surah").getAttribute("href")`);
  const next = await evaluate(`document.getElementById("next-surah").getAttribute("href")`);
  console.log(`       verse 10 top = ${top}px, prev = ${prev}, next = ${next}`);
  expect(top >= 0 && top < 200, "did not scroll to verse 10");
  expect(prev === "quran.html?surah=17" && next === "quran.html?surah=19", "prev/next wrong");
});

await test("Continue reading remembers the last verse", async () => {
  await go(BASE + "quran.html");
  await waitFor(`!document.getElementById("continue").hidden`);
  const t = await text("#continue");
  const href = await evaluate(`document.getElementById("continue").getAttribute("href")`);
  console.log("      ", t.replace(/\s+/g, " "), "→", href);
  expect(/^quran\.html\?surah=18#ayah-(9|10|11)$/.test(href), `href = ${href}`);
});

await test("Translation and font size settings", async () => {
  await go(BASE + "quran.html?surah=112");
  await waitFor(`document.querySelectorAll(".ayah").length === 4`);
  await evaluate(`(() => { const s = document.getElementById("translation"); s.value = "en"; s.dispatchEvent(new Event("change")); })()`);
  expect(await visible("#ayah-1 .tr-en") && !(await visible("#ayah-1 .tr-ur")), "English-only failed");
  await evaluate(`(() => { const s = document.getElementById("translation"); s.value = "none"; s.dispatchEvent(new Event("change")); })()`);
  expect(!(await visible("#ayah-1 .tr-en")) && !(await visible("#ayah-1 .tr-ur")), "Arabic-only failed");
  await evaluate(`(() => { const s = document.getElementById("translation"); s.value = "both"; s.dispatchEvent(new Event("change")); })()`);
  const before = await evaluate(`parseFloat(getComputedStyle(document.querySelector("#ayah-1 .quran-text")).fontSize)`);
  await click("#font-up"); await click("#font-up");
  const after = await evaluate(`parseFloat(getComputedStyle(document.querySelector("#ayah-1 .quran-text")).fontSize)`);
  console.log(`       font ${before}px → ${after}px`);
  expect(after > before, "font did not grow");
  await click("#font-down"); await click("#font-down");
});

await test("Bookmark a verse, see it on the index, remove it", async () => {
  await click('#ayah-1 [data-action="bookmark"]');
  await sleep(200);
  expect((await text("#toast")) === "Verse bookmarked.", "no toast");
  await go(BASE + "quran.html");
  await waitFor(`document.querySelectorAll("#bookmarks-list li").length === 1`);
  console.log("      ", (await text("#bookmarks-list li")).replace(/\s+/g, " ").slice(0, 80));
  await click("#bookmarks-list button");
  await sleep(200);
  expect(!(await visible("#bookmarks")), "bookmark not removed");
});

await test("Copy verse and copy link", async () => {
  await send("Browser.grantPermissions", { origin: "http://localhost:8000", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await go(BASE + "quran.html?surah=112");
  await waitFor(`document.querySelectorAll(".ayah").length === 4`);
  await click('#ayah-1 [data-action="copy"]');
  await sleep(300);
  const copied = await evaluate(`navigator.clipboard.readText()`);
  await click('#ayah-1 [data-action="link"]');
  await sleep(300);
  const link = await evaluate(`navigator.clipboard.readText()`);
  console.log("      ", JSON.stringify(copied.slice(0, 70)), "|", link);
  expect(copied.includes("— Quran 112:1 (Al-Ikhlaas)") && copied.includes("Say,"), "copy payload wrong");
  expect(link === "http://localhost:8000/quran.html?surah=112#ayah-1", "link wrong");
});

await test("Play surah continues verse by verse; player controls", async () => {
  await waitFor(`!document.getElementById("play-surah").disabled`);
  await click("#play-surah");
  await waitFor(`!player.audio.paused`, 15000);
  expect(await visible("#player"), "player hidden");
  expect((await text("#player-title")) === "Al-Ikhlaas 112:1", "title wrong");
  expect(await evaluate(`document.querySelector("#ayah-1").classList.contains("playing")`), "verse 1 not highlighted");
  await evaluate(`player.audio.dispatchEvent(new Event("ended"))`);
  await waitFor(`player.index === 1`);
  expect((await text("#player-title")) === "Al-Ikhlaas 112:2", "did not advance");
  await click("#player-next");
  await waitFor(`player.index === 2`);
  await click("#player-prev");
  await waitFor(`player.index === 1`);
  await click("#player-toggle");
  await waitFor(`player.audio.paused`);
  expect((await text("#play-surah")) === "Resume", "play-surah label");
  await click("#player-close");
  expect(!(await visible("#player")), "player not closed");
});

await test("Changing reciter loads that reciter's audio", async () => {
  await evaluate(`(() => { const s = document.getElementById("reciter"); s.value = "ar.husary"; s.dispatchEvent(new Event("change")); })()`);
  await waitFor(`reader.audio[0]?.includes("ar.husary")`);
  console.log("      ", await evaluate(`reader.audio[0]`));
  const res = await fetch(await evaluate(`reader.audio[0]`), { method: "HEAD" });
  expect(res.ok, `audio HEAD ${res.status}`);
  await evaluate(`(() => { const s = document.getElementById("reciter"); s.value = "ar.alafasy"; s.dispatchEvent(new Event("change")); })()`);
});

// ---------------- Tasbih ----------------

await test("Tasbih after-prayer sequence 33/33/34 completes at 100", async () => {
  await evaluate(`localStorage.removeItem("tasbih")`);
  await go(BASE + "tasbih.html");
  expect((await text("#dhikr-tr")) === "SubhanAllah", "starts wrong");
  for (let i = 0; i < 33; i++) await click("#counter");
  expect((await text("#dhikr-tr")) === "Alhamdulillah" && (await text("#count")) === "0", "step 2 wrong");
  await click("#undo");
  expect((await text("#dhikr-tr")) === "SubhanAllah" && (await text("#count")) === "32", "undo wrong");
  await click("#counter");
  for (let i = 0; i < 33; i++) await click("#counter");
  expect((await text("#dhikr-tr")) === "Allahu Akbar" && (await text("#count-of")) === "of 34", "step 3 wrong");
  for (let i = 0; i < 34; i++) await click("#counter");
  expect(await visible("#complete"), "not complete");
  await click("#counter");
  expect((await text("#count")) === "34", "counted past completion");
  expect((await text("#stat-today")) === "100" && (await text("#stat-total")) === "100", `stats ${await text("#stat-today")}/${await text("#stat-total")}`);
});

await test("Tasbih state persists after reload; reset", async () => {
  await go(BASE + "tasbih.html");
  expect(await visible("#complete"), "completion not remembered");
  await click("#reset");
  expect((await text("#count")) === "0" && (await text("#dhikr-tr")) === "SubhanAllah", "reset failed");
  expect((await text("#stat-total")) === "100", "total lost on reset");
});

await test("Tasbih free count with target and Space key", async () => {
  await click("#mode-free");
  await evaluate(`(() => { const s = document.getElementById("phrase"); s.value = "4"; s.dispatchEvent(new Event("change")); })()`);
  expect((await text("#dhikr-tr")) === "Astaghfirullah", "phrase not changed");
  await evaluate(`document.activeElement.blur()`);
  for (let i = 0; i < 33; i++) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  }
  const of = await text("#count-of");
  console.log("       after 33 Space presses:", await text("#count"), of);
  expect(of === "of 33 · round 2", `count-of = ${of}`);
  await click("#mode-prayer");
});

// ---------------- Calendar ----------------

await test("Calendar shows upcoming Islamic dates and Ramadan countdown", async () => {
  await go(BASE + "calendar.html");
  const items = await evaluate(`[...document.querySelectorAll("#events li")].map(li => li.innerText.replace(/\\n/g, " | "))`);
  console.log("       " + (await text("#featured")).replace(/\s+/g, " "));
  items.slice(0, 3).forEach((i) => console.log("       " + i));
  expect(items.length === 10, `${items.length} events`);
  expect(/Ramadan 1448 AH \d+ days Expected to begin/.test((await text("#featured")).replace(/\s+/g, " ")), "featured wrong");
});

await test("Calendar monthly timetable, today highlighted, month navigation", async () => {
  await waitFor(`document.querySelectorAll("#timetable tr").length >= 28`);
  const title = await text("#month-title");
  const rows = await evaluate(`document.querySelectorAll("#timetable tr").length`);
  const today = await evaluate(`document.querySelector("#timetable tr.today")?.innerText.replace(/\\t/g, " | ")`);
  console.log(`       ${title}: ${rows} rows · today: ${today}`);
  console.log("      ", await text("#month-meta"));
  expect(rows === 31 && title === "October 2026" && today, "October wrong");
  await click("#month-next");
  await waitFor(`document.getElementById("month-title").textContent === "November 2026" && document.querySelectorAll("#timetable tr").length === 30`);
  await click("#month-today");
  await waitFor(`document.getElementById("month-title").textContent === "October 2026"`);
});

await test("Calendar during Ramadan shows the day of Ramadan", async () => {
  await setClock("2027-02-20T10:00:00+05:00");
  await go(BASE + "calendar.html");
  const f = (await text("#featured")).replace(/\s+/g, " ");
  console.log("      ", f);
  expect(/Ramadan 1448 AH Day \d+ Eid al-Fitr/.test(f), f);
  await setClock(null);
});

const realErrors = errors.filter((e) => !/favicon|navigator\.vibrate|search\/qwxyzzq/.test(e));
console.log(`\n${passed} passed, ${failed} failed. Console errors: ${realErrors.length ? "\n  " + realErrors.join("\n  ") : "none"}`);
ws.close();
chrome.kill();
process.exit(failed ? 1 : 0);
