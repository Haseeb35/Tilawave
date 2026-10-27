const HADITH_SETTINGS_KEY = "hadith-settings";
const PAGE_SIZE = 40;

// English titles as commonly written, and the collections' Arabic titles
const COLLECTION_TITLES = {
  bukhari: { en: "Sahih al-Bukhari", ar: "صحيح البخاري", by: "Imam Muhammad al-Bukhari" },
  muslim: { en: "Sahih Muslim", ar: "صحيح مسلم", by: "Imam Muslim ibn al-Hajjaj" },
  abudawud: { en: "Sunan Abu Dawud", ar: "سنن أبي داود", by: "Imam Abu Dawud as-Sijistani" },
  tirmidhi: { en: "Jami' at-Tirmidhi", ar: "جامع الترمذي", by: "Imam Muhammad at-Tirmidhi" },
  nasai: { en: "Sunan an-Nasa'i", ar: "سنن النسائي", by: "Imam Ahmad an-Nasa'i" },
  ibnmajah: { en: "Sunan Ibn Majah", ar: "سنن ابن ماجه", by: "Imam Muhammad ibn Majah" },
  malik: { en: "Muwatta Imam Malik", ar: "موطأ الإمام مالك", by: "Imam Malik ibn Anas" },
  nawawi: { en: "Forty Hadith of an-Nawawi", ar: "الأربعون النووية", by: "Imam Yahya an-Nawawi" },
  qudsi: { en: "Forty Hadith Qudsi", ar: "الأحاديث القدسية", by: "Sayings of Allah conveyed by the Prophet ﷺ" },
  dehlawi: { en: "Forty Hadith of Shah Waliullah", ar: "أربعون حديثا", by: "Shah Waliullah Dehlawi" },
};
const LANG_NAMES = { eng: "English", urd: "Urdu", ara: "Arabic only" };

const hadithSettings = () => ({ lang: null, arabic: false, ...readStore(HADITH_SETTINGS_KEY, {}) });
const saveHadithSettings = (update) => writeStore(HADITH_SETTINGS_KEY, { ...hadithSettings(), ...update });

const title = (c) => COLLECTION_TITLES[c.id]?.en || c.name;
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
// Collections are cited by hadith number, so the highest number is the familiar count
const hadithCount = (c) => c.last;

function showError(message) {
  $("hadith-error").textContent = message;
  $("hadith-error").hidden = false;
}

async function getCollections() {
  return getJSON("data/hadith-books.json");
}

// ---------- All collections ----------

function renderCollections(collections) {
  $("collections-view").hidden = false;
  $("collections").innerHTML = collections.map((c) => {
    const t = COLLECTION_TITLES[c.id] || {};
    return `<li>
      <a class="collection-card card" href="hadith.html?c=${c.id}">
        <span class="collection-ar" lang="ar" dir="rtl">${escapeHtml(t.ar || "")}</span>
        <strong>${escapeHtml(title(c))}</strong>
        <span class="muted small">${withHonorific(t.by || "")}</span>
        <span class="collection-stats">
          <span>${plural(hadithCount(c), "hadith")}</span>
          <span>${plural(c.books.length, "book")}</span>
          <span>${c.langs.map((l) => LANG_NAMES[l].replace(" only", "")).join(" · ")}</span>
        </span>
      </a>
    </li>`;
  }).join("");
  const list = $("collections");
  const columns = Math.max(1, getComputedStyle(list).gridTemplateColumns.split(" ").length);
  reveal(list.children, (el, i) => i % columns);
  tilt(list.querySelectorAll(".collection-card"), 5);
}

// ---------- One collection ----------

function renderBooks(c, filter = "") {
  const q = filter.trim().toLowerCase();
  const shown = c.books.filter(([n, name]) => !q || name.toLowerCase().includes(q) || String(n) === q);
  $("books").innerHTML = shown.length
    ? shown.map(([n, name, first, last]) => `
      <li>
        <a class="book-row" href="hadith.html?c=${c.id}&b=${n}">
          <span class="book-num">${n}</span>
          <span class="book-name">${escapeHtml(name)}</span>
          <span class="book-range muted">${first === last ? first : `${first}–${last}`}</span>
        </a>
      </li>`).join("")
    : `<li class="muted book-empty">No book matches “${escapeHtml(filter)}”.</li>`;
}

function openCollection(c) {
  const t = COLLECTION_TITLES[c.id] || {};
  document.title = `${title(c)} — Hadith — Tilawave`;
  $("page-title").textContent = title(c);
  $("books-view").hidden = false;
  $("collection-ar").textContent = t.ar || "";
  $("collection-title").textContent = "Books";
  $("collection-meta").textContent = `${plural(hadithCount(c), "hadith")} in ${plural(c.books.length, "book")}`;
  $("jump-n").max = c.last;
  renderBooks(c);
  $("book-filter").addEventListener("input", () => renderBooks(c, $("book-filter").value));
  $("jump-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = Number($("jump-n").value);
    const book = c.books.find(([, , first, last]) => n >= first && n <= last);
    if (!book) return toast(`${title(c)} has no hadith number ${n}.`);
    location.href = `hadith.html?c=${c.id}&b=${book[0]}#h-${n}`;
  });
}

// ---------- One book ----------

const book = { collection: null, info: null, hadiths: [], shown: [], limit: PAGE_SIZE };

// Fetch the chosen language (and Arabic alongside it when asked) and join them by number.
async function loadBook() {
  const { collection: c, info } = book;
  const { lang, arabic } = currentLang();
  const wantArabic = arabic && lang !== "ara";
  const [main, ar] = await Promise.all([
    getHadithJSON(`${lang}-${c.id}/sections/${info[0]}`),
    wantArabic ? getHadithJSON(`ara-${c.id}/sections/${info[0]}`) : null,
  ]);
  // Where a translation is missing, show the Arabic original instead of nothing
  const missing = lang !== "ara" && !ar && main.hadiths.some((h) => !h.text?.trim());
  const original = missing ? await getHadithJSON(`ara-${c.id}/sections/${info[0]}`).catch(() => null) : ar;
  const arabicByNumber = new Map((original?.hadiths || [])
    .filter((h) => wantArabic || !main.hadiths.find((m) => m.hadithnumber === h.hadithnumber)?.text?.trim())
    .map((h) => [h.hadithnumber, h.text]));
  const all = main.hadiths.map((h) => ({
    n: h.hadithnumber,
    ref: h.reference,
    text: (h.text || "").trim(),
    ar: arabicByNumber.get(h.hadithnumber)?.trim() || "",
    grades: h.grades || [],
  }));
  // A few source entries are empty in every language; there is nothing to show for them.
  book.hadiths = all.filter((h) => h.text || h.ar);
  book.empty = all.length - book.hadiths.length;
}

function currentLang() {
  const s = hadithSettings();
  const langs = book.collection.langs;
  const fallback = quranSettings().translation === "ur" && langs.includes("urd") ? "urd" : "eng";
  return { lang: langs.includes(s.lang) ? s.lang : fallback, arabic: s.arabic };
}

function hadithHtml(h) {
  const { lang } = currentLang();
  const rtl = lang !== "eng";
  const textClass = lang === "urd" ? "hadith-text urdu" : lang === "ara" ? "hadith-text hadith-arabic" : "hadith-text";
  const grades = h.grades.filter((g) => g.grade).map((g) => `<span>${escapeHtml(g.grade)}<span class="muted"> · ${escapeHtml(g.name)}</span></span>`);
  const ref = h.ref ? `Book ${h.ref.book}, Hadith ${h.ref.hadith}` : "";
  return `<li class="hadith-item card" id="h-${h.n}" data-n="${h.n}">
    <div class="hadith-item-head">
      <span class="hadith-num">Hadith ${h.n}</span>
      <span class="muted small">${ref}</span>
      <span class="hadith-actions">
        <button class="icon-btn small-btn" data-action="copy" type="button" aria-label="Copy hadith ${h.n}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
        </button>
        <button class="icon-btn small-btn" data-action="share" type="button" aria-label="Share hadith ${h.n} as an image" title="Share as image">${SHARE_ICON}</button>
        <button class="icon-btn small-btn" data-action="link" type="button" aria-label="Copy link to hadith ${h.n}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></svg>
        </button>
      </span>
    </div>
    ${h.ar ? `<p class="hadith-arabic" lang="ar" dir="rtl">${escapeHtml(h.ar)}</p>` : ""}
    ${h.text
      ? `<p class="${textClass}"${rtl ? ` lang="${lang === "urd" ? "ur" : "ar"}" dir="rtl"` : ""}>${withHonorific(h.text)}</p>`
      : `<p class="muted small">${h.ar ? `No ${LANG_NAMES[lang]} translation in this edition; the Arabic original is shown.` : `This hadith has no ${LANG_NAMES[lang]} text in this edition.`}</p>`}
    ${grades.length ? `<p class="grades"><span class="eyebrow">Grade</span>${grades.join("")}</p>` : ""}
  </li>`;
}

function renderHadiths() {
  const q = $("hadith-filter").value.trim().toLowerCase();
  book.shown = q
    ? book.hadiths.filter((h) => String(h.n) === q || h.text.toLowerCase().includes(q) || h.ar.includes(q))
    : book.hadiths;
  $("hadith-count").textContent = q
    ? `${plural(book.shown.length, "hadith")} found for “${$("hadith-filter").value.trim()}”`
    : plural(book.hadiths.length, "hadith") +
      (book.empty ? ` · ${plural(book.empty, "numbered entry")} with no text in the source edition ${book.empty === 1 ? "is" : "are"} left out` : "");
  // Show a small remainder too, rather than a "Show more" for two hadiths
  if (book.shown.length - book.limit <= 10) book.limit = book.shown.length;
  const visible = book.shown.slice(0, book.limit);
  $("hadiths").innerHTML = visible.length
    ? visible.map(hadithHtml).join("")
    : `<li class="muted loading-text">No hadith in this book matches your search.</li>`;
  $("more-hadiths").hidden = book.shown.length <= book.limit;
  $("more-hadiths").textContent = `Show more (${(book.shown.length - book.limit).toLocaleString()} left)`;
}

async function refreshBook() {
  document.body.classList.add("loading");
  try {
    await loadBook();
    renderHadiths();
  } catch (err) {
    $("hadiths").innerHTML = `<li class="error">Couldn't load this book. ${escapeHtml(err.message)}</li>`;
  } finally {
    document.body.classList.remove("loading");
  }
}

async function openBook(c, n) {
  const index = c.books.findIndex(([id]) => id === n);
  const info = c.books[index];
  if (!info) return showError("That book doesn't exist in this collection.");
  Object.assign(book, { collection: c, info });

  document.title = `${info[1]} — ${title(c)} — Tilawave`;
  $("page-title").textContent = title(c);
  $("book-view").hidden = false;
  const single = c.books.length === 1;
  $("book-back").href = single ? "hadith.html" : `hadith.html?c=${c.id}`;
  $("book-back").textContent = single ? "All collections" : `All books of ${title(c)}`;
  $("book-eyebrow").textContent = c.books.length > 1 ? `Book ${n}` : "";
  $("book-title").textContent = info[1];
  $("book-meta").textContent = info[2] === info[3] ? `Hadith ${info[2]}` : `Hadith ${info[2]} to ${info[3]}`;

  const { lang, arabic } = currentLang();
  $("hadith-lang").innerHTML = c.langs.map((l) => `<option value="${l}">${LANG_NAMES[l]}</option>`).join("");
  $("hadith-lang").value = lang;
  $("arabic-btn").setAttribute("aria-pressed", String(arabic));
  $("arabic-btn").hidden = lang === "ara";

  const prev = c.books[index - 1];
  const next = c.books[index + 1];
  for (const [id, b, label] of [["prev-book", prev, (x) => `← ${x[1]}`], ["next-book", next, (x) => `${x[1]} →`]]) {
    $(id).hidden = !b;
    if (b) {
      $(id).href = `hadith.html?c=${c.id}&b=${b[0]}`;
      $(id).textContent = label(b);
    }
  }

  await refreshBook();
  openHashTarget();
}

// Links to a single hadith (#h-123) show enough of the list to reach it.
function openHashTarget() {
  const m = location.hash.match(/^#h-(\d+)$/);
  if (!m) return;
  const at = book.shown.findIndex((h) => h.n === Number(m[1]));
  if (at < 0) return;
  if (at >= book.limit) {
    book.limit = at + PAGE_SIZE;
    renderHadiths();
  }
  const el = document.getElementById(`h-${m[1]}`);
  $("book-view").classList.add("is-visible");
  el.scrollIntoView({ block: "start" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 2500);
}

$("hadith-lang").addEventListener("change", () => {
  saveHadithSettings({ lang: $("hadith-lang").value });
  $("arabic-btn").hidden = $("hadith-lang").value === "ara";
  refreshBook();
});

$("arabic-btn").addEventListener("click", () => {
  const arabic = !currentLang().arabic;
  saveHadithSettings({ arabic });
  $("arabic-btn").setAttribute("aria-pressed", String(arabic));
  refreshBook();
});

let filterTimer = 0;
$("hadith-filter").addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    book.limit = PAGE_SIZE;
    renderHadiths();
  }, 150);
});

$("print-book").addEventListener("click", () => {
  if (book.shown.length > book.limit) toast("Only the hadiths shown on the page are printed. Use Show more to include the rest.", 5000);
  setTimeout(() => window.print(), book.shown.length > book.limit ? 600 : 0);
});

$("more-hadiths").addEventListener("click", () => {
  book.limit += PAGE_SIZE;
  renderHadiths();
});

$("hadiths").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const n = Number(btn.closest(".hadith-item").dataset.n);
  const h = book.hadiths.find((x) => x.n === n);
  const source = `${title(book.collection)}, Hadith ${n}`;
  if (btn.dataset.action === "share") {
    const { lang } = currentLang();
    shareCard({
      label: title(book.collection),
      ar: lang === "ara" ? h.text : h.ar,
      text: lang === "ara" ? "" : h.text,
      textRtl: lang === "urd",
      ref: `${title(book.collection)} ${n}`,
    }).catch((err) => toast(`Couldn't create the image. ${err.message}`));
  } else if (btn.dataset.action === "copy") {
    await copyText([h.ar, h.text, `— ${source}`].filter(Boolean).join("\n\n"));
    toast("Hadith copied.");
  } else {
    await copyText(`${location.origin}${location.pathname}?c=${book.collection.id}&b=${book.info[0]}#h-${n}`);
    toast("Link copied.");
  }
});

// ---------- Start ----------

(async () => {
  const params = new URLSearchParams(location.search);
  try {
    const collections = await getCollections();
    const c = collections.find((x) => x.id === params.get("c"));
    if (!c) return renderCollections(collections);
    // A hadith by number (from quick search): open the book that contains it
    if (params.has("n")) {
      const n = Number(params.get("n"));
      const found = c.books.find(([, , first, last]) => n >= first && n <= last);
      if (found) return location.replace(`hadith.html?c=${c.id}&b=${found[0]}#h-${n}`);
      toast(`${title(c)} has no hadith number ${n}.`);
    }
    document.querySelector(".hadith-page").classList.add("inner");
    // The forty-hadith collections have a single book: open it directly.
    if (params.has("b") || c.books.length === 1) return openBook(c, params.has("b") ? Number(params.get("b")) : c.books[0][0]);
    openCollection(c);
  } catch (err) {
    showError(`Couldn't load the hadith library. ${err.message}`);
  }
})();
