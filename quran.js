const BOOKMARKS_KEY = "quran-bookmarks";
const LAST_READ_KEY = "quran-last-read";
const SURAHS_KEY = "quran-surahs";
const JUZ_STARTS_KEY = "quran-juz-starts";
const KHATAM_KEY = "quran-khatam";
const READING_DAYS_KEY = "quran-reading-days";
const MAX_RESULTS = 50;

// Traditional para names (the opening words of each juz), as used in Pakistan and India
const PARA_NAMES = [
  "Alif Lam Meem", "Sayaqool", "Tilkal Rusul", "Lan Tanaloo", "Wal Mohsanat",
  "La Yuhibbullah", "Wa Iza Samiu", "Wa Lau Annana", "Qalal Malao", "Wa A'lamu",
  "Yatazeroon", "Wa Mamin Da'abat", "Wa Ma Ubrioo", "Rubama", "Subhanallazi",
  "Qal Alam", "Iqtaraba", "Qad Aflaha", "Wa Qalallazina", "Amman Khalaq",
  "Utlu Ma Oohi", "Wa Manyaqnut", "Wa Mali", "Faman Azlam", "Elahe Yuruddo",
  "Ha'a Meem", "Qala Fama Khatbukum", "Qad Sami Allah", "Tabarakallazi", "Amma Yatasa'aloon",
];

const ICONS = {
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>`,
  copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>`,
  link: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></svg>`,
};

// ---------- Data ----------

async function getSurahs() {
  const cached = readStore(SURAHS_KEY, null);
  if (Array.isArray(cached) && cached.length === 114) return cached;
  const { data } = await getJSON(`${QURAN_API}/surah`);
  writeStore(SURAHS_KEY, data);
  return data;
}

// Where each of the 30 paras begins: [{ surah, ayah }, ...]
async function getJuzStarts() {
  const cached = readStore(JUZ_STARTS_KEY, null);
  if (Array.isArray(cached) && cached.length === 30) return cached;
  const { data } = await getJSON(`${QURAN_API}/meta`);
  const starts = data.juzs.references;
  writeStore(JUZ_STARTS_KEY, starts);
  return starts;
}

// "Al-Baqara 142 – Al-Baqara 252" for each para
function paraRanges(starts, surahs) {
  return starts.map((start, i) => {
    const next = starts[i + 1];
    const end = !next
      ? { surah: 114, ayah: surahs[113].numberOfAyahs }
      : next.ayah > 1
        ? { surah: next.surah, ayah: next.ayah - 1 }
        : { surah: next.surah - 1, ayah: surahs[next.surah - 2].numberOfAyahs };
    return { start, end };
  });
}

const getBookmarks = () => readStore(BOOKMARKS_KEY, []) || [];
const isBookmarked = (surah, ayah) => getBookmarks().some((b) => b.surah === surah && b.ayah === ayah);

function toggleBookmark(entry) {
  const list = getBookmarks();
  const i = list.findIndex((b) => b.surah === entry.surah && b.ayah === entry.ayah);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(entry);
  writeStore(BOOKMARKS_KEY, list);
  return i < 0;
}

// Lowercase letters/digits only, word-final "h" dropped and doubled letters
// collapsed, so "fatiha" matches "Al-Faatiha" and "baqarah" matches "Al-Baqara".
const simplify = (s) =>
  s.toLowerCase().replace(/h\b/g, "").replace(/[^a-z0-9]/g, "").replace(/(.)\1+/g, "$1");

// ---------- Khatam tracker ----------

function getKhatam() {
  return { completed: [], goalDays: 0, goalStart: null, khatams: 0, ...readStore(KHATAM_KEY, {}) };
}

function saveKhatam(k) {
  writeStore(KHATAM_KEY, k);
}

function toggleJuzComplete(juz) {
  const k = getKhatam();
  const done = new Set(k.completed);
  if (done.has(juz)) done.delete(juz);
  else done.add(juz);
  k.completed = [...done].sort((a, b) => a - b);
  saveKhatam(k);
  return done.has(juz);
}

function markReadingDay() {
  const days = new Set(readStore(READING_DAYS_KEY, []) || []);
  const today = localDateKey();
  if (days.has(today)) return;
  days.add(today);
  writeStore(READING_DAYS_KEY, [...days].sort().slice(-400));
}

// Days in a row with some reading, ending today (or yesterday if not read yet today)
function readingStreak() {
  const days = new Set(readStore(READING_DAYS_KEY, []) || []);
  const d = new Date();
  if (!days.has(localDateKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(localDateKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

const daysBetween = (fromKey, toKey) =>
  Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000);

function khatamStatus(k) {
  const done = k.completed.length;
  const parts = [];
  if (k.goalDays && k.goalStart && done < 30) {
    const day = daysBetween(k.goalStart, localDateKey()) + 1;
    if (day > k.goalDays) {
      parts.push(`Goal date passed · ${30 - done} para${30 - done === 1 ? "" : "s"} left`);
    } else {
      const target = Math.min(30, Math.ceil((30 * day) / k.goalDays));
      const behind = target - done;
      parts.push(`Day ${day} of ${k.goalDays}`);
      parts.push(`Today's target: ${target} para${target === 1 ? "" : "s"}`);
      parts.push(behind > 0 ? `${behind} para${behind === 1 ? "" : "s"} behind` : "On track");
    }
  }
  if (k.khatams) parts.push(`Khatams completed: ${k.khatams}`);
  return parts.join(" · ");
}

function renderKhatam() {
  const k = getKhatam();
  const done = new Set(k.completed);
  const count = done.size;
  $("khatam-title").textContent = `${count} of 30 paras`;
  $("khatam-bar").style.width = `${(count / 30) * 100}%`;
  document.querySelector(".progress").setAttribute("aria-valuenow", count);
  $("khatam-status").textContent = khatamStatus(k) || "Tap a para below when you finish it, or set a goal.";
  $("khatam-goal").value = String(k.goalDays);

  $("khatam-grid").innerHTML = PARA_NAMES.map((name, i) => {
    const juz = i + 1;
    const on = done.has(juz);
    return `<li><button class="cell${on ? " on" : ""}" type="button" data-juz="${juz}" aria-pressed="${on}"
      aria-label="Para ${juz}, ${name}${on ? ", complete" : ""}" title="Para ${juz} · ${name}">${juz}</button></li>`;
  }).join("");

  const next = PARA_NAMES.findIndex((_, i) => !done.has(i + 1)) + 1;
  $("khatam-done").hidden = count < 30;
  $("khatam-next").hidden = count === 30;
  if (next) {
    $("khatam-next").href = `quran.html?juz=${next}`;
    $("khatam-next").textContent = `Read Para ${next} · ${PARA_NAMES[next - 1]}`;
  }
  const streak = readingStreak();
  $("khatam-streak").textContent = streak ? `Reading streak: ${streak} day${streak === 1 ? "" : "s"}` : "";
}

$("khatam-grid").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-juz]");
  if (!btn) return;
  toggleJuzComplete(Number(btn.dataset.juz));
  renderKhatam();
  renderParaList();
});

$("khatam-goal").addEventListener("change", () => {
  const k = getKhatam();
  k.goalDays = Number($("khatam-goal").value);
  k.goalStart = k.goalDays ? localDateKey() : null;
  saveKhatam(k);
  renderKhatam();
  toast(k.goalDays ? `Goal set: finish in ${k.goalDays} days, starting today.` : "Goal removed.");
});

$("khatam-new").addEventListener("click", () => {
  const k = getKhatam();
  saveKhatam({ ...k, completed: [], khatams: k.khatams + 1, goalStart: k.goalDays ? localDateKey() : null });
  renderKhatam();
  renderParaList();
  toast("New khatam started. May Allah make it easy.");
});

// ---------- Index view ----------

let paraData = null; // { starts, surahs } once loaded

async function openIndex() {
  renderContinue();
  renderBookmarks();
  renderKhatam();

  const params = new URLSearchParams(location.search);
  if (params.get("q")) {
    $("search-q").value = params.get("q");
    if (params.get("lang")) $("search-lang").value = params.get("lang");
    search($("search-q").value, $("search-lang").value);
  }
  showTab(params.get("tab") === "paras" ? "paras" : "surahs");

  try {
    const [surahs, starts] = await Promise.all([getSurahs(), getJuzStarts()]);
    paraData = { surahs, ranges: paraRanges(starts, surahs) };
    renderSurahList(surahs);
    renderParaList();
    $("surah-filter").addEventListener("input", () => renderSurahList(surahs, $("surah-filter").value));
  } catch (err) {
    $("surahs-error").textContent = `Couldn't load the list of surahs. ${err.message}`;
    $("surahs-error").hidden = false;
  }
}

function showTab(tab) {
  const paras = tab === "paras";
  $("tab-surahs").setAttribute("aria-selected", String(!paras));
  $("tab-paras").setAttribute("aria-selected", String(paras));
  $("surah-list").hidden = paras;
  $("para-list").hidden = !paras;
  $("surah-filter").hidden = paras;
}

$("tab-surahs").addEventListener("click", () => showTab("surahs"));
$("tab-paras").addEventListener("click", () => showTab("paras"));

function continueLink(last) {
  return last.juz
    ? `quran.html?juz=${last.juz}#ayah-${last.surah}-${last.ayah}`
    : `quran.html?surah=${last.surah}#ayah-${last.ayah}`;
}

function renderContinue() {
  const last = readStore(LAST_READ_KEY, null);
  if (!last) return;
  const el = $("continue");
  el.href = continueLink(last);
  el.innerHTML = last.juz
    ? `<span class="eyebrow">Continue reading</span>
       <strong>Para ${last.juz} · ${escapeHtml(PARA_NAMES[last.juz - 1])}</strong>
       <span class="muted">${escapeHtml(last.name)}, verse ${last.surah}:${last.ayah}</span>`
    : `<span class="eyebrow">Continue reading</span>
       <strong>${escapeHtml(last.name)}</strong>
       <span class="muted">Surah ${last.surah}, verse ${last.ayah}</span>`;
  el.hidden = false;
}

function renderBookmarks() {
  const list = getBookmarks();
  $("bookmarks").hidden = list.length === 0;
  $("bookmarks-list").innerHTML = list.map((b) => `
    <li class="card">
      <a href="quran.html?surah=${b.surah}#ayah-${b.ayah}">
        <span class="ref">${escapeHtml(b.name)} ${b.surah}:${b.ayah}</span>
        <span class="quran-text snippet" lang="ar" dir="rtl">${escapeHtml(b.ar)}</span>
        <span class="muted snippet-en">${escapeHtml(b.en)}</span>
      </a>
      <button class="text-btn" type="button" data-surah="${b.surah}" data-ayah="${b.ayah}">Remove</button>
    </li>`).join("");
}

$("bookmarks-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-surah]");
  if (!btn) return;
  toggleBookmark({ surah: Number(btn.dataset.surah), ayah: Number(btn.dataset.ayah) });
  renderBookmarks();
  toast("Bookmark removed.");
});

function renderSurahList(surahs, filter = "") {
  const q = simplify(filter);
  const shown = surahs.filter((s) =>
    !q ||
    String(s.number) === filter.trim() ||
    simplify(s.englishName).includes(q) ||
    simplify(s.englishNameTranslation).includes(q)
  );
  $("surah-list").innerHTML = shown.length
    ? shown.map((s) => `
      <li>
        <a class="surah-card card" href="quran.html?surah=${s.number}">
          <span class="surah-num">${s.number}</span>
          <span class="surah-names">
            <strong>${escapeHtml(s.englishName)}</strong>
            <span class="muted">${escapeHtml(s.englishNameTranslation)}</span>
          </span>
          <span class="surah-ar" lang="ar" dir="rtl">${escapeHtml(s.name)}</span>
          <span class="surah-meta muted">${s.revelationType === "Meccan" ? "Makki" : "Madani"} · ${s.numberOfAyahs} verses</span>
        </a>
      </li>`).join("")
    : `<li class="muted">No surah matches “${escapeHtml(filter)}”.</li>`;
  decorateGrid($("surah-list"));
}

// 3D entrance by column, and tilt on hover, for surah and para cards
function decorateGrid(list) {
  const columns = Math.max(1, getComputedStyle(list).gridTemplateColumns.split(" ").length);
  reveal(list.querySelectorAll(":scope > li"), (el, i) => i % columns);
  tilt(list.querySelectorAll(".surah-card"), 5);
}

function renderParaList() {
  if (!paraData) return;
  const done = new Set(getKhatam().completed);
  const name = (n) => paraData.surahs[n - 1].englishName;
  $("para-list").innerHTML = paraData.ranges.map(({ start, end }, i) => {
    const juz = i + 1;
    return `<li>
      <a class="surah-card card${done.has(juz) ? " is-done" : ""}" href="quran.html?juz=${juz}">
        <span class="surah-num">${juz}</span>
        <span class="surah-names">
          <strong>${PARA_NAMES[i]}</strong>
          <span class="muted">${escapeHtml(name(start.surah))} ${start.surah}:${start.ayah} – ${escapeHtml(name(end.surah))} ${end.surah}:${end.ayah}</span>
        </span>
        <span class="surah-ar" lang="ar" dir="rtl">الجزء ${arabicNumber(juz)}</span>
        <span class="surah-meta muted">${done.has(juz) ? "Completed" : "Para " + juz}</span>
      </a>
    </li>`;
  }).join("");
  decorateGrid($("para-list"));
}

// ---------- Search ----------

let searchId = 0;

async function search(query, edition) {
  const id = ++searchId;
  const q = query.trim();
  if (!q) return;
  $("results").hidden = false;
  $("results-summary").textContent = "Searching…";
  $("results-list").innerHTML = "";

  const url = new URL(location.href);
  url.search = new URLSearchParams({ q, lang: edition });
  history.replaceState(null, "", url);

  try {
    const { data } = await getJSON(`${QURAN_API}/search/${encodeURIComponent(q)}/all/${edition}`);
    if (id !== searchId) return;
    renderResults(data.matches, data.count, q, edition);
  } catch (err) {
    if (id !== searchId) return;
    $("results-summary").textContent =
      err.status === 404 ? `No verses found for “${q}”.` : `Search failed. ${err.message}`;
  }
}

function highlight(text, query) {
  const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const safe = escapeHtml(text);
  if (!words.length) return safe;
  return safe.replace(new RegExp(`(${words.map(escapeHtml).join("|")})`, "gi"), "<mark>$1</mark>");
}

function renderResults(matches, count, query, edition) {
  const urdu = edition.startsWith("ur");
  $("results-summary").textContent =
    `${count} verse${count === 1 ? "" : "s"} found for “${query}”` +
    (count > MAX_RESULTS ? `. Showing the first ${MAX_RESULTS}.` : ".");
  $("results-list").innerHTML = matches.slice(0, MAX_RESULTS).map((m) => `
    <li class="card">
      <a href="quran.html?surah=${m.surah.number}#ayah-${m.numberInSurah}">
        <span class="ref">${escapeHtml(m.surah.englishName)} ${m.surah.number}:${m.numberInSurah}</span>
        <span class="${urdu ? "urdu" : ""}" ${urdu ? 'lang="ur" dir="rtl"' : ""}>${highlight(m.text, query)}</span>
      </a>
    </li>`).join("");
}

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  search($("search-q").value, $("search-lang").value);
});

$("results-clear").addEventListener("click", () => {
  searchId++;
  $("results").hidden = true;
  $("search-q").value = "";
  history.replaceState(null, "", "quran.html");
});

// ---------- Reader (a surah or a para) ----------

// items: [{ surah, number, name, ar, en, ur, basmala }]
const reader = { mode: "surah", n: 0, items: [], audio: [] };

// Verse ids: #ayah-5 inside a surah, #ayah-2-142 inside a para (which can span surahs)
const ayahId = (item) => (reader.mode === "juz" ? `ayah-${item.surah}-${item.number}` : `ayah-${item.number}`);

function applyReaderSettings() {
  const s = quranSettings();
  const view = $("reader-view");
  view.classList.toggle("hide-en", s.translation === "ur" || s.translation === "none");
  view.classList.toggle("hide-ur", s.translation === "en" || s.translation === "none");
  view.style.setProperty("--quran-scale", s.fontScale);
  $("translation").value = s.translation;
  $("reciter").value = s.reciter;
}

// Combine the Arabic, English and Urdu editions verse by verse.
function buildItems(ar, en, ur, surahs) {
  return ar.map((a, i) => {
    const surah = a.surah?.number ?? reader.n;
    const split = splitBasmala(a.text, surah, a.numberInSurah);
    return {
      surah,
      number: a.numberInSurah,
      name: surahs[surah - 1].englishName,
      ar: split.text,
      en: en[i].text,
      ur: ur[i].text,
      basmala: split.basmala,
    };
  });
}

async function openReader(mode, n) {
  $("index-view").hidden = true;
  $("reader-view").hidden = false;
  reader.mode = mode;
  reader.n = n;
  $("play-surah").textContent = `Play ${mode === "juz" ? "para" : "surah"}`;

  $("reciter").innerHTML = Object.entries(RECITERS)
    .map(([id, name]) => `<option value="${id}">${name}</option>`).join("");
  applyReaderSettings();

  try {
    const surahs = await getSurahs();
    if (mode === "surah") {
      const texts = await getJSON(`${QURAN_API}/surah/${n}/editions/${TEXT_EDITIONS}`);
      const [ar, en, ur] = texts.data;
      reader.items = buildItems(ar.ayahs, en.ayahs, ur.ayahs, surahs);
      renderSurahHead(surahs[n - 1], surahs);
      const basmala = reader.items[0].basmala;
      $("basmala").textContent = basmala || "";
      $("basmala").hidden = !basmala;
    } else {
      const [ar, en, ur] = await Promise.all(
        TEXT_EDITIONS.split(",").map((ed) => getJSON(`${QURAN_API}/juz/${n}/${ed}`))
      );
      reader.items = buildItems(ar.data.ayahs, en.data.ayahs, ur.data.ayahs, surahs);
      renderJuzHead(n);
      renderJuzComplete();
    }
    renderAyahs();
    scrollToHash();
    watchReadingPosition();
    await loadAudio();
  } catch (err) {
    $("ayahs").innerHTML = "";
    $("reader-error").textContent = `Couldn't load this ${mode === "juz" ? "para" : "surah"}. ${err.message}`;
    $("reader-error").hidden = false;
  }
}

function setPrevNext(prev, next) {
  for (const [id, link] of [["prev-surah", prev], ["next-surah", next]]) {
    $(id).hidden = !link;
    if (link) {
      $(id).href = link.href;
      $(id).textContent = link.text;
    }
  }
}

function renderSurahHead(meta, surahs) {
  document.title = `${meta.englishName} — Quran — Tilawave`;
  $("surah-arabic").textContent = meta.name;
  $("surah-title").textContent = meta.englishName;
  $("surah-meta").textContent =
    `Surah ${meta.number} · ${meta.englishNameTranslation} · ${meta.revelationType === "Meccan" ? "Makki" : "Madani"} · ${meta.numberOfAyahs} verses`;
  const prev = surahs[meta.number - 2];
  const next = surahs[meta.number];
  setPrevNext(
    prev && { href: `quran.html?surah=${prev.number}`, text: `← ${prev.number}. ${prev.englishName}` },
    next && { href: `quran.html?surah=${next.number}`, text: `${next.number}. ${next.englishName} →` }
  );
}

function renderJuzHead(n) {
  const first = reader.items[0];
  const last = reader.items.at(-1);
  document.title = `Para ${n} — Quran — Tilawave`;
  $("back-link").href = "quran.html?tab=paras";
  $("back-link").textContent = "All paras";
  $("surah-arabic").textContent = `الجزء ${arabicNumber(n)}`;
  $("surah-title").textContent = `Para ${n} · ${PARA_NAMES[n - 1]}`;
  $("surah-meta").textContent =
    `${first.name} ${first.surah}:${first.number} – ${last.name} ${last.surah}:${last.number} · ${reader.items.length} verses`;
  setPrevNext(
    n > 1 && { href: `quran.html?juz=${n - 1}`, text: `← Para ${n - 1}` },
    n < 30 && { href: `quran.html?juz=${n + 1}`, text: `Para ${n + 1} →` }
  );
}

function renderJuzComplete() {
  const done = getKhatam().completed.includes(reader.n);
  $("juz-complete").hidden = false;
  $("juz-complete-text").textContent = done
    ? `Para ${reader.n} is marked complete in your khatam.`
    : `You've reached the end of Para ${reader.n}.`;
  $("juz-complete-btn").textContent = done ? "Mark as not complete" : `Mark Para ${reader.n} as complete`;
  $("juz-complete-btn").setAttribute("aria-pressed", String(done));
}

$("juz-complete-btn").addEventListener("click", () => {
  const done = toggleJuzComplete(reader.n);
  renderJuzComplete();
  const count = getKhatam().completed.length;
  toast(done ? (count === 30 ? "Khatam complete. MashaAllah!" : `Para ${reader.n} complete · ${count} of 30.`) : "Unmarked.");
});

function renderAyahs() {
  let html = "";
  reader.items.forEach((a, i) => {
    // Inside a para, show a heading wherever a surah begins (or continues).
    if (reader.mode === "juz" && (i === 0 || a.surah !== reader.items[i - 1].surah)) {
      html += `<header class="surah-divider">
        <span class="surah-divider-name">${escapeHtml(a.name)}</span>
        <span class="muted small">Surah ${a.surah}${a.number > 1 ? ` · continued from verse ${a.number}` : ""}</span>
        ${a.basmala ? `<p class="basmala quran-text" lang="ar" dir="rtl">${escapeHtml(a.basmala)}</p>` : ""}
      </header>`;
    }
    const marked = isBookmarked(a.surah, a.number);
    html += `
    <article class="ayah" id="${ayahId(a)}" data-index="${i}">
      <div class="ayah-bar">
        <span class="ayah-ref">${a.surah}:${a.number}</span>
        <div class="ayah-actions">
          <button class="icon-btn small-btn" data-action="play" type="button" aria-label="Play from verse ${a.surah}:${a.number}" disabled>${ICONS.play}</button>
          <button class="icon-btn small-btn${marked ? " active" : ""}" data-action="bookmark" type="button"
            aria-label="Bookmark verse ${a.surah}:${a.number}" aria-pressed="${marked}">${ICONS.bookmark}</button>
          <button class="icon-btn small-btn" data-action="copy" type="button" aria-label="Copy verse ${a.surah}:${a.number}">${ICONS.copy}</button>
          <button class="icon-btn small-btn" data-action="link" type="button" aria-label="Copy link to verse ${a.surah}:${a.number}">${ICONS.link}</button>
        </div>
      </div>
      <p class="quran-text" lang="ar" dir="rtl">${escapeHtml(a.ar)} <span class="ayah-end">${arabicNumber(a.number)}</span></p>
      <p class="translation tr-en">${escapeHtml(a.en)}</p>
      <p class="translation tr-ur urdu" lang="ur" dir="rtl">${escapeHtml(a.ur)}</p>
    </article>`;
  });
  $("ayahs").innerHTML = html;
}

function scrollToHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const el = /^ayah-[\d-]+$/.test(id) && document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 2500);
}

// Remember the first verse on screen as the place to continue reading from.
function watchReadingPosition() {
  let timer = null;
  const save = () => {
    const first = [...document.querySelectorAll(".ayah")].find((el) => el.getBoundingClientRect().bottom > 140);
    if (!first) return;
    const a = reader.items[Number(first.dataset.index)];
    const last = { surah: a.surah, ayah: a.number, name: a.name };
    if (reader.mode === "juz") last.juz = reader.n;
    writeStore(LAST_READ_KEY, last);
    markReadingDay();
  };
  save();
  window.addEventListener("scroll", () => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  }, { passive: true });
}

function copyPayload(a) {
  const { translation } = quranSettings();
  const parts = [a.ar];
  if (translation === "en" || translation === "both") parts.push(a.en);
  if (translation === "ur" || translation === "both") parts.push(a.ur);
  parts.push(`— Quran ${a.surah}:${a.number} (${a.name})`);
  return parts.join("\n\n");
}

$("ayahs").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const index = Number(btn.closest(".ayah").dataset.index);
  const a = reader.items[index];

  if (btn.dataset.action === "play") {
    if (player.index === index && !player.audio.paused) player.audio.pause();
    else playAyah(index);
  } else if (btn.dataset.action === "bookmark") {
    const added = toggleBookmark({ surah: a.surah, ayah: a.number, name: a.name, ar: a.ar, en: a.en });
    btn.classList.toggle("active", added);
    btn.setAttribute("aria-pressed", String(added));
    toast(added ? "Verse bookmarked." : "Bookmark removed.");
  } else if (btn.dataset.action === "copy") {
    await copyText(copyPayload(a));
    toast("Verse copied.");
  } else if (btn.dataset.action === "link") {
    await copyText(`${location.origin}${location.pathname}?surah=${a.surah}#ayah-${a.number}`);
    toast("Link copied.");
  }
});

// ---------- Settings ----------

$("translation").addEventListener("change", () => {
  saveQuranSettings({ translation: $("translation").value });
  applyReaderSettings();
});

$("reciter").addEventListener("change", async () => {
  saveQuranSettings({ reciter: $("reciter").value });
  stopPlayer();
  await loadAudio();
  toast(`Reciter: ${RECITERS[$("reciter").value]}`);
});

function changeFont(step) {
  const scale = Math.min(1.8, Math.max(0.8, Math.round((quranSettings().fontScale + step) * 10) / 10));
  saveQuranSettings({ fontScale: scale });
  applyReaderSettings();
}
$("font-down").addEventListener("click", () => changeFont(-0.1));
$("font-up").addEventListener("click", () => changeFont(0.1));

// ---------- Audio ----------

const player = { audio: new Audio(), index: -1 };

async function loadAudio() {
  const reciter = quranSettings().reciter;
  setAudioReady(false);
  try {
    const { data } = await getJSON(`${QURAN_API}/${reader.mode}/${reader.n}/${reciter}`);
    reader.audio = data.ayahs.map((a) => a.audio);
    setAudioReady(true);
  } catch (err) {
    reader.audio = [];
    toast(`Couldn't load the recitation. ${err.message}`, 5000);
  }
}

function setAudioReady(ready) {
  $("play-surah").disabled = !ready;
  for (const btn of document.querySelectorAll('[data-action="play"]')) btn.disabled = !ready;
}

// Plays from this verse and continues through the rest of the surah or para.
function playAyah(index) {
  const url = reader.audio[index];
  if (!url) return;
  player.index = index;
  player.audio.src = url;
  player.audio.play().catch(() => {
    toast("Couldn't play the recitation.");
    renderPlayState();
  });

  const a = reader.items[index];
  $("player-title").textContent = `${a.name} ${a.surah}:${a.number}`;
  $("player-reciter").textContent = RECITERS[quranSettings().reciter];
  $("player").hidden = false;
  document.body.classList.add("has-player");
  renderPlayState();

  document.querySelectorAll(".ayah.playing").forEach((el) => el.classList.remove("playing"));
  const el = document.querySelector(`.ayah[data-index="${index}"]`);
  el.classList.add("playing");
  el.scrollIntoView({ block: "center", behavior: "smooth" });

  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${a.name} ${a.surah}:${a.number}`,
      artist: RECITERS[quranSettings().reciter],
      album: "The Holy Quran",
    });
  }
}

function stopPlayer() {
  player.audio.pause();
  player.audio.removeAttribute("src");
  player.index = -1;
  $("player").hidden = true;
  document.body.classList.remove("has-player");
  document.querySelectorAll(".ayah.playing").forEach((el) => el.classList.remove("playing"));
  renderPlayState();
}

function renderPlayState() {
  const playing = !player.audio.paused;
  $("player-toggle").classList.toggle("is-paused", !playing);
  $("player-toggle").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("play-surah").textContent = playing ? "Pause" : player.index >= 0 ? "Resume" : `Play ${reader.mode === "juz" ? "para" : "surah"}`;
  document.querySelectorAll('[data-action="play"]').forEach((btn) => {
    const isCurrent = playing && Number(btn.closest(".ayah").dataset.index) === player.index;
    btn.innerHTML = isCurrent ? ICONS.pause : ICONS.play;
  });
}

player.audio.addEventListener("play", renderPlayState);
player.audio.addEventListener("pause", renderPlayState);
player.audio.addEventListener("ended", () => {
  if (player.index < reader.items.length - 1) playAyah(player.index + 1);
  else {
    stopPlayer();
    toast(reader.mode === "juz" ? "Para complete." : "Surah complete.");
  }
});

$("play-surah").addEventListener("click", () => {
  if (!player.audio.paused) player.audio.pause();
  else if (player.index >= 0) player.audio.play();
  else playAyah(0);
});
$("player-toggle").addEventListener("click", () => (player.audio.paused ? player.audio.play() : player.audio.pause()));
$("player-prev").addEventListener("click", () => player.index > 0 && playAyah(player.index - 1));
$("player-next").addEventListener("click", () => player.index < reader.items.length - 1 && playAyah(player.index + 1));
$("player-close").addEventListener("click", stopPlayer);

// ---------- Start ----------

const startParams = new URLSearchParams(location.search);
const surahParam = Number(startParams.get("surah"));
const juzParam = Number(startParams.get("juz"));
if (Number.isInteger(surahParam) && surahParam >= 1 && surahParam <= 114) openReader("surah", surahParam);
else if (Number.isInteger(juzParam) && juzParam >= 1 && juzParam <= 30) openReader("juz", juzParam);
else openIndex();
