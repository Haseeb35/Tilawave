const API = "https://api.aladhan.com/v1";
const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";
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
const STORAGE_KEY = "prayer-times-settings";
const DEFAULT_CITY = { city: "Lahore", country: "Pakistan" };

const $ = (id) => document.getElementById(id);

let state = {
  place: null,     // { lat, lng, label, city, country, timezone }
  today: null,     // Aladhan timings for today
  tomorrow: null,  // Aladhan timings for tomorrow (for Fajr after Isha)
  dateKey: null,   // "DD-MM-YYYY" in the place's timezone
  qibla: null,     // degrees from North
};
let requestId = 0;
let countdownTimer = null;

// ---------- Settings (saved in the browser) ----------

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings(update) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSettings(), ...update }));
  } catch {
    // Storage may be blocked (private mode); the app still works.
  }
}

// ---------- Network ----------

async function getJSON(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Network error. Check your internet connection and try again.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.data || `Service returned ${res.status}. Please try again.`);
  return json;
}

// City name -> coordinates and timezone (Aladhan's city endpoint returns
// placeholder coordinates, and we need real ones for the Qibla).
async function geocode(city, country) {
  const { results } = await getJSON(`${GEOCODE_API}?name=${encodeURIComponent(city)}&count=10&language=en`);
  if (!results?.length) throw new Error(`Couldn't find "${city}". Check the spelling and try again.`);
  const wanted = country.toLowerCase();
  const match =
    results.find((r) => r.country?.toLowerCase() === wanted || r.country_code?.toLowerCase() === wanted) ||
    results[0];
  return {
    lat: match.latitude,
    lng: match.longitude,
    city: match.name,
    country: match.country,
    label: `${match.name}, ${match.country}`,
    timezone: match.timezone,
  };
}

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

async function fetchDay(place, date) {
  const params = new URLSearchParams({
    latitude: place.lat,
    longitude: place.lng,
    method: $("method").value,
    school: $("school").value,
    timezonestring: place.timezone,
  });
  const json = await getJSON(`${API}/timings/${date}?${params}`);
  if (json.code !== 200) throw new Error(json.data || "Could not load prayer times.");
  return json.data;
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
    renderQibla();
    startCountdown();
  } catch (err) {
    if (id === requestId) showError(err.message);
  } finally {
    if (id === requestId) setBusy(false);
  }
}

// ---------- Time helpers ----------

function partsIn(timeZone, options) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).formatToParts(new Date());
  return (type) => Number(parts.find((p) => p.type === type).value);
}

// Date in the given timezone as "DD-MM-YYYY", optionally shifted by whole days
function dateIn(timeZone, addDays = 0) {
  const get = partsIn(timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + addDays));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

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

// "05:12" or "05:12 (PKT)" -> seconds since midnight
function toSeconds(time) {
  const [h, m] = time.split(" ")[0].split(":").map(Number);
  return h * 3600 + m * 60;
}

// "15:41" -> ["3:41", "PM"]
function to12h(time) {
  const [h, m] = time.split(" ")[0].split(":").map(Number);
  return [`${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`, h >= 12 ? "PM" : "AM"];
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

function renderHeader() {
  const { date } = state.today;
  $("location").textContent = state.place.label;
  $("dates").innerHTML =
    `${date.gregorian.weekday.en}, ${date.readable}` +
    `<span class="hijri">${date.hijri.day} ${date.hijri.month.en} ${date.hijri.year} AH</span>`;
}

function renderTimes() {
  const now = nowSeconds();
  const next = nextPrayer();
  $("times").innerHTML = PRAYERS.map((name) => {
    const time = state.today.timings[name];
    const [clock, suffix] = to12h(time);
    const isNext = !next.tomorrow && name === next.name;
    const classes = [
      name === "Sunrise" && "sunrise",
      isNext ? "next" : toSeconds(time) <= now && "passed",
    ].filter(Boolean).join(" ");
    return `<li class="${classes}">
      <div><span class="name">${name}</span><span class="arabic" lang="ar">${ARABIC[name]}</span></div>
      <span class="time">${clock}<small>${suffix}</small></span>
    </li>`;
  }).join("");
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

// ---------- Sun path (Fajr → Isha arc) ----------

const ARC = { x0: 40, x1: 960, base: 170, height: 140 };

function arcPoint(t) {
  return [ARC.x0 + (ARC.x1 - ARC.x0) * t, ARC.base - ARC.height * Math.sin(Math.PI * t)];
}

function arcPath(t0, t1) {
  const steps = Math.max(2, Math.ceil((t1 - t0) * 80));
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const [x, y] = arcPoint(t0 + ((t1 - t0) * i) / steps);
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

// Position of a time of day along the arc, 0 (Fajr) to 1 (Isha)
function arcT(seconds) {
  const start = toSeconds(state.today.timings.Fajr);
  const end = toSeconds(state.today.timings.Isha);
  return Math.min(1, Math.max(0, (seconds - start) / (end - start)));
}

function renderArc() {
  const now = nowSeconds();
  const next = nextPrayer();
  const markers = PRAYERS.map((name) => {
    const s = toSeconds(state.today.timings[name]);
    const [x, y] = arcPoint(arcT(s));
    const cls = !next.tomorrow && name === next.name ? "next" : s <= now ? "passed" : "";
    return `<g class="marker ${cls}">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" />
      <text x="${x.toFixed(1)}" y="${ARC.base + 30}">${name}</text>
    </g>`;
  }).join("");
  $("arc").innerHTML = `
    <defs>
      <radialGradient id="sun-glow">
        <stop offset="0" stop-color="#ffe6ad" stop-opacity="0.9" />
        <stop offset="1" stop-color="#ffe6ad" stop-opacity="0" />
      </radialGradient>
    </defs>
    <line class="horizon" x1="0" x2="1000" y1="${ARC.base}" y2="${ARC.base}" />
    <path class="arc-track" d="${arcPath(0, 1)}" />
    <path id="arc-done" class="arc-done" />
    ${markers}
    <g id="sun"><circle r="28" fill="url(#sun-glow)" /><circle class="sun-core" r="8" /></g>`;
  updateSun();
}

function updateSun() {
  const now = nowSeconds();
  const t = arcT(now);
  const [x, y] = arcPoint(t);
  $("arc-done").setAttribute("d", t > 0 ? arcPath(0, t) : "");
  $("sun").setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  $("sun").classList.toggle("resting", currentPeriod() === "night");
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
    const next = nextPrayer();
    $("countdown").textContent = formatDuration(next.remaining);
    $("hero").dataset.period = currentPeriod();
    const key = `${next.name}-${next.tomorrow}`;
    if (key !== lastNext) {
      lastNext = key;
      $("next-name").textContent = next.name;
      $("next-time").textContent = `at ${to12h(next.time).join(" ")}${next.tomorrow ? " tomorrow" : ""}`;
      renderTimes();
      renderArc();
    } else {
      updateSun();
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
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

function drawTicks() {
  const ticks = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const major = deg % 30 === 0;
    const inner = major ? 84 : 89;
    ticks.push(
      `<line class="tick${major ? " major" : ""}" y1="-${inner}" y2="-94" transform="rotate(${deg})" />`
    );
  }
  $("ticks").innerHTML = ticks.join("");
}

function renderQibla(heading = 0) {
  if (state.qibla == null) return;
  $("qibla-deg").textContent = `${state.qibla.toFixed(1)}°`;
  // Rotate the dial opposite to the phone's heading so N stays pointing north.
  $("dial").setAttribute("transform", `rotate(${-heading})`);
  $("needle").setAttribute("transform", `rotate(${state.qibla})`);
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

for (const id of ["method", "school"]) {
  $(id).addEventListener("change", () => {
    saveSettings({ [id]: $(id).value });
    if (state.place) update(() => state.place);
  });
}

// ---------- Start ----------

(function init() {
  drawTicks();

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
