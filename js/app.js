import { productArt, storeArt } from "./art.js";
import { buildSpec, collect, describeSpec, filterChoices, storeById } from "./collector.js";
import { examples, products } from "./data.js";
import { daysLabel, explainDecision, explainProduct, formatShekel, noMatchMessage, totalPrice } from "./engine.js";

const CONDITION = { new: "חדש", used: "משומש" };
const choices = filterChoices();
const thread = document.querySelector("#thread");
const filtersRoot = document.querySelector("#filters");
const form = document.querySelector("#composer");
const input = document.querySelector("#query");
const pending = document.querySelector("#pending");
const photo = document.querySelector("#photo");
const micBtn = document.querySelector("#mic-btn");

const state = {
  messages: [],
  mode: "cheap",
  pendingImage: null,
  openReviews: new Set(),
};

const welcome = {
  role: "assistant",
  kind: "welcome",
  text: "אפשר לכתוב משפט, לבחור מסננים, להקליט, או להעלות תמונה. אני אחפש גם בחנויות וגם באתרים, ואראה דירוג וביקורות. המחירים והביקורות כאן לדוגמה.",
};

renderFilters();
renderThread();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(input.value.trim());
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit(input.value.trim());
  }
});

document.querySelector("#photo-btn").addEventListener("click", () => photo.click());
photo.addEventListener("change", () => {
  const file = photo.files?.[0];
  photo.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.pendingImage = String(reader.result);
    renderPending();
  };
  reader.readAsDataURL(file);
});

micBtn.addEventListener("click", toggleMic);

function submit(text) {
  const image = state.pendingImage;
  if (!text && !image) return;
  state.messages.push({ role: "user", text, image });
  state.pendingImage = null;
  input.value = "";
  renderPending();
  if (!text) {
    state.messages.push({
      role: "assistant",
      kind: "photo",
      text: "קיבלתי את התמונה. אין עדיין זיהוי תמונה אוטומטי, אז כתוב מה רואים בה או בחר מוצר קרוב.",
    });
  } else {
    answer(text);
  }
  renderThread();
}

function answer(text) {
  const spec = buildSpec(text, readFilters(), state.mode);
  state.mode = spec.mode;
  state.messages.push({ role: "assistant", kind: "results", spec, result: collect(spec) });
}

function rerun(modeOverride = null) {
  const user = [...state.messages].reverse().find((message) => message.role === "user" && message.text);
  if (!user) return;
  const resultIndex = state.messages.findLastIndex((message) => message.kind === "results");
  const spec = buildSpec(user.text, readFilters(), state.mode, modeOverride);
  state.mode = spec.mode;
  const next = { role: "assistant", kind: "results", spec, result: collect(spec) };
  if (resultIndex >= 0) state.messages[resultIndex] = next;
  else state.messages.push(next);
  renderThread();
}

function renderFilters() {
  filtersRoot.replaceChildren(
    el("h2", {}, "סינון"),
    selectField("category", "קטגוריה", ["all", ...choices.categories], { all: "הכול" }),
    selectField("channel", "איפה קונים", ["all", "online", "store"], { all: "חנות ואתר", online: "רק אתר", store: "רק חנות" }),
    selectField("condition", "מצב", ["all", "new", "used"], { all: "הכול", new: "חדש", used: "משומש" }),
    selectField("brand", "מותג", ["all", ...choices.brands], { all: "הכול" }),
    selectField("color", "צבע", ["all", ...choices.colors], { all: "הכול" }),
    selectField("sizeLabel", "מידה", ["all", ...choices.sizes], { all: "הכול" }),
  );
  const prices = el("div", { class: "field" }, [el("span", {}, "טווח מחיר, כולל משלוח")]);
  const row = el("div", { class: "price-row" });
  row.append(numberField("priceMin", "מ־"), numberField("priceMax", "עד"));
  prices.append(row);
  filtersRoot.append(prices);
  filtersRoot.append(el("button", { id: "reset", type: "button", onclick: resetFilters }, "נקה סינון"));
}

function selectField(name, label, values, labels) {
  const field = el("label", { class: "field" }, [el("span", {}, label)]);
  const select = el("select", { name });
  for (const value of values) {
    select.append(el("option", { value }, labels[value] ?? value));
  }
  select.addEventListener("change", () => rerun());
  field.append(select);
  return field;
}

function numberField(name, placeholder) {
  const input = el("input", { type: "number", name, min: "0", placeholder, "aria-label": placeholder });
  input.addEventListener("change", () => rerun());
  return input;
}

function readFilters() {
  const data = {};
  for (const field of filtersRoot.querySelectorAll("[name]")) data[field.name] = field.value;
  return data;
}

function resetFilters() {
  for (const field of filtersRoot.querySelectorAll("select")) field.value = "all";
  for (const field of filtersRoot.querySelectorAll("input")) field.value = "";
  rerun();
}

function renderPending() {
  pending.hidden = !state.pendingImage;
  pending.replaceChildren();
  if (!state.pendingImage) return;
  const image = el("img", { alt: "תמונה שנבחרה" });
  image.src = state.pendingImage;
  pending.append(image, el("button", { type: "button", onclick: () => { state.pendingImage = null; renderPending(); } }, "הסר תמונה"));
}

function renderThread() {
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  thread.replaceChildren();
  thread.append(renderMessage(welcome));
  state.messages.forEach((message, index) => thread.append(renderMessage(message, index)));
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}

function renderMessage(message, index = -1) {
  if (message.kind === "welcome") return welcomeBubble();
  if (message.role === "user") return userBubble(message);
  if (message.kind === "photo") return photoHelp(message.text);
  if (message.kind === "note") return el("article", { class: "bubble assistant" }, [el("p", {}, message.text)]);
  return resultsBubble(message, index);
}

function welcomeBubble() {
  const box = el("article", { class: "bubble assistant" }, [el("p", {}, welcome.text)]);
  const row = el("div", { class: "chips" });
  for (const example of examples) row.append(el("button", { type: "button", class: "chip", onclick: () => submit(example) }, example));
  box.append(row);
  return box;
}

function userBubble(message) {
  const box = el("article", { class: "bubble user" });
  if (message.text) box.append(el("p", {}, message.text));
  if (message.image) {
    const image = el("img", { class: "user-photo", alt: "תמונה שנשלחה" });
    image.src = message.image;
    box.append(image);
  }
  return box;
}

function photoHelp(text) {
  const box = el("article", { class: "bubble assistant" }, [el("p", {}, text)]);
  const row = el("div", { class: "chips" });
  for (const product of products.slice(0, 6)) {
    row.append(el("button", { type: "button", class: "chip", onclick: () => submit(product.name) }, product.name));
  }
  box.append(row);
  return box;
}

function resultsBubble(message) {
  const { spec, result } = message;
  const box = el("article", { class: "bubble assistant" }, [
    el("p", { class: "hint" }, "הבנתי כך"),
  ]);
  const notes = el("div", { class: "constraints" });
  for (const note of describeSpec(spec)) notes.append(el("span", { class: "constraint" }, note));
  box.append(notes, modeSwitch(spec.mode));
  const topScore = result.rows[0]?.score ?? 0;
  const shown = result.rows.filter((row, index) => index === 0 || row.score >= topScore - 2).slice(0, 2);
  if (shown.length === 0) {
    box.append(el("p", { class: "empty" }, "לא מצאתי מוצר שמתאים למשפט ולמסננים."));
  }
  shown.forEach((row, rowIndex) => box.append(productBlock(row, spec, rowIndex === 0, shown)));
  box.append(el("p", { class: "source-line" }, sourceLine(result)));
  return box;
}

function modeSwitch(active) {
  const group = el("div", { class: "modes", role: "radiogroup", "aria-label": "מיון" });
  for (const mode of [
    ["cheap", "הכי זול"],
    ["fast", "הכי מהר"],
    ["balance", "איזון"],
  ]) {
    group.append(el("button", {
      type: "button",
      class: active === mode[0] ? "mode is-selected" : "mode",
      role: "radio",
      "aria-checked": active === mode[0] ? "true" : "false",
      onclick: () => rerun(mode[0]),
    }, mode[1]));
  }
  return group;
}

function productBlock(row, spec, primary, rows) {
  const { product } = row;
  const wrap = el("section", { class: "product-block" });
  const head = el("div", { class: "product" }, [
    html(productArt(product.icon, product.accent), "product-art"),
    el("div", {}, [
      el("p", { class: "eyebrow" }, `${product.brand} · ${product.category}`),
      el("h2", {}, product.name),
      el("p", { class: "meta" }, product.blurb),
    ]),
  ]);
  wrap.append(head);
  if (primary) {
    const because = explainProduct(product, rows, spec);
    if (because) wrap.append(el("p", { class: "because" }, because));
  }
  if (!row.winner) wrap.append(el("p", { class: "empty" }, noMatchMessage(spec)));
  wrap.append(channelGroup("אתרים", "online", row, spec));
  wrap.append(channelGroup("חנויות", "store", row, spec));
  return wrap;
}

function channelGroup(title, channel, row, spec) {
  const cards = [
    ...row.ranked.map((offer) => ({ offer, rejected: "" })),
    ...row.overBudget.map((offer) => ({ offer, rejected: "מעל התקציב" })),
    ...row.excluded.map((item) => ({ offer: item.offer, rejected: item.reason })),
  ].filter((item) => storeById(item.offer.storeId)?.channel === channel);
  const section = el("div");
  section.append(el("h3", { class: "channel-title" }, title));
  if (cards.length === 0) {
    section.append(el("p", { class: "meta" }, "אין כאן תוצאה לפי מה שביקשת."));
    return section;
  }
  const list = el("div", { class: "offers" });
  for (const card of cards) list.append(offerCard(card.offer, card.rejected, spec, row));
  section.append(list);
  return section;
}

function offerCard(offer, rejected, spec, row) {
  const store = storeById(offer.storeId);
  const winner = !rejected && isSameOffer(offer, row.winner);
  const classes = ["offer"];
  if (winner) classes.push("is-winner");
  if (rejected) classes.push("is-over");
  const card = el("article", { class: classes.join(" "), "data-store": store.name });
  if (winner) card.dataset.winner = "true";
  const main = el("div", {}, [
    el("div", { class: "offer-top" }, [
      el("h3", {}, store.name),
      el("span", { class: "badge" }, store.channel === "online" ? "אתר" : "חנות"),
      el("span", { class: "badge" }, CONDITION[offer.condition] ?? offer.condition),
    ]),
    el("p", { class: "meta" }, `${store.place} · ${offer.color} · מידה ${offer.sizeLabel}`),
    el("p", { class: "stars" }, `${stars(store.rating)} ${store.rating.toFixed(1)} · ${store.reviewCount} דירוגים`),
    el("p", { class: "meta" }, shippingLine(offer)),
    el("button", {
      type: "button",
      class: "linkish",
      onclick: () => toggleReviews(store.id, card),
    }, state.openReviews.has(store.id) ? "הסתר ביקורות" : "ביקורות מהרשת"),
  ]);
  if (state.openReviews.has(store.id)) main.append(reviewList(store));
  if (winner) main.append(el("p", { class: "reason" }, explainDecision(offer, spec)));
  if (rejected) main.append(el("p", { class: "reason" }, rejected));
  card.append(
    html(storeArt(store.channel), "store-art"),
    main,
    el("div", {}, [
      el("p", { class: "total" }, formatShekel(totalPrice(offer))),
      el("p", { class: "meta" }, offer.shipping === 0 ? "משלוח חינם" : `משלוח ${formatShekel(offer.shipping)}`),
    ]),
  );
  return card;
}

function isSameOffer(offer, winner) {
  if (!winner) return false;
  return offer.storeId === winner.storeId && offer.price === winner.price && offer.color === winner.color;
}

function shippingLine(offer) {
  const shipping = offer.shipping === 0 ? "משלוח חינם" : `משלוח ${formatShekel(offer.shipping)}`;
  return `${shipping} · ${daysLabel(offer.days)} · ${offer.detail}`;
}

function reviewList(store) {
  const list = el("div", { class: "reviews" });
  for (const review of store.reviews) {
    list.append(el("p", { class: "review" }, `${review.name} · ${stars(review.stars)} ${review.text}`));
  }
  return list;
}

function toggleReviews(storeId, card) {
  if (state.openReviews.has(storeId)) state.openReviews.delete(storeId);
  else state.openReviews.add(storeId);
  const button = card.querySelector(".linkish");
  const existing = card.querySelector(".reviews");
  if (existing) existing.remove();
  button.textContent = state.openReviews.has(storeId) ? "הסתר ביקורות" : "ביקורות מהרשת";
  if (state.openReviews.has(storeId)) button.after(reviewList(storeById(storeId)));
}

function stars(value) {
  const full = Math.max(0, Math.min(5, Math.floor(value)));
  return `${"★".repeat(full)}${"☆".repeat(5 - full)}`;
}

function sourceLine(result) {
  return `החיפוש רץ על ${result.connectedSources.join(" ועל ")}. סריקה של אתרים אמיתיים עדיין לא מחוברת, כי צריך מקור שהאתר מרשה.`;
}

function toggleMic() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    state.messages.push({ role: "assistant", kind: "note", text: "הדפדפן הזה לא נותן להקליט דיבור. אפשר לכתוב את המשפט." });
    renderThread();
    return;
  }
  if (micBtn.dataset.on === "1") return;
  const rec = new Rec();
  rec.lang = "he-IL";
  micBtn.dataset.on = "1";
  micBtn.classList.add("is-on");
  micBtn.textContent = "מקליט…";
  rec.onresult = (event) => {
    input.value = event.results[0][0].transcript;
  };
  rec.onend = () => {
    micBtn.dataset.on = "0";
    micBtn.classList.remove("is-on");
    micBtn.textContent = "הקלטה";
  };
  rec.start();
}

function html(markup, className) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const node = template.content.firstElementChild;
  node.classList.add(className);
  return node;
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
