const BACKUP_APP = "tilawave";
const TUNE_LIMIT = 30;

// ---------- Prayer times ----------

function renderPrayerSettings() {
  const s = loadSettings();
  $("set-place").textContent = s.place?.label || `${DEFAULT_CITY.city}, ${DEFAULT_CITY.country} (default)`;
  $("set-method").value = s.method || "1";
  $("set-school").value = s.school || "1";
  const tune = s.tune || {};
  $("tune-list").innerHTML = TUNED.map((p) => {
    const n = Number(tune[p]) || 0;
    return `<li>
      <span class="tune-name">${p}</span>
      <div class="stepper" role="group" aria-label="${p} adjustment">
        <button class="icon-btn small-btn" type="button" data-tune="${p}" data-step="-1" aria-label="${p} one minute earlier" ${n <= -TUNE_LIMIT ? "disabled" : ""}>−</button>
        <output class="tune-value${n ? " changed" : ""}" aria-live="polite">${n > 0 ? "+" : ""}${n} min</output>
        <button class="icon-btn small-btn" type="button" data-tune="${p}" data-step="1" aria-label="${p} one minute later" ${n >= TUNE_LIMIT ? "disabled" : ""}>+</button>
      </div>
    </li>`;
  }).join("");
  $("tune-reset").hidden = !TUNED.some((p) => tune[p]);
}

$("set-method").addEventListener("change", () => saveSettings({ method: $("set-method").value }));
$("set-school").addEventListener("change", () => saveSettings({ school: $("set-school").value }));

$("tune-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tune]");
  if (!btn) return;
  const tune = { ...(loadSettings().tune || {}) };
  const p = btn.dataset.tune;
  tune[p] = Math.max(-TUNE_LIMIT, Math.min(TUNE_LIMIT, (Number(tune[p]) || 0) + Number(btn.dataset.step)));
  saveSettings({ tune });
  renderPrayerSettings();
  document.querySelector(`button[data-tune="${p}"][data-step="${btn.dataset.step}"]`)?.focus();
});

$("tune-reset").addEventListener("click", () => {
  saveSettings({ tune: {} });
  renderPrayerSettings();
  toast("Prayer times reset to the calculated times.");
});

// ---------- Hijri ----------

function renderHijri() {
  const adj = hijriAdjustment();
  $("hijri-adjust").innerHTML = [-2, -1, 0, 1, 2].map((n) =>
    `<button type="button" role="radio" data-adjust="${n}" aria-checked="${n === adj}" aria-selected="${n === adj}">${n > 0 ? "+" : ""}${n === 0 ? "None" : n}</button>`
  ).join("");
  const now = new Date();
  $("hijri-preview").textContent = hijriLabel(hijriFor(now.getFullYear(), now.getMonth() + 1, now.getDate()));
}

$("hijri-adjust").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-adjust]");
  if (!btn) return;
  saveSettings({ hijriAdjust: Number(btn.dataset.adjust) });
  renderHijri();
});

// ---------- Quran ----------

const fill = (select, map) => {
  select.innerHTML = Object.entries(map).map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join("");
};
fill($("set-en"), EN_TRANSLATIONS);
fill($("set-ur"), UR_TRANSLATIONS);
fill($("set-reciter"), RECITERS);

function renderQuranSettings() {
  const q = quranSettings();
  $("set-translation").value = q.translation;
  $("set-en").value = q.enEdition;
  $("set-ur").value = q.urEdition;
  $("set-reciter").value = q.reciter;
  $("set-script").value = q.script || "uthmani";
  $("set-translit").setAttribute("aria-checked", String(!!q.transliteration));
}

for (const [id, key] of [["set-translation", "translation"], ["set-en", "enEdition"], ["set-ur", "urEdition"], ["set-reciter", "reciter"], ["set-script", "script"]]) {
  $(id).addEventListener("change", () => saveQuranSettings({ [key]: $(id).value }));
}
$("set-translit").addEventListener("click", () => {
  saveQuranSettings({ transliteration: !quranSettings().transliteration });
  renderQuranSettings();
});

// ---------- Theme ----------

function renderThemeChoice() {
  const choice = document.documentElement.dataset.theme || "system";
  for (const btn of $("set-theme").children) {
    const on = btn.dataset.themeChoice === choice;
    btn.setAttribute("aria-checked", String(on));
    btn.setAttribute("aria-selected", String(on));
  }
}

$("set-theme").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-theme-choice]");
  if (!btn) return;
  const choice = btn.dataset.themeChoice;
  try {
    if (choice === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", choice);
  } catch {
    // Storage blocked: the theme still applies for this visit
  }
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  renderThemeButton();
  renderThemeChoice();
});
$("theme-btn").addEventListener("click", renderThemeChoice);

// ---------- Backup, restore, reset ----------

function storedData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    data[key] = localStorage.getItem(key);
  }
  return data;
}

function renderBackupSummary() {
  const log = readStore("prayer-log", {}) || {};
  const parts = [
    `${Object.keys(log).length} tracked days`,
    `${(readStore("quran-bookmarks", []) || []).length} bookmarks`,
    `${(readStore("quran-hifz", []) || []).length} memorised surahs`,
    `${(readStore("quran-khatam", {})?.completed || []).length} paras in your khatam`,
  ];
  $("backup-summary").textContent = parts.join(" · ");
}

$("export-btn").addEventListener("click", () => {
  const backup = { app: BACKUP_APP, version: 1, exported: new Date().toISOString(), data: storedData() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tilawave-backup-${localDateKey()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  toast("Backup saved to your downloads.");
});

$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    return toast("That file isn't a Tilawave backup.", 4000);
  }
  if (backup?.app !== BACKUP_APP || typeof backup.data !== "object" || !backup.data) {
    return toast("That file isn't a Tilawave backup.", 4000);
  }
  const date = new Date(backup.exported).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  if (!confirm(`Restore the backup from ${date}? This replaces the data on this device.`)) return;
  try {
    localStorage.clear();
    for (const [key, value] of Object.entries(backup.data)) {
      if (typeof value === "string") localStorage.setItem(key, value);
    }
  } catch {
    return toast("Couldn't restore: this browser is blocking storage.", 5000);
  }
  toast("Backup restored.");
  setTimeout(() => location.reload(), 700);
});

$("reset-btn").addEventListener("click", () => {
  if (!confirm("Delete all your Tilawave data on this device? Download a backup first if you might want it back.")) return;
  try {
    localStorage.clear();
  } catch {
    // Nothing to clear
  }
  toast("All data deleted.");
  setTimeout(() => location.reload(), 700);
});

// ---------- Start ----------

renderPrayerSettings();
renderHijri();
renderQuranSettings();
renderThemeChoice();
renderBackupSummary();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
