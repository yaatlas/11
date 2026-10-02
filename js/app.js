import { examples, products } from "./data.js";
import {
  compareProduct,
  daysLabel,
  explainDecision,
  explainProduct,
  formatShekel,
  intentNotes,
  interpret,
  noMatchMessage,
  productById,
  totalPrice,
} from "./engine.js";

const CONDITION = {
  new: "חדש",
  refurbished: "מחודש",
};

const MODES = [
  { id: "cheap", label: "הכי זול כולל משלוח" },
  { id: "fast", label: "הכי מהר" },
  { id: "balance", label: "איזון בין מחיר למהירות" },
];

const ICONS = {
  headphones: `
    <path d="M14 28v-5a10 10 0 0 1 20 0v5"/>
    <rect x="8" y="26" width="8" height="14" rx="3"/>
    <rect x="32" y="26" width="8" height="14" rx="3"/>
  `,
  bottle: `
    <path d="M20 8h8v5l4 5v18a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V18l4-5z"/>
    <path d="M20 20h8"/>
  `,
  shoe: `
    <path d="M8 30c6-1 10-8 14-8h6l8 4 4 2v4c0 4-6 8-14 8H14c-4 0-8-3-8-7z"/>
    <path d="M22 22c2-4 6-6 10-6"/>
  `,
  bricks: `
    <rect x="8" y="12" width="14" height="10" rx="1.5"/>
    <rect x="24" y="12" width="16" height="10" rx="1.5"/>
    <rect x="14" y="26" width="20" height="10" rx="1.5"/>
  `,
  mouse: `
    <rect x="14" y="8" width="20" height="30" rx="10"/>
    <path d="M24 8v12"/>
  `,
  battery: `
    <rect x="8" y="16" width="28" height="16" rx="3"/>
    <path d="M36 20h4v8h-4"/>
    <path d="M14 24h8"/>
  `,
  ball: `
    <circle cx="24" cy="24" r="14"/>
    <path d="M10 24h28"/>
    <path d="M24 10c5 6 5 22 0 28"/>
    <path d="M24 10c-5 6-5 22 0 28"/>
  `,
};

const state = {
  query: "",
  mode: "cheap",
  intent: null,
  matches: [],
  productId: null,
  searched: false,
};

const form = document.querySelector("#search-form");
const input = document.querySelector("#query");
const examplesRoot = document.querySelector("#examples");
const resultsRoot = document.querySelector("#results");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(input.value);
});

examples.forEach((example) => {
  examplesRoot.append(chip(example, () => {
    input.value = example;
    runSearch(example);
  }));
});

render();

function runSearch(raw) {
  const result = interpret(products, raw, state.mode);
  state.query = raw;
  state.intent = result;
  state.mode = result.mode;
  state.matches = result.matches;
  state.productId = result.matches[0]?.product.id ?? null;
  state.searched = true;
  input.value = raw;
  render();
  resultsRoot.scrollIntoView({ behavior: "smooth", block: "start" });
}

function activeIntent() {
  return { ...(state.intent ?? {}), mode: state.mode };
}

function selectProduct(id) {
  state.productId = id;
  render();
}

function render() {
  resultsRoot.replaceChildren();
  if (!state.searched) {
    resultsRoot.append(home());
    return;
  }
  resultsRoot.append(summary());
  if (!state.productId) {
    resultsRoot.append(empty("לא מצאתי מוצר כזה בקטלוג לדוגמה. כדאי לכתוב שם של מוצר, למשל אוזניות או בקבוק."));
    return;
  }
  const product = productById(products, state.productId);
  resultsRoot.append(productHero(product), modeSwitch(), offerSection(product), similarSection(product));
}

function home() {
  const wrap = el("section", { class: "home" }, [
    el("h2", {}, "אפשר להתחיל מכאן"),
    el("p", {}, "אפשר לכתוב משפט שלם: מה לחפש, כמה אפשר להוציא, ואם חשוב שיהיה חדש או שיגיע מהר."),
  ]);
  const grid = el("div", { class: "choice-grid" });
  for (const id of ["soundmini", "bottle750", "lego", "ball"]) {
    grid.append(productChoice(productById(products, id), () => runSearch(productById(products, id).name)));
  }
  wrap.append(grid);
  return wrap;
}

function summary() {
  const box = el("section", { class: "summary", role: "status" }, [
    el("p", { class: "eyebrow" }, "המנוע הבין כך"),
  ]);
  const notes = el("div", { class: "constraints" });
  for (const note of intentNotes(state.intent)) notes.append(el("span", { class: "constraint" }, note));
  box.append(notes);
  const product = productById(products, state.productId);
  const because = product ? explainProduct(product, state.matches, state.intent ?? {}) : "";
  if (because) box.append(el("p", { class: "because" }, because));
  const closeMatches = closeChoices(state.matches);
  if (closeMatches.length > 1) {
    box.append(el("p", { class: "chooser-label" }, "יש כמה מוצרים שמתאימים. זה המוצר?"));
    const row = el("div", { class: "chooser" });
    for (const match of closeMatches) {
      const selected = match.product.id === state.productId;
      row.append(chip(match.product.name, () => selectProduct(match.product.id), selected));
    }
    box.append(row);
  }
  return box;
}

function closeChoices(matches) {
  if (matches.length < 2) return matches;
  const top = matches[0].score;
  return matches.filter((match) => match.score >= top - 2).slice(0, 5);
}

function productHero(product) {
  return el("section", { class: "hero-product" }, [
    icon(product.icon, product.accent),
    el("div", {}, [
      el("p", { class: "eyebrow" }, product.category),
      el("h2", {}, product.name),
      el("p", {}, product.blurb),
    ]),
  ]);
}

function modeSwitch() {
  const group = el("div", { class: "modes", role: "radiogroup", "aria-label": "מיון ההצעות" });
  for (const mode of MODES) {
    const selected = state.mode === mode.id;
    const button = el("button", {
      type: "button",
      class: selected ? "mode is-selected" : "mode",
      role: "radio",
      "aria-checked": selected ? "true" : "false",
      onclick: () => {
        state.mode = mode.id;
        render();
      },
    }, mode.label);
    group.append(button);
  }
  return el("section", {}, [
    el("h3", {}, "מה חשוב בבחירה?"),
    group,
  ]);
}

function offerSection(product) {
  const intent = activeIntent();
  const comparison = compareProduct(product, intent);
  const section = el("section", {}, [
    el("h3", {}, "אותו מוצר, מוכרים שונים"),
  ]);
  if (!comparison.winner) section.append(empty(noMatchMessage(intent)));
  else if (intent.budget != null || intent.condition === "new" || intent.maxDays != null) {
    section.append(el("p", { class: "budget-note" }, `${comparison.ranked.length} הצעות עומדות במה שכתבת.`));
  }
  const list = el("div", { class: "offers" });
  comparison.ranked.forEach((offer, index) => list.append(offerCard(offer, index === 0)));
  if (comparison.ranked.length > 0) section.append(list);
  appendRejected(section, "מעל התקציב", comparison.overBudget.map((offer) => ({ offer, reason: "מעל התקציב שכתבת" })));
  appendRejected(section, "לא עומד בתנאים", comparison.excluded);
  return section;
}

function appendRejected(section, title, rows) {
  if (!rows || rows.length === 0) return;
  section.append(el("h3", { class: "over-title" }, title));
  const extra = el("div", { class: "offers" });
  for (const row of rows) extra.append(offerCard(row.offer, false, row.reason));
  section.append(extra);
}

function offerCard(offer, winner, rejectedReason = "") {
  const classes = ["offer"];
  if (winner) classes.push("is-winner");
  if (rejectedReason) classes.push("is-over");
  const card = el("article", { class: classes.join(" "), "data-store": offer.store });
  if (winner) card.dataset.winner = "true";
  const main = el("div", {}, [
    el("div", { class: "offer-top" }, [
      el("h4", {}, offer.store),
      el("span", { class: "pill" }, CONDITION[offer.condition] ?? offer.condition),
      el("span", { class: "rating" }, `${offer.rating.toFixed(1)} מתוך 5`),
    ]),
    el("p", { class: "shipping-line" }, shippingLine(offer)),
    el("p", { class: "detail" }, offer.detail),
  ]);
  if (winner) main.append(el("p", { class: "reason" }, explainDecision(offer, activeIntent())));
  if (rejectedReason) main.append(el("p", { class: "reason over-reason" }, rejectedReason));
  const price = el("div", { class: "price-block" }, [
    el("p", { class: "total" }, formatShekel(totalPrice(offer))),
    el("p", { class: "split" }, `מוצר ${formatShekel(offer.price)} · משלוח ${offer.shipping === 0 ? "חינם" : formatShekel(offer.shipping)}`),
  ]);
  card.append(main, price);
  return card;
}

function shippingLine(offer) {
  const shipping = offer.shipping === 0 ? "משלוח חינם" : `משלוח ${formatShekel(offer.shipping)}`;
  return `${shipping} · ${daysLabel(offer.days)}`;
}

function similarSection(product) {
  const related = product.similar.map((id) => productById(products, id)).filter(Boolean);
  if (related.length === 0) return el("section");
  const section = el("section", {}, [
    el("h3", {}, "אפשרויות דומות"),
    el("p", { class: "section-copy" }, "אלה לא אותו מוצר. אלה חלופות קרובות, עם המחיר הזול ביותר שלהן כולל משלוח."),
  ]);
  const grid = el("div", { class: "choice-grid" });
  for (const item of related) grid.append(productChoice(item, () => selectProduct(item.id)));
  section.append(grid);
  return section;
}

function productChoice(product, onClick) {
  const cheapest = compareProduct(product, "cheap", null).winner;
  const button = el("button", { type: "button", class: "choice", onclick: onClick }, [
    icon(product.icon, product.accent),
    el("span", { class: "choice-copy" }, [
      el("span", { class: "choice-name" }, product.name),
      el("span", { class: "choice-pitch" }, product.pitch),
      el("span", { class: "choice-price" }, `החל מ־${formatShekel(totalPrice(cheapest))}`),
    ]),
  ]);
  return button;
}

function empty(text) {
  return el("p", { class: "empty" }, text);
}

function chip(label, onClick, selected = false) {
  return el("button", {
    type: "button",
    class: selected ? "chip is-selected" : "chip",
    onclick: onClick,
  }, label);
}

function icon(name, accent) {
  const template = document.createElement("template");
  template.innerHTML = `<svg viewBox="0 0 48 48" class="icon" aria-hidden="true" style="color:${accent}">${ICONS[name] ?? ICONS.ball}</svg>`;
  const bubble = el("span", { class: "icon-bubble" });
  bubble.append(template.content.firstChild);
  return bubble;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "onclick") node.addEventListener("click", value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}
