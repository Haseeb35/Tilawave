// Shared by every page: storage, theme, navigation, network, places, time and Quran helpers.

const $ = (id) => document.getElementById(id);

const ALADHAN_API = "https://api.aladhan.com/v1";
const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";
const QURAN_API = "https://api.alquran.cloud/v1";

const SETTINGS_KEY = "prayer-times-settings";
const QURAN_SETTINGS_KEY = "quran-settings";
const DEFAULT_CITY = { city: "Lahore", country: "Pakistan" };

const METHOD_NAMES = {
  1: "Karachi",
  2: "ISNA",
  3: "Muslim World League",
  4: "Umm Al-Qura",
  5: "Egyptian",
  8: "Gulf Region",
  16: "Dubai",
};

// ---------- Storage ----------

function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be blocked (private mode); the app still works for this visit.
  }
}

function loadSettings() {
  return readStore(SETTINGS_KEY, {}) || {};
}

function saveSettings(update) {
  writeStore(SETTINGS_KEY, { ...loadSettings(), ...update });
}

// ---------- Small utilities ----------

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function toast(message, ms = 2800) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), ms);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that block the async clipboard (e.g. plain http)
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
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
  if (!res.ok || !json) {
    const err = new Error(json?.data || `Service returned ${res.status}. Please try again.`);
    err.status = res.status;
    throw err;
  }
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

// The place chosen on the Prayer times page, or the default city
async function savedOrDefaultPlace() {
  const { place } = loadSettings();
  if (place?.timezone) return place;
  return geocode(DEFAULT_CITY.city, DEFAULT_CITY.country);
}

// ---------- Time ----------

function partsIn(timeZone, options, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).formatToParts(date);
  return (type) => Number(parts.find((p) => p.type === type).value);
}

// Date in the given timezone as "DD-MM-YYYY", optionally shifted by whole days
function dateIn(timeZone, addDays = 0) {
  const get = partsIn(timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + addDays));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

// The device's local date as "YYYY-MM-DD" (for trackers and streaks)
function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Whole days since 1970 for the device's local date; drives the "of the day" picks
function localDayNumber() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
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

// ---------- Quran ----------

const TEXT_EDITIONS = "quran-uthmani,en.sahih,ur.jalandhry";
const RECITERS = {
  "ar.alafasy": "Mishary Alafasy",
  "ar.abdulsamad": "Abdul Basit Abdus Samad",
  "ar.abdurrahmaansudais": "Abdur-Rahman As-Sudais",
  "ar.husary": "Mahmoud Khalil Al-Husary",
  "ar.mahermuaiqly": "Maher Al-Muaiqly",
};

function quranSettings() {
  return { translation: "both", reciter: "ar.alafasy", fontScale: 1, ...readStore(QURAN_SETTINGS_KEY, {}) };
}

function saveQuranSettings(update) {
  writeStore(QURAN_SETTINGS_KEY, { ...quranSettings(), ...update });
}

// "Bismillah ir-Rahman ir-Raheem" without diacritics, used to recognise it.
const BASMALA_PLAIN = "بسم ٱلله ٱلرحمن ٱلرحيم";
const stripMarks = (s) => s.replace(/[ً-ٰٟۖ-ۭ﻿]/g, "");

// The Uthmani text joins the Bismillah onto verse 1 of every surah except
// Al-Fatiha (where it *is* verse 1) and At-Tawbah (which has none).
// Split it off so it can be shown as a heading, as printed mushafs do.
function splitBasmala(text, surah, ayah) {
  const clean = text.replace(/﻿/g, "");
  if (ayah !== 1 || surah === 1 || surah === 9) return { basmala: null, text: clean };
  const words = clean.split(" ");
  if (stripMarks(words.slice(0, 4).join(" ")) !== BASMALA_PLAIN) return { basmala: null, text: clean };
  return { basmala: words.slice(0, 4).join(" "), text: words.slice(4).join(" ").trim() };
}

function arabicNumber(n) {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
}

// ---------- Theme ----------

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

// The user's choice if they made one, otherwise the system setting
function currentTheme() {
  return document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");
}

function renderThemeButton() {
  const dark = currentTheme() === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  $("theme-btn").classList.toggle("is-dark", dark);
  $("theme-btn").setAttribute("aria-label", label);
  $("theme-btn").title = label;
}

function toggleTheme() {
  const theme = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Storage may be blocked; the theme still applies for this visit.
  }
  renderThemeButton();
}

$("theme-btn").addEventListener("click", toggleTheme);
darkQuery.addEventListener("change", renderThemeButton);
renderThemeButton();

// Mark the current page in the navigation
for (const link of document.querySelectorAll(".nav a")) {
  if (link.dataset.page === document.body.dataset.page) link.setAttribute("aria-current", "page");
}

// ---------- Installable app & offline ----------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {
    // Not fatal: the site still works, just without offline support.
  });
}

const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installPrompt = null;

// Chrome, Edge and Android offer a real install prompt; iOS needs Share → Add to Home Screen.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install-btn").hidden = false;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("install-btn").hidden = true;
  toast("Salah is installed. Open it from your home screen or app list.");
});

if (isIOS && !isStandalone) $("install-btn").hidden = false;

$("install-btn").addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") $("install-btn").hidden = true;
    installPrompt = null;
  } else if (isIOS) {
    toast("To install: tap the Share button, then “Add to Home Screen”.", 6000);
  }
});

window.addEventListener("offline", () => toast("You're offline. Saved pages and data still work.", 4000));
window.addEventListener("online", () => toast("Back online.", 2000));
