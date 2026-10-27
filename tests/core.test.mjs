// End-to-end test of the Prayer Times site, driving headless Chrome over CDP.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "http://localhost:8000/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "--window-size=1280,1000", "about:blank",
], { stdio: "ignore" });

let pageWs;
for (let i = 0; i < 50 && !pageWs; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    pageWs = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
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
const waitFor = async (expr, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expr).catch(() => false)) return true;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
};
const idle = () => waitFor(`!document.body.classList.contains("loading") && document.querySelectorAll("#times li").length === 6`);
const text = (id) => evaluate(`document.getElementById("${id}").textContent.trim()`);
const snapshot = async () => ({
  location: await text("location"),
  dates: await evaluate(`document.getElementById("dates").innerText.replace(/\\n/g, " | ")`),
  next: `${await text("next-name")} ${await text("countdown")} ${await text("next-time")}`,
  times: await evaluate(`[...document.querySelectorAll("#times li")].map(li => li.querySelector(".name").textContent + " " + li.querySelector(".time").textContent + (li.className ? " [" + li.className + "]" : "")).join(", ")`),
  qibla: await text("qibla-deg"),
  error: await evaluate(`document.getElementById("error").hidden ? "" : document.getElementById("error").textContent`),
  url: await evaluate(`location.search`),
});
const search = (city, country) => evaluate(`(() => {
  document.getElementById("city").value = ${JSON.stringify(city)};
  document.getElementById("country").value = ${JSON.stringify(country)};
  document.getElementById("city-form").requestSubmit();
})()`);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); passed++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); failed++; }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

await test("Default load shows Lahore", async () => {
  await send("Page.navigate", { url: BASE });
  await idle();
  const s = await snapshot();
  console.log("      ", s);
  expect(s.location === "Lahore, Pakistan", `location = ${s.location}`);
  expect(s.qibla === "260.3°", `qibla = ${s.qibla}`);
  expect(/AH/.test(s.dates), "hijri date missing");
  expect(/^\d\d:\d\d:\d\d$/.test(s.next.split(" ")[1]), `countdown = ${s.next}`);
  expect(s.url === "?city=Lahore&country=Pakistan", `url = ${s.url}`);
});

await test("Countdown ticks", async () => {
  const a = await text("countdown");
  await sleep(1300);
  const b = await text("countdown");
  expect(a !== b, `countdown stuck at ${a}`);
});

await test("Search Karachi", async () => {
  await search("Karachi", "Pakistan");
  await waitFor(`document.getElementById("location").textContent.includes("Karachi")`);
  await idle();
  const s = await snapshot();
  console.log("      ", s.location, "|", s.times, "|", s.qibla);
  expect(s.qibla === "267.7°", `qibla = ${s.qibla}`);
});

await test("Search London (different timezone)", async () => {
  await search("London", "United Kingdom");
  await waitFor(`document.getElementById("location").textContent.includes("London")`);
  await idle();
  const s = await snapshot();
  console.log("      ", s);
  expect(s.qibla === "119.0°", `qibla = ${s.qibla}`);
});

await test("Unknown city shows an error and keeps old data", async () => {
  await search("Qwxzvbnmplk", "Nowhere");
  await waitFor(`!document.getElementById("error").hidden`);
  const s = await snapshot();
  console.log("      ", s.error);
  expect(s.location.includes("London"), "old data was lost");
});

await test("Asr school change updates Asr time", async () => {
  await search("Lahore", "Pakistan");
  await waitFor(`document.getElementById("location").textContent.includes("Lahore")`);
  await idle();
  const hanafi = (await snapshot()).times;
  await evaluate(`(() => { const s = document.getElementById("school"); s.value = "0"; s.dispatchEvent(new Event("change")); })()`);
  await sleep(300);
  await idle();
  const standard = (await snapshot()).times;
  const asr = (t) => t.match(/Asr ([\d:]+)/)[1];
  console.log("       Hanafi Asr", asr(hanafi), "| Standard Asr", asr(standard));
  expect(asr(hanafi) !== asr(standard), "Asr did not change");
});

await test("Method change updates times", async () => {
  const before = (await snapshot()).times;
  await evaluate(`(() => { const s = document.getElementById("method"); s.value = "4"; s.dispatchEvent(new Event("change")); })()`);
  await sleep(300);
  await idle();
  const after = (await snapshot()).times;
  expect(before !== after, "times did not change");
});

await test("Settings and place persist after reload", async () => {
  await send("Page.navigate", { url: BASE });
  await idle();
  const s = await snapshot();
  const school = await evaluate(`document.getElementById("school").value`);
  const method = await evaluate(`document.getElementById("method").value`);
  expect(s.location === "Lahore, Pakistan" && school === "0" && method === "4", `${s.location} school=${school} method=${method}`);
});

await test("Shared link ?city=Makkah opens Makkah", async () => {
  await send("Page.navigate", { url: BASE + "?city=Makkah&country=Saudi%20Arabia" });
  await idle();
  const s = await snapshot();
  console.log("      ", s.location, s.qibla);
  expect(/Mecca|Makkah/.test(s.location), `location = ${s.location}`);
});

await test("Use my location (granted, Karachi coordinates)", async () => {
  await send("Browser.grantPermissions", { origin: "http://localhost:8000", permissions: ["geolocation"] });
  await send("Emulation.setGeolocationOverride", { latitude: 24.8607, longitude: 67.0011, accuracy: 10 });
  await evaluate(`document.getElementById("gps-btn").click()`);
  await waitFor(`document.getElementById("location").textContent.includes("Karachi")`);
  await idle();
  const s = await snapshot();
  console.log("      ", s.location, s.url);
});

await test("Use my location (denied) shows a helpful error", async () => {
  await send("Browser.resetPermissions");
  await send("Browser.setPermission", { origin: "http://localhost:8000", permission: { name: "geolocation" }, setting: "denied" });
  await evaluate(`document.getElementById("gps-btn").click()`);
  await waitFor(`!document.getElementById("error").hidden`);
  console.log("      ", (await snapshot()).error);
});

await test("Compass with no sensor reports it", async () => {
  await evaluate(`document.getElementById("compass-btn").click()`);
  await waitFor(`document.getElementById("compass-note").textContent.includes("No compass sensor")`, 5000);
  console.log("      ", await text("compass-note"));
});

await test("Compass with a sensor rotates and gives directions", async () => {
  await evaluate(`document.getElementById("compass-btn").click()`);
  console.log("       listening on:", await evaluate(`compass.event`));
  await evaluate(`window.dispatchEvent(Object.assign(new Event(compass.event), { alpha: 100, absolute: true }))`);
  const note = await text("compass-note");
  const dial = await evaluate(`document.getElementById("dial").getAttribute("transform")`);
  console.log("      ", note, "| dial", dial, "| btn", await text("compass-btn"));
  expect(dial === "rotate(-260)", `dial = ${dial}`);
  expect(/facing|Turn/.test(note), `note = ${note}`);
  await evaluate(`document.getElementById("compass-btn").click()`);
  expect((await text("compass-btn")) === "Enable live compass", "did not turn off");
});

await test("Theme toggle switches and is remembered", async () => {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await send("Page.navigate", { url: BASE });
  await idle();
  const bg = () => evaluate(`getComputedStyle(document.body).backgroundColor`);
  const start = await bg();
  expect(start === "rgb(11, 14, 26)", `system dark bg = ${start}`);
  await evaluate(`document.getElementById("theme-btn").click()`);
  await sleep(400);
  const light = await bg();
  expect(light === "rgb(246, 243, 236)", `after toggle bg = ${light}`);
  expect((await evaluate(`document.getElementById("theme-btn").title`)) === "Switch to dark mode", "button label wrong");
  await send("Page.navigate", { url: BASE });
  await idle();
  expect((await bg()) === "rgb(246, 243, 236)", "light theme not remembered");
  await evaluate(`document.getElementById("theme-btn").click()`);
  await sleep(400);
  expect((await bg()) === "rgb(11, 14, 26)", "did not switch back to dark");
  console.log("       dark -> light -> (reload) light -> dark");
});

// Fake the clock so it's late at night in Karachi.
let fakeClock = null;
async function loadAt(isoInstant, url) {
  if (fakeClock) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: fakeClock });
  const offset = Date.parse(isoInstant) - Date.now();
  ({ identifier: fakeClock } = await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const Real = Date, offset = ${offset};
    class FakeDate extends Real {
      constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); }
      static now() { return Real.now() + offset; }
    }
    globalThis.Date = FakeDate;
  })()` }));
  await send("Page.navigate", { url });
  await idle();
}

await test("After Isha, next prayer is tomorrow's Fajr", async () => {
  await loadAt("2026-10-27T23:30:00+05:00", BASE + "?city=Karachi&country=Pakistan");
  const s = await snapshot();
  console.log("      ", s.next, "|", s.times);
  expect(/Fajr .* tomorrow/.test(s.next), `next = ${s.next}`);
  expect(!s.times.includes("[next]"), "a row is still marked next");
});

await test("Midnight rollover loads the new day", async () => {
  await loadAt("2026-10-27T23:59:56+05:00", BASE + "?city=Karachi&country=Pakistan");
  const before = (await snapshot()).dates;
  expect(before.includes("27 Oct"), `started on wrong day: ${before}`);
  await waitFor(`document.getElementById("dates").innerText.includes("28 Oct")`, 15000);
  await idle();
  const after = await snapshot();
  console.log("       before:", before, "\n       after: ", after.dates, "|", after.next);
});

await test("Offline search shows a network error", async () => {
  await send("Network.enable");
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // The service worker makes its own network requests, so take it offline too.
  const sws = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "service_worker");
  const swSockets = await Promise.all(sws.map(async (t) => {
    const sock = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => (sock.onopen = r));
    let n = 0;
    const call = (method, params = {}) => new Promise((r) => { const id = ++n; sock.addEventListener("message", function h({ data }) { if (JSON.parse(data).id === id) { sock.removeEventListener("message", h); r(); } }); sock.send(JSON.stringify({ id, method, params })); });
    await call("Network.enable");
    await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    return sock;
  }));
  console.log(`       service workers taken offline: ${swSockets.length}`);
  await search("Dubai", "United Arab Emirates");
  await waitFor(`!document.getElementById("error").hidden`);
  console.log("      ", (await snapshot()).error);
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

const realErrors = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
console.log(`\n${passed} passed, ${failed} failed. Console errors: ${realErrors.length ? realErrors.join("\n  ") : "none"}`);
ws.close();
chrome.kill();
process.exit(failed ? 1 : 0);
