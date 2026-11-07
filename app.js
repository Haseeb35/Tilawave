const REVERSE_GEOCODE_API = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const PRAYERS = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
const ARABIC = {
  Fajr: "الفجر",
  Sunrise: "الشروق",
  Dhuhr: "الظهر",
  Asr: "العصر",
  Maghrib: "المغرب",
  Isha: "العشاء",
};
const KAABA = { lat: 21.4225, lng: 39.8262 };
const TOTAL_AYAHS = 6236;

let state = {
  place: null,     // { lat, lng, label, city, country, timezone }
  today: null,     // Aladhan timings for today
  tomorrow: null,  // Aladhan timings for tomorrow (for Fajr after Isha)
  dateKey: null,   // "DD-MM-YYYY" in the place's timezone
  qibla: null,     // degrees from North
};
let requestId = 0;
let countdownTimer = null;

// ---------- Network ----------

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Location isn't supported by this browser. Search by city instead."));
    }
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      const messages = {
        1: "Location permission was denied. Allow it in your browser settings, or search by city.",
        2: "Your location is unavailable. On a Mac, check System Settings → Privacy & Security → Location Services.",
        3: "Finding your location took too long. Try again, or search by city.",
      };
      reject(new Error(messages[err.code] || err.message));
    }, { timeout: 15000, maximumAge: 10 * 60 * 1000 });
  });
}

// Device location -> place, with a city name when one can be found.
async function locate() {
  const { coords } = await getPosition();
  const lat = coords.latitude;
  const lng = coords.longitude;
  const place = {
    lat,
    lng,
    city: "",
    country: "",
    label: `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  try {
    const r = await getJSON(`${REVERSE_GEOCODE_API}?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
    place.city = r.city || r.locality || "";
    place.country = (r.countryName || "").replace(/\s*\(the\)$/, "");
    if (place.city) place.label = `${place.city}, ${place.country}`;
  } catch {
    // Keep the coordinates as the label.
  }
  return place;
}

function timesParams(place) {
  return new URLSearchParams({
    latitude: place.lat,
    longitude: place.lng,
    method: $("method").value,
    school: $("school").value,
    timezonestring: place.timezone,
    ...(tuneParam() && { tune: tuneParam() }),
  });
}

// Offline fallback: this month's and next month's times, saved once a day.
const TIMES_CACHE_KEY = "times-cache";
const timesCacheKey = (place) =>
  `${place.lat.toFixed(3)},${place.lng.toFixed(3)},${$("method").value},${$("school").value},${tuneParam() || ""}`;

async function cacheMonths(place) {
  const key = timesCacheKey(place);
  const today = dateIn(place.timezone);
  const cache = readStore(TIMES_CACHE_KEY, null);
  if (cache?.key === key && cache.savedOn === today) return;
  const [, month, year] = today.split("-").map(Number);
  const months = [[year, month], month === 12 ? [year + 1, 1] : [year, month + 1]];
  try {
    const results = await Promise.all(
      months.map(([y, m]) => getJSON(`${ALADHAN_API}/calendar/${y}/${m}?${timesParams(place)}`))
    );
    const days = {};
    for (const { data } of results) {
      for (const d of data) days[d.date.gregorian.date] = { timings: d.timings, date: d.date };
    }
    writeStore(TIMES_CACHE_KEY, { key, savedOn: today, days });
  } catch {
    // Best effort; the live API still works while online.
  }
}

async function fetchDay(place, date) {
  try {
    const json = await getJSON(`${ALADHAN_API}/timings/${date}?${timesParams(place)}`);
    if (json.code !== 200) throw new Error(json.data || "Could not load prayer times.");
    return json.data;
  } catch (err) {
    const cache = readStore(TIMES_CACHE_KEY, null);
    const saved = cache?.key === timesCacheKey(place) && cache.days[date];
    if (saved) return saved;
    throw err;
  }
}

// Resolve a place, then load today's and tomorrow's times for it.
// Only the latest request is rendered, so quick repeated searches can't race.
async function update(getPlace) {
  const id = ++requestId;
  setBusy(true);
  showError("");
  try {
    const place = await getPlace();
    const dateKey = dateIn(place.timezone);
    const [today, tomorrow] = await Promise.all([
      fetchDay(place, dateKey),
      fetchDay(place, dateIn(place.timezone, 1)),
    ]);
    if (id !== requestId) return;

    state = { place, today, tomorrow, dateKey, qibla: qiblaDirection(place.lat, place.lng) };
    saveSettings({ place });
    syncUrl(place);
    $("city").value = place.city;
    $("country").value = place.country;

    renderHeader();
    renderTimes();
    renderTracker();
    renderQibla();
    startCountdown();
    cacheMonths(place);
  } catch (err) {
    if (id === requestId) showError(err.message);
  } finally {
    if (id === requestId) setBusy(false);
  }
}

// ---------- Time helpers ----------

// Current time of day (in seconds) in the place's timezone
function nowSeconds() {
  const get = partsIn(state.place.timezone, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

// Next prayer (Sunrise is skipped — it isn't a prayer). After Isha, it's tomorrow's Fajr.
function nextPrayer() {
  const now = nowSeconds();
  const today = state.today.timings;
  for (const name of PRAYERS) {
    if (name === "Sunrise") continue;
    const t = toSeconds(today[name]);
    if (t > now) return { name, time: today[name], remaining: t - now, tomorrow: false };
  }
  const fajr = state.tomorrow.timings.Fajr;
  return { name: "Fajr", time: fajr, remaining: 86400 - now + toSeconds(fajr), tomorrow: true };
}

// ---------- Rendering ----------

function setBusy(busy) {
  document.body.classList.toggle("loading", busy);
  $("search-btn").disabled = busy;
  $("gps-btn").disabled = busy;
  if (busy && !state.place) $("location").textContent = "Loading";
}

function showError(msg) {
  $("error").textContent = msg;
  $("error").hidden = !msg;
}

function syncUrl(place) {
  const url = new URL(location.href);
  url.search = place.city ? new URLSearchParams({ city: place.city, country: place.country }) : "";
  history.replaceState(null, "", url);
}

// ---------- Share today's times ----------

async function sharePrayerTimes() {
  const W = 1080, H = 1350, PAD = 96;
  await Promise.all(['60px "Instrument Serif"', '30px "Geist"', '30px "Noto Naskh Arabic"'].map((f) => document.fonts.load(f).catch(() => null)));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0e1a";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(216, 180, 110, 0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  const { date, timings } = state.today;
  const [d, m, y] = date.gregorian.date.split("-").map(Number);
  ctx.fillStyle = "#d8b46e";
  ctx.font = '500 26px "Geist", sans-serif';
  ctx.fillText("PRAYER TIMES", PAD, PAD + 30);
  ctx.fillStyle = "#f2eee3";
  ctx.font = '76px "Instrument Serif", serif';
  ctx.fillText(state.place.label, PAD, PAD + 130, W - PAD * 2);
  ctx.fillStyle = "#9ea2b4";
  ctx.font = '30px "Geist", sans-serif';
  ctx.fillText(`${date.gregorian.weekday.en}, ${date.readable} · ${hijriLabel(hijriFor(y, m, d))}`, PAD, PAD + 190, W - PAD * 2);

  const rowH = 128;
  let top = PAD + 260;
  PRAYERS.forEach((name, i) => {
    const yRow = top + i * rowH;
    if (i) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(PAD, yRow, W - PAD * 2, 2);
    }
    const sunrise = name === "Sunrise";
    ctx.textAlign = "left";
    ctx.fillStyle = sunrise ? "#9ea2b4" : "#f2eee3";
    ctx.font = '500 40px "Geist", sans-serif';
    ctx.fillText(name, PAD, yRow + 78);
    ctx.fillStyle = "#9ea2b4";
    ctx.font = '32px "Noto Naskh Arabic", serif';
    ctx.fillText(ARABIC[name], PAD + 260, yRow + 78);
    const [clock, suffix] = to12h(timings[name]);
    ctx.textAlign = "right";
    ctx.fillStyle = "#9ea2b4";
    ctx.font = '500 26px "Geist", sans-serif';
    ctx.fillText(suffix, W - PAD, yRow + 78);
    const suffixW = ctx.measureText(suffix).width;
    ctx.fillStyle = sunrise ? "#9ea2b4" : "#d8b46e";
    ctx.font = '60px "Geist", sans-serif';
    ctx.fillText(clock, W - PAD - suffixW - 14, yRow + 80);
  });

  ctx.textAlign = "left";
  ctx.fillStyle = "#9ea2b4";
  ctx.font = '26px "Geist", sans-serif';
  const { method = "1", school = "1" } = loadSettings();
  ctx.fillText(`${METHOD_NAMES[method] || "Karachi"} method · ${school === "1" ? "Hanafi" : "Standard"} Asr${tuneParam() ? " · adjusted" : ""}`, PAD, H - PAD - 10);
  ctx.textAlign = "right";
  ctx.font = '40px "Instrument Serif", serif';
  ctx.fillText("Tilawave", W - PAD, H - PAD - 8);

  const text = `Prayer times for ${state.place.label}, ${date.readable}\n` +
    PRAYERS.map((p) => `${p}: ${to12h(timings[p]).join(" ")}`).join("\n");
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], `prayer-times-${date.gregorian.date}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  await copyText(text);
  toast("Image saved, and the times copied as text.");
}

$("share-times").addEventListener("click", () =>
  sharePrayerTimes().catch((err) => toast(`Couldn't create the image. ${err.message}`)));

function renderHeader() {
  const { date, timings } = state.today;
  const [d, m, y] = date.gregorian.date.split("-").map(Number);
  const hijri = hijriFor(y, m, d);
  $("location").textContent = state.place.label;
  $("dates").innerHTML =
    `${escapeHtml(date.gregorian.weekday.en)}, ${escapeHtml(date.readable)}` +
    `<span class="hijri">${hijriLabel(hijri)}</span>`;

  // During Ramadan, show when Sehri ends (Fajr) and Iftar begins (Maghrib).
  const ramadan = hijri.month === 9;
  $("share-times").disabled = false;
  $("tune-link").textContent = tuneParam() ? "Adjusted times · change" : "Adjust times";
  $("ramadan").hidden = !ramadan;
  if (ramadan) {
    $("ramadan").textContent =
      `Ramadan day ${hijri.day} · Sehri ends ${to12h(timings.Fajr).join(" ")} · ` +
      `Iftar ${to12h(timings.Maghrib).join(" ")}`;
  }
}

const CHECK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>`;

// Small line icons showing where the sun is at each prayer
// Drawn on a 32×32 grid. Each prayer has its own colour (set in CSS by li.p-Name).
const SKY_ICONS = {
  Fajr: `<path d="M9.5 19.5a6.5 6.5 0 0 1 13 0" /><path d="M4 19.5h24M8 23.5h16M12 27.5h8" /><path class="rays" d="M16 6.5v3M7.6 10l2 2M24.4 10l-2 2M3.8 15l2.7.8M28.2 15l-2.7.8" />`,
  Sunrise: `<circle cx="16" cy="16" r="5.5" /><path class="rays" d="M16 3.5V7M16 25v3.5M3.5 16H7M25 16h3.5M7.2 7.2l2.5 2.5M22.3 22.3l2.5 2.5M7.2 24.8l2.5-2.5M22.3 9.7l2.5-2.5" />`,
  Dhuhr: `<circle class="core" cx="16" cy="16" r="6" /><path class="rays" d="M16 3v3.5M16 25.5V29M3 16h3.5M25.5 16H29M6.8 6.8l2.5 2.5M22.7 22.7l2.5 2.5M6.8 25.2l2.5-2.5M22.7 9.3l2.5-2.5" />`,
  Asr: `<circle cx="12.5" cy="12" r="4.8" /><path class="rays" d="M12.5 3.5v2M5 6.2l1.4 1.4M4 12h2M20 6.2l-1.4 1.4" /><path class="cloud" d="M11 26.5h12.5a4.5 4.5 0 0 0 .5-9 6.5 6.5 0 0 0-12.3 1.9A3.6 3.6 0 0 0 11 26.5z" />`,
  Maghrib: `<path d="M9.5 18.5a6.5 6.5 0 0 1 13 0" /><path d="M4 18.5h24M7 22.5h18M10.5 26.5h11" /><path class="sink" d="M16 5.5v6M13.2 8.8l2.8 2.8 2.8-2.8" />`,
  Isha: `<path d="M19.5 4.8a11.5 11.5 0 1 0 7.7 17.4A9.5 9.5 0 0 1 19.5 4.8z" /><path class="twinkle" d="M24 5.5l.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5 2.1-.3z" />`,
};

// Fard rak'ahs, which every school agrees on
const PRAYER_FACTS = {
  Fajr: "2 rak'ahs fard",
  Dhuhr: "4 rak'ahs fard",
  Asr: "4 rak'ahs fard",
  Maghrib: "3 rak'ahs fard",
  Isha: "4 rak'ahs fard, then Witr",
};
const WINDOW_END = { Fajr: "Sunrise", Dhuhr: "Asr", Asr: "Maghrib", Maghrib: "Isha", Isha: "Fajr" };

// When a prayer's time ends (Isha runs until tomorrow's Fajr)
function windowEnd(name) {
  if (name === "Isha") return toSeconds(state.tomorrow.timings.Fajr) + DAY;
  return toSeconds(state.today.timings[WINDOW_END[name]]);
}

// The prayer whose time we are in right now, if any (none between sunrise and Dhuhr)
function currentWindow() {
  const now = nowSeconds();
  for (const name of [...FARD].reverse()) {
    const start = toSeconds(state.today.timings[name]);
    if (now < start) continue;
    const end = windowEnd(name);
    return now < end ? { name, start, end, now } : null;
  }
  return null;
}

let renderedWindow = null;

function renderTimes() {
  const now = nowSeconds();
  const next = nextPrayer();
  const current = currentWindow();
  renderedWindow = current?.name ?? null;
  const prayed = prayedOn(localDateKey());

  $("times").innerHTML = PRAYERS.map((name) => {
    const time = state.today.timings[name];
    const [clock, suffix] = to12h(time);
    const started = toSeconds(time) <= now;
    const isNext = !next.tomorrow && name === next.name;
    const isNow = current?.name === name;
    const classes = [
      "prayer",
      `p-${name}`,
      name === "Sunrise" && "sunrise",
      isNow && "now",
      isNext ? "next" : started && !isNow && "passed",
    ].filter(Boolean).join(" ");
    const done = prayed.includes(name);
    const check = name === "Sunrise" ? "" : `
      <button class="pray-check${done ? " done" : ""}" data-prayer="${name}" type="button"
        aria-pressed="${done}" aria-label="Mark ${name} as prayed" ${started || done ? "" : "disabled"}
        title="${started || done ? `Mark ${name} as prayed` : `${name} hasn't started yet`}">${CHECK_ICON}</button>`;

    const start = toSeconds(time);
    const back = name === "Sunrise"
      ? `<p class="back-title">Sunrise</p>
         <p class="back-line">The Fajr time ends.</p>
         <p class="back-line muted">No prayer is offered while the sun rises.</p>`
      : `<p class="back-title">${name} window</p>
         <p class="back-line">${fmt(start)} – ${fmt(windowEnd(name))}</p>
         <p class="back-line muted">${formatSpan(windowEnd(name) - start)} long</p>
         <p class="back-line">${PRAYER_FACTS[name]}</p>
         ${name === "Isha" ? `<p class="back-line muted">Best before ${fmt(toSeconds(state.today.timings.Midnight) + (toSeconds(state.today.timings.Midnight) < 12 * 3600 ? DAY : 0))}</p>` : ""}`;

    return `<li class="${classes}">
      <div class="tile">
        <div class="face front">
          <svg class="sky-icon" viewBox="0 0 32 32" aria-hidden="true">${SKY_ICONS[name]}</svg>
          <div class="prayer-name"><span class="name">${name}${isNow ? `<span class="visually-hidden"> (now)</span>` : isNext ? `<span class="visually-hidden"> (next)</span>` : ""}</span><span class="arabic" lang="ar">${ARABIC[name]}</span></div>
          <span class="time">${clock}<small>${suffix}</small></span>
          ${isNow ? `<div class="window" aria-label="Time left to pray ${name}">
              <div class="window-bar"><span></span></div>
              <span class="window-left"></span>
            </div>` : ""}
        </div>
        <div class="face back" aria-hidden="true">${back}</div>
      </div>
      ${check}
    </li>`;
  }).join("");
  updateWindow();
}

// Live progress of the current prayer's time
function updateWindow() {
  const current = currentWindow();
  if ((current?.name ?? null) !== renderedWindow) return renderTimes();
  if (!current) return;
  const li = $("times").querySelector("li.now");
  if (!li) return;
  const total = current.end - current.start;
  const left = current.end - current.now;
  li.querySelector(".window-bar span").style.width = `${(((total - left) / total) * 100).toFixed(2)}%`;
  li.querySelector(".window-left").textContent = `${formatSpan(left)} left`;
}

// ---------- Prayer tracker ----------

const PRAYER_LOG_KEY = "prayer-log"; // { "YYYY-MM-DD": ["Fajr", "Dhuhr", ...] }
const FARD = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

const prayerLog = () => readStore(PRAYER_LOG_KEY, {}) || {};
const prayedOn = (dateKey) => prayerLog()[dateKey] || [];

function togglePrayed(dateKey, name) {
  const log = prayerLog();
  const set = new Set(log[dateKey] || []);
  if (set.has(name)) set.delete(name);
  else set.add(name);
  if (set.size) log[dateKey] = FARD.filter((p) => set.has(p));
  else delete log[dateKey];
  writeStore(PRAYER_LOG_KEY, log);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function renderTracker() {
  const log = prayerLog();
  const done = (key) => log[key] || [];
  const todayKey = localDateKey();
  $("tracker-today").textContent = `${done(todayKey).length} of 5 today`;

  // Days in a row with all five, counting today only once it's complete
  let streak = 0;
  for (let i = done(todayKey).length === 5 ? 0 : 1; i < 3650; i++) {
    if (done(localDateKey(daysAgo(i))).length !== 5) break;
    streak++;
  }
  $("tracker-streak").textContent = `${streak} day${streak === 1 ? "" : "s"}`;

  const week = Array.from({ length: 7 }, (_, i) => daysAgo(6 - i));
  const weekTotal = week.reduce((sum, d) => sum + done(localDateKey(d)).length, 0);
  $("tracker-week").textContent = `${weekTotal} / 35`;

  // Unmarked prayers on past days since tracking began (at most 30 days back)
  const firstDay = Object.keys(log).sort()[0];
  let missed = 0;
  for (let i = 1; firstDay && i <= 30; i++) {
    const key = localDateKey(daysAgo(i));
    if (key < firstDay) break;
    missed += 5 - done(key).length;
  }
  $("tracker-missed").textContent = missed;

  $("tracker-days").innerHTML = `<th></th>` + week.map((d) => {
    const isToday = localDateKey(d) === todayKey;
    return `<th scope="col" class="${isToday ? "today" : ""}">
      ${d.toLocaleDateString("en-GB", { weekday: "short" })}<span>${d.getDate()}</span>
    </th>`;
  }).join("");

  const now = state.place ? nowSeconds() : Infinity;
  $("tracker-body").innerHTML = FARD.map((p) => `<tr>
    <th scope="row">${p}</th>
    ${week.map((d) => {
      const key = localDateKey(d);
      const on = done(key).includes(p);
      const notYet = key === todayKey && !on && state.today && toSeconds(state.today.timings[p]) > now;
      const label = `${p} on ${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}`;
      return `<td><button class="cell${on ? " on" : ""}" type="button" data-prayer="${p}" data-date="${key}"
        aria-pressed="${on}" aria-label="${label}" title="${label}" ${notYet ? "disabled" : ""}></button></td>`;
    }).join("")}
  </tr>`).join("");
}

// ---------- Qada: prayers to make up ----------

const QADA_KEY = "qada"; // { counts: { Fajr: 3, ... }, imported: ["2026-10-01|Fajr", ...] }
const loadQada = () => ({ counts: {}, imported: [], ...readStore(QADA_KEY, {}) });

// Past days (up to 30, from the first tracked day) with prayers left unmarked
function unmarkedPrayers() {
  const log = prayerLog();
  const firstDay = Object.keys(log).sort()[0];
  const imported = new Set(loadQada().imported);
  const found = [];
  for (let i = 1; firstDay && i <= 30; i++) {
    const key = localDateKey(daysAgo(i));
    if (key < firstDay) break;
    for (const p of FARD) if (!(log[key] || []).includes(p) && !imported.has(`${key}|${p}`)) found.push(`${key}|${p}`);
  }
  return found;
}

function renderQada() {
  const { counts } = loadQada();
  const total = FARD.reduce((sum, p) => sum + (counts[p] || 0), 0);
  $("qada-total").textContent = `${total.toLocaleString()} prayer${total === 1 ? "" : "s"}`;
  $("qada-list").innerHTML = FARD.map((p) => {
    const n = Math.max(0, Math.floor(Number(counts[p]))) || 0;
    return `<li>
      <span class="qada-name">${p}</span>
      <span class="qada-count">${n}</span>
      <button class="icon-btn small-btn" type="button" data-qada="${p}" data-step="1" aria-label="Add a missed ${p}">+</button>
      <button class="chip" type="button" data-qada="${p}" data-step="-1" ${n ? "" : "disabled"}>Made up</button>
    </li>`;
  }).join("");
  const pending = unmarkedPrayers().length;
  $("qada-import").hidden = !pending;
  $("qada-import").textContent = `Add ${pending} unmarked from tracker`;
}

$("qada-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-qada]");
  if (!btn) return;
  const q = loadQada();
  const p = btn.dataset.qada;
  q.counts[p] = Math.max(0, (q.counts[p] || 0) + Number(btn.dataset.step));
  writeStore(QADA_KEY, q);
  renderQada();
  if (btn.dataset.step === "-1") toast(`${p} made up. May Allah accept it.`);
});

$("qada-import").addEventListener("click", () => {
  const q = loadQada();
  const found = unmarkedPrayers();
  for (const key of found) {
    const p = key.split("|")[1];
    q.counts[p] = (q.counts[p] || 0) + 1;
  }
  q.imported = [...q.imported, ...found].slice(-2000);
  writeStore(QADA_KEY, q);
  renderQada();
  toast(`${found.length} prayer${found.length === 1 ? "" : "s"} added to qada.`);
});

// ---------- Nearby mosques (OpenStreetMap) ----------

// Public Overpass servers are often busy, so try each in turn, then fall back to Nominatim search
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

async function fetchWithTimeout(url, options = {}, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Mosques within radius metres: [{ name, lat, lng }]
async function mosquesAround(from, radius) {
  const query = `[out:json][timeout:15];nwr["amenity"="place_of_worship"]["religion"="muslim"](around:${radius},${from.lat},${from.lng});out center 60;`;
  for (const url of OVERPASS) {
    const json = await fetchWithTimeout(url, { method: "POST", body: new URLSearchParams({ data: query }) });
    if (json?.elements) {
      return json.elements.map((el) => ({
        name: el.tags?.["name:en"] || el.tags?.name,
        lat: el.lat ?? el.center?.lat,
        lng: el.lon ?? el.center?.lon,
      }));
    }
  }
  const d = radius / 111000; // metres to degrees, roughly
  const box = [from.lng - d, from.lat + d, from.lng + d, from.lat - d].map((n) => n.toFixed(5)).join(",");
  const json = await fetchWithTimeout(`${NOMINATIM}?q=mosque&format=jsonv2&limit=40&bounded=1&accept-language=en&viewbox=${box}`);
  if (!json) throw new Error("The map service is busy. Please try again in a minute.");
  return json
    .filter((r) => r.type === "place_of_worship")
    .map((r) => ({ name: r.name, lat: Number(r.lat), lng: Number(r.lon) }));
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function findMosques() {
  const btn = $("mosques-btn");
  btn.disabled = true;
  $("mosques-status").textContent = "Finding your location…";
  let from;
  let approximate = false;
  try {
    const { coords } = await getPosition();
    from = { lat: coords.latitude, lng: coords.longitude };
  } catch (err) {
    if (!state.place) {
      $("mosques-status").textContent = err.message;
      btn.disabled = false;
      return;
    }
    from = { lat: state.place.lat, lng: state.place.lng };
    approximate = true;
  }
  $("mosques-status").textContent = "Searching the map…";
  try {
    let mosques = [];
    for (const radius of [3000, 10000]) {
      mosques = (await mosquesAround(from, radius))
        .filter((m) => m.lat != null)
        .map((m) => ({ ...m, name: m.name || "Mosque" }))
        .map((m) => ({ ...m, km: distanceKm(from, m) }))
        .sort((a, b) => a.km - b.km)
        // A mosque can be mapped twice (as a point and as a building)
        .filter((m, i, all) => !all.slice(0, i).some((o) => o.name === m.name && distanceKm(o, m) < 0.15))
        .slice(0, 8);
      if (mosques.length >= 3) break;
    }
    const where = approximate ? `the centre of ${state.place.label} (location was not shared)` : "you";
    $("mosques-status").textContent = mosques.length
      ? `${mosques.length} closest to ${where}. From OpenStreetMap; check timings locally.`
      : `No mosques are mapped within 10 km of ${where}.`;
    $("mosques-list").innerHTML = mosques.map((m) => {
      const dist = m.km < 1 ? `${Math.round(m.km * 1000 / 10) * 10} m` : `${m.km.toFixed(1)} km`;
      const walk = Math.max(1, Math.round((m.km * 1000) / 80));
      return `<li>
        <span class="mosque-name">${escapeHtml(m.name)}</span>
        <span class="muted small">${dist}${m.km < 3 ? ` · about ${walk} min walk` : ""}</span>
        <a class="text-btn" href="https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}&travelmode=${m.km < 2 ? "walking" : "driving"}" target="_blank" rel="noopener">Directions</a>
      </li>`;
    }).join("");
    reveal($("mosques-list").children);
  } catch (err) {
    $("mosques-status").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Search again";
  }
}

$("mosques-btn").addEventListener("click", findMosques);

function onPrayerToggle(e) {
  const btn = e.target.closest("button[data-prayer]");
  if (!btn) return;
  togglePrayed(btn.dataset.date || localDateKey(), btn.dataset.prayer);
  if (state.today) renderTimes();
  renderTracker();
  renderNotes();
  renderQada();
}

// ---------- Today notes: Jummah, reading plan, unmarked prayers ----------

const KAHF = 18;

function jummahNote() {
  if (new Date().getDay() !== 5) return null;
  const last = readLastRead();
  const reading = last && !last.juz && last.surah === KAHF && last.ayah > 1;
  return {
    title: "It's Jummah",
    text: reading ? `Continue Surah Al-Kahf from verse ${last.ayah}.` : "A Friday sunnah: read Surah Al-Kahf.",
    href: reading ? `quran.html?surah=${KAHF}#ayah-${last.ayah}` : `quran.html?surah=${KAHF}`,
    action: reading ? "Continue" : "Read Al-Kahf",
  };
}

// Mirrors the khatam goal on the Quran page: by day d of a g-day goal, 30·d/g paras should be done.
function readingNote() {
  const k = { completed: [], goalDays: 0, goalStart: null, ...readStore("quran-khatam", {}) };
  const done = k.completed.length;
  if (done >= 30) return null;
  const next = Array.from({ length: 30 }, (_, i) => i + 1).find((j) => !k.completed.includes(j));
  const link = { href: `quran.html?juz=${next}`, action: `Read Para ${next}` };
  if (!k.goalDays || !k.goalStart) {
    return done ? { title: "Khatam", text: `${done} of 30 paras read. Para ${next} is next.`, ...link } : null;
  }
  const day = Math.round((Date.parse(`${localDateKey()}T00:00:00Z`) - Date.parse(`${k.goalStart}T00:00:00Z`)) / 86400000) + 1;
  const target = Math.min(30, Math.ceil((30 * day) / k.goalDays));
  const left = target - done;
  const text = day > k.goalDays
    ? `Your ${k.goalDays}-day goal has passed. ${30 - done} paras to go.`
    : left > 0
      ? `Read ${left} para${left === 1 ? "" : "s"} today to stay on your ${k.goalDays}-day khatam.`
      : `You're on track with your ${k.goalDays}-day khatam. MashaAllah.`;
  return { title: "Today's reading", text, ...link };
}

// After Isha begins, list today's prayers that have started but aren't ticked yet
function trackerNote() {
  if (!state.today || dateIn(state.place.timezone) !== state.dateKey) return null;
  const now = nowSeconds();
  if (now < toSeconds(state.today.timings.Isha)) return null;
  const done = prayedOn(localDateKey());
  const open = FARD.filter((p) => !done.includes(p));
  if (!open.length) return null;
  const names = open.length === 1 ? open[0] : `${open.slice(0, -1).join(", ")} and ${open.at(-1)}`;
  return { title: "Prayer tracker", text: `You haven't marked ${names} today.`, href: "#tracker", action: "Open tracker" };
}

const hijriDate = (date) => hijriFor(date.getFullYear(), date.getMonth() + 1, date.getDate());

// Sunnah fasts coming up tomorrow: Monday and Thursday, the White Days (13–15),
// Arafah, and Tasu'a and Ashura. Never during Ramadan, on Eid or the days of Tashreeq.
function fastingNote() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { day, month } = hijriDate(tomorrow);
  if (month === 9 || (month === 10 && day === 1) || (month === 12 && day >= 10 && day <= 13)) return null;
  const reasons = [];
  if (month === 12 && day === 9) reasons.push("the Day of Arafah");
  if (month === 1 && day === 9) reasons.push("Tasu'a, the day before Ashura");
  if (month === 1 && day === 10) reasons.push("Ashura");
  if (day >= 13 && day <= 15) reasons.push(`the ${day}th of the Hijri month, one of the White Days`);
  const weekday = tomorrow.getDay();
  if (weekday === 1 || weekday === 4) reasons.push(weekday === 1 ? "Monday" : "Thursday");
  if (!reasons.length) return null;
  return {
    title: "Sunnah fast tomorrow",
    text: `Tomorrow is ${reasons.join(" and ")}. Intend to fast and set an alarm for suhoor.`,
    href: "calendar.html",
    action: "Islamic calendar",
  };
}

// After Isha and through the night: the sunnah of reciting Al-Mulk before sleep
function mulkNote() {
  if (!state.today) return null;
  const now = nowSeconds();
  if (now < toSeconds(state.today.timings.Isha) && now >= toSeconds(state.today.timings.Fajr)) return null;
  return { title: "Before you sleep", text: "A sunnah of the night: recite Surah Al-Mulk before you sleep.", href: "quran.html?surah=67", action: "Read Al-Mulk" };
}

function renderNotes() {
  const notes = [jummahNote(), fastingNote(), readingNote(), trackerNote(), mulkNote()].filter(Boolean);
  $("today-notes").innerHTML = notes.map((n) => `
    <a class="note card" href="${escapeHtml(n.href)}">
      <span class="eyebrow">${escapeHtml(n.title)}</span>
      <span class="note-text">${escapeHtml(n.text)}</span>
      <span class="note-action">${escapeHtml(n.action)} →</span>
    </a>`).join("");
}

// Part of the day, used to colour the sky behind the hero.
function currentPeriod() {
  const now = nowSeconds();
  const at = (name) => toSeconds(state.today.timings[name]);
  if (now < at("Fajr") || now >= at("Isha")) return "night";
  if (now < at("Sunrise")) return "dawn";
  if (now < at("Dhuhr")) return "morning";
  if (now < at("Asr")) return "afternoon";
  if (now < at("Maghrib")) return "evening";
  return "dusk";
}

// ---------- Sky path: the sun by day, the moon by night ----------

// Geometry of the SVG (viewBox 0 0 1000 260)
const SKY = { x0: 40, x1: 960, horizon: 150, height: 118, padding: 25 * 60 };
const DAY = 86400;

const fmt = (seconds) => to12h(new Date(((seconds % DAY) + DAY) % DAY * 1000).toISOString().slice(11, 16)).join(" ");

function formatSpan(seconds) {
  const m = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

// Everything is measured in seconds on one continuous axis, so a night that
// crosses midnight (Isha → Fajr) is just a range with values past 86400.
function skyModel() {
  const at = (name) => toSeconds(state.today.timings[name]);
  let now = nowSeconds();
  const period = currentPeriod();

  if (period !== "night") {
    const sunrise = at("Sunrise");
    const sunset = at("Maghrib");
    // Sun altitude as a sine over the day: 0 at sunrise and sunset, 1 at noon,
    // negative (below the horizon) for the dawn and dusk twilight.
    const altitude = (t) => Math.max(-0.5, Math.sin((Math.PI * (t - sunrise)) / (sunset - sunrise)));
    return {
      mode: "day",
      period,
      now,
      start: at("Fajr") - SKY.padding,
      end: at("Isha") + SKY.padding,
      altitude,
      markers: PRAYERS.map((name) => ({ name, label: name, time: at(name), prayer: name !== "Sunrise" })),
      sunrise,
      sunset,
    };
  }

  // Night: from tonight's Isha to the next Fajr. Before Fajr (after midnight),
  // the night started yesterday; today's Isha is within a minute of it.
  const afterMidnight = now < at("Fajr");
  if (afterMidnight) now += DAY;
  const isha = at("Isha");
  const fajr = (afterMidnight ? at("Fajr") : toSeconds(state.tomorrow.timings.Fajr)) + DAY;
  const late = (name) => { const t = at(name); return t < 12 * 3600 ? t + DAY : t; };
  const midnight = late("Midnight");
  const lastThird = late("Lastthird");
  const altitude = (t) => 0.62 * Math.max(-0.5, Math.sin((Math.PI * (t - isha)) / (fajr - isha)));
  return {
    mode: "night",
    period,
    now,
    start: isha - SKY.padding,
    end: fajr + SKY.padding,
    altitude,
    markers: [
      { name: "Isha", label: "Isha", time: isha, prayer: true },
      { name: "Midnight", label: "Midnight", time: midnight },
      { name: "Lastthird", label: "Last third", time: lastThird },
      { name: "Fajr", label: "Fajr", time: fajr, prayer: true },
    ],
    midnight,
    lastThird,
    fajr,
  };
}

const skyX = (m, t) => SKY.x0 + ((SKY.x1 - SKY.x0) * (t - m.start)) / (m.end - m.start);
const skyY = (m, t) => SKY.horizon - SKY.height * m.altitude(t);

function skyPath(m, from, to) {
  if (to <= from) return "";
  const steps = Math.max(2, Math.ceil(((to - from) / (m.end - m.start)) * 120));
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    d += `${i ? "L" : "M"}${skyX(m, t).toFixed(1)} ${skyY(m, t).toFixed(1)}`;
  }
  return d;
}

// What's happening right now, in words
function skyStatus(m) {
  const at = (name) => toSeconds(state.today.timings[name]);
  const now = m.now;
  if (m.mode === "night") {
    if (now >= m.lastThird) return ["Last third of the night", `Best time for Tahajjud · Fajr in ${formatSpan(m.fajr - now)}`];
    if (now >= m.midnight) return ["Night", `Last third begins at ${fmt(m.lastThird)}`];
    return ["Isha time", `Night midpoint ${fmt(m.midnight)} · Last third from ${fmt(m.lastThird)}`];
  }
  switch (m.period) {
    case "dawn": return ["Fajr time · Dawn", `Sunrise in ${formatSpan(m.sunrise - now)}. Pray Fajr before it`];
    case "morning": return ["Morning", `Sun is up · ${formatSpan(m.sunset - now)} of daylight left`];
    case "afternoon": return ["Dhuhr time", `${formatSpan(m.sunset - now)} of daylight left`];
    case "evening": return ["Asr time", `Sunset in ${formatSpan(m.sunset - now)}`];
    default: return ["Maghrib time · Dusk", `Twilight fades by Isha at ${fmt(at("Isha"))}`];
  }
}

// A few dozen stars for the night sky, placed once
function drawStars() {
  const field = document.querySelector("#hero .stars");
  if (!field || field.childElementCount) return;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Styles are set through the DOM, since the Content Security Policy blocks inline style attributes.
  for (let i = 0; i < 46; i++) {
    const size = rand() < 0.15 ? 2.5 : 1.5;
    const star = document.createElement("i");
    Object.assign(star.style, {
      left: `${(rand() * 100).toFixed(1)}%`, top: `${(rand() * 62).toFixed(1)}%`, width: `${size}px`, height: `${size}px`,
      animationDelay: `${(rand() * 6).toFixed(2)}s`, animationDuration: `${(3 + rand() * 4).toFixed(2)}s`,
    });
    field.append(star);
  }
  field.append(Object.assign(document.createElement("b"), { className: "shooting-star" }));
}

let sky = null;           // the current model
let skyIntro = null;      // { from, startedAt } while the indicator glides in
let skyFrame = 0;

function renderArc() {
  const m = skyModel();
  sky = m;
  const next = nextPrayer();
  const nightNext = m.mode === "night" ? "Fajr" : null;

  const markers = m.markers.map((mk) => {
    const x = skyX(m, mk.time).toFixed(1);
    const y = skyY(m, mk.time).toFixed(1);
    const isNext = mk.prayer && (nightNext ? mk.name === nightNext : !next.tomorrow && mk.name === next.name);
    const cls = [isNext ? "next" : mk.time <= m.now ? "passed" : "", mk.prayer ? "" : "minor"].join(" ");
    return `<g class="marker ${cls}">
      ${isNext ? `<circle class="ping" cx="${x}" cy="${y}" r="5" />` : ""}
      <circle cx="${x}" cy="${y}" r="${mk.prayer ? 5 : 3.5}" />
      <text x="${x}" y="${SKY.horizon + 80}">${mk.label}</text>
      <text class="marker-time" x="${x}" y="${SKY.horizon + 98}">${fmt(mk.time)}</text>
    </g>`;
  }).join("");

  const glowX = m.mode === "day" ? skyX(m, m.period === "dusk" || m.period === "evening" ? m.sunset : m.sunrise) : 500;
  $("arc").innerHTML = `
    <defs>
      <radialGradient id="sun-glow">
        <stop offset="0" stop-color="#ffe6ad" stop-opacity="0.85" />
        <stop offset="1" stop-color="#ffe6ad" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="moon-glow">
        <stop offset="0" stop-color="#dfe6ff" stop-opacity="0.45" />
        <stop offset="1" stop-color="#dfe6ff" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="horizon-glow">
        <stop offset="0" stop-color="#ffb489" stop-opacity="0.5" />
        <stop offset="0.45" stop-color="#ffb489" stop-opacity="0.18" />
        <stop offset="1" stop-color="#ffb489" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="horizon-fade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0" />
        <stop offset="0.12" stop-color="#fff" stop-opacity="1" />
        <stop offset="0.88" stop-color="#fff" stop-opacity="1" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <mask id="crescent"><rect x="-20" y="-20" width="40" height="40" fill="#fff" /><circle cx="5" cy="-4" r="9" fill="#000" /></mask>
    </defs>
    <ellipse class="horizon-glow ${m.mode}" cx="${glowX.toFixed(1)}" cy="${SKY.horizon}" rx="260" ry="95" fill="url(#horizon-glow)" />
    <rect class="horizon" x="0" y="${SKY.horizon - 0.5}" width="1000" height="1" fill="url(#horizon-fade)" />
    <text class="horizon-label" x="500" y="${SKY.horizon + 18}">Horizon</text>
    <path class="arc-track" d="${skyPath(m, m.start, m.end)}" />
    <path id="arc-done" class="arc-done" />
    ${markers}
    <g id="sun" class="indicator ${m.mode === "night" ? "is-moon" : "is-sun"}">
      ${m.mode === "night"
        ? `<circle class="moon-halo" r="30" fill="url(#moon-glow)" /><circle class="moon-core" r="9" mask="url(#crescent)" />`
        : `<circle class="sun-halo" r="30" fill="url(#sun-glow)" />
           <g class="sun-rays">${Array.from({ length: 8 }, (_, i) => `<line y1="-13" y2="-17.5" transform="rotate(${i * 45})" />`).join("")}</g>
           <circle class="sun-core" r="8" />`}
    </g>
    <g id="now-tag" class="now-tag"><rect x="-44" y="-13" width="88" height="26" rx="13" /><text y="0.5"></text></g>`;

  // Draw in: the travelled path and the sun/moon glide from the start to "now"
  skyIntro = reduceMotion ? null : { startedAt: performance.now() };
  cancelAnimationFrame(skyFrame);
  const animate = () => {
    updateSun();
    if (skyIntro) skyFrame = requestAnimationFrame(animate);
  };
  animate();
}

function updateSun() {
  if (!sky) return;
  const fresh = skyModel();
  if (fresh.mode !== sky.mode) return renderArc();
  sky.now = fresh.now;
  sky.period = fresh.period;
  const m = sky;

  let shown = Math.min(Math.max(m.now, m.start), m.end);
  if (skyIntro) {
    const p = Math.min(1, (performance.now() - skyIntro.startedAt) / 1600);
    const eased = 1 - Math.pow(1 - p, 3);
    shown = m.start + (shown - m.start) * eased;
    if (p >= 1) skyIntro = null;
  }

  const x = skyX(m, shown);
  const y = skyY(m, shown);
  $("arc-done").setAttribute("d", skyPath(m, m.start, shown));
  $("sun").setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  $("sun").classList.toggle("below", m.altitude(shown) < 0);

  // "Now" tag rides above the sun/moon, kept inside the card
  const tagX = Math.min(Math.max(x, 54), 946);
  $("now-tag").setAttribute("transform", `translate(${tagX.toFixed(1)} ${(y - 40).toFixed(1)})`);
  $("now-tag").querySelector("text").textContent = `Now ${fmt(m.now)}`;

  const [phase, detail] = skyStatus(m);
  $("sky-phase").textContent = phase;
  $("sky-detail").textContent = detail;
}

function startCountdown() {
  clearInterval(countdownTimer);
  let lastNext = null;
  const tick = () => {
    // A new day has started where this place is: load the new times.
    if (dateIn(state.place.timezone) !== state.dateKey) {
      clearInterval(countdownTimer);
      update(() => state.place);
      return;
    }
    checkAlerts();
    const next = nextPrayer();
    $("countdown").textContent = formatDuration(next.remaining);
    $("hero").dataset.period = currentPeriod();
    const key = `${next.name}-${next.tomorrow}`;
    if (key !== lastNext) {
      lastNext = key;
      $("next-name").textContent = next.name;
      replay($("next-name"), "flip-in");
      $("next-time").textContent = `at ${to12h(next.time).join(" ")}${next.tomorrow ? " tomorrow" : ""}`;
      renderTimes();
      renderTracker();
      renderArc();
      renderNotes();
    } else {
      updateSun();
      updateWindow();
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---------- Prayer alerts ----------

const alerts = { on: readStore("prayer-alerts", false) === true, fired: new Set(), ctx: null };

function renderAlertsButton() {
  $("alerts-btn").textContent = `Prayer alerts: ${alerts.on ? "On" : "Off"}`;
  $("alerts-btn").setAttribute("aria-pressed", String(alerts.on));
  $("alerts-test").hidden = !alerts.on;
}

function notificationsAllowed() {
  return "Notification" in window && Notification.permission === "granted";
}

// Audio needs a user gesture before it can play, so this is first called from a click.
function audioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  alerts.ctx ??= new Ctx();
  if (alerts.ctx.state === "suspended") alerts.ctx.resume();
  return alerts.ctx;
}

// A soft three-note bell, synthesised so no audio file is needed.
function playChime() {
  const ctx = audioContext();
  if (!ctx) return;
  [0, 0.9, 1.8].forEach((offset, i) => {
    const base = i === 2 ? 495 : 660;
    for (const [mult, peak] of [[1, 0.16], [1.5, 0.06], [2, 0.03]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + offset;
      osc.type = "sine";
      osc.frequency.value = base * mult;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 2.5);
    }
  });
}

function announcePrayer(name) {
  playChime();
  $("prayer-banner-text").textContent = `It's time for ${name} (${ARABIC[name]}) in ${state.place.label}.`;
  $("prayer-banner").hidden = false;
  if (notificationsAllowed()) {
    new Notification(`Time for ${name}`, {
      body: `${name} has begun in ${state.place.label}.`,
      tag: `prayer-${name}`,
    });
  }
}

// Fire once per prayer, within the first minute of its time.
function checkAlerts() {
  if (!alerts.on) return;
  const now = nowSeconds();
  for (const name of PRAYERS) {
    if (name === "Sunrise") continue;
    const t = toSeconds(state.today.timings[name]);
    const key = `${state.dateKey}-${name}`;
    if (now >= t && now - t < 60 && !alerts.fired.has(key)) {
      alerts.fired.add(key);
      announcePrayer(name);
    }
  }
}

async function toggleAlerts() {
  alerts.on = !alerts.on;
  writeStore("prayer-alerts", alerts.on);
  renderAlertsButton();
  if (!alerts.on) return toast("Prayer alerts turned off.");

  audioContext();
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  toast(
    notificationsAllowed()
      ? "You'll get a notification and a chime at each prayer time while this page is open."
      : "You'll hear a chime at each prayer time while this page is open. Allow notifications to get pop-ups too.",
    5000
  );
}

// ---------- Verse of the day ----------

let verse = null;
const verseAudio = new Audio();

// Same verse for everyone on a given day; stepping by a number coprime
// with 6236 visits every verse before repeating.
function verseOfTheDayNumber() {
  return ((localDayNumber() * 2621) % TOTAL_AYAHS) + 1;
}

function applyTranslationSetting(root) {
  const { translation } = quranSettings();
  root.classList.toggle("hide-en", translation === "ur" || translation === "none");
  root.classList.toggle("hide-ur", translation === "en" || translation === "none");
}

async function loadVerseOfTheDay() {
  const { reciter } = quranSettings();
  applyTranslationSetting($("verse"));
  try {
    const { data } = await getJSON(
      `${QURAN_API}/ayah/${verseOfTheDayNumber()}/editions/${textEditions().slice(0, 3)},${reciter}`
    );
    const [ar, en, ur, audio] = data;
    const surah = ar.surah;
    const ayah = ar.numberInSurah;
    verse = {
      surah: surah.number,
      ayah,
      name: surah.englishName,
      ar: splitBasmala(ar.text, surah.number, ayah).text,
      en: en.text,
      ur: ur.text,
      audio: audio.audio,
    };
    const link = `quran.html?surah=${verse.surah}#ayah-${ayah}`;
    $("verse-ref").textContent = `${surah.englishName} ${verse.surah}:${ayah}`;
    $("verse-ref").href = link;
    $("verse-link").href = link;
    $("verse-ar").textContent = verse.ar;
    $("verse-en").textContent = verse.en;
    $("verse-ur").textContent = verse.ur;
    verseAudio.src = verse.audio;
    $("verse-play").disabled = false;
    $("verse-copy").disabled = false;
    $("verse-share").disabled = false;
  } catch (err) {
    $("verse-ar").textContent = "";
    $("verse-en").textContent = `Couldn't load today's verse. ${err.message}`;
  }
}

function toggleVerseAudio() {
  if (verseAudio.paused) {
    verseAudio.play().catch(() => toast("Couldn't play the recitation."));
  } else {
    verseAudio.pause();
  }
}

verseAudio.addEventListener("play", () => ($("verse-play").textContent = "Pause recitation"));
verseAudio.addEventListener("pause", () => ($("verse-play").textContent = "Play recitation"));
verseAudio.addEventListener("ended", () => {
  verseAudio.currentTime = 0;
  $("verse-play").textContent = "Play recitation";
});

async function copyVerse() {
  const { translation } = quranSettings();
  const parts = [verse.ar];
  if (translation === "en" || translation === "both") parts.push(verse.en);
  if (translation === "ur" || translation === "both") parts.push(verse.ur);
  parts.push(`— Quran ${verse.surah}:${verse.ayah} (${verse.name})`);
  await copyText(parts.join("\n\n"));
  toast("Verse copied.");
}

// ---------- Hadith of the day ----------

const HADITH_COLLECTIONS = [
  { id: "bukhari", name: "Sahih al-Bukhari" },
  { id: "muslim", name: "Sahih Muslim" },
];
const HADITH_COUNT = 7563; // highest hadith number in both collections
let hadith = null;

const hadithText = async (lang, collection, n) => {
  const json = await getHadithJSON(`${lang}-${collection}/${n}`);
  return { text: json.hadiths?.[0]?.text?.trim() || "", hadith: json.hadiths?.[0], metadata: json.metadata };
};

// Alternates Bukhari and Muslim by day. Starting from the day's number, takes the
// first hadith that has Arabic, English and Urdu text and is short enough to read.
async function loadHadithOfTheDay() {
  applyTranslationSetting($("hadith"));
  const day = localDayNumber();
  const collection = HADITH_COLLECTIONS[day % 2];
  let n = ((day * 3571) % HADITH_COUNT) + 1;
  try {
    for (let tries = 0; tries < 20; tries++, n = (n % HADITH_COUNT) + 1) {
      const en = await hadithText("eng", collection.id, n).catch((err) => {
        if (err.status === 404) return null;
        throw err;
      });
      if (!en?.text || en.text.length > 700 || en.text.includes("??")) continue;
      const [ur, ar] = await Promise.all([hadithText("urd", collection.id, n), hadithText("ara", collection.id, n)]);
      if (!ur.text || !ar.text) continue;

      const { book, hadith: inBook } = en.hadith.reference;
      hadith = {
        ref: `${collection.name} · Book ${book}, Hadith ${inBook}`,
        section: Object.values(en.metadata.section || {})[0] || "",
        en: en.text,
        ur: ur.text,
        ar: ar.text,
      };
      $("hadith-ref").textContent = hadith.ref;
      $("hadith-book").textContent = hadith.section;
      const section = Object.keys(en.metadata.section || {})[0];
      if (section) $("hadith-link").href = `hadith.html?c=${collection.id}&b=${section}#h-${n}`;
      $("hadith-en").innerHTML = withHonorific(hadith.en);
      $("hadith-ur").textContent = hadith.ur;
      $("hadith-ar").textContent = hadith.ar;
      $("hadith-ar-wrap").hidden = false;
      $("hadith-ar-wrap").open = quranSettings().translation === "none";
      $("hadith-copy").disabled = false;
      $("hadith-share").disabled = false;
      return;
    }
    throw new Error("Please try again later.");
  } catch (err) {
    $("hadith-en").textContent = `Couldn't load today's hadith. ${err.message}`;
  }
}

async function copyHadith() {
  const { translation } = quranSettings();
  const parts = [];
  if (translation === "en" || translation === "both") parts.push(hadith.en);
  if (translation === "ur" || translation === "both") parts.push(hadith.ur);
  if (translation === "none") parts.push(hadith.ar);
  parts.push(`— ${hadith.ref}`);
  await copyText(parts.join("\n\n"));
  toast("Hadith copied.");
}

// ---------- Qibla ----------

// Great-circle initial bearing from (lat, lng) to the Kaaba, in degrees from North.
function qiblaDirection(lat, lng) {
  const rad = Math.PI / 180;
  const φ1 = lat * rad;
  const φ2 = KAABA.lat * rad;
  const Δλ = (KAABA.lng - lng) * rad;
  const y = Math.sin(Δλ);
  const x = Math.cos(φ1) * Math.tan(φ2) - Math.sin(φ1) * Math.cos(Δλ);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const CARDINALS = { 0: "N", 90: "E", 180: "S", 270: "W" };

// Compass graduations: a tick every 2°, longer every 10°, bold every 30°,
// with N/E/S/W and degree numbers in between.
function drawDial() {
  const parts = [];
  for (let deg = 0; deg < 360; deg += 2) {
    const cls = deg % 30 === 0 ? "major" : deg % 10 === 0 ? "mid" : "";
    const len = deg % 30 === 0 ? 12 : deg % 10 === 0 ? 8 : 4;
    parts.push(`<line class="tick ${cls}" y1="-104" y2="${-104 + len}" transform="rotate(${deg})" />`);
  }
  for (let deg = 0; deg < 360; deg += 30) {
    const a = (deg * Math.PI) / 180;
    const x = (80 * Math.sin(a)).toFixed(1);
    const y = (-80 * Math.cos(a)).toFixed(1);
    const cls = deg === 0 ? "cardinal north" : CARDINALS[deg] ? "cardinal" : "degree";
    parts.push(`<text class="${cls}" x="${x}" y="${y}">${CARDINALS[deg] ?? deg}</text>`);
  }
  $("ticks").innerHTML = parts.join("");
}

// Point the needle (and the arc from North) at an angle
function setNeedle(angle) {
  $("needle").setAttribute("transform", `rotate(${angle})`);
  // Keep the Kaaba upright relative to the dial.
  $("kaaba").setAttribute("transform", `translate(0 -57) rotate(${-angle})`);
  const a = (angle * Math.PI) / 180;
  const x = (68 * Math.sin(a)).toFixed(2);
  const y = (-68 * Math.cos(a)).toFixed(2);
  $("qibla-arc").setAttribute("d", angle < 0.5 ? "" : `M0 -68 A68 68 0 ${angle > 180 ? 1 : 0} 1 ${x} ${y}`);
}

// When the bearing changes, the needle swings to it like a real compass settling.
let needleAt = 0;
let needleFrame = 0;
function swingNeedle(to) {
  cancelAnimationFrame(needleFrame);
  if (reduceMotion) return setNeedle((needleAt = to));
  const from = needleAt;
  const start = performance.now();
  const duration = 1400;
  // Ease out with a small overshoot that settles
  const ease = (t) => 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 2.2) * (1 - t * 0.2);
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    setNeedle(from + (to - from) * ease(t));
    if (t < 1) needleFrame = requestAnimationFrame(step);
  };
  needleAt = to;
  needleFrame = requestAnimationFrame(step);
}

function renderQibla(heading = 0) {
  if (state.qibla == null) return;
  const q = state.qibla;
  $("qibla-deg").textContent = `${q.toFixed(1)}°`;
  // Rotate the dial opposite to the phone's heading so N stays pointing north.
  $("dial").setAttribute("transform", `rotate(${-heading})`);
  if (needleAt !== q) swingNeedle(q);
}

const compass = { on: false, event: null, gotReading: false, timer: null };

function handleOrientation(e) {
  let heading = null;
  if (typeof e.webkitCompassHeading === "number") {
    heading = e.webkitCompassHeading; // iOS
  } else if (e.absolute && e.alpha != null) {
    heading = 360 - e.alpha; // Android
  }
  if (heading == null || state.qibla == null) return;

  compass.gotReading = true;
  renderQibla(heading);
  // Signed difference in -180..180: positive means turn right.
  const diff = ((state.qibla - heading + 540) % 360) - 180;
  $("compass-note").textContent =
    Math.abs(diff) < 5
      ? "You are facing the Qibla."
      : `Turn ${diff > 0 ? "right" : "left"} ${Math.round(Math.abs(diff))}°.`;
}

function stopCompass(note) {
  if (compass.event) window.removeEventListener(compass.event, handleOrientation);
  clearTimeout(compass.timer);
  Object.assign(compass, { on: false, event: null, gotReading: false, timer: null });
  $("compass-btn").textContent = "Enable live compass";
  $("compass-note").textContent = note;
  renderQibla();
}

async function toggleCompass() {
  if (compass.on) {
    return stopCompass("Live compass off.");
  }
  if (!window.isSecureContext) {
    $("compass-note").textContent = "The compass needs a secure (https) connection.";
    return;
  }
  try {
    // iOS 13+ requires explicit permission
    if (typeof DeviceOrientationEvent?.requestPermission === "function") {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== "granted") throw new Error("Motion & orientation permission was denied.");
      compass.event = "deviceorientation";
    } else if ("ondeviceorientationabsolute" in window) {
      compass.event = "deviceorientationabsolute";
    } else if ("DeviceOrientationEvent" in window) {
      compass.event = "deviceorientation";
    } else {
      throw new Error("This browser doesn't support the compass.");
    }
  } catch (err) {
    $("compass-note").textContent = `${err.message} Use the bearing above.`;
    return;
  }

  window.addEventListener(compass.event, handleOrientation);
  compass.on = true;
  $("compass-btn").textContent = "Disable live compass";
  $("compass-note").textContent = "Waiting for the compass…";
  compass.timer = setTimeout(() => {
    if (!compass.gotReading) {
      stopCompass("No compass sensor found on this device. Use the bearing above, or open this page on your phone.");
    }
  }, 3000);
}

// ---------- Events ----------

$("city-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const city = $("city").value.trim();
  const country = $("country").value.trim();
  update(() => geocode(city, country));
});

$("gps-btn").addEventListener("click", () => update(locate));
$("compass-btn").addEventListener("click", toggleCompass);
$("alerts-btn").addEventListener("click", toggleAlerts);
$("alerts-test").addEventListener("click", () => {
  if (state.place) announcePrayer(nextPrayer().name);
});
$("prayer-banner-close").addEventListener("click", () => ($("prayer-banner").hidden = true));
$("verse-play").addEventListener("click", toggleVerseAudio);
$("verse-copy").addEventListener("click", copyVerse);
$("hadith-copy").addEventListener("click", copyHadith);
$("verse-share").addEventListener("click", () =>
  shareCard({ label: "Verse of the day", ar: verse.ar, ...cardTranslation(verse.en, verse.ur), ref: `${verse.name} ${verse.surah}:${verse.ayah}` })
    .catch((err) => toast(`Couldn't create the image. ${err.message}`)));
$("hadith-share").addEventListener("click", () =>
  shareCard({ label: "Hadith of the day", ar: hadith.ar, ...cardTranslation(hadith.en, hadith.ur), ref: hadith.ref.replace(" · ", ", ") })
    .catch((err) => toast(`Couldn't create the image. ${err.message}`)));
$("times").addEventListener("click", onPrayerToggle);
$("tracker").addEventListener("click", onPrayerToggle);

for (const id of ["method", "school"]) {
  $(id).addEventListener("change", () => {
    saveSettings({ [id]: $(id).value });
    if (state.place) update(() => state.place);
  });
}

// ---------- Start ----------

(function init() {
  drawDial();
  drawStars();
  renderAlertsButton();
  renderTracker();
  loadVerseOfTheDay();
  loadHadithOfTheDay();

  const saved = loadSettings();
  if (saved.method) $("method").value = saved.method;
  if (saved.school) $("school").value = saved.school;

  // A shared link (?city=Karachi&country=Pakistan) wins over the saved place.
  const params = new URLSearchParams(location.search);
  if (params.get("city")) {
    update(() => geocode(params.get("city"), params.get("country") || ""));
  } else if (saved.place?.timezone) {
    update(() => saved.place);
  } else {
    update(() => geocode(DEFAULT_CITY.city, DEFAULT_CITY.country));
  }
})();

renderNotes();
renderQada();
