const BOOKMARKS_KEY = "quran-bookmarks";
const LAST_READ_KEY = "quran-last-read";
const SURAHS_KEY = "quran-surahs";
const JUZ_STARTS_KEY = "quran-juz-starts";
const KHATAM_KEY = "quran-khatam";
const READING_DAYS_KEY = "quran-reading-days";
const MAX_RESULTS = 50;
const SEARCHES_KEY = "quran-searches";
const HIFZ_KEY = "quran-hifz"; // surah numbers memorised
const POPULAR = [{ surah: 36 }, { surah: 18 }, { surah: 67 }, { surah: 55 }, { surah: 56 }, { surah: 2, ayah: 255, label: "Ayat al-Kursi" }];

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
  share: SHARE_ICON,
  tafsir: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10 5 7.3 4.5 4 5v13c3.3-.5 6 0 8 1.5 2-1.5 4.7-2 8-1.5V5c-3.3-.5-6 0-8 1.5zM12 6.5v13" /></svg>`,
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

// ---------- Hifz (memorisation) ----------

const getHifz = () => new Set(readStore(HIFZ_KEY, []) || []);

function toggleHifz(surah) {
  const set = getHifz();
  if (set.has(surah)) set.delete(surah);
  else set.add(surah);
  writeStore(HIFZ_KEY, [...set].sort((a, b) => a - b));
  return set.has(surah);
}

function renderHifz(surahs) {
  const set = getHifz();
  const verses = [...set].reduce((sum, n) => sum + (surahs?.[n - 1]?.numberOfAyahs || 0), 0);
  $("hifz-title").textContent = `${set.size} of 114 surahs`;
  $("hifz-bar").style.width = `${(verses / 6236) * 100}%`;
  document.querySelector("#hifz .progress").setAttribute("aria-valuenow", verses);
  $("hifz-status").textContent = set.size
    ? `${verses.toLocaleString()} of 6,236 verses memorised.`
    : "Mark a surah as memorised from its page. Most people begin with the short surahs at the end.";
  // Suggest working backwards from An-Nas, the usual order for memorising
  const next = Array.from({ length: 114 }, (_, i) => 114 - i).find((n) => !set.has(n));
  $("hifz-next").hidden = !next || !surahs;
  if (next && surahs) {
    $("hifz-next").href = `quran.html?surah=${next}&practice=1`;
    $("hifz-next").textContent = `Practise ${surahs[next - 1].englishName}`;
  }
  $("hifz-list").innerHTML = surahs
    ? [...set].sort((a, b) => b - a).map((n) => `<a class="chip" href="quran.html?surah=${n}&practice=1">${n}. ${escapeHtml(surahs[n - 1].englishName)}</a>`).join("")
    : "";
}

function renderPopular(surahs) {
  $("popular-list").innerHTML = POPULAR.map((p) => {
    const s = surahs[p.surah - 1];
    const href = p.ayah ? `quran.html?surah=${p.surah}#ayah-${p.ayah}` : `quran.html?surah=${p.surah}`;
    return `<a class="popular-card" href="${href}">
      <span class="popular-ar" lang="ar" dir="rtl">${escapeHtml(p.ayah ? "آية الكرسي" : s.name.replace(/^سُورَةُ\s*/, ""))}</span>
      <strong>${escapeHtml(p.label || s.englishName)}</strong>
      <span class="muted small">${p.ayah ? `${s.englishName} ${p.surah}:${p.ayah}` : `${s.numberOfAyahs} verses`}</span>
    </a>`;
  }).join("");
  tilt($("popular-list").children, 6);
}

// ---------- Index view ----------

let paraData = null; // { starts, surahs } once loaded

async function openIndex() {
  renderRecentSearches();
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
    renderPopular(surahs);
    renderHifz(surahs);
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
  const hifz = getHifz();
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
          <span class="surah-meta muted">${s.revelationType === "Meccan" ? "Makki" : "Madani"} · ${s.numberOfAyahs} verses${hifz.has(s.number) ? ` · <span class="memorised">Memorised</span>` : ""}</span>
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

const recentSearches = () => readStore(SEARCHES_KEY, []) || [];

function renderRecentSearches() {
  const list = recentSearches();
  $("recent-searches").hidden = !list.length;
  $("recent-searches").innerHTML = list.length
    ? `<span class="muted small">Recent</span>` +
      list.map((s, i) => `<button class="chip" type="button" data-i="${i}" ${s.lang.startsWith("ur") ? 'lang="ur" dir="rtl"' : ""}>${escapeHtml(s.q)}</button>`).join("") +
      `<button class="text-btn small" type="button" data-clear>Clear</button>`
    : "";
}

function rememberSearch(q, lang) {
  const list = recentSearches().filter((s) => s.q.toLowerCase() !== q.toLowerCase());
  writeStore(SEARCHES_KEY, [{ q, lang }, ...list].slice(0, 5));
  renderRecentSearches();
}

$("recent-searches").addEventListener("click", (e) => {
  if (e.target.closest("[data-clear]")) {
    writeStore(SEARCHES_KEY, []);
    return renderRecentSearches();
  }
  const btn = e.target.closest("button[data-i]");
  if (!btn) return;
  const { q, lang } = recentSearches()[Number(btn.dataset.i)];
  $("search-q").value = q;
  $("search-lang").value = lang;
  search(q, lang);
});

async function search(query, edition) {
  const id = ++searchId;
  const q = query.trim();
  if (!q) return;
  rememberSearch(q, edition);
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

const options = (map, selected) =>
  Object.entries(map).map(([id, name]) => `<option value="${id}"${id === String(selected) ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");

function applyReaderSettings() {
  const s = quranSettings();
  const view = $("reader-view");
  view.classList.toggle("hide-en", s.translation === "ur" || s.translation === "none");
  view.classList.toggle("hide-ur", s.translation === "en" || s.translation === "none");
  view.classList.toggle("show-translit", s.transliteration);
  view.classList.toggle("script-indopak", s.script === "indopak");
  $("script").value = s.script || "uthmani";
  view.style.setProperty("--quran-scale", s.fontScale);
  $("translation").value = s.translation;
  $("reciter").value = s.reciter;
  $("en-edition").value = s.enEdition;
  $("ur-edition").value = s.urEdition;
  $("translit-btn").setAttribute("aria-pressed", String(s.transliteration));
}

// Combine the Arabic text, translations and transliteration verse by verse.
function buildItems([ar, en, ur, tl], surahs) {
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
      tl: tl[i].text,
      basmala: split.basmala,
    };
  });
}

// One request per surah (all editions at once); a para is fetched edition by edition.
async function fetchTexts(mode, n) {
  const editions = textEditions();
  const surahs = await getSurahs();
  let items;
  if (mode === "surah") {
    const { data } = await getJSON(`${QURAN_API}/surah/${n}/editions/${editions}`);
    const byId = Object.fromEntries(data.map((d) => [d.edition.identifier, d.ayahs]));
    items = buildItems(editions.map((ed) => byId[ed]), surahs);
  } else {
    const parts = await Promise.all(editions.map((ed) => getJSON(`${QURAN_API}/juz/${n}/${ed}`)));
    items = buildItems(parts.map((p) => p.data.ayahs), surahs);
  }
  return quranSettings().script === "indopak" ? withIndoPak(items, mode, n) : items;
}

// Indo-Pak script (as printed in Pakistan and India) comes from Quran.com.
// Its verses never include the Bismillah, which is taken from Al-Fatiha 1:1.
async function withIndoPak(items, mode, n) {
  const query = mode === "surah" ? `chapter_number=${n}` : `juz_number=${n}`;
  const [{ verses }, opening] = await Promise.all([
    getJSON(`${QURAN_COM_API}/quran/verses/indopak?${query}`),
    getJSON(`${QURAN_COM_API}/quran/verses/indopak?verse_key=1:1`),
  ]);
  // Drop direction marks, and private-use codes the font has no glyph for
  // (they sit beside a standard pause mark, which is kept)
  const clean = (text) => text.replace(/[\u200e\u200f\ue000-\uf8ff]/g, "").trim();
  const byKey = new Map(verses.map((v) => [v.verse_key, clean(v.text_indopak)]));
  const basmala = clean(opening.verses[0].text_indopak);
  return items.map((item) => ({
    ...item,
    ar: byKey.get(`${item.surah}:${item.number}`) || item.ar,
    basmala: item.basmala && basmala,
  }));
}

async function openReader(mode, n) {
  $("index-view").hidden = true;
  $("reader-view").hidden = false;
  reader.mode = mode;
  reader.n = n;
  $("play-surah").textContent = `Play ${mode === "juz" ? "para" : "surah"}`;

  $("reciter").innerHTML = options(RECITERS);
  $("en-edition").innerHTML = options(EN_TRANSLATIONS);
  $("ur-edition").innerHTML = options(UR_TRANSLATIONS);
  $("tafsir-source").innerHTML = Object.entries(TAFSIRS)
    .map(([id, t]) => `<option value="${id}">${escapeHtml(t.name)} · ${t.lang === "ur" ? "Urdu" : "English"}</option>`).join("");
  applyReaderSettings();

  try {
    const surahs = await getSurahs();
    reader.items = await fetchTexts(mode, n);
    if (mode === "surah") {
      renderSurahHead(surahs[n - 1], surahs);
      const basmala = reader.items[0].basmala;
      $("basmala").textContent = basmala || "";
      $("basmala").hidden = !basmala;
      $("info-btn").hidden = false;
      renderHifzButton();
      if (new URLSearchParams(location.search).has("practice")) startPractice();
    } else {
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
          <button class="icon-btn small-btn" data-action="tafsir" type="button" aria-label="Tafsir of verse ${a.surah}:${a.number}" title="Tafsir">${ICONS.tafsir}</button>
          <button class="icon-btn small-btn" data-action="share" type="button" aria-label="Share verse ${a.surah}:${a.number} as an image" title="Share as image">${ICONS.share}</button>
          <button class="icon-btn small-btn" data-action="copy" type="button" aria-label="Copy verse ${a.surah}:${a.number}">${ICONS.copy}</button>
          <button class="icon-btn small-btn" data-action="link" type="button" aria-label="Copy link to verse ${a.surah}:${a.number}">${ICONS.link}</button>
        </div>
      </div>
      <p class="quran-text" lang="ar" dir="rtl">${escapeHtml(a.ar)} <span class="ayah-end">${arabicNumber(a.number)}</span></p>
      <p class="translit">${escapeHtml(a.tl)}</p>
      <p class="translation tr-en">${escapeHtml(a.en)}</p>
      <p class="translation tr-ur urdu" lang="ur" dir="rtl">${escapeHtml(a.ur)}</p>
    </article>`;
  });
  $("ayahs").innerHTML = html;
  setAudioReady(reader.audio.length > 0);
  renderPlayState();
  document.querySelector(`.ayah[data-index="${player.index}"]`)?.classList.add("playing");
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
  } else if (btn.dataset.action === "tafsir") {
    openTafsir(index);
  } else if (btn.dataset.action === "share") {
    shareVerse(a);
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

// The verse at the top of the screen, so a re-render can return to it
function firstVisibleIndex() {
  const el = [...document.querySelectorAll(".ayah")].find((a) => a.getBoundingClientRect().bottom > 140);
  return el ? Number(el.dataset.index) : 0;
}

async function changeEditions(update) {
  saveQuranSettings(update);
  applyReaderSettings();
  const index = firstVisibleIndex();
  const offset = document.querySelector(`.ayah[data-index="${index}"]`)?.getBoundingClientRect().top ?? 0;
  document.body.classList.add("loading");
  try {
    reader.items = await fetchTexts(reader.mode, reader.n);
    renderAyahs();
    const el = document.querySelector(`.ayah[data-index="${index}"]`);
    if (el && index > 0) scrollBy(0, el.getBoundingClientRect().top - offset);
    toast(update.script
      ? `Arabic script: ${update.script === "indopak" ? "Indo-Pak" : "Uthmani"}`
      : `Translation: ${update.enEdition ? EN_TRANSLATIONS[update.enEdition] : UR_TRANSLATIONS[update.urEdition]}`);
  } catch (err) {
    toast(`Couldn't load that ${update.script ? "script" : "translation"}. ${err.message}`, 5000);
  } finally {
    document.body.classList.remove("loading");
  }
}

$("en-edition").addEventListener("change", () => changeEditions({ enEdition: $("en-edition").value }));
$("ur-edition").addEventListener("change", () => changeEditions({ urEdition: $("ur-edition").value }));

$("script").addEventListener("change", async () => {
  await changeEditions({ script: $("script").value });
  // The Bismillah heading follows the script too
  const basmala = reader.items[0]?.basmala;
  if (reader.mode === "surah" && basmala) $("basmala").textContent = basmala;
});

$("translit-btn").addEventListener("click", () => {
  saveQuranSettings({ transliteration: !quranSettings().transliteration });
  applyReaderSettings();
});

$("more-btn").addEventListener("click", () => {
  const open = $("reader-more").hidden;
  $("reader-more").hidden = !open;
  $("more-btn").setAttribute("aria-expanded", String(open));
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

// ---------- Hifz in the reader ----------

function renderHifzButton() {
  const on = getHifz().has(reader.n);
  $("hifz-btn").hidden = false;
  $("hifz-btn").setAttribute("aria-pressed", String(on));
  $("hifz-btn").textContent = on ? "Memorised" : "Mark as memorised";
}

$("hifz-btn").addEventListener("click", () => {
  const on = toggleHifz(reader.n);
  renderHifzButton();
  toast(on ? `${reader.items[0].name} marked as memorised. MashaAllah.` : "Removed from memorised.");
});

// Practice mode: each verse repeats 3 times, starting from the first verse
function startPractice() {
  player.repeat = 3;
  renderRepeat();
  toast("Practice: each verse plays 3 times. Press Play surah to begin.", 5000);
}

// ---------- Surah introduction ----------

const infoCache = new Map();

async function showSurahInfo(lang) {
  $("info-en").setAttribute("aria-selected", String(lang === "en"));
  $("info-ur").setAttribute("aria-selected", String(lang === "ur"));
  const text = $("info-text");
  const urdu = lang === "ur";
  text.classList.toggle("urdu-rich", urdu);
  text.lang = urdu ? "ur" : "en";
  text.dir = urdu ? "rtl" : "ltr";
  text.innerHTML = `<p class="muted">Loading…</p>`;
  const key = `${reader.n}-${lang}`;
  try {
    if (!infoCache.has(key)) infoCache.set(key, getJSON(`${QURAN_COM_API}/chapters/${reader.n}/info?language=${lang}`));
    const { chapter_info: info } = await infoCache.get(key);
    if (!$("info-" + lang).matches('[aria-selected="true"]')) return;
    text.innerHTML = sanitizeHtml(info.text);
    $("info-source").textContent = info.source ? `Source: ${info.source.replace(/\s+-\s+/g, " · ")}` : "";
  } catch (err) {
    infoCache.delete(key);
    text.innerHTML = `<p class="error">Couldn't load the introduction. ${escapeHtml(err.message)}</p>`;
  }
}

$("info-btn").addEventListener("click", () => {
  const open = $("surah-info").hidden;
  $("surah-info").hidden = !open;
  $("info-btn").setAttribute("aria-expanded", String(open));
  if (open && !$("info-text").childElementCount) showSurahInfo(quranSettings().translation === "ur" ? "ur" : "en");
});
$("info-en").addEventListener("click", () => showSurahInfo("en"));
$("info-ur").addEventListener("click", () => showSurahInfo("ur"));

// ---------- Tafsir ----------

const tafsirCache = new Map();
const tafsir = { index: -1, groupEnd: -1 };
const verseKey = (a) => `${a.surah}:${a.number}`;

async function openTafsir(index) {
  const a = reader.items[index];
  if (!a) return;
  tafsir.index = index;
  tafsir.groupEnd = index;
  const source = Number(quranSettings().tafsir);
  const urdu = TAFSIRS[source].lang === "ur";
  $("tafsir-source").value = source;
  $("tafsir-title").textContent = `${a.name} ${verseKey(a)}`;
  $("tafsir-verse").textContent = a.ar;
  $("tafsir-covers").hidden = true;
  $("tafsir-prev").disabled = index === 0;
  $("tafsir-next").disabled = index === reader.items.length - 1;
  const text = $("tafsir-text");
  text.classList.toggle("urdu-rich", urdu);
  text.lang = urdu ? "ur" : "en";
  text.dir = urdu ? "rtl" : "ltr";
  text.innerHTML = `<p class="muted">Loading…</p>`;
  $("tafsir-body").scrollTop = 0;
  if (!$("tafsir").open) $("tafsir").showModal();

  const key = `${source}/${verseKey(a)}`;
  try {
    if (!tafsirCache.has(key)) tafsirCache.set(key, getJSON(`${QURAN_COM_API}/tafsirs/${source}/by_ayah/${verseKey(a)}`));
    const { tafsir: data } = await tafsirCache.get(key);
    if (tafsir.index !== index || Number(quranSettings().tafsir) !== source) return;

    // Commentary is often written for a passage, not a single verse.
    const covered = Object.keys(data.verses || {});
    if (covered.length > 1) {
      $("tafsir-covers").textContent = `This commentary covers verses ${covered[0]} to ${covered.at(-1)}.`;
      $("tafsir-covers").hidden = false;
      const last = reader.items.findIndex((item) => verseKey(item) === covered.at(-1));
      tafsir.groupEnd = Math.max(index, last);
      $("tafsir-next").disabled = tafsir.groupEnd >= reader.items.length - 1;
    }
    text.innerHTML = data.text?.trim()
      ? sanitizeHtml(data.text)
      : `<p class="muted">${escapeHtml(TAFSIRS[source].name)} has no separate note on this verse. It is usually explained with the verses around it.</p>`;
  } catch (err) {
    tafsirCache.delete(key);
    text.innerHTML = `<p class="error">Couldn't load the tafsir. ${escapeHtml(err.message)}</p>`;
  }
}

$("tafsir-source").addEventListener("change", () => {
  saveQuranSettings({ tafsir: Number($("tafsir-source").value) });
  openTafsir(tafsir.index);
});
$("tafsir-prev").addEventListener("click", () => openTafsir(tafsir.index - 1));
$("tafsir-next").addEventListener("click", () => openTafsir(tafsir.groupEnd + 1));
$("tafsir-close").addEventListener("click", () => $("tafsir").close());
// A click on the dimmed backdrop lands on the dialog itself, outside its box
$("tafsir").addEventListener("click", (e) => {
  if (e.target !== $("tafsir")) return;
  const r = $("tafsir").getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $("tafsir").close();
});

// ---------- Audio ----------

const player = { audio: new Audio(), index: -1, repeat: 1, plays: 1 };

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
  player.plays = 1;
  renderRepeat();
  player.audio.src = url;
  player.audio.play().catch((err) => {
    if (err.name === "AbortError") return; // replaced by the next verse
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
  // Repeat the same verse for memorising before moving on
  if (player.plays < player.repeat) {
    player.plays++;
    renderRepeat();
    player.audio.currentTime = 0;
    player.audio.play().catch(() => {});
    return;
  }
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

// ---------- Repeat and sleep timer ----------

const REPEATS = [1, 3, 5, 10];
const SLEEP_MINUTES = [0, 15, 30, 60];
const sleep = { minutes: 0, endsAt: 0, timer: 0 };

function renderRepeat() {
  const on = player.repeat > 1;
  $("repeat-label").textContent = on ? `${Math.min(player.plays, player.repeat)} of ${player.repeat}` : "1×";
  $("player-repeat").setAttribute("aria-pressed", String(on));
  $("player-repeat").setAttribute("aria-label", on ? `Repeat each verse ${player.repeat} times` : "Repeat each verse");
}

$("player-repeat").addEventListener("click", () => {
  player.repeat = REPEATS[(REPEATS.indexOf(player.repeat) + 1) % REPEATS.length];
  player.plays = Math.min(player.plays, player.repeat);
  renderRepeat();
  toast(player.repeat > 1 ? `Each verse plays ${player.repeat} times.` : "Repeat off.");
});

function renderSleep() {
  const left = sleep.endsAt ? Math.max(1, Math.ceil((sleep.endsAt - Date.now()) / 60000)) : 0;
  $("sleep-label").textContent = left ? `${left} min` : "Off";
  $("player-sleep").setAttribute("aria-pressed", String(!!left));
}

$("player-sleep").addEventListener("click", () => {
  sleep.minutes = SLEEP_MINUTES[(SLEEP_MINUTES.indexOf(sleep.minutes) + 1) % SLEEP_MINUTES.length];
  clearInterval(sleep.timer);
  sleep.endsAt = sleep.minutes ? Date.now() + sleep.minutes * 60000 : 0;
  if (sleep.minutes) {
    sleep.timer = setInterval(() => {
      if (Date.now() < sleep.endsAt) return renderSleep();
      clearInterval(sleep.timer);
      sleep.minutes = 0;
      sleep.endsAt = 0;
      player.audio.pause();
      renderSleep();
      toast("Sleep timer ended. Recitation paused.");
    }, 15000);
  }
  renderSleep();
  toast(sleep.minutes ? `Recitation will stop in ${sleep.minutes} minutes.` : "Sleep timer off.");
});

// ---------- Share as image ----------

function shareVerse(a) {
  return shareCard({
    label: "The Holy Quran",
    ar: a.ar,
    arFont: quranSettings().script === "indopak" ? "IndoPak" : "Amiri Quran",
    ...cardTranslation(a.en, a.ur),
    ref: `${a.name} ${a.surah}:${a.number}`,
  }).catch((err) => toast(`Couldn't create the image. ${err.message}`));
}

// ---------- Keyboard shortcuts (reader) ----------

// The verse being recited, or else the first one on screen
const currentIndex = () => (player.index >= 0 ? player.index : firstVisibleIndex());

function goToVerse(index) {
  if (index < 0 || index >= reader.items.length) return;
  if (player.index >= 0) return playAyah(index);
  const el = document.querySelector(`.ayah[data-index="${index}"]`);
  el.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  replay(el, "flash");
}

document.addEventListener("keydown", (e) => {
  if ($("reader-view").hidden || $("tafsir").open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, select, textarea, button, a")) {
    if (e.key === " " || e.target.closest("input, select, textarea")) return;
  }
  const index = currentIndex();
  const a = reader.items[index];
  const actions = {
    " ": () => (player.index < 0 ? reader.audio.length && playAyah(index) : player.audio.paused ? player.audio.play().catch(() => {}) : player.audio.pause()),
    ArrowRight: () => goToVerse(index + 1),
    ArrowLeft: () => goToVerse(index - 1),
    b: () => document.querySelector(`.ayah[data-index="${index}"] [data-action="bookmark"]`)?.click(),
    t: () => a && openTafsir(index),
    s: () => a && shareVerse(a),
  };
  const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!action) return;
  e.preventDefault();
  action();
});

// ---------- Start ----------

const startParams = new URLSearchParams(location.search);
const surahParam = Number(startParams.get("surah"));
const juzParam = Number(startParams.get("juz"));
if (Number.isInteger(surahParam) && surahParam >= 1 && surahParam <= 114) openReader("surah", surahParam);
else if (Number.isInteger(juzParam) && juzParam >= 1 && juzParam <= 30) openReader("juz", juzParam);
else openIndex();
