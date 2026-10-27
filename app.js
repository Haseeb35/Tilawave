const API = "https://api.aladhan.com/v1";
const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";
const PRAYERS = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
const KAABA = { lat: 21.4225, lng: 39.8262 };
const STORAGE_KEY = "prayer-times-settings";

const $ = (id) => document.getElementById(id);

let state = {
  timings: null,   // { Fajr: "05:12", ... }
  timezone: null,  // e.g. "Asia/Karachi"
  qibla: null,     // degrees from North
};
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

// ---------- Fetching prayer times ----------

// City name -> real coordinates (Aladhan's city endpoint doesn't return them,
// and we need them for an accurate Qibla direction).
async function geocode(city, country) {
  const res = await fetch(`${GEOCODE_API}?name=${encodeURIComponent(city)}&count=10&language=en`);
  const { results } = await res.json();
  if (!results?.length) throw new Error(`"${city}" not found`);
  const wanted = country.toLowerCase();
  const match =
    results.find((r) => r.country?.toLowerCase() === wanted || r.country_code?.toLowerCase() === wanted) ||
    results[0];
  return { lat: match.latitude, lng: match.longitude, label: `${match.name}, ${match.country}` };
}

async function fetchTimings(query) {
  const method = $("method").value;
  const school = $("school").value;

  showError("");
  $("location").textContent = "Loading…";

  try {
    const place = "lat" in query ? query : await geocode(query.city, query.country);
    const res = await fetch(
      `${API}/timings?latitude=${place.lat}&longitude=${place.lng}&method=${method}&school=${school}`
    );
    const json = await res.json();
    if (json.code !== 200) throw new Error(json.data || "Location not found");

    const { timings, date, meta } = json.data;
    state.timings = timings;
    state.timezone = meta.timezone;
    state.qibla = qiblaDirection(place.lat, place.lng);

    $("location").textContent =
      `📍 ${place.label || `${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}`}`;
    $("dates").textContent =
      `${date.readable} · ${date.hijri.day} ${date.hijri.month.en} ${date.hijri.year} AH`;

    renderTimes();
    renderQibla();
    startCountdown();
  } catch (err) {
    $("location").textContent = "";
    showError(`Could not load prayer times: ${err.message}`);
  }
}

function showError(msg) {
  $("error").textContent = msg;
  $("error").hidden = !msg;
}

// ---------- Time helpers ----------

// "05:12" or "05:12 (PKT)" -> seconds since midnight
function toSeconds(time) {
  const [h, m] = time.split(" ")[0].split(":").map(Number);
  return h * 3600 + m * 60;
}

// Current time of day (in seconds) in the location's timezone
function nowSeconds() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: state.timezone || undefined,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

function to12h(time) {
  const [h, m] = time.split(" ")[0].split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
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
  for (const name of PRAYERS) {
    if (name === "Sunrise") continue;
    const t = toSeconds(state.timings[name]);
    if (t > now) return { name, remaining: t - now };
  }
  return { name: "Fajr", remaining: 86400 - now + toSeconds(state.timings.Fajr) };
}

// ---------- Rendering ----------

function renderTimes() {
  const now = nowSeconds();
  const next = nextPrayer().name;
  $("times").innerHTML = PRAYERS.map((name) => {
    const time = state.timings[name];
    const cls = name === next ? "next" : toSeconds(time) <= now ? "passed" : "";
    return `<li class="${cls}"><span>${name}</span><span class="time">${to12h(time)}</span></li>`;
  }).join("");
}

function startCountdown() {
  clearInterval(countdownTimer);
  let lastNext = null;
  const tick = () => {
    const { name, remaining } = nextPrayer();
    $("next-name").textContent = name;
    $("countdown").textContent = formatDuration(remaining);
    if (name !== lastNext) {
      lastNext = name;
      renderTimes();
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

function renderQibla(heading = 0) {
  if (state.qibla == null) return;
  $("qibla-deg").textContent = `${state.qibla.toFixed(1)}°`;
  // Rotate the dial opposite to the phone's heading so "N" stays pointing north.
  document.querySelector(".compass").style.transform = `rotate(${-heading}deg)`;
  $("needle").style.transform = `rotate(${state.qibla}deg)`;
}

function handleOrientation(e) {
  let heading = null;
  if (typeof e.webkitCompassHeading === "number") {
    heading = e.webkitCompassHeading; // iOS
  } else if (e.absolute && e.alpha != null) {
    heading = 360 - e.alpha; // Android
  }
  if (heading != null) renderQibla(heading);
}

async function enableCompass() {
  try {
    // iOS 13+ requires explicit permission
    if (typeof DeviceOrientationEvent?.requestPermission === "function") {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== "granted") throw new Error("permission denied");
      window.addEventListener("deviceorientation", handleOrientation);
    } else if ("ondeviceorientationabsolute" in window) {
      window.addEventListener("deviceorientationabsolute", handleOrientation);
    } else if ("DeviceOrientationEvent" in window) {
      window.addEventListener("deviceorientation", handleOrientation);
    } else {
      throw new Error("not supported");
    }
    $("compass-note").textContent = "Live compass on. Turn until the 🕋 points straight up.";
  } catch (err) {
    $("compass-note").textContent = `Compass unavailable (${err.message}). Use the degrees shown above.`;
  }
}

// ---------- Events ----------

function useGps() {
  if (!navigator.geolocation) return showError("Geolocation is not supported by this browser.");
  $("location").textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const query = { lat: coords.latitude, lng: coords.longitude };
      saveSettings({ query });
      fetchTimings(query);
    },
    (err) => {
      $("location").textContent = "";
      showError(`Location error: ${err.message}. Try searching by city instead.`);
    }
  );
}

$("city-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const query = { city: $("city").value.trim(), country: $("country").value.trim() };
  saveSettings({ query });
  fetchTimings(query);
});

$("gps-btn").addEventListener("click", useGps);
$("compass-btn").addEventListener("click", enableCompass);

for (const id of ["method", "school"]) {
  $(id).addEventListener("change", () => {
    saveSettings({ [id]: $(id).value });
    const { query } = loadSettings();
    if (query) fetchTimings(query);
  });
}

// ---------- Start ----------

(function init() {
  const saved = loadSettings();
  if (saved.method) $("method").value = saved.method;
  if (saved.school) $("school").value = saved.school;

  const query = saved.query || { city: "Lahore", country: "Pakistan" };
  if (query.city) {
    $("city").value = query.city;
    $("country").value = query.country;
  }
  fetchTimings(query);
})();
