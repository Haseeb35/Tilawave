const TASBIH_KEY = "tasbih";

const DHIKR = [
  { ar: "سُبْحَانَ اللَّهِ", tr: "SubhanAllah", en: "Glory be to Allah", ur: "اللہ پاک ہے" },
  { ar: "الْحَمْدُ لِلَّهِ", tr: "Alhamdulillah", en: "All praise is for Allah", ur: "سب تعریفیں اللہ کے لیے ہیں" },
  { ar: "اللَّهُ أَكْبَرُ", tr: "Allahu Akbar", en: "Allah is the Greatest", ur: "اللہ سب سے بڑا ہے" },
  { ar: "لَا إِلَٰهَ إِلَّا اللَّهُ", tr: "La ilaha illallah", en: "There is no god but Allah", ur: "اللہ کے سوا کوئی معبود نہیں" },
  { ar: "أَسْتَغْفِرُ اللَّهَ", tr: "Astaghfirullah", en: "I seek Allah's forgiveness", ur: "میں اللہ سے معافی مانگتا ہوں" },
];

// After-prayer sequence: 33 + 33 + 34 = 100
const SEQUENCE = [
  { phrase: 0, target: 33 },
  { phrase: 1, target: 33 },
  { phrase: 2, target: 34 },
];

const RING = 2 * Math.PI * 90;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadState() {
  const s = {
    mode: "prayer",
    step: 0,        // index into SEQUENCE
    count: 0,       // count within the current step / round
    phrase: 0,      // free mode
    target: 33,     // free mode; 0 = no limit
    rounds: 0,      // free mode: completed rounds
    history: [],    // previous states for Undo
    today: { date: todayKey(), count: 0 },
    total: 0,
    ...readStore(TASBIH_KEY, {}),
  };
  if (s.today.date !== todayKey()) s.today = { date: todayKey(), count: 0 };
  return s;
}

let state = loadState();
const save = () => writeStore(TASBIH_KEY, state);

const current = () =>
  state.mode === "prayer"
    ? { phrase: SEQUENCE[state.step].phrase, target: SEQUENCE[state.step].target }
    : { phrase: state.phrase, target: state.target };

const sequenceDone = () => state.mode === "prayer" && state.step === SEQUENCE.length - 1 && state.count >= SEQUENCE.at(-1).target;

// ---------- Rendering ----------

function render() {
  const { phrase, target } = current();
  const d = DHIKR[phrase];
  $("dhikr-ar").textContent = d.ar;
  $("dhikr-tr").textContent = d.tr;
  $("dhikr-en").textContent = d.en;
  $("dhikr-ur").textContent = d.ur;

  $("count").textContent = state.count;
  $("count-of").textContent =
    target ? `of ${target}` + (state.mode === "free" && state.rounds ? ` · round ${state.rounds + 1}` : "") : "";
  const progress = target ? Math.min(1, state.count / target) : 0;
  $("counter-ring").style.strokeDasharray = RING;
  $("counter-ring").style.strokeDashoffset = RING * (1 - progress);

  const prayer = state.mode === "prayer";
  $("mode-prayer").setAttribute("aria-selected", String(prayer));
  $("mode-free").setAttribute("aria-selected", String(!prayer));
  $("free-controls").hidden = prayer;
  $("phrase").value = state.phrase;
  $("target").value = state.target;

  $("steps").hidden = !prayer;
  $("steps").innerHTML = SEQUENCE.map((s, i) => {
    const cls = i < state.step || (i === state.step && sequenceDone()) ? "done" : i === state.step ? "current" : "";
    return `<li class="${cls}">${DHIKR[s.phrase].tr} <span class="muted">${s.target}</span></li>`;
  }).join("");
  $("complete").hidden = !sequenceDone();
  $("counter").classList.toggle("finished", sequenceDone());

  $("undo").disabled = state.history.length === 0;
  $("stat-today").textContent = state.today.count.toLocaleString();
  $("stat-total").textContent = state.total.toLocaleString();
}

// ---------- Counting ----------

function snapshot() {
  const { history, today, total, ...rest } = state;
  state.history = [...history.slice(-99), rest];
}

function count() {
  if (sequenceDone()) return;
  if (state.today.date !== todayKey()) state.today = { date: todayKey(), count: 0 };
  snapshot();
  state.count++;
  state.today.count++;
  state.total++;

  const { target } = current();
  let milestone = false;
  if (target && state.count >= target) {
    milestone = true;
    if (state.mode === "prayer") {
      if (state.step < SEQUENCE.length - 1) {
        state.step++;
        state.count = 0;
      }
    } else {
      state.rounds++;
      state.count = 0;
      toast(`${DHIKR[state.phrase].tr} × ${target} complete.`);
    }
  }
  navigator.vibrate?.(milestone ? [60, 60, 120] : 12);
  $("counter").classList.remove("pulse");
  void $("counter").offsetWidth; // restart the animation
  $("counter").classList.add("pulse");
  save();
  render();
}

function undo() {
  const prev = state.history.pop();
  if (!prev) return;
  Object.assign(state, prev);
  state.today.count = Math.max(0, state.today.count - 1);
  state.total = Math.max(0, state.total - 1);
  save();
  render();
}

function reset() {
  Object.assign(state, { step: 0, count: 0, rounds: 0, history: [] });
  save();
  render();
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  reset();
}

// ---------- Events ----------

$("phrase").innerHTML = DHIKR.map((d, i) => `<option value="${i}">${d.tr}</option>`).join("");

$("counter").addEventListener("click", count);
$("undo").addEventListener("click", undo);
$("reset").addEventListener("click", reset);
$("mode-prayer").addEventListener("click", () => setMode("prayer"));
$("mode-free").addEventListener("click", () => setMode("free"));
$("phrase").addEventListener("change", () => {
  state.phrase = Number($("phrase").value);
  reset();
});
$("target").addEventListener("change", () => {
  state.target = Number($("target").value);
  reset();
});

// Space or Enter anywhere counts (except when using a form control,
// and the counter button already handles its own key presses).
document.addEventListener("keydown", (e) => {
  if (e.key !== " " && e.key !== "Enter") return;
  if (e.target.closest("button, select, input, a")) return;
  e.preventDefault();
  count();
});

render();
