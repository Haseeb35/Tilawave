const ZAKAT_KEY = "zakat";
const PRICES_KEY = "metal-prices";

const GRAMS_PER_TROY_OUNCE = 31.1034768;
const GRAMS_PER_TOLA = 11.664;
const NISAB_GRAMS = { gold: 87.48, silver: 612.36 };
const ZAKAT_RATE = 0.025;

// The currency API quotes one troy ounce of gold (xau) and silver (xag) in every currency.
const PRICE_SOURCES = [
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies",
  "https://latest.currency-api.pages.dev/v1/currencies",
];

const CURRENCIES = {
  pkr: "Pakistani rupee", inr: "Indian rupee", bdt: "Bangladeshi taka", usd: "US dollar",
  gbp: "British pound", eur: "Euro", cad: "Canadian dollar", aud: "Australian dollar",
  sar: "Saudi riyal", aed: "UAE dirham", qar: "Qatari riyal", kwd: "Kuwaiti dinar",
  myr: "Malaysian ringgit", idr: "Indonesian rupiah", try: "Turkish lira", egp: "Egyptian pound",
  zar: "South African rand", ngn: "Nigerian naira",
};

const ASSETS = ["cash", "bank", "owed", "shares", "stock", "other"];
const FIELDS = ["gold", "silver", ...ASSETS, "debts", "fitr-people", "fitr-rate"];

function loadZakat() {
  return {
    currency: "pkr",
    nisab: "silver",
    unit: "g",
    karat: 24,
    values: {},
    customPrices: null, // { gold, silver } per gram, when the user types their own
    ...readStore(ZAKAT_KEY, {}),
  };
}

const state = loadZakat();
const save = () => writeStore(ZAKAT_KEY, state);
let live = readStore(PRICES_KEY, null); // { date, currency, gold, silver } per gram

const money = (n) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: state.currency.toUpperCase(), maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${state.currency.toUpperCase()} ${Math.round(n).toLocaleString()}`;
  }
};
const num = (id) => Math.max(0, Number($(id).value) || 0);
const toGrams = (value) => (state.unit === "tola" ? value * GRAMS_PER_TOLA : value);

// ---------- Prices ----------

async function fetchMetal(metal) {
  let lastError;
  for (const base of PRICE_SOURCES) {
    try {
      return await getJSON(`${base}/${metal}.min.json`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function loadPrices() {
  $("price-source").textContent = "Fetching today's gold and silver prices…";
  try {
    const [gold, silver] = await Promise.all([fetchMetal("xau"), fetchMetal("xag")]);
    const cur = state.currency;
    if (!gold.xau[cur] || !silver.xag[cur]) throw new Error("No price for this currency.");
    live = {
      date: gold.date,
      currency: cur,
      gold: gold.xau[cur] / GRAMS_PER_TROY_OUNCE,
      silver: silver.xag[cur] / GRAMS_PER_TROY_OUNCE,
    };
    writeStore(PRICES_KEY, live);
  } catch (err) {
    if (live?.currency !== state.currency) live = null;
    toast(`Couldn't fetch live metal prices. ${live ? "Using the last saved prices." : "Enter prices under Metal prices."}`, 5000);
  }
  renderPrices();
  calculate();
}

function prices() {
  if (state.customPrices) return state.customPrices;
  return live?.currency === state.currency ? live : null;
}

function renderPrices() {
  const p = prices();
  const round = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 100) / 100);
  $("gold-price").value = p ? round(p.gold) : "";
  $("silver-price").value = p ? round(p.silver) : "";
  $("price-live").hidden = !state.customPrices;
  if (state.customPrices) {
    $("price-source").textContent = "Using the prices you entered.";
  } else if (live?.currency === state.currency) {
    const date = new Date(`${live.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    $("price-source").textContent = `International spot prices for ${date}. Local shop prices can differ; edit them if you like.`;
  } else {
    $("price-source").textContent = "Live prices aren't available. Enter today's prices to work out the nisab.";
  }
}

// ---------- Calculation ----------

function calculate() {
  const p = prices();
  const goldValue = p ? toGrams(num("gold")) * (state.karat / 24) * p.gold : 0;
  const silverValue = p ? toGrams(num("silver")) * p.silver : 0;
  const assets = goldValue + silverValue + ASSETS.reduce((sum, id) => sum + num(id), 0);
  const debts = num("debts");
  const net = Math.max(0, assets - debts);
  const nisab = p ? NISAB_GRAMS[state.nisab] * p[state.nisab] : null;
  const due = nisab != null && net >= nisab ? net * ZAKAT_RATE : 0;

  $("sum-assets").textContent = money(assets);
  $("sum-debts").textContent = debts ? `− ${money(debts)}` : money(0);
  $("sum-net").textContent = money(net);
  const grams = NISAB_GRAMS[state.nisab];
  $("nisab-label").textContent = `Nisab · ${state.unit === "tola" ? `${+(grams / GRAMS_PER_TOLA).toFixed(1)} tola` : `${grams} g`} ${state.nisab}`;
  $("sum-nisab").textContent = nisab != null ? money(nisab) : "Needs prices";
  $("zakat-due").textContent = money(due);
  $("nisab-bar").style.width = nisab ? `${Math.min(100, (net / nisab) * 100)}%` : "0%";
  $("nisab-bar").classList.toggle("reached", nisab != null && net >= nisab);

  const hasMetal = num("gold") || num("silver");
  $("zakat-status").textContent =
    nisab == null ? (hasMetal ? "Add gold and silver prices to value your metals." : "Add metal prices to work out the nisab.")
      : !net ? "Enter what you own to begin."
        : net >= nisab ? `Your wealth is above the nisab. Zakat is 2.5% of ${money(net)}.`
          : `Below the nisab by ${money(nisab - net)}. No zakat is due.`;

  const fitr = Math.round(num("fitr-people")) * num("fitr-rate");
  $("fitr-total").textContent = money(fitr);
}

function renderSettings() {
  $("currency").value = state.currency;
  $("karat").value = String(state.karat);
  for (const [id, on] of [["nisab-silver", state.nisab === "silver"], ["nisab-gold", state.nisab === "gold"], ["unit-g", state.unit === "g"], ["unit-tola", state.unit === "tola"]]) {
    $(id).setAttribute("aria-checked", String(on));
    $(id).setAttribute("aria-selected", String(on));
  }
  document.querySelectorAll("[data-unit]").forEach((el) => (el.textContent = state.unit === "tola" ? "tola" : "g"));
  document.querySelectorAll("[data-currency]").forEach((el) => (el.textContent = state.currency.toUpperCase()));
}

// ---------- Events ----------

$("currency").innerHTML = Object.entries(CURRENCIES)
  .map(([code, name]) => `<option value="${code}">${code.toUpperCase()} · ${name}</option>`).join("");

for (const id of FIELDS) {
  $(id).value = state.values[id] ?? "";
  $(id).addEventListener("input", () => {
    state.values[id] = $(id).value;
    save();
    calculate();
  });
}

$("currency").addEventListener("change", () => {
  state.currency = $("currency").value;
  state.customPrices = null;
  save();
  renderSettings();
  loadPrices();
});

$("karat").addEventListener("change", () => {
  state.karat = Number($("karat").value);
  save();
  calculate();
});

const choose = (key, value) => () => {
  state[key] = value;
  save();
  renderSettings();
  calculate();
};
$("nisab-silver").addEventListener("click", choose("nisab", "silver"));
$("nisab-gold").addEventListener("click", choose("nisab", "gold"));
$("unit-g").addEventListener("click", choose("unit", "g"));
$("unit-tola").addEventListener("click", choose("unit", "tola"));

for (const id of ["gold-price", "silver-price"]) {
  $(id).addEventListener("input", () => {
    const gold = Number($("gold-price").value);
    const silver = Number($("silver-price").value);
    state.customPrices = gold > 0 && silver > 0 ? { gold, silver } : null;
    save();
    $("price-live").hidden = !state.customPrices;
    $("price-source").textContent = state.customPrices ? "Using the prices you entered." : "Enter both prices to use them.";
    calculate();
  });
}

$("price-live").addEventListener("click", () => {
  state.customPrices = null;
  save();
  loadPrices();
});

$("zakat-reset").addEventListener("click", () => {
  for (const id of FIELDS) $(id).value = "";
  state.values = {};
  save();
  calculate();
  toast("Cleared.");
});

$("zakat-form").addEventListener("submit", (e) => e.preventDefault());

renderSettings();
renderPrices();
calculate();
loadPrices();
