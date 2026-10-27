const LEARNED_KEY = "names-learned";
const NAMES_KEY = "names-of-allah";

// Only verse references are listed here. Every word shown comes from the Quran API.
// "by" names who made the supplication, where the verse itself says so.
const DUA_TOPICS = [
  {
    id: "forgiveness",
    name: "Forgiveness & mercy",
    duas: [
      { ref: "7:23", by: "Prophet Adam and Hawwa" },
      { ref: "28:16", by: "Prophet Musa" },
      { ref: "21:87", by: "Prophet Yunus" },
      { ref: "3:16" },
      { ref: "3:147" },
      { ref: "3:193" },
      { ref: "23:109" },
      { ref: "23:118" },
      { ref: "59:10" },
      { ref: "66:8" },
    ],
  },
  {
    id: "guidance",
    name: "Guidance & faith",
    duas: [
      { ref: "1:6" },
      { ref: "3:8" },
      { ref: "3:53" },
      { ref: "5:83" },
      { ref: "2:128", by: "Prophets Ibrahim and Ismail" },
      { ref: "18:10", by: "The youths of the cave" },
      { ref: "3:191-194" },
    ],
  },
  {
    id: "hardship",
    name: "Patience & hardship",
    duas: [
      { ref: "2:250" },
      { ref: "7:126" },
      { ref: "21:83", by: "Prophet Ayyub" },
      { ref: "28:24", by: "Prophet Musa" },
      { ref: "10:85-86" },
      { ref: "60:4-5", by: "Prophet Ibrahim and those with him" },
    ],
  },
  {
    id: "family",
    name: "Family & parents",
    duas: [
      { ref: "25:74" },
      { ref: "17:24" },
      { ref: "14:40-41", by: "Prophet Ibrahim" },
      { ref: "71:28", by: "Prophet Nuh" },
      { ref: "3:38", by: "Prophet Zakariya" },
      { ref: "21:89", by: "Prophet Zakariya" },
      { ref: "46:15" },
    ],
  },
  {
    id: "knowledge",
    name: "Knowledge & ease",
    duas: [
      { ref: "20:25-28", by: "Prophet Musa" },
      { ref: "20:114" },
      { ref: "17:80" },
      { ref: "23:29", by: "Prophet Nuh" },
      { ref: "27:19", by: "Prophet Sulayman" },
    ],
  },
  {
    id: "hereafter",
    name: "This life & the next",
    duas: [
      { ref: "2:201" },
      { ref: "2:127", by: "Prophets Ibrahim and Ismail" },
      { ref: "2:286" },
      { ref: "25:65-66" },
      { ref: "7:47" },
      { ref: "26:83-85", by: "Prophet Ibrahim" },
      { ref: "12:101", by: "Prophet Yusuf" },
      { ref: "40:7-8", by: "The angels who carry the Throne" },
      { ref: "23:97-98" },
    ],
  },
];

// "20:25-28" -> ["20:25", "20:26", "20:27", "20:28"]
function expandRef(ref) {
  const [surah, range] = ref.split(":");
  const [from, to = from] = range.split("-").map(Number);
  return Array.from({ length: to - from + 1 }, (_, i) => `${surah}:${from + i}`);
}

const ayahCache = new Map();

async function getAyah(key) {
  const { enEdition, urEdition } = quranSettings();
  const editions = ["quran-uthmani", enEdition, urEdition, TRANSLITERATION, "ar.alafasy"];
  const cacheKey = `${key}/${editions}`;
  if (!ayahCache.has(cacheKey)) {
    ayahCache.set(cacheKey, getJSON(`${QURAN_API}/ayah/${key}/editions/${editions}`).then(({ data }) => {
      const [ar, en, ur, tl, audio] = data;
      return {
        surah: ar.surah.number,
        number: ar.numberInSurah,
        name: ar.surah.englishName,
        ar: splitBasmala(ar.text, ar.surah.number, ar.numberInSurah).text,
        en: en.text,
        ur: ur.text,
        tl: tl.text,
        audio: audio.audio,
      };
    }).catch((err) => {
      ayahCache.delete(cacheKey);
      throw err;
    }));
  }
  return ayahCache.get(cacheKey);
}

// ---------- Duas ----------

let topic = DUA_TOPICS[0];
let duaItems = []; // [{ ref, by, ayahs: [...] }]

function applyTranslation() {
  const { translation } = quranSettings();
  const root = $("duas");
  root.classList.toggle("hide-en", translation === "ur" || translation === "none");
  root.classList.toggle("hide-ur", translation === "en" || translation === "none");
}

function renderTopics() {
  $("dua-topics").innerHTML = DUA_TOPICS.map((t) =>
    `<button class="chip" type="button" data-topic="${t.id}" aria-pressed="${t === topic}">${escapeHtml(t.name)}</button>`
  ).join("");
}

// Run tasks a few at a time so the Quran API isn't flooded
async function inBatches(tasks, size = 4) {
  const results = [];
  for (let i = 0; i < tasks.length; i += size) {
    results.push(...(await Promise.all(tasks.slice(i, i + size).map((task) => task()))));
  }
  return results;
}

async function showTopic(next) {
  topic = next;
  stopAudio();
  renderTopics();
  $("topic-note").innerHTML = `${topic.duas.length} supplications · <button id="print-duas" class="text-btn small" type="button">Print or save as PDF</button>`;
  $("print-duas").addEventListener("click", () => window.print());
  $("duas").innerHTML = `<p class="muted loading-text">Loading…</p>`;
  const shownTopic = topic;
  try {
    const keys = topic.duas.flatMap((d) => expandRef(d.ref));
    const ayahs = new Map(await inBatches(keys.map((key) => async () => [key, await getAyah(key)])));
    const items = topic.duas.map((d) => ({ ...d, ayahs: expandRef(d.ref).map((key) => ayahs.get(key)) }));
    if (shownTopic !== topic) return;
    duaItems = items;
    renderDuas();
  } catch (err) {
    if (shownTopic !== topic) return;
    $("duas").innerHTML = `<p class="error">Couldn't load these duas. ${escapeHtml(err.message)}</p>`;
  }
}

function renderDuas() {
  applyTranslation();
  $("duas").innerHTML = duaItems.map((d, i) => {
    const first = d.ayahs[0];
    const last = d.ayahs.at(-1);
    const ref = first === last ? `${first.surah}:${first.number}` : `${first.surah}:${first.number}–${last.number}`;
    const join = (field) => d.ayahs.map((a) => escapeHtml(a[field])).join(" ");
    return `<article class="dua card" data-index="${i}" data-reveal="flat">
      <div class="dua-head">
        <div>
          <a class="ref" href="quran.html?surah=${first.surah}#ayah-${first.number}">${escapeHtml(first.name)} ${ref}</a>
          ${d.by ? `<span class="dua-by muted small">${escapeHtml(d.by)}</span>` : ""}
        </div>
        <div class="ayah-actions">
          <button class="icon-btn small-btn" data-action="play" type="button" aria-label="Play recitation of ${ref}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
          </button>
          <button class="icon-btn small-btn" data-action="share" type="button" aria-label="Share ${ref} as an image" title="Share as image">${SHARE_ICON}</button>
          <button class="icon-btn small-btn" data-action="copy" type="button" aria-label="Copy ${ref}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
          </button>
        </div>
      </div>
      <p class="quran-text" lang="ar" dir="rtl">${d.ayahs.map((a) => `${escapeHtml(a.ar)} <span class="ayah-end">${arabicNumber(a.number)}</span>`).join(" ")}</p>
      <p class="translit dua-translit">${join("tl")}</p>
      <p class="translation tr-en">${join("en")}</p>
      <p class="translation tr-ur urdu" lang="ur" dir="rtl">${join("ur")}</p>
    </article>`;
  }).join("");
  reveal($("duas").children);
}

// ---------- Recitation ----------

const audio = new Audio();
const playing = { index: -1, part: 0 };

function playDua(index, part = 0) {
  const d = duaItems[index];
  playing.index = index;
  playing.part = part;
  audio.src = d.ayahs[part].audio;
  audio.play().catch(() => {
    toast("Couldn't play the recitation.");
    stopAudio();
  });
  renderAudio();
}

function stopAudio() {
  audio.pause();
  audio.removeAttribute("src");
  playing.index = -1;
  renderAudio();
}

function renderAudio() {
  document.querySelectorAll(".dua").forEach((el) => {
    const on = Number(el.dataset.index) === playing.index && !audio.paused;
    el.classList.toggle("playing", on);
    const btn = el.querySelector('[data-action="play"]');
    btn.innerHTML = on
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>`;
  });
}

audio.addEventListener("play", renderAudio);
audio.addEventListener("pause", renderAudio);
audio.addEventListener("ended", () => {
  const d = duaItems[playing.index];
  if (d && playing.part < d.ayahs.length - 1) playDua(playing.index, playing.part + 1);
  else stopAudio();
});

$("duas").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const index = Number(btn.closest(".dua").dataset.index);
  const d = duaItems[index];
  if (btn.dataset.action === "play") {
    if (playing.index === index && !audio.paused) audio.pause();
    else if (playing.index === index && audio.src) audio.play();
    else playDua(index);
  } else if (btn.dataset.action === "share") {
    const first = d.ayahs[0];
    const last = d.ayahs.at(-1);
    shareCard({
      label: "Dua from the Quran",
      ar: d.ayahs.map((a) => a.ar).join(" "),
      ...cardTranslation(d.ayahs.map((a) => a.en).join(" "), d.ayahs.map((a) => a.ur).join(" ")),
      ref: `${first.name} ${first.surah}:${first.number}${last !== first ? `–${last.number}` : ""}`,
    }).catch((err) => toast(`Couldn't create the image. ${err.message}`));
  } else {
    const { translation } = quranSettings();
    const first = d.ayahs[0];
    const parts = [d.ayahs.map((a) => a.ar).join(" "), d.ayahs.map((a) => a.tl).join(" ")];
    if (translation === "en" || translation === "both") parts.push(d.ayahs.map((a) => a.en).join(" "));
    if (translation === "ur" || translation === "both") parts.push(d.ayahs.map((a) => a.ur).join(" "));
    parts.push(`— Quran ${d.ref} (${first.name})`);
    await copyText(parts.join("\n\n"));
    toast("Dua copied.");
  }
});

$("dua-topics").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-topic]");
  if (btn) showTopic(DUA_TOPICS.find((t) => t.id === btn.dataset.topic));
});

// ---------- 99 Names ----------

let names = [];
const learned = () => new Set(readStore(LEARNED_KEY, []) || []);

async function loadNames() {
  const cached = readStore(NAMES_KEY, null);
  if (Array.isArray(cached) && cached.length === 99) return cached;
  const { data } = await getJSON(`${ALADHAN_API}/asmaAlHusna`);
  const list = data.map((n) => ({ n: n.number, ar: n.name, tl: n.transliteration, en: n.en.meaning }));
  writeStore(NAMES_KEY, list);
  return list;
}

function renderNames() {
  const q = $("names-filter").value.trim().toLowerCase();
  const done = learned();
  const shown = names.filter((x) => !q || String(x.n) === q || x.tl.toLowerCase().includes(q) || x.en.toLowerCase().includes(q));
  $("names").innerHTML = shown.length
    ? shown.map((x) => `<li>
      <button class="name-card card${done.has(x.n) ? " learned" : ""}" type="button" data-n="${x.n}" aria-pressed="${done.has(x.n)}">
        <span class="name-num">${x.n}</span>
        <span class="name-ar" lang="ar" dir="rtl">${escapeHtml(x.ar)}</span>
        <strong class="name-tl">${escapeHtml(x.tl)}</strong>
        <span class="name-en muted">${escapeHtml(x.en)}</span>
      </button>
    </li>`).join("")
    : `<li class="muted">No name matches “${escapeHtml($("names-filter").value)}”.</li>`;
  const columns = Math.max(1, getComputedStyle($("names")).gridTemplateColumns.split(" ").length);
  reveal($("names").children, (el, i) => i % columns);
  tilt($("names").querySelectorAll(".name-card"), 6);
  $("quiz-start").textContent = done.size ? `Practise the names · ${done.size} of 99 learned` : "Practise the names";
}

function toggleLearned(n) {
  const done = learned();
  if (done.has(n)) done.delete(n);
  else done.add(n);
  writeStore(LEARNED_KEY, [...done]);
  return done.has(n);
}

$("names").addEventListener("click", (e) => {
  const card = e.target.closest(".name-card");
  if (!card) return;
  const on = toggleLearned(Number(card.dataset.n));
  card.classList.toggle("learned", on);
  card.setAttribute("aria-pressed", String(on));
  replay(card, "pop");
  const count = learned().size;
  $("quiz-start").textContent = count ? `Practise the names · ${count} of 99 learned` : "Practise the names";
});

$("names-filter").addEventListener("input", renderNames);

// ---------- Practice ----------

const quiz = { current: null, right: 0, asked: 0 };
const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

function nextQuestion() {
  // Names not yet learned come up first
  const done = learned();
  const pool = names.filter((x) => !done.has(x.n));
  const from = pool.length ? pool : names;
  const current = from[Math.floor(Math.random() * from.length)];
  const wrong = shuffle(names.filter((x) => x.n !== current.n && x.en !== current.en)).slice(0, 3);
  quiz.current = current;
  $("quiz-name").textContent = current.ar;
  $("quiz-translit").textContent = current.tl;
  $("quiz-options").innerHTML = shuffle([current, ...wrong]).map((x) =>
    `<button class="quiz-option" type="button" data-n="${x.n}">${escapeHtml(x.en)}</button>`
  ).join("");
  $("quiz-next").hidden = true;
  renderScore();
  replay($("quiz-name"), "pop");
}

function renderScore() {
  $("quiz-score").textContent = quiz.asked ? `${quiz.right} of ${quiz.asked} correct` : "";
}

$("quiz-options").addEventListener("click", (e) => {
  const btn = e.target.closest(".quiz-option");
  if (!btn || $("quiz-options").classList.contains("answered")) return;
  const correct = Number(btn.dataset.n) === quiz.current.n;
  quiz.asked++;
  if (correct) {
    quiz.right++;
    if (!learned().has(quiz.current.n)) toggleLearned(quiz.current.n);
  }
  $("quiz-options").classList.add("answered");
  for (const option of $("quiz-options").children) {
    option.disabled = true;
    if (Number(option.dataset.n) === quiz.current.n) option.classList.add("right");
  }
  if (!correct) btn.classList.add("wrong");
  $("quiz-next").hidden = false;
  $("quiz-next").focus();
  renderScore();
  renderNames();
});

$("quiz-next").addEventListener("click", () => {
  $("quiz-options").classList.remove("answered");
  nextQuestion();
});

$("quiz-start").addEventListener("click", () => {
  if (!names.length) return;
  $("quiz").hidden = false;
  $("quiz-options").classList.remove("answered");
  nextQuestion();
  $("quiz").scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
});

$("quiz-close").addEventListener("click", () => {
  $("quiz").hidden = true;
});

// ---------- Tabs ----------

let namesLoaded = false;

async function showTab(tab) {
  const isNames = tab === "names";
  $("tab-duas").setAttribute("aria-selected", String(!isNames));
  $("tab-names").setAttribute("aria-selected", String(isNames));
  $("duas-view").hidden = isNames;
  $("names-view").hidden = !isNames;
  history.replaceState(null, "", isNames ? "duas.html#names" : "duas.html");
  if (isNames) stopAudio();
  if (!isNames || namesLoaded) return;
  namesLoaded = true;
  try {
    names = await loadNames();
    renderNames();
  } catch (err) {
    namesLoaded = false;
    $("names-error").textContent = `Couldn't load the names. ${err.message}`;
    $("names-error").hidden = false;
  }
}

$("tab-duas").addEventListener("click", () => showTab("duas"));
$("tab-names").addEventListener("click", () => showTab("names"));

renderTopics();
showTopic(topic);
showTab(location.hash === "#names" ? "names" : "duas");
addEventListener("hashchange", () => showTab(location.hash === "#names" ? "names" : "duas"));
