// Tests for: installable app + offline, Para navigation, Khatam tracker, Prayer tracker, Hadith of the Day.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:8000/";
const PORT = 9341;
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

// ---------- Quran reader ----------
await test("Reader: translation picker lists 9 English and 6 Urdu editions", async () => {
  await go(BASE + "quran.html?surah=1");
  await waitFor(`document.querySelectorAll(".ayah").length === 7`);
  expect(await evaluate(`$("en-edition").options.length`) === 9, "en count");
  expect(await evaluate(`$("ur-edition").options.length`) === 6, "ur count");
  expect(!(await visible("#reader-more")), "panel should start closed");
  await click("#more-btn");
  expect(await visible("#reader-more"), "panel should open");
});

await test("Reader: switching English translation reloads verses from the API", async () => {
  const before = await text("#ayah-1 .tr-en");
  await evaluate(`$("en-edition").value = "en.pickthall"; $("en-edition").dispatchEvent(new Event("change"))`);
  await waitFor(`!document.body.classList.contains("loading") && document.querySelector("#ayah-1 .tr-en").textContent !== ${JSON.stringify(before)}`);
  const after = await text("#ayah-2 .tr-en");
  const api = await evaluate(`fetch("https://api.alquran.cloud/v1/ayah/1:2/en.pickthall").then(r => r.json()).then(j => j.data.text)`);
  expect(after === api.trim() || after === api, `got "${after}" vs "${api}"`);
  expect(JSON.parse(await evaluate(`localStorage.getItem("quran-settings")`)).enEdition === "en.pickthall", "saved");
});

await test("Reader: switching Urdu translation works", async () => {
  await evaluate(`$("ur-edition").value = "ur.maududi"; $("ur-edition").dispatchEvent(new Event("change"))`);
  const api = await evaluate(`fetch("https://api.alquran.cloud/v1/ayah/1:2/ur.maududi").then(r => r.json()).then(j => j.data.text)`);
  await waitFor(`document.querySelector("#ayah-2 .tr-ur").textContent.trim() === ${JSON.stringify(api.trim())}`);
});

await test("Reader: transliteration toggles and matches the API", async () => {
  expect(!(await visible("#ayah-2 .translit")), "hidden by default");
  await click("#translit-btn");
  expect(await visible("#ayah-2 .translit"), "should show");
  const api = await evaluate(`fetch("https://api.alquran.cloud/v1/ayah/1:2/en.transliteration").then(r => r.json()).then(j => j.data.text)`);
  expect((await text("#ayah-2 .translit")) === api.trim(), "text matches");
  await go(BASE + "quran.html?surah=1");
  await waitFor(`document.querySelectorAll(".ayah").length === 7`);
  expect(await visible("#ayah-2 .translit"), "setting persists");
  await click("#translit-btn");
});

await test("Reader: About this surah loads Maududi's introduction (English and Urdu)", async () => {
  await go(BASE + "quran.html?surah=2");
  await waitFor(`document.querySelectorAll(".ayah").length === 286`, 30000);
  expect(await visible("#info-btn"), "button visible");
  await click("#info-btn");
  await waitFor(`$("info-text").querySelector("h2")`);
  const t = await text("#info-text");
  expect(/Al-Baqarah/i.test(t), "mentions surah");
  expect(/Tafhim/.test(await text("#info-source")), "source shown");
  expect(await evaluate(`!$("info-text").querySelector("[class],[style],script,img")`), "sanitized");
  await click("#info-ur");
  await waitFor(`$("info-text").lang === "ur" && /[\\u0600-\\u06ff]/.test($("info-text").textContent) && !$("info-text").textContent.includes("Loading")`);
});

await test("Reader: tafsir panel opens with Ibn Kathir for 2:255", async () => {
  await evaluate(`document.querySelector('#ayah-255 [data-action="tafsir"]').click()`);
  await waitFor(`$("tafsir").open && $("tafsir-text").querySelector("h2")`);
  expect((await text("#tafsir-title")).includes("2:255"), "title");
  expect(/Ayat Al-Kursi/i.test(await text("#tafsir-text")), "content");
  expect(await evaluate(`!$("tafsir-text").querySelector("[class],[style],script,img,a")`), "sanitized");
  expect(await evaluate(`!!$("tafsir-text").querySelector('[dir="rtl"]')`), "arabic quotes marked rtl");
});

await test("Tafsir: switching to Urdu Ibn Kathir and Ma'ariful Quran", async () => {
  await evaluate(`$("tafsir-source").value = "160"; $("tafsir-source").dispatchEvent(new Event("change"))`);
  await waitFor(`$("tafsir-text").lang === "ur" && $("tafsir-text").textContent.length > 500`);
  await evaluate(`$("tafsir-source").value = "168"; $("tafsir-source").dispatchEvent(new Event("change"))`);
  await waitFor(`$("tafsir-text").lang === "en" && /Kursi/i.test($("tafsir-text").textContent)`);
});

await test("Tafsir: grouped passages show the covered range and next skips past it", async () => {
  await evaluate(`$("tafsir-source").value = "168"; $("tafsir-source").dispatchEvent(new Event("change"))`);
  await evaluate(`openTafsir(3)`); // 2:4
  await waitFor(`!$("tafsir-covers").hidden`);
  expect(/2:4 to 2:5/.test(await text("#tafsir-covers")), await text("#tafsir-covers"));
  await click("#tafsir-next");
  await waitFor(`$("tafsir-title").textContent.includes("2:6")`);
  await click("#tafsir-prev");
  await waitFor(`$("tafsir-title").textContent.includes("2:5")`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  await click("#tafsir-close");
  expect(!(await evaluate(`$("tafsir").open`)), "closed");
  await evaluate(`$("tafsir-source").value = "169"; $("tafsir-source").dispatchEvent(new Event("change")); $("tafsir").close()`);
});

await test("Reader: Para mode still works with transliteration data", async () => {
  await go(BASE + "quran.html?juz=30");
  await waitFor(`document.querySelectorAll(".ayah").length > 500`, 30000);
  expect(await evaluate(`reader.items.every(i => i.tl && i.en && i.ur && i.ar)`), "all fields");
  expect(!(await visible("#info-btn")), "no surah intro in para mode");
});

// ---------- Hadith library ----------
await test("Hadith: 10 collections listed", async () => {
  await go(BASE + "hadith.html");
  await waitFor(`document.querySelectorAll(".collection-card").length === 10`);
  expect((await text(".collection-card strong")) === "Sahih al-Bukhari", "first");
});

await test("Hadith: Bukhari lists 97 books and filters", async () => {
  await click(".collection-card");
  await waitFor(`location.search === "?c=bukhari" && document.querySelectorAll(".book-row").length === 97`);
  await evaluate(`$("book-filter").value = "prayer"; $("book-filter").dispatchEvent(new Event("input"))`);
  const n = await evaluate(`document.querySelectorAll(".book-row").length`);
  expect(n > 0 && n < 97, `filtered ${n}`);
});

await test("Hadith: Book 1 of Bukhari shows 7 hadiths with real text", async () => {
  await go(BASE + "hadith.html?c=bukhari&b=1");
  await waitFor(`document.querySelectorAll(".hadith-item").length === 7`);
  expect(/intention/i.test(await text("#h-1 .hadith-text")), "hadith 1 text");
  expect(!(await visible("#prev-book")) && (await text("#next-book")).includes("Belief"), "book nav");
});

await test("Hadith: Urdu and Arabic", async () => {
  await evaluate(`$("hadith-lang").value = "urd"; $("hadith-lang").dispatchEvent(new Event("change"))`);
  await waitFor(`document.querySelector("#h-1 .hadith-text.urdu")`);
  await click("#arabic-btn");
  await waitFor(`document.querySelector("#h-1 .hadith-arabic")`);
  await evaluate(`$("hadith-lang").value = "eng"; $("hadith-lang").dispatchEvent(new Event("change"))`);
  await waitFor(`document.querySelector("#h-1 .hadith-text:not(.urdu)") && document.querySelector("#h-1 .hadith-arabic")`);
  await click("#arabic-btn");
  await waitFor(`!document.querySelector("#h-1 .hadith-arabic")`);
});

await test("Hadith: jump to number opens the right book and scrolls to it", async () => {
  await go(BASE + "hadith.html?c=abudawud");
  await waitFor(`document.querySelectorAll(".book-row").length > 10`);
  await evaluate(`$("jump-n").value = "1000"; $("jump-form").requestSubmit()`);
  await waitFor(`location.hash === "#h-1000" && document.getElementById("h-1000")`, 25000);
  expect((await text("#book-title")).includes("Prayer"), "book 2 prayer");
  const top = await evaluate(`document.getElementById("h-1000").getBoundingClientRect().top`);
  expect(top >= -5 && top < 400, `scrolled top ${top}`);
  expect(await evaluate(`!!document.querySelector("#h-1000 .grades")`), "grades shown");
});

await test("Hadith: search within a book and paging", async () => {
  expect(await visible("#more-hadiths"), "show more visible for big book");
  await evaluate(`$("hadith-filter").value = "ablution"; $("hadith-filter").dispatchEvent(new Event("input"))`);
  await waitFor(`/found for/.test($("hadith-count").textContent)`);
  const ok = await evaluate(`[...document.querySelectorAll(".hadith-item .hadith-text")].every(p => /ablution/i.test(p.textContent))`);
  expect(ok, "all results match");
});

await test("Hadith: Forty Hadith collections open directly", async () => {
  await go(BASE + "hadith.html?c=nawawi");
  await waitFor(`document.querySelectorAll(".hadith-item").length === 42`);
  expect((await evaluate(`$("book-back").getAttribute("href")`)) === "hadith.html", "back goes to collections");
  expect(await evaluate(`$("hadith-lang").options.length`) === 2, "eng + ara only");
});

await test("Hadith: Muslim introduction (book 0) loads despite CDN refusals", async () => {
  await go(BASE + "hadith.html?c=muslim&b=0");
  await waitFor(`document.querySelectorAll(".hadith-item").length === 40`, 25000);
  const ok = await evaluate(`[...document.querySelectorAll(".hadith-item")].every(li => li.querySelector(".hadith-text, .hadith-arabic"))`);
  expect(ok, "every shown item has text");
  expect(/left out/.test(await text("#hadith-count")), await text("#hadith-count"));
});

await test("Home: hadith of the day links into the library", async () => {
  await go(BASE);
  await waitFor(`$("hadith-link").getAttribute("href").includes("#h-")`, 30000);
  const href = await evaluate(`$("hadith-link").getAttribute("href")`);
  await go(BASE + href);
  const n = href.split("#h-")[1];
  await waitFor(`document.getElementById("h-${n}")`, 25000);
});

// ---------- Duas ----------
await test("Duas: first topic loads real verses with audio", async () => {
  await go(BASE + "duas.html");
  await waitFor(`document.querySelectorAll(".dua").length === 10`, 30000);
  const ref = await text(".dua .ref");
  expect(ref.includes("7:23"), ref);
  const api = await evaluate(`fetch("https://api.alquran.cloud/v1/ayah/7:23/quran-uthmani").then(r => r.json()).then(j => j.data.text)`);
  expect((await text(".dua .quran-text")).startsWith(api.trim().slice(0, 20)), "arabic from API");
});

await test("Duas: every topic loads and multi-verse duas join verses", async () => {
  for (const t of ["guidance", "hardship", "family", "knowledge", "hereafter"]) {
    await click(`[data-topic="${t}"]`);
    await waitFor(`!$("duas").textContent.includes("Loading")`, 30000);
    expect(!(await evaluate(`!!$("duas").querySelector(".error")`)), await text("#duas"));
    await waitFor(`document.querySelector('[data-topic="${t}"]').getAttribute("aria-pressed") === "true" && document.querySelectorAll(".dua").length === duaItems.length && duaItems.length > 0 && document.querySelector(".dua") && !$("duas").textContent.includes("Loading")`, 30000);
  }
  await click(`[data-topic="knowledge"]`);
  await waitFor(`document.querySelector(".dua .ref")?.textContent.includes("20:25–28")`, 30000);
  expect(await evaluate(`document.querySelector(".dua .quran-text").querySelectorAll(".ayah-end").length`) === 4, "4 verses");
});

await test("Duas: play recitation", async () => {
  await evaluate(`document.querySelector('.dua [data-action="play"]').click()`);
  await waitFor(`document.querySelector(".dua.playing")`, 15000);
  await evaluate(`audio.pause()`);
});

await test("99 Names: loads 99 names and filter works", async () => {
  await click("#tab-names");
  await waitFor(`document.querySelectorAll(".name-card").length === 99`);
  expect(await evaluate(`location.hash`) === "#names", "hash");
  await evaluate(`$("names-filter").value = "merciful"; $("names-filter").dispatchEvent(new Event("input"))`);
  const n = await evaluate(`document.querySelectorAll(".name-card").length`);
  expect(n >= 1 && n < 10, `filtered ${n}`);
  await evaluate(`$("names-filter").value = ""; $("names-filter").dispatchEvent(new Event("input"))`);
});

await test("99 Names: tap to mark learned, and the quiz", async () => {
  await click(".name-card");
  expect(await evaluate(`document.querySelector(".name-card").classList.contains("learned")`), "learned");
  await click("#quiz-start");
  expect(await visible("#quiz"), "quiz open");
  expect(await evaluate(`$("quiz-options").children.length`) === 4, "4 options");
  await evaluate(`[...$("quiz-options").children].find(b => Number(b.dataset.n) === quiz.current.n).click()`);
  expect((await text("#quiz-score")) === "1 of 1 correct", await text("#quiz-score"));
  expect(await visible("#quiz-next"), "next shown");
  await click("#quiz-next");
  await evaluate(`[...$("quiz-options").children].find(b => Number(b.dataset.n) !== quiz.current.n).click()`);
  expect((await text("#quiz-score")) === "1 of 2 correct", "score 2");
  expect(await evaluate(`!!$("quiz-options").querySelector(".right") && !!$("quiz-options").querySelector(".wrong")`), "marks");
});

// ---------- Zakat ----------
await test("Zakat: live prices load and calculation is correct", async () => {
  await go(BASE + "zakat.html");
  await waitFor(`Number($("gold-price").value) > 0 && Number($("silver-price").value) > 0`, 20000);
  await evaluate(`$("currency").value = "usd"; $("currency").dispatchEvent(new Event("change"))`);
  await waitFor(`$("price-source").textContent.includes("spot") && Number($("silver-price").value) < 50`);
  const silver = await evaluate(`prices().silver`);
  await evaluate(`$("cash").value = "10000"; $("cash").dispatchEvent(new Event("input"))`);
  await evaluate(`$("debts").value = "2000"; $("debts").dispatchEvent(new Event("input"))`);
  const nisab = 612.36 * silver;
  const expected = 8000 >= nisab ? 200 : 0;
  const due = await evaluate(`$("zakat-due").textContent`);
  expect(due.replace(/[^\d]/g, "") === String(expected), `due ${due} expected ${expected} (nisab ${nisab})`);
});

await test("Zakat: gold in tola with purity, gold nisab, custom prices", async () => {
  await evaluate(`$("zakat-reset").click()`);
  await click("#unit-tola");
  await click("#nisab-gold");
  await evaluate(`$("karat").value = "22"; $("karat").dispatchEvent(new Event("change"))`);
  await evaluate(`$("gold-price").value = "100"; $("gold-price").dispatchEvent(new Event("input"))`);
  await evaluate(`$("silver-price").value = "1"; $("silver-price").dispatchEvent(new Event("input"))`);
  await evaluate(`$("gold").value = "10"; $("gold").dispatchEvent(new Event("input"))`);
  // 10 tola = 116.64 g × 22/24 × 100 = 10692; nisab 87.48 × 100 = 8748; zakat 267.3
  expect((await text("#sum-net")).replace(/[^\d]/g, "") === "10692", await text("#sum-net"));
  expect((await text("#sum-nisab")).replace(/[^\d]/g, "") === "8748", await text("#sum-nisab"));
  expect((await text("#zakat-due")).replace(/[^\d]/g, "") === "267", await text("#zakat-due"));
  expect((await text("#nisab-label")).includes("7.5 tola"), await text("#nisab-label"));
  await go(BASE + "zakat.html");
  expect((await text("#zakat-due")).replace(/[^\d]/g, "") === "267", "persists after reload");
  await click("#price-live");
  await waitFor(`$("price-source").textContent.includes("spot")`);
});

await test("Zakat al-Fitr total", async () => {
  await evaluate(`$("fitr-people").value = "5"; $("fitr-people").dispatchEvent(new Event("input")); $("fitr-rate").value = "12"; $("fitr-rate").dispatchEvent(new Event("input"))`);
  expect((await text("#fitr-total")).replace(/[^\d]/g, "") === "60", await text("#fitr-total"));
});

// ---------- Layout ----------
await test("No horizontal overflow on new pages (desktop, tablet and phone)", async () => {
  for (const width of [1280, 900, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    for (const page of ["hadith.html", "hadith.html?c=bukhari", "hadith.html?c=bukhari&b=2", "duas.html", "duas.html#names", "zakat.html", "quran.html?surah=2"]) {
      await go(BASE + page);
      await sleep(1500);
      const over = await evaluate(`document.documentElement.scrollWidth - innerWidth`);
      expect(over <= 0, `${page} at ${width}px overflows by ${over}`);
      const navFits = await evaluate(`(() => { const n = document.querySelector(".nav"); return innerWidth < 761 || n.scrollWidth <= n.clientWidth + 1; })()`);
      expect(navFits, `nav clipped on ${page} at ${width}`);
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
