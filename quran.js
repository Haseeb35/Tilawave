const BOOKMARKS_KEY = "quran-bookmarks";
const LAST_READ_KEY = "quran-last-read";
const SURAHS_KEY = "quran-surahs";
const MAX_RESULTS = 50;

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

// ---------- Index view ----------

async function openIndex() {
  renderContinue();
  renderBookmarks();

  const params = new URLSearchParams(location.search);
  if (params.get("q")) {
    $("search-q").value = params.get("q");
    if (params.get("lang")) $("search-lang").value = params.get("lang");
    search($("search-q").value, $("search-lang").value);
  }

  try {
    const surahs = await getSurahs();
    renderSurahList(surahs);
    $("surah-filter").addEventListener("input", () => renderSurahList(surahs, $("surah-filter").value));
  } catch (err) {
    $("surahs-error").textContent = `Couldn't load the list of surahs. ${err.message}`;
    $("surahs-error").hidden = false;
  }
}

function renderContinue() {
  const last = readStore(LAST_READ_KEY, null);
  if (!last) return;
  const el = $("continue");
  el.href = `quran.html?surah=${last.surah}#ayah-${last.ayah}`;
  el.innerHTML = `
    <span class="eyebrow">Continue reading</span>
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

// ---------- Reader ----------

const reader = { surah: null, meta: null, ayahs: [], audio: [] };

function applyReaderSettings() {
  const s = quranSettings();
  const view = $("reader-view");
  view.classList.toggle("hide-en", s.translation === "ur" || s.translation === "none");
  view.classList.toggle("hide-ur", s.translation === "en" || s.translation === "none");
  view.style.setProperty("--quran-scale", s.fontScale);
  $("translation").value = s.translation;
  $("reciter").value = s.reciter;
}

async function openReader(n) {
  $("index-view").hidden = true;
  $("reader-view").hidden = false;
  reader.surah = n;

  $("reciter").innerHTML = Object.entries(RECITERS)
    .map(([id, name]) => `<option value="${id}">${name}</option>`).join("");
  applyReaderSettings();

  try {
    const [surahs, texts] = await Promise.all([
      getSurahs(),
      getJSON(`${QURAN_API}/surah/${n}/editions/${TEXT_EDITIONS}`),
    ]);
    const meta = surahs[n - 1];
    reader.meta = meta;
    renderSurahHead(meta, surahs);

    const [ar, en, ur] = texts.data;
    let basmala = null;
    reader.ayahs = ar.ayahs.map((a, i) => {
      const split = splitBasmala(a.text, n, a.numberInSurah);
      if (split.basmala) basmala = split.basmala;
      return { number: a.numberInSurah, ar: split.text, en: en.ayahs[i].text, ur: ur.ayahs[i].text };
    });
    $("basmala").textContent = basmala || "";
    $("basmala").hidden = !basmala;
    renderAyahs();
    scrollToHash();
    watchReadingPosition();
    await loadAudio();
  } catch (err) {
    $("ayahs").innerHTML = "";
    $("reader-error").textContent = `Couldn't load this surah. ${err.message}`;
    $("reader-error").hidden = false;
  }
}

function renderSurahHead(meta, surahs) {
  document.title = `${meta.englishName} — Quran — Salah`;
  $("surah-arabic").textContent = meta.name;
  $("surah-title").textContent = `${meta.number}. ${meta.englishName}`;
  $("surah-meta").textContent =
    `${meta.englishNameTranslation} · ${meta.revelationType === "Meccan" ? "Makki" : "Madani"} · ${meta.numberOfAyahs} verses`;

  const prev = surahs[meta.number - 2];
  const next = surahs[meta.number];
  if (prev) {
    $("prev-surah").href = `quran.html?surah=${prev.number}`;
    $("prev-surah").textContent = `← ${prev.number}. ${prev.englishName}`;
    $("prev-surah").hidden = false;
  }
  if (next) {
    $("next-surah").href = `quran.html?surah=${next.number}`;
    $("next-surah").textContent = `${next.number}. ${next.englishName} →`;
    $("next-surah").hidden = false;
  }
}

function renderAyahs() {
  const n = reader.surah;
  $("ayahs").innerHTML = reader.ayahs.map((a, i) => `
    <article class="ayah" id="ayah-${a.number}" data-index="${i}">
      <div class="ayah-bar">
        <span class="ayah-ref">${n}:${a.number}</span>
        <div class="ayah-actions">
          <button class="icon-btn small-btn" data-action="play" type="button" aria-label="Play from verse ${a.number}" disabled>${ICONS.play}</button>
          <button class="icon-btn small-btn${isBookmarked(n, a.number) ? " active" : ""}" data-action="bookmark" type="button"
            aria-label="Bookmark verse ${a.number}" aria-pressed="${isBookmarked(n, a.number)}">${ICONS.bookmark}</button>
          <button class="icon-btn small-btn" data-action="copy" type="button" aria-label="Copy verse ${a.number}">${ICONS.copy}</button>
          <button class="icon-btn small-btn" data-action="link" type="button" aria-label="Copy link to verse ${a.number}">${ICONS.link}</button>
        </div>
      </div>
      <p class="quran-text" lang="ar" dir="rtl">${escapeHtml(a.ar)} <span class="ayah-end">${arabicNumber(a.number)}</span></p>
      <p class="translation tr-en">${escapeHtml(a.en)}</p>
      <p class="translation tr-ur urdu" lang="ur" dir="rtl">${escapeHtml(a.ur)}</p>
    </article>`).join("");
}

function scrollToHash() {
  const match = location.hash.match(/^#ayah-(\d+)$/);
  if (!match) return;
  const el = document.getElementById(`ayah-${match[1]}`);
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
    const ayah = reader.ayahs[Number(first.dataset.index)].number;
    writeStore(LAST_READ_KEY, { surah: reader.surah, ayah, name: reader.meta.englishName });
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
  parts.push(`— Quran ${reader.surah}:${a.number} (${reader.meta.englishName})`);
  return parts.join("\n\n");
}

$("ayahs").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const index = Number(btn.closest(".ayah").dataset.index);
  const a = reader.ayahs[index];

  if (btn.dataset.action === "play") {
    if (player.index === index && !player.audio.paused) player.audio.pause();
    else playAyah(index);
  } else if (btn.dataset.action === "bookmark") {
    const added = toggleBookmark({ surah: reader.surah, ayah: a.number, name: reader.meta.englishName, ar: a.ar, en: a.en });
    btn.classList.toggle("active", added);
    btn.setAttribute("aria-pressed", String(added));
    toast(added ? "Verse bookmarked." : "Bookmark removed.");
  } else if (btn.dataset.action === "copy") {
    await copyText(copyPayload(a));
    toast("Verse copied.");
  } else if (btn.dataset.action === "link") {
    await copyText(`${location.origin}${location.pathname}?surah=${reader.surah}#ayah-${a.number}`);
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
    const { data } = await getJSON(`${QURAN_API}/surah/${reader.surah}/${reciter}`);
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

// Plays from this verse and continues through the rest of the surah.
function playAyah(index) {
  const url = reader.audio[index];
  if (!url) return;
  player.index = index;
  player.audio.src = url;
  player.audio.play().catch(() => {
    toast("Couldn't play the recitation.");
    renderPlayState();
  });

  const a = reader.ayahs[index];
  $("player-title").textContent = `${reader.meta.englishName} ${reader.surah}:${a.number}`;
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
      title: `${reader.meta.englishName} ${reader.surah}:${a.number}`,
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
  $("play-surah").textContent = playing ? "Pause" : player.index >= 0 ? "Resume" : "Play surah";
  document.querySelectorAll('[data-action="play"]').forEach((btn) => {
    const isCurrent = playing && Number(btn.closest(".ayah").dataset.index) === player.index;
    btn.innerHTML = isCurrent ? ICONS.pause : ICONS.play;
  });
}

player.audio.addEventListener("play", renderPlayState);
player.audio.addEventListener("pause", renderPlayState);
player.audio.addEventListener("ended", () => {
  if (player.index < reader.ayahs.length - 1) playAyah(player.index + 1);
  else {
    stopPlayer();
    toast("Surah complete.");
  }
});

$("play-surah").addEventListener("click", () => {
  if (!player.audio.paused) player.audio.pause();
  else if (player.index >= 0) player.audio.play();
  else playAyah(0);
});
$("player-toggle").addEventListener("click", () => (player.audio.paused ? player.audio.play() : player.audio.pause()));
$("player-prev").addEventListener("click", () => player.index > 0 && playAyah(player.index - 1));
$("player-next").addEventListener("click", () => player.index < reader.ayahs.length - 1 && playAyah(player.index + 1));
$("player-close").addEventListener("click", stopPlayer);

// ---------- Start ----------

const surahParam = Number(new URLSearchParams(location.search).get("surah"));
if (Number.isInteger(surahParam) && surahParam >= 1 && surahParam <= 114) openReader(surahParam);
else openIndex();
