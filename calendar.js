
const EVENTS = [
  { month: 1, day: 1, name: "Islamic New Year" },
  { month: 1, day: 10, name: "Day of Ashura" },
  { month: 3, day: 12, name: "Mawlid an-Nabi" },
  { month: 7, day: 27, name: "Isra and Mi'raj" },
  { month: 8, day: 15, name: "Shab-e-Barat" },
  { month: 9, day: 1, name: "Ramadan begins" },
  { month: 9, day: 27, name: "Laylat al-Qadr (27th night)", note: "The night begins at Maghrib the evening before." },
  { month: 10, day: 1, name: "Eid al-Fitr" },
  { month: 12, day: 9, name: "Day of Arafah" },
  { month: 12, day: 10, name: "Eid al-Adha" },
];

const longDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

// Hijri date of a UTC calendar day, following the Hijri adjustment in Settings
const hijriOf = (date) => hijriFor(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());

// ---------- Islamic dates (calculated locally, no network needed) ----------

function upcomingEvents() {
  const now = new Date();
  const found = new Map();
  for (let i = 0; i <= 400 && found.size < EVENTS.length; i++) {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + i, 12));
    const h = hijriOf(date);
    for (const e of EVENTS) {
      if (!found.has(e) && e.month === h.month && e.day === h.day) found.set(e, { ...e, date, days: i, hijri: h });
    }
  }
  return [...found.values()].sort((a, b) => a.days - b.days);
}

function inDays(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function renderEvents() {
  const events = upcomingEvents();
  const today = hijriOf(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12)));

  // Featured: Ramadan progress during Ramadan, otherwise the countdown to it.
  const ramadan = events.find((e) => e.month === 9 && e.day === 1);
  const eid = events.find((e) => e.month === 10 && e.day === 1);
  $("featured").innerHTML = today.month === 9
    ? `<p class="eyebrow">Ramadan ${today.year} AH</p>
       <h1>Day ${today.day}</h1>
       <p class="dates">Eid al-Fitr ${eid.days === 1 ? "is expected tomorrow" : `in about ${eid.days} days`} · ${longDate.format(eid.date)}</p>`
    : `<p class="eyebrow">Ramadan ${ramadan.hijri.year} AH</p>
       <h1>${ramadan.days} days</h1>
       <p class="dates">Expected to begin ${longDate.format(ramadan.date)}</p>`;

  $("events").innerHTML = events.map((e) => `
    <li class="card${e.days === 0 ? " is-today" : ""}">
      <div>
        <strong>${e.name}</strong>
        <span class="muted">${e.day} ${HIJRI_MONTH_NAMES[e.month - 1]} ${e.hijri.year} AH</span>
        ${e.note ? `<span class="muted small">${e.note}</span>` : ""}
      </div>
      <div class="event-when">
        <span>${longDate.format(e.date)}</span>
        <span class="muted">${inDays(e.days)}</span>
      </div>
    </li>`).join("");
}

// ---------- Monthly timetable ----------

const PRAYER_COLUMNS = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
const view = { place: null, year: 0, month: 0, requestId: 0 };

function thisMonth() {
  const get = partsIn(view.place.timezone, { year: "numeric", month: "2-digit" });
  return { year: get("year"), month: get("month") };
}

async function loadMonth() {
  const id = ++view.requestId;
  const { method = "1", school = "1" } = loadSettings();
  const title = new Date(Date.UTC(view.year, view.month - 1, 1))
    .toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  $("month-title").textContent = title;
  $("month-meta").textContent =
    `${view.place.label} · ${METHOD_NAMES[method] || "Karachi"} method · ${school === "1" ? "Hanafi" : "Standard"} Asr`;
  $("timetable-error").hidden = true;
  document.body.classList.add("loading");

  try {
    const params = new URLSearchParams({
      latitude: view.place.lat,
      longitude: view.place.lng,
      method,
      school,
      timezonestring: view.place.timezone,
    });
    if (tuneParam()) params.set("tune", tuneParam());
    const { data } = await getJSON(`${ALADHAN_API}/calendar/${view.year}/${view.month}?${params}`);
    if (id !== view.requestId) return;
    renderMonth(data);
  } catch (err) {
    if (id !== view.requestId) return;
    $("timetable").innerHTML = "";
    $("timetable-error").textContent = `Couldn't load the timetable. ${err.message}`;
    $("timetable-error").hidden = false;
  } finally {
    if (id === view.requestId) document.body.classList.remove("loading");
  }
}

// "28-10-2026" -> "17 Jumada al-Ula"
function hijriCell(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split("-").map(Number);
  const h = hijriFor(y, m, d);
  return `${h.day} ${HIJRI_MONTH_NAMES[h.month - 1]}`;
}

function renderMonth(days) {
  const todayKey = dateIn(view.place.timezone);
  $("timetable").innerHTML = days.map(({ date, timings }) => {
    const isToday = date.gregorian.date === todayKey;
    const isFriday = date.gregorian.weekday.en === "Friday";
    const cls = [isToday && "today", isFriday && "friday"].filter(Boolean).join(" ");
    return `<tr class="${cls}">
      <th scope="row">${escapeHtml(date.gregorian.weekday.en.slice(0, 3))} ${Number(date.gregorian.day)}</th>
      <td class="hijri">${hijriCell(date.gregorian.date)}</td>
      ${PRAYER_COLUMNS.map((p) => `<td>${to12h(timings[p]).join(" ")}</td>`).join("")}
    </tr>`;
  }).join("");
}

function shiftMonth(step) {
  const d = new Date(Date.UTC(view.year, view.month - 1 + step, 1));
  view.year = d.getUTCFullYear();
  view.month = d.getUTCMonth() + 1;
  loadMonth();
}

$("month-prev").addEventListener("click", () => shiftMonth(-1));
$("month-next").addEventListener("click", () => shiftMonth(1));
$("month-today").addEventListener("click", () => {
  Object.assign(view, thisMonth());
  loadMonth();
});
$("print").addEventListener("click", () => window.print());

// ---------- Start ----------

(async function init() {
  renderEvents();
  try {
    view.place = await savedOrDefaultPlace();
    Object.assign(view, thisMonth());
    await loadMonth();
  } catch (err) {
    $("timetable-error").textContent = `Couldn't load the timetable. ${err.message}`;
    $("timetable-error").hidden = false;
  }
})();
