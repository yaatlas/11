import { productArt, storeArt } from "./art.js";
import { applyFacet, buildSpec, categoryById, collect, describeSpec, facetOptions, searchCategories, storeById } from "./collector.js";
import { daysLabel, explainDecision, explainProduct, formatShekel, noMatchMessage, totalPrice } from "./engine.js";

const CONDITION = { new: "חדש", used: "משומש" };
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
  filters: {
    category: "all",
    categoryQuery: "",
    channel: "all",
    condition: "all",
    priceMin: "",
    priceMax: "",
    facets: {},
  },
};

const welcome = {
  role: "assistant",
  kind: "welcome",
  text: "כותבים מה צריך, או בוחרים קטגוריה בצד. הסינון משתנה לפי הקטגוריה: בבגדים מופיעים צבע ומידה, במוצרי חשמל מופיעים סוג והספק. אפשר גם להקליט או להעלות תמונה. המחירים כאן להדגמה.",
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
      text: "קיבלתי את התמונה. אין עדיין זיהוי תמונה אוטומטי, אז כתבו במילים מה רואים בה.",
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
  const filters = readFilters();
  const user = [...state.messages].reverse().find((message) => message.role === "user" && message.text);
  const spec = buildSpec(user?.text || "", filters, state.mode, modeOverride);
  state.mode = spec.mode;
  if (user) {
    const resultIndex = state.messages.findLastIndex((message) => message.kind === "results" || message.kind === "browse");
    const next = { role: "assistant", kind: "results", spec, result: collect(spec) };
    if (resultIndex >= 0) state.messages[resultIndex] = next;
    else state.messages.push(next);
    renderThread();
    return;
  }
  if (spec.category === "all") {
    state.messages = state.messages.filter((message) => message.kind !== "browse");
    renderThread();
    return;
  }
  const next = { role: "assistant", kind: "browse", spec, result: collect(spec) };
  const browseIndex = state.messages.findLastIndex((message) => message.kind === "browse");
  if (browseIndex >= 0) state.messages[browseIndex] = next;
  else state.messages.push(next);
  renderThread();
}

function renderFilters() {
  const query = state.filters.categoryQuery;
  const caret = document.activeElement?.id === "category-search" ? document.activeElement.selectionStart : null;
  filtersRoot.replaceChildren(
    el("div", { class: "filter-head" }, [
      el("h2", {}, "סינון"),
      el("p", { class: "filter-note" }, "קודם קטגוריה. אחר כך מופיעים רק הסינונים שמתאימים לה, והם מצטמצמים לפי מה שכבר נבחר."),
    ]),
    categorySearchField(),
    categoryList(query),
    facetBlock(),
    selectField("channel", "איפה קונים", ["all", "online", "store"], { all: "חנות ואתר", online: "רק אתר", store: "רק חנות" }),
    selectField("condition", "מצב", ["all", "new", "used"], { all: "הכול", new: "חדש", used: "משומש" }),
  );
  const prices = el("div", { class: "field" }, [el("span", {}, "טווח מחיר, כולל משלוח")]);
  const row = el("div", { class: "price-row" });
  row.append(numberField("priceMin", "מ־"), numberField("priceMax", "עד"));
  prices.append(row);
  filtersRoot.append(prices, el("button", { id: "reset", type: "button", onclick: resetFilters }, "נקה סינון"));
  if (caret != null) {
    const field = filtersRoot.querySelector("#category-search");
    field.focus();
    field.setSelectionRange(caret, caret);
  }
}

function categorySearchField() {
  const field = el("label", { class: "field" }, [el("span", {}, "חיפוש קטגוריה")]);
  const input = el("input", {
    id: "category-search",
    type: "search",
    placeholder: "למשל ביגוד, חשמל, ספורט",
    value: state.filters.categoryQuery,
    autocomplete: "off",
  });
  input.addEventListener("input", () => {
    state.filters.categoryQuery = input.value;
    renderFilters();
  });
  field.append(input);
  return field;
}

function categoryList(query) {
  const found = searchCategories(query);
  const wrap = el("div", { class: "cat-list", role: "group", "aria-label": "קטגוריות" });
  if (found.length === 0) {
    wrap.append(el("p", { class: "meta" }, "אין קטגוריה שמתאימה לחיפוש."));
    return wrap;
  }
  for (const category of found) {
    const selected = state.filters.category === category.id;
    wrap.append(el("button", {
      type: "button",
      class: selected ? "cat-btn is-selected" : "cat-btn",
      "aria-pressed": selected ? "true" : "false",
      onclick: () => chooseCategory(category.id),
    }, [
      el("span", { class: "cat-name" }, category.name),
      el("span", { class: "cat-hint" }, category.hint),
    ]));
  }
  return wrap;
}

function chooseCategory(id) {
  state.filters.category = state.filters.category === id ? "all" : id;
  state.filters.facets = {};
  renderFilters();
  rerun();
}

function facetBlock() {
  const category = categoryById(state.filters.category);
  if (!category) {
    return el("p", { class: "facet-wait" }, "בחרו קטגוריה כדי לפתוח סינון שנגזר ממנה.");
  }
  const block = el("section", { class: "facet-block" }, [
    el("h3", {}, category.name),
    el("p", { class: "filter-note" }, "האפשרויות כאן שייכות רק לקטגוריה הזו, ומשתנות לפי הבחירה הקודמת."),
  ]);
  for (const facet of facetOptions(state.filters.category, state.filters.facets)) {
    block.append(facetField(facet));
  }
  return block;
}

function facetField(facet) {
  const field = el("label", { class: "field" }, [el("span", {}, facet.label)]);
  const select = el("select", { name: `facet-${facet.key}` });
  select.append(el("option", { value: "all" }, "הכול"));
  for (const value of facet.values) select.append(el("option", { value }, value));
  select.value = state.filters.facets[facet.key] ?? "all";
  select.addEventListener("change", () => {
    state.filters.facets = applyFacet(state.filters.category, state.filters.facets, facet.key, select.value);
    renderFilters();
    rerun();
  });
  field.append(select);
  return field;
}

function selectField(name, label, values, labels) {
  const field = el("label", { class: "field" }, [el("span", {}, label)]);
  const select = el("select", { name });
  for (const value of values) {
    select.append(el("option", { value }, labels[value] ?? value));
  }
  select.value = state.filters[name] ?? "all";
  select.addEventListener("change", () => {
    state.filters[name] = select.value;
    rerun();
  });
  field.append(select);
  return field;
}

function numberField(name, placeholder) {
  const input = el("input", {
    type: "number",
    name,
    min: "0",
    placeholder,
    "aria-label": placeholder,
    value: state.filters[name] ?? "",
  });
  input.addEventListener("change", () => {
    state.filters[name] = input.value;
    rerun();
  });
  return input;
}

function readFilters() {
  return {
    category: state.filters.category,
    channel: state.filters.channel,
    condition: state.filters.condition,
    priceMin: state.filters.priceMin,
    priceMax: state.filters.priceMax,
    facets: state.filters.facets,
  };
}

function resetFilters() {
  state.filters = {
    category: "all",
    categoryQuery: "",
    channel: "all",
    condition: "all",
    priceMin: "",
    priceMax: "",
    facets: {},
  };
  renderFilters();
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
  return el("article", { class: "bubble assistant welcome-card" }, [
    el("p", { class: "welcome-kicker" }, "השוואת מחירים"),
    el("h2", {}, "מה מחפשים?"),
    el("p", {}, welcome.text),
  ]);
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
  return el("article", { class: "bubble assistant" }, [el("p", {}, text)]);
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
  const limit = spec.text ? 2 : 4;
  const shown = result.rows.filter((row, index) => index === 0 || row.score >= topScore - 2).slice(0, limit);
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

function offerFacts(product, offer, store) {
  const keys = new Set((categoryById(product.categoryId)?.facets ?? []).map((facet) => facet.key));
  const bits = [store.place];
  if (keys.has("color") && offer.color) bits.push(offer.color);
  if (keys.has("size") && offer.sizeLabel) bits.push(`מידה ${offer.sizeLabel}`);
  for (const key of ["connection", "power", "volume", "age"]) {
    if (keys.has(key) && product[key]) bits.push(product[key]);
  }
  return bits.join(" · ");
}

function offerCard(offer, rejected, spec, row) {
  const store = storeById(offer.storeId);
  const winner = !rejected && isSameOffer(offer, row.winner);
  const classes = ["offer"];
  if (winner) classes.push("is-winner");
  if (rejected) classes.push("is-over");
  const card = el("article", { class: classes.join(" "), "data-store": store.name });
  if (winner) card.dataset.winner = "true";
  const main = el("div", { class: "offer-body" }, [
    el("div", { class: "offer-head" }, [
      el("h3", {}, store.name),
      el("div", { class: "price-col" }, [
        el("p", { class: "total" }, formatShekel(totalPrice(offer))),
      ]),
    ]),
    el("div", { class: "badges" }, [
      el("span", { class: "badge" }, store.channel === "online" ? "אתר" : "חנות"),
      el("span", { class: "badge" }, CONDITION[offer.condition] ?? offer.condition),
    ]),
    el("p", { class: "meta" }, offerFacts(row.product, offer, store)),
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
  card.append(html(storeArt(store.channel), "store-art"), main);
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
