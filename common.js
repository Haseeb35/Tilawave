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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJSON(url, attempt = 0) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    // Busy APIs answer bursts with a rate-limit reply the browser reports as a
    // network failure, so try again after a short pause while online.
    if (navigator.onLine && attempt < 3) {
      await wait(700 * 2 ** attempt);
      return getJSON(url, attempt + 1);
    }
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

// ---------- Prayer time and Hijri adjustments (set on the Settings page) ----------

const TUNED = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

// Minutes added to each prayer, as Aladhan's "tune" parameter
// (order: Imsak, Fajr, Sunrise, Dhuhr, Asr, Maghrib, Sunset, Isha, Midnight)
function tuneParam() {
  const tune = loadSettings().tune || {};
  if (!TUNED.some((p) => tune[p])) return null;
  const m = (p) => Number(tune[p]) || 0;
  return [0, m("Fajr"), 0, m("Dhuhr"), m("Asr"), m("Maghrib"), 0, m("Isha"), 0].join(",");
}

const HIJRI_MONTH_NAMES = [
  "Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani", "Jumada al-Ula", "Jumada al-Thaniyah",
  "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhul Qa'dah", "Dhul Hijjah",
];
const umalqura = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
  day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC",
});

// Local moon sighting can differ from the Umm al-Qura calendar by a day or two
const hijriAdjustment = () => Math.max(-2, Math.min(2, Number(loadSettings().hijriAdjust) || 0));

// Hijri date of a Gregorian calendar day, with the user's adjustment applied
function hijriFor(year, month, day) {
  const parts = umalqura.formatToParts(new Date(Date.UTC(year, month - 1, day + hijriAdjustment(), 12)));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { day: get("day"), month: get("month"), year: get("year") };
}

const hijriLabel = (h) => `${h.day} ${HIJRI_MONTH_NAMES[h.month - 1]} ${h.year} AH`;

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

const QURAN_COM_API = "https://api.quran.com/api/v4";
const TRANSLITERATION = "en.transliteration";

const EN_TRANSLATIONS = {
  "en.sahih": "Saheeh International",
  "en.asad": "Muhammad Asad",
  "en.pickthall": "Marmaduke Pickthall",
  "en.yusufali": "Abdullah Yusuf Ali",
  "en.hilali": "Hilali & Muhsin Khan",
  "en.maududi": "Abul Ala Maududi",
  "en.itani": "Talal Itani (Clear Quran)",
  "en.wahiduddin": "Wahiduddin Khan",
  "en.arberry": "A. J. Arberry",
};
const UR_TRANSLATIONS = {
  "ur.jalandhry": "Fateh Muhammad Jalandhry",
  "ur.maududi": "Abul Ala Maududi",
  "ur.kanzuliman": "Ahmed Raza Khan (Kanz-ul-Iman)",
  "ur.junagarhi": "Muhammad Junagarhi",
  "ur.ahmedali": "Ahmed Ali",
  "ur.qadri": "Tahir ul Qadri",
};

// quran.com tafsir resource ids
const TAFSIRS = {
  169: { name: "Ibn Kathir (abridged)", lang: "en" },
  168: { name: "Ma'ariful Quran", lang: "en" },
  160: { name: "Tafsir Ibn Kathir", lang: "ur" },
};

const RECITERS = {
  "ar.alafasy": "Mishary Alafasy",
  "ar.abdulsamad": "Abdul Basit Abdus Samad",
  "ar.abdurrahmaansudais": "Abdur-Rahman As-Sudais",
  "ar.husary": "Mahmoud Khalil Al-Husary",
  "ar.mahermuaiqly": "Maher Al-Muaiqly",
};

function quranSettings() {
  const s = {
    translation: "both",
    enEdition: "en.sahih",
    urEdition: "ur.jalandhry",
    transliteration: false,
    tafsir: 169,
    reciter: "ar.alafasy",
    fontScale: 1,
    ...readStore(QURAN_SETTINGS_KEY, {}),
  };
  if (!EN_TRANSLATIONS[s.enEdition]) s.enEdition = "en.sahih";
  if (!UR_TRANSLATIONS[s.urEdition]) s.urEdition = "ur.jalandhry";
  if (!TAFSIRS[s.tafsir]) s.tafsir = 169;
  return s;
}

function saveQuranSettings(update) {
  writeStore(QURAN_SETTINGS_KEY, { ...quranSettings(), ...update });
}

// Arabic, the chosen English and Urdu translations, and transliteration, in that order
function textEditions() {
  const s = quranSettings();
  return ["quran-uthmani", s.enEdition, s.urEdition, TRANSLITERATION];
}

// Commentary and surah introductions arrive as HTML. Keep only plain text
// formatting, drop every attribute, and mark Arabic-script paragraphs.
const SAFE_TAGS = new Set(["P", "H2", "H3", "H4", "STRONG", "B", "EM", "I", "BR", "UL", "OL", "LI", "BLOCKQUOTE", "SUP", "SUB", "SPAN", "DIV"]);
const DROP_TAGS = new Set(["script", "style", "iframe", "object", "embed", "img", "svg", "math", "video", "audio", "form", "input", "button", "select", "textarea", "link", "meta", "template"]);
const ARABIC_SCRIPT = /[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]/g;

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) child.remove();
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (!SAFE_TAGS.has(child.tagName)) {
        if (DROP_TAGS.has(child.tagName.toLowerCase())) child.remove();
        else child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
      clean(child);
      const text = child.textContent.replace(/\s/g, "");
      if (text && (text.match(ARABIC_SCRIPT) || []).length > text.length * 0.6 && child.tagName !== "SPAN") {
        child.setAttribute("dir", "rtl");
      }
    }
  };
  // Unwrapping can expose new children, so run until nothing changes.
  let before;
  do {
    before = doc.body.innerHTML;
    clean(doc.body);
  } while (doc.body.innerHTML !== before);
  return doc.body.firstChild.innerHTML;
}

// ---------- Hadith ----------

// The CDN occasionally refuses files it hasn't cached yet; the same files are
// also served unminified and straight from GitHub.
const HADITH_SOURCES = [
  "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions",
  "https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions",
];

async function getHadithJSON(path) {
  const urls = [
    `${HADITH_SOURCES[0]}/${path}.min.json`,
    `${HADITH_SOURCES[0]}/${path}.json`,
    `${HADITH_SOURCES[1]}/${path}.min.json`,
  ];
  let lastError;
  for (const url of urls) {
    try {
      return await getJSON(url);
    } catch (err) {
      if (err.status === 404) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

// The ﷺ ligature is very tall in most fonts; give it its own size.
const withHonorific = (text) => escapeHtml(text).replace(/ﷺ/g, '<span class="honorific" lang="ar">ﷺ</span>');

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

// ---------- Share as image ----------

const SHARE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>`;

// Break text into lines that fit maxWidth with the context's current font
function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Fit a block of text: shrink the font until it fits the height, then cut with an ellipsis
function fitText(ctx, text, { font, size, min, lineHeight, width, height }) {
  for (let px = size; ; px -= 2) {
    ctx.font = font(px);
    const lines = wrapLines(ctx, text, width);
    const fits = lines.length * px * lineHeight <= height;
    if (fits || px <= min) {
      const max = Math.max(1, Math.floor(height / (px * lineHeight)));
      if (lines.length > max) lines.splice(max - 1, lines.length, `${lines[max - 1]} …`);
      return { lines, px };
    }
  }
}

// A 1080×1350 card (Instagram portrait) with Arabic, a translation and the reference.
// card: { ar, arFont, text, textRtl, ref, label }
async function shareCard(card) {
  const W = 1080, H = 1350, PAD = 96;
  const arFont = card.arFont || "Amiri Quran";
  await Promise.all([`60px "${arFont}"`, '60px "Amiri Quran"', '40px "Instrument Serif"', '30px "Geist"', '34px "Noto Nastaliq Urdu"']
    .map((f) => document.fonts.load(f).catch(() => null)));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0b0e1a";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(216, 180, 110, 0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  ctx.fillStyle = "#d8b46e";
  ctx.font = '500 26px "Geist", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText((card.label || "").toUpperCase(), PAD, PAD + 30);

  // Lay out first, then centre the block between the label and the footer
  const top = PAD + 90;
  const bottom = H - PAD - 90;
  const blocks = [];
  if (card.ar && card.ar.length < 700) {
    ctx.direction = "rtl";
    const fit = fitText(ctx, card.ar, {
      font: (n) => `${n}px "${arFont}", "Amiri Quran", serif`, size: 64, min: 34, lineHeight: 1.9,
      width: W - PAD * 2, height: card.text ? (bottom - top) * 0.48 : bottom - top,
    });
    blocks.push({ ...fit, rtl: true, lineHeight: 1.9, color: "#f2eee3", font: (n) => `${n}px "${arFont}", "Amiri Quran", serif`, gapAfter: 40 });
  }
  if (card.text) {
    const rtl = card.textRtl;
    ctx.direction = rtl ? "rtl" : "ltr";
    const used = blocks.reduce((sum, b) => sum + b.lines.length * b.px * b.lineHeight + b.gapAfter, 0);
    // "Amiri Quran" second, so the ﷺ ligature falls back to its compact form
    const font = (n) => (rtl ? `${n}px "Noto Nastaliq Urdu", serif` : `${n}px "Instrument Serif", "Amiri Quran", Georgia, serif`);
    const lineHeight = rtl ? 2.1 : 1.35;
    const fit = fitText(ctx, card.text, { font, size: rtl ? 36 : 46, min: 24, lineHeight, width: W - PAD * 2, height: bottom - top - used });
    blocks.push({ ...fit, rtl, lineHeight, color: "#d4d0c6", font, gapAfter: 0 });
  }
  const total = blocks.reduce((sum, b) => sum + b.lines.length * b.px * b.lineHeight + b.gapAfter, 0);
  let y = top + Math.max(0, (bottom - top - total) / 2);
  for (const b of blocks) {
    ctx.direction = b.rtl ? "rtl" : "ltr";
    ctx.textAlign = b.rtl ? "right" : "left";
    ctx.font = b.font(b.px);
    ctx.fillStyle = b.color;
    for (const line of b.lines) {
      y += b.px * b.lineHeight;
      ctx.fillText(line, b.rtl ? W - PAD : PAD, y - b.px * (b.lineHeight - 1) * 0.5);
    }
    y += b.gapAfter;
  }

  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.fillStyle = "#d8b46e";
  ctx.font = '500 30px "Geist", sans-serif';
  ctx.fillText(card.ref, PAD, H - PAD - 10);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9ea2b4";
  ctx.font = '40px "Instrument Serif", serif';
  ctx.fillText("Tilawave", W - PAD, H - PAD - 8);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], `tilawave-${card.ref.replace(/[^\w]+/g, "-").toLowerCase()}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: card.ref });
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
  toast("Image saved to your downloads.");
}

// Translation to put on a shared card, following the reader's language choice
function cardTranslation(en, ur) {
  const { translation } = quranSettings();
  if (translation === "ur") return { text: ur, textRtl: true };
  if (translation === "none") return { text: "" };
  return { text: en };
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

// ---------- Header: quick search and settings ----------

$("theme-btn").insertAdjacentHTML("beforebegin", `
  <button id="search-btn" class="icon-btn" type="button" aria-label="Quick search" title="Quick search (Ctrl K)">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
  </button>
  <a id="settings-link" class="icon-btn" href="settings.html" aria-label="Settings" title="Settings">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  </a>`);
if (document.body.dataset.page === "settings") $("settings-link").setAttribute("aria-current", "page");

// Everything quick search can jump to. Surahs come from the list the Quran page saves.
const SEARCH_PAGES = [
  ["Prayer times", "./", "Today's times, countdown and sky"],
  ["Qibla", "./#qibla", "Direction of the Kaaba and live compass"],
  ["Prayer tracker", "./#tracker", "Mark prayers and see your streak"],
  ["Qada", "./#qada", "Prayers to make up"],
  ["Nearby mosques", "./#mosques", "Closest mosques with directions"],
  ["Quran", "quran.html", "Surahs, paras, search and khatam"],
  ["Bookmarks", "quran.html#bookmarks", "Verses you saved"],
  ["Hifz", "quran.html#hifz", "Surahs you've memorised"],
  ["Hadith library", "hadith.html", "Bukhari, Muslim, the Sunan and more"],
  ["Quranic duas", "duas.html", "Supplications from the Quran"],
  ["99 Names of Allah", "duas.html#names", "Names, meanings and practice"],
  ["Tasbih", "tasbih.html", "Dhikr counter"],
  ["Islamic calendar", "calendar.html", "Ramadan countdown and Islamic dates"],
  ["Monthly timetable", "calendar.html#timetable", "Printable prayer timetable"],
  ["Zakat calculator", "zakat.html", "Zakat on gold, silver and savings"],
  ["Settings", "settings.html", "Adjustments, Hijri date, backup"],
];
const SEARCH_HADITH = [
  ["bukhari", "Sahih al-Bukhari"], ["muslim", "Sahih Muslim"], ["abudawud", "Sunan Abu Dawud"],
  ["tirmidhi", "Jami' at-Tirmidhi"], ["nasai", "Sunan an-Nasa'i"], ["ibnmajah", "Sunan Ibn Majah"],
  ["malik", "Muwatta Malik"], ["nawawi", "Forty Hadith of an-Nawawi"], ["qudsi", "Forty Hadith Qudsi"],
];

// Lowercase letters and digits with doubled letters collapsed ("Rahmaan" -> "rahman")
const searchKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(.)\1+/g, "$1");
// The same, with each word's final "h" dropped, so "fatihah" matches "Faatiha"
const looseKey = (s) => searchKey(s.toLowerCase().replace(/h\b/g, ""));

function quickResults(query) {
  const q = query.trim();
  if (!q) return SEARCH_PAGES.slice(0, 8).map(([title, href, hint]) => ({ title, href, hint }));
  const surahs = readStore("quran-surahs", []) || [];
  const out = [];

  // "2:255", "2 255" or "2.255" -> a verse
  const verse = q.match(/^(\d{1,3})\s*[:.\s]\s*(\d{1,3})$/);
  if (verse) {
    const [s, a] = [Number(verse[1]), Number(verse[2])];
    const surah = surahs[s - 1];
    if (s >= 1 && s <= 114 && (!surah || a <= surah.numberOfAyahs)) {
      out.push({ title: `Verse ${s}:${a}`, hint: surah ? surah.englishName : "Quran", href: `quran.html?surah=${s}#ayah-${a}` });
    }
  }
  // "para 30" or "juz 30"
  const para = q.match(/^(?:para|juz|parah|sipara)\s*(\d{1,2})$/i);
  if (para && Number(para[1]) >= 1 && Number(para[1]) <= 30) {
    out.push({ title: `Para ${para[1]}`, hint: "Read the whole para", href: `quran.html?juz=${para[1]}` });
  }
  // "bukhari 1" -> a hadith by number
  const hadith = q.match(/^([a-z' -]+?)\s+(\d{1,5})$/i);
  if (hadith) {
    const c = SEARCH_HADITH.find(([id, name]) => searchKey(name).includes(searchKey(hadith[1])) || id.startsWith(searchKey(hadith[1])));
    if (c) out.push({ title: `${c[1]} ${hadith[2]}`, hint: "Open this hadith", href: `hadith.html?c=${c[0]}&n=${hadith[2]}` });
  }

  const key = searchKey(q);
  const loose = q.length >= 4 ? looseKey(q) : key;
  // Whole text starts with it > a word starts with it > it appears inside (3+ letters)
  const score = (text) => {
    let best = 0;
    for (const [k, words] of [[key, text.split(/[\s'-]+/).map(searchKey)], [loose, text.split(/[\s'-]+/).map(looseKey)]]) {
      const whole = words.join("");
      if (whole.startsWith(k)) best = Math.max(best, 2);
      else if (words.some((w) => w.startsWith(k))) best = Math.max(best, 1.5);
      else if (k.length >= 3 && whole.includes(k)) best = Math.max(best, 1);
    }
    return best;
  };
  const ranked = [];
  if (key) {
    for (const [title, href, hint] of SEARCH_PAGES) {
      const sc = Math.max(score(title), score(hint) && 0.5);
      if (sc) ranked.push({ title, href, hint, sc });
    }
    for (const s of surahs) {
      const sc = String(s.number) === q ? 3 : Math.max(score(s.englishName), score(s.englishNameTranslation) * 0.8);
      if (sc) ranked.push({ title: `${s.number}. ${s.englishName}`, hint: `${s.englishNameTranslation} · ${s.numberOfAyahs} verses`, href: `quran.html?surah=${s.number}`, sc });
    }
    for (const [id, name] of SEARCH_HADITH) {
      const sc = Math.max(score(name), score(id));
      if (sc) ranked.push({ title: name, hint: "Hadith collection", href: `hadith.html?c=${id}`, sc });
    }
  }
  ranked.sort((a, b) => b.sc - a.sc);
  return [...out, ...ranked].slice(0, 8);
}

let quick = null;

function openQuickSearch() {
  if (!quick) {
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="quick" class="quick" aria-label="Quick search">
        <div class="quick-field">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input id="quick-q" type="search" placeholder="Search surahs, verses (2:255), paras, hadith, pages…" autocomplete="off" aria-label="Search" aria-controls="quick-list">
          <kbd>Esc</kbd>
        </div>
        <ul id="quick-list" class="quick-list" role="listbox"></ul>
      </dialog>`);
    quick = { dialog: $("quick"), active: 0, results: [] };
    $("quick-q").addEventListener("input", renderQuick);
    $("quick-q").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = quick.results.length;
        quick.active = (quick.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
        renderQuick(false);
      } else if (e.key === "Enter" && quick.results[quick.active]) {
        e.preventDefault();
        goQuick(quick.results[quick.active].href);
      }
    });
    $("quick-list").addEventListener("click", (e) => {
      const a = e.target.closest("a[data-i]");
      if (!a) return;
      e.preventDefault();
      goQuick(quick.results[Number(a.dataset.i)].href);
    });
    quick.dialog.addEventListener("click", (e) => {
      if (e.target === quick.dialog) quick.dialog.close();
    });
    // Make sure surahs are available to search, even before the Quran page was opened
    if (!(readStore("quran-surahs", []) || []).length) {
      getJSON(`${QURAN_API}/surah`).then(({ data }) => {
        writeStore("quran-surahs", data);
        if (quick.dialog.open) renderQuick();
      }).catch(() => {});
    }
  }
  $("quick-q").value = "";
  renderQuick();
  quick.dialog.showModal();
  $("quick-q").focus();
}

function renderQuick(reset = true) {
  if (reset) {
    quick.results = quickResults($("quick-q").value);
    quick.active = 0;
  }
  $("quick-list").innerHTML = quick.results.length
    ? quick.results.map((r, i) => `<li role="option" aria-selected="${i === quick.active}">
        <a href="${r.href}" data-i="${i}"><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(r.hint)}</span></a>
      </li>`).join("")
    : `<li class="quick-empty">Nothing found. Try a surah name, a verse like 2:255, or “para 30”.</li>`;
  $("quick-list").querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function goQuick(href) {
  quick.dialog.close();
  const url = new URL(href, location.href);
  // Same page, different section: reload so the page can react to it
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    location.hash = url.hash;
    document.querySelector(url.hash)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  } else {
    location.href = url.href;
  }
}

$("search-btn").addEventListener("click", openQuickSearch);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (quick?.dialog.open) quick.dialog.close();
    else openQuickSearch();
  } else if (e.key === "/" && !e.target.closest("input, textarea, select, [contenteditable]") && !document.querySelector("dialog[open]")) {
    e.preventDefault();
    openQuickSearch();
  }
});

// Mark the current page in the navigation
for (const link of document.querySelectorAll(".nav a")) {
  if (link.dataset.page !== document.body.dataset.page) continue;
  link.setAttribute("aria-current", "page");
  // On phones the nav scrolls sideways; bring the current page into view
  const nav = link.parentElement;
  if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
}

// ---------- Motion ----------

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

// The header gains a hairline once the page scrolls under it
const topbar = document.querySelector(".topbar");
const markScrolled = () => topbar.classList.toggle("scrolled", scrollY > 8);
addEventListener("scroll", markScrolled, { passive: true });
markScrolled();

// Sections rise into place in 3D as they scroll into view
const revealObserver = "IntersectionObserver" in window && !reduceMotion
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 })
  : null;

// Safety net: a fast fling can skip past elements between observer callbacks,
// so anything already above the bottom of the screen is shown on scroll.
let revealFrame = 0;
addEventListener("scroll", () => {
  if (!revealObserver || revealFrame) return;
  revealFrame = requestAnimationFrame(() => {
    revealFrame = 0;
    for (const el of document.querySelectorAll(".reveal:not(.is-visible)")) {
      if (el.offsetParent !== null && el.getBoundingClientRect().top < innerHeight) {
        el.classList.add("is-visible");
        revealObserver.unobserve(el);
      }
    }
  });
}, { passive: true });

// delay(el, i) returns a small step count used to stagger elements
function reveal(elements, delay = (el, i) => Math.min(i, 6)) {
  if (!revealObserver) return;
  [...elements].forEach((el, i) => {
    if (el.classList.contains("reveal")) return;
    el.classList.add("reveal");
    el.style.setProperty("--i", delay(el, i));
    revealObserver.observe(el);
  });
}

// Cards lean toward the pointer, like a physical object under the hand.
// data-tilt sets the maximum angle in degrees.
function tilt(elements, maxDefault = 4) {
  if (!finePointer || reduceMotion) return;
  for (const el of elements) {
    if (el.classList.contains("tilt")) continue;
    const max = Number(el.dataset.tilt) || maxDefault;
    el.classList.add("tilt");
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.classList.add("tilting");
      el.style.setProperty("--rx", `${(-y * max).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
    });
    el.addEventListener("pointerleave", () => {
      el.classList.remove("tilting");
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    });
  }
}

// Restart a CSS animation class on an element
function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

reveal(document.querySelectorAll("main > section, main > .card, main > .place-bar, main > .continue"));
tilt(document.querySelectorAll("[data-tilt]"));

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
  toast("Tilawave is installed. Open it from your home screen or app list.");
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
