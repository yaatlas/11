import { productArt } from "./art.js?v=7";
import { applyFacet, buildSpec, categoryById, collect, describeSpec, facetOptions, searchCategories, storeById } from "./collector.js?v=7";
import { daysLabel, formatMoney, formatShekel, totalPrice } from "./engine.js?v=7";

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
  text: "כותבים מה צריך, או בוחרים קטגוריה. החיפוש נשלח לשרת. בלי סיסמה בשרת נשארים מחירי הדוגמה, עם כיתוב שהם דוגמה.",
};

let requestSerial = 0;

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
  state.pendingImage = null;
  input.value = "";
  renderPending();
  state.messages.push({ role: "user", text, image });
  if (!text) {
    state.messages.push({
      role: "assistant",
      kind: "photo",
      text: "קיבלתי את התמונה. אין עדיין זיהוי תמונה אוטומטי, אז כתבו במילים מה רואים בה.",
    });
    renderThread(true);
    return;
  }
  const placeholder = { role: "assistant", kind: "note", pending: true, text: "מחפש עכשיו…" };
  state.messages.push(placeholder);
  renderThread(true);
  placeResults({ prompt: text, filters: readFilters(), mode: state.mode, modeOverride: null, placeholder });
}

function rerun(modeOverride = null) {
  const filters = readFilters();
  const user = [...state.messages].reverse().find((message) => message.role === "user" && message.text);
  if (!user && (filters.category === "all" || !filters.category)) {
    requestSerial += 1;
    state.messages = state.messages.filter((message) => message.kind !== "browse" && !message.pending);
    renderThread();
    return;
  }
  const placeholder = { role: "assistant", kind: "note", pending: true, text: "מחפש עכשיו…" };
  const resultIndex = state.messages.findLastIndex((message) => message.kind === "results" || message.kind === "browse" || message.pending);
  if (resultIndex >= 0) state.messages[resultIndex] = placeholder;
  else state.messages.push(placeholder);
  renderThread(true);
  placeResults({
    prompt: user?.text || "",
    filters,
    mode: state.mode,
    modeOverride,
    placeholder,
  });
}

async function placeResults({ prompt, filters, mode, modeOverride, placeholder }) {
  const serial = ++requestSerial;
  const payload = await searchOnServer({ prompt, filters, mode, modeOverride });
  if (serial !== requestSerial) return;
  state.mode = payload.spec.mode;
  const next = {
    role: "assistant",
    kind: prompt ? "results" : "browse",
    spec: payload.spec,
    result: payload.result,
  };
  const index = state.messages.indexOf(placeholder);
  if (index >= 0) state.messages[index] = next;
  else state.messages.push(next);
  renderThread(true);
}

async function searchOnServer(body) {
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    if (!payload?.result?.answer || !payload?.spec) throw new Error("bad payload");
    return payload;
  } catch {
    const spec = buildSpec(body.prompt || "", body.filters || {}, body.mode || "cheap", body.modeOverride || null);
    const result = collect(spec);
    result.answer = {
      ...result.answer,
      note: "המחירים בכרטיסים הם דוגמה מקטלוג ההדגמה. החיפוש לא הגיע לשרת, אז לא יצאה קריאה למנוע הקניות או ל-eBay.",
    };
    return { spec, result };
  }
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

function renderThread(scrollToEnd = false) {
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  thread.replaceChildren();
  thread.append(renderMessage(welcome));
  state.messages.forEach((message, index) => thread.append(renderMessage(message, index)));
  if (scrollToEnd || atBottom) thread.scrollTop = thread.scrollHeight;
}

function renderMessage(message, index = -1) {
  if (message.kind === "welcome") return welcomeBubble();
  if (message.role === "user") return userBubble(message);
  if (message.kind === "photo") return photoHelp(message.text);
  if (message.kind === "note") return el("article", { class: "bubble assistant" }, [el("p", {}, message.text)]);
  return resultsBubble(message, index);
}

function welcomeBubble() {
  const box = el("article", { class: "bubble assistant welcome-card" }, [
    el("p", { class: "welcome-kicker" }, "בחרו תחום"),
    el("h2", {}, "התאמה, ולידה החלופות"),
    el("p", {}, "המנוע מחליט אם לחפש חדש אונליין, יד שנייה, או חנות מקומית. בתשובה רואים מה מתאים ומה מפסידים. מידות נשארות בבגדים, לא במוצרי חשמל. בלי סיסמה בשרת המחירים הם דוגמה."),
  ]);
  const grid = el("div", { class: "home-cats" });
  for (const category of searchCategories("")) {
    const selected = state.filters.category === category.id;
    grid.append(el("button", {
      type: "button",
      class: selected ? "home-cat is-selected" : "home-cat",
      onclick: () => chooseCategory(category.id),
    }, [
      el("span", { class: "cat-name" }, category.name),
      el("span", { class: "cat-hint" }, category.hint),
    ]));
  }
  box.append(grid);
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
  return el("article", { class: "bubble assistant" }, [el("p", {}, text)]);
}

function resultsBubble(message) {
  const { spec, result } = message;
  const box = el("article", { class: "bubble assistant" }, [
    el("p", { class: "hint" }, "הבנתי כך"),
  ]);
  const notes = el("div", { class: "constraints" });
  for (const note of describeSpec(spec)) notes.append(el("span", { class: "constraint" }, note));
  box.append(notes, modeSwitch(spec.mode), planBlock(result.plan), answerGrid(result.answer));
  box.append(el("p", { class: "source-line" }, sourceLine(result)));
  return box;
}

function planBlock(plan) {
  const block = el("section", { class: "plan" }, [el("h3", {}, "איפה לחפש")]);
  const grid = el("div", { class: "plan-kinds" });
  for (const kind of plan.kinds) {
    const card = el("article", {
      class: kind.fit ? "kind is-fit" : "kind is-skip",
      "data-kind": kind.id,
      "data-fit": kind.fit ? "true" : "false",
    }, [
      el("h4", {}, kind.title),
      el("p", { class: "kind-state" }, kind.fit ? "מתאים לחיפוש" : "לא הפעם"),
      el("p", { class: "meta" }, kind.reason),
      el("p", { class: "meta" }, providerLine(kind)),
    ]);
    grid.append(card);
  }
  block.append(grid);
  const used = plan.kinds.find((kind) => kind.id === "used");
  if (used?.fit && plan.phrase) {
    block.append(el("p", { class: "phrase-box" }, `נוסח לפייסבוק מרקטפלייס וליד2, בלי שליפת מחיר: ${plan.phrase}`));
  }
  return block;
}

function providerLine(kind) {
  return kind.providers.map((provider) => {
    if (provider.role === "phrase") return `${provider.title}: נוסח בלבד`;
    const call = provider.call;
    if (provider.id === "shopping" || provider.id === "ebay") {
      if (call?.sent && call.reason === "ok") return `${provider.title}: מהחיפוש הזה`;
      if (call?.sent) return `${provider.title}: יצאה קריאה, אין תוצאה`;
      if (call?.reason === "missing-secret") return `${provider.title}: לא יצאה קריאה, אין סיסמה בשרת`;
      if (!kind.fit) return `${provider.title}: לא הפעם`;
    }
    return `${provider.title}: ${provider.connected ? "קובץ דוגמה" : "לא מחובר"}`;
  }).join(" · ");
}

function answerGrid(answer) {
  const section = el("section", { class: "answer" }, [
    el("h3", {}, "ההתאמה והחלופות"),
    el("p", { class: "meta" }, answer.note),
  ]);
  const grid = el("div", { class: "choices", role: "list" });
  for (const slot of answer.slots) grid.append(choiceCard(slot));
  section.append(grid);
  return section;
}

function choiceCard(slot) {
  const card = el("article", {
    class: slot.offer ? `choice is-${slot.role}` : "choice is-empty",
    role: "listitem",
    "data-role": slot.role,
    "data-price-kind": slot.priceKind || "",
  }, [el("p", { class: "choice-role" }, slot.title)]);
  if (!slot.product) {
    card.append(el("p", { class: "tradeoff" }, slot.line));
    return card;
  }
  const head = el("div", { class: "choice-head" }, [
    html(productArt(slot.product.icon, slot.product.accent), "choice-art"),
    el("div", {}, [
      el("p", { class: "eyebrow" }, `${slot.product.brand} · ${slot.product.category}`),
      el("h3", {}, slot.product.name),
    ]),
  ]);
  card.append(head);
  if (slot.offer) {
    const store = slot.offer.storeId ? storeById(slot.offer.storeId) : null;
    card.append(el("p", { class: "total" }, [
      choicePrice(slot),
      " ",
      el("span", { class: slot.priceKind === "live" ? "badge badge-live" : "badge badge-demo" }, slot.priceKind === "live" ? "מהחיפוש הזה" : "מחיר לדוגמה"),
    ]));
    card.append(el("p", { class: "meta" }, choiceMeta(slot, store)));
    if (store) {
      card.append(el("p", { class: "stars" }, `${stars(store.rating)} ${store.rating.toFixed(1)}`));
      card.append(el("button", {
        type: "button",
        class: "linkish",
        onclick: () => toggleReviews(store.id, card),
      }, state.openReviews.has(store.id) ? "הסתר ביקורות" : "ביקורות מהרשת"));
      if (state.openReviews.has(store.id)) card.append(reviewList(store));
    } else if (slot.priceKind === "live" && slot.offer.url) {
      card.append(el("a", { class: "linkish", href: slot.offer.url, target: "_blank", rel: "noopener noreferrer" }, "לדף המוצר"));
    }
  }
  card.append(el("p", { class: "tradeoff" }, slot.line));
  return card;
}

function choicePrice(slot) {
  if (slot.priceKind === "live") {
    const currency = slot.offer.currency || null;
    if (slot.offer.shipping == null) return formatMoney(slot.offer.price, currency);
    return formatMoney(slot.offer.price + slot.offer.shipping, currency);
  }
  return formatShekel(totalPrice(slot.offer));
}

function choiceMeta(slot, store) {
  if (slot.priceKind === "live") {
    const bits = [slot.offer.seller || "החנות לא צוינה"];
    if (slot.offer.days != null) bits.push(daysLabel(slot.offer.days));
    else bits.push("זמן משלוח לא צוין");
    if (slot.offer.condition === "new" || slot.offer.condition === "used") bits.push(CONDITION[slot.offer.condition]);
    else bits.push("מצב לא צוין");
    const keys = new Set((categoryById(slot.product.categoryId)?.facets ?? []).map((facet) => facet.key));
    if (keys.has("size") && slot.offer.sizeLabel) bits.push(`מידה ${slot.offer.sizeLabel}`);
    if (keys.has("color") && slot.offer.color) bits.push(slot.offer.color);
    bits.push("מהחיפוש הזה");
    return bits.filter(Boolean).join(" · ");
  }
  const bits = [store?.name ?? "", daysLabel(slot.offer.days), CONDITION[slot.offer.condition] ?? slot.offer.condition];
  const keys = new Set((categoryById(slot.product.categoryId)?.facets ?? []).map((facet) => facet.key));
  if (keys.has("size") && slot.offer.sizeLabel) bits.push(`מידה ${slot.offer.sizeLabel}`);
  if (keys.has("color") && slot.offer.color) bits.push(slot.offer.color);
  if (slot.overBudget) bits.push("מעל התקציב");
  bits.push("מחיר לדוגמה");
  return bits.filter(Boolean).join(" · ");
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
  const fit = result.plan.kinds.filter((kind) => kind.fit).map((kind) => kind.title);
  const where = fit.length ? fit.join(", ") : "אף סוג מקור";
  if (result.answer.priceKind === "live") {
    return `התוכנית: ${where}. כל מחיר חי מסומן כמחיר מהחיפוש הזה. מפייסבוק ויד2 לא נשלף מחיר.`;
  }
  if (result.answer.priceKind === "none") {
    return `התוכנית: ${where}. אין תוצאה בחיפוש הזה, אז אין מחיר להציג. מפייסבוק ויד2 לא נשלף מחיר.`;
  }
  return `התוכנית: ${where}. המחירים בכרטיסים הם דוגמה, לא מחיר אמיתי. מפייסבוק ויד2 לא נשלף מחיר.`;
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
