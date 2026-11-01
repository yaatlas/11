import { categories, collectedFeed, products, stores } from "./data.js?v=7";
import {
  compareProduct,
  daysLabel,
  formatShekel,
  intentNotes,
  normalize,
  parseQuery,
  rankOffers,
  searchProducts,
  totalPrice,
} from "./engine.js?v=7";

const storesById = new Map(stores.map((store) => [store.id, store]));

export function storeById(id) {
  return storesById.get(id) ?? null;
}

export function buildSpec(prompt, filters = {}, previousMode = "cheap", modeOverride = null) {
  const parsed = parseQuery(prompt || "");
  const filterMax = numberOrNull(filters.priceMax);
  const priceMin = numberOrNull(filters.priceMin);
  let budget = parsed.budget;
  if (filterMax != null) budget = budget == null ? filterMax : Math.min(budget, filterMax);
  const condition = filters.condition && filters.condition !== "all" ? filters.condition : parsed.condition;
  const channel = filters.channel && filters.channel !== "all" ? filters.channel : (parsed.place || "all");
  return {
    ...parsed,
    askedMode: parsed.mode,
    mode: modeOverride ?? parsed.mode ?? previousMode ?? "cheap",
    budget,
    priceMin,
    condition,
    channel,
    category: filters.category || "all",
    facets: applyFacet(filters.category || "all", filters.facets || {}, null, null),
    brand: filters.facets?.brand || filters.brand || "all",
    color: filters.facets?.color || filters.color || "all",
    sizeLabel: filters.facets?.size || filters.sizeLabel || "all",
  };
}

export function describeSpec(spec) {
  const notes = intentNotes(spec);
  if (spec.condition === "used") notes.push("רק משומש");
  if (spec.channel === "online") notes.push("רק אתרים");
  if (spec.channel === "store") notes.push("רק חנויות");
  if (spec.category && spec.category !== "all") notes.push(categoryById(spec.category)?.name ?? spec.category);
  for (const facet of categoryById(spec.category)?.facets ?? []) {
    const value = spec.facets?.[facet.key];
    if (!value || value === "all") continue;
    notes.push(facet.key === "size" ? `מידה ${value}` : value);
  }
  if (spec.priceMin != null) notes.push(`מ־${formatShekel(spec.priceMin)}`);
  return notes;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hardFilter(offer, product, spec) {
  const store = storeById(offer.storeId);
  if (!store) return false;
  if (spec.channel !== "all" && store.channel !== spec.channel) return false;
  if (spec.color !== "all" && offer.color !== spec.color) return false;
  if (spec.sizeLabel !== "all" && offer.sizeLabel !== spec.sizeLabel) return false;
  if (spec.priceMin != null && offer.price + offer.shipping < spec.priceMin) return false;
  if (!productMatches(product, spec)) return false;
  return true;
}

const OFFER_FACETS = { color: "color", size: "sizeLabel" };

export function categoryById(id) {
  return categories.find((category) => category.id === id) ?? null;
}

export function searchCategories(query) {
  const needle = normalize(query);
  if (!needle) return categories;
  const tokens = needle.split(" ").filter(Boolean);
  return categories.filter((category) => {
    const haystack = [category.name, ...(category.keywords ?? [])].map((item) => normalize(item));
    return tokens.every((token) => haystack.some((item) => item.includes(token)));
  });
}

function facetValue(product, facet) {
  if (OFFER_FACETS[facet.key]) {
    return product.offers.map((offer) => offer[OFFER_FACETS[facet.key]]).filter(Boolean);
  }
  const value = product[facet.key];
  return value ? [value] : [];
}

function matchesSelected(product, facet, value) {
  return facetValue(product, facet).includes(value);
}

function valuesFor(category, facet, selected) {
  const pool = products.filter((product) => {
    if (product.categoryId !== category.id) return false;
    return Object.entries(selected).every(([key, value]) => {
      const previous = category.facets.find((item) => item.key === key);
      return previous ? matchesSelected(product, previous, value) : true;
    });
  });
  const values = new Set(pool.flatMap((product) => facetValue(product, facet)));
  return [...values].sort(compareFacetValues);
}

const SIZE_RANK = ["XS", "S", "M", "L", "XL", "XXL"];

function compareFacetValues(a, b) {
  const aRank = SIZE_RANK.indexOf(a);
  const bRank = SIZE_RANK.indexOf(b);
  if (aRank !== -1 && bRank !== -1) return aRank - bRank;
  return a.localeCompare(b, "he", { numeric: true });
}

export function facetOptions(categoryId, facets = {}) {
  const category = categoryById(categoryId);
  if (!category) return [];
  const selected = {};
  return category.facets.map((facet) => {
    const values = valuesFor(category, facet, selected);
    const current = facets[facet.key];
    if (current && current !== "all" && values.includes(current)) selected[facet.key] = current;
    return { ...facet, values };
  }).filter((facet) => facet.values.length > 0);
}

export function applyFacet(categoryId, facets = {}, key = null, value = null) {
  const next = { ...facets };
  if (key) {
    if (!value || value === "all") delete next[key];
    else next[key] = value;
  }
  const selected = {};
  for (const facet of facetOptions(categoryId, next)) {
    if (next[facet.key] && facet.values.includes(next[facet.key])) selected[facet.key] = next[facet.key];
  }
  return selected;
}

function productMatches(product, spec) {
  if (spec.category !== "all" && product.categoryId !== spec.category) return false;
  const facets = spec.facets ?? {};
  for (const facet of categoryById(spec.category)?.facets ?? []) {
    if (OFFER_FACETS[facet.key]) continue;
    const value = facets[facet.key];
    if (!value || value === "all") continue;
    if (product[facet.key] !== value) return false;
  }
  if ((!spec.facets || !spec.facets.brand) && spec.brand && spec.brand !== "all" && product.brand !== spec.brand) return false;
  return true;
}

function feedOffersFor(productId) {
  return collectedFeed
    .filter((row) => row.productId === productId)
    .map((row) => ({
      ...row,
      store: storeById(row.storeId)?.name ?? row.storeId,
      rating: storeById(row.storeId)?.rating ?? 0,
    }));
}

export const sources = [
  {
    id: "catalog",
    title: "קטלוג הדגמה",
    connected: true,
  },
  {
    id: "feed",
    title: "דיווחים שנאספו לקובץ דוגמה",
    connected: true,
  },
  {
    id: "live-web",
    title: "סריקה חיה של אתרי חנויות",
    connected: false,
    note: "כדי לסרוק אתר אמיתי צריך חיבור למקור שהאתר מרשה, למשל ממשק רשמי. אין הורדת דפים בלי רשות.",
  },
];

export function collect(spec) {
  const searched = searchProducts(products, spec.text, spec);
  const browsing = !spec.text && spec.category && spec.category !== "all";
  const matches = (browsing
    ? products.filter((product) => product.categoryId === spec.category).map((product) => ({ product, score: 1 }))
    : searched
  ).filter(({ product }) => productMatches(product, spec));

  const rows = matches.map(({ product, score }) => {
    const offers = [...product.offers, ...feedOffersFor(product.id)].filter((offer) =>
      hardFilter(offer, product, spec),
    );
    const comparison = compareProduct({ ...product, offers }, spec);
    return { product, score, ...comparison };
  });

  const plan = searchPlan(spec);
  return {
    rows,
    sources,
    connectedSources: sources.filter((source) => source.connected).map((source) => source.title),
    plan,
    answer: shapeAnswer(spec, rows),
  };
}

const SLOT_TITLES = {
  match: "ההתאמה",
  cheaper: "חלופה זולה יותר",
  faster: "חלופה מהירה יותר",
  similar: "חלופה דומה",
};

export function marketplacePhrase(spec) {
  const parts = [];
  if (spec.text) parts.push(spec.text);
  if (spec.category && spec.category !== "all") {
    const name = categoryById(spec.category)?.name;
    if (name && !parts.some((part) => part.includes(name))) parts.push(name);
  }
  for (const facet of categoryById(spec.category)?.facets ?? []) {
    const value = spec.facets?.[facet.key];
    if (value && value !== "all") parts.push(facet.key === "size" ? `מידה ${value}` : value);
  }
  if (spec.condition === "used") parts.push("משומש");
  if (spec.condition === "new") parts.push("חדש");
  if (spec.budget != null) parts.push(`עד ${spec.budget}`);
  return parts.join(" ").trim();
}

export function searchPlan(spec) {
  const phrase = marketplacePhrase(spec);
  return {
    phrase,
    kinds: [newOnlineKind(spec), usedKind(spec, phrase), localKind(spec)],
  };
}

function newOnlineKind(spec) {
  const fit = spec.condition !== "used" && spec.channel !== "store";
  let reason = "מנוע קניות קיים, כמו גוגל שופינג. לא מחובר, ואין מפתח בדפדפן.";
  if (spec.condition === "used") reason = "ביקשת יד שנייה, אז לא מחפשים מוצר חדש באתרי חנויות.";
  else if (spec.channel === "store") reason = "ביקשת חנות פיזית, אז לא מחפשים באתרי חנויות.";
  return {
    id: "new-online",
    title: "חדש אונליין",
    fit,
    reason,
    providers: [
      {
        id: "shopping",
        title: "מנוע קניות",
        connected: false,
        role: "prices",
        note: "גוגל שופינג דרך ממשק כמו DataForSEO, SearchApi או SerpAPI. לא מחובר.",
      },
    ],
  };
}

function usedKind(spec, phrase) {
  const fit = spec.condition !== "new" && spec.channel !== "store";
  let reason = "eBay אחר כך דרך ממשק חיפוש. לפייסבוק וליד2 אין ממשק פתוח, אז רק מכינים נוסח.";
  if (spec.condition === "new") reason = "ביקשת מוצר חדש, אז לא מחפשים יד שנייה.";
  else if (spec.channel === "store") reason = "ביקשת חנות פיזית, לא לוח יד שנייה.";
  const prepared = fit ? phrase : "";
  return {
    id: "used",
    title: "יד שנייה",
    fit,
    reason,
    providers: [
      {
        id: "ebay",
        title: "eBay",
        connected: false,
        role: "prices",
        note: "יש ממשק חיפוש. לא מחובר, ואין מפתח בדפדפן.",
      },
      {
        id: "facebook",
        title: "פייסבוק מרקטפלייס",
        connected: false,
        role: "phrase",
        phrase: prepared,
        note: "אין ממשק חיפוש פתוח. מכינים נוסח, לא שולפים מחיר.",
      },
      {
        id: "yad2",
        title: "יד2",
        connected: false,
        role: "phrase",
        phrase: prepared,
        note: "אין ממשק חיפוש פתוח. מכינים נוסח, לא שולפים מחיר.",
      },
    ],
  };
}

function localKind(spec) {
  const fit = spec.channel !== "online";
  const reason = fit
    ? "יש קובץ מוצרים להדגמה. חנות בלי מלאי מפורסם או בלי קובץ לא נכנסת."
    : "ביקשת רק אתרים, אז לא מחפשים בחנות פיזית.";
  return {
    id: "local",
    title: "מקומי",
    fit,
    reason,
    providers: [
      {
        id: "catalog",
        title: "קובץ מוצרים",
        connected: true,
        role: "prices",
        note: "קטלוג הדגמה. המחירים לא אמיתיים.",
      },
      {
        id: "feed",
        title: "דיווחים שנאספו",
        connected: true,
        role: "prices",
        note: "קובץ דוגמה, לא סריקה חיה.",
      },
      {
        id: "published-stock",
        title: "מלאי שפורסם אונליין",
        connected: false,
        role: "prices",
        note: "חנות פיזית נכנסת רק אם המלאי מפורסם. אין חיבור למלאי חי.",
      },
    ],
  };
}

function sameOffer(a, b) {
  if (!a || !b) return false;
  return a.storeId === b.storeId
    && a.price === b.price
    && a.shipping === b.shipping
    && a.days === b.days
    && a.condition === b.condition
    && a.color === b.color
    && a.sizeLabel === b.sizeLabel;
}

function offerViews(rows) {
  const views = [];
  for (const row of rows) {
    for (const offer of row.ranked) {
      views.push({ product: row.product, offer, score: row.score, eligible: true, overBudget: false });
    }
    for (const offer of row.overBudget) {
      views.push({ product: row.product, offer, score: row.score, eligible: false, overBudget: true });
    }
  }
  return views;
}

function pickMatch(rows, spec) {
  if (rows.length === 0) return null;
  if (spec.text) {
    const top = rows[0];
    return { product: top.product, offer: top.winner, score: top.score, eligible: Boolean(top.winner), overBudget: false };
  }
  const ready = rows.filter((row) => row.winner);
  if (ready.length === 0) {
    return { product: rows[0].product, offer: null, score: rows[0].score, eligible: false, overBudget: false };
  }
  const best = rankOffers(ready.map((row) => row.winner), spec.mode ?? "cheap")[0];
  const row = ready.find((item) => sameOffer(item.winner, best));
  return { product: row.product, offer: row.winner, score: row.score, eligible: true, overBudget: false };
}

function pickCheaper(match, views, similar, faster) {
  if (!match) return null;
  let options = views.filter((view) => view.eligible && !sameOffer(view.offer, match.offer));
  if (match.offer) options = options.filter((view) => totalPrice(view.offer) < totalPrice(match.offer));
  if (options.length === 0) return null;
  const avoidId = similar?.product?.id;
  const different = options.filter((view) => view.product.id !== match.product.id);
  let pool = different.filter((view) => view.product.id !== avoidId);
  if (pool.length === 0) pool = different;
  if (pool.length === 0) pool = options;
  pool.sort((a, b) => totalPrice(a.offer) - totalPrice(b.offer) || a.offer.days - b.offer.days);
  const chosen = pool.find((view) => !sameOffer(view.offer, faster?.offer)) ?? null;
  if (!chosen) return null;
  if (similar && sameOffer(chosen.offer, similar.offer)) return null;
  return chosen;
}

function pickFaster(match, views) {
  if (!match?.offer) return null;
  const faster = views.filter((view) => view.offer.days < match.offer.days && !sameOffer(view.offer, match.offer));
  if (faster.length === 0) return null;
  const same = faster.filter((view) => view.product.id === match.product.id);
  const pool = same.length ? same : faster;
  pool.sort((a, b) => a.offer.days - b.offer.days || Number(b.eligible) - Number(a.eligible) || totalPrice(a.offer) - totalPrice(b.offer));
  return pool[0];
}

function siblingRow(spec, id) {
  const product = products.find((item) => item.id === id);
  if (!product || !productMatches(product, spec)) return null;
  const offers = [...product.offers, ...feedOffersFor(product.id)].filter((offer) => hardFilter(offer, product, spec));
  const comparison = compareProduct({ ...product, offers }, spec);
  if (!comparison.winner) return null;
  return { product, score: 0, ...comparison };
}

function alternativeRows(spec, rows, match) {
  if (!match) return rows;
  const ids = new Set(rows.map((row) => row.product.id));
  const extra = [];
  for (const id of match.product.similar ?? []) {
    if (ids.has(id)) continue;
    const sibling = siblingRow(spec, id);
    if (sibling) extra.push(sibling);
  }
  return [...rows, ...extra];
}

function pickSimilar(match, rows) {
  if (!match) return null;
  for (const id of match.product.similar ?? []) {
    const row = rows.find((item) => item.product.id === id && item.winner);
    if (row) {
      return { product: row.product, offer: row.winner, score: row.score, eligible: true, overBudget: false };
    }
  }
  const other = rows.find((row) => row.winner && row.product.id !== match.product.id);
  if (!other) return null;
  return { product: other.product, offer: other.winner, score: other.score, eligible: true, overBudget: false };
}

function tradeoff(fits, loses) {
  return {
    fits,
    loses,
    line: `מתאים: ${fits}. מפסידים: ${loses}.`,
  };
}

function explainMatch(view, hasCheaper, hasFaster) {
  if (!view?.product) return tradeoff("לא נמצא מוצר שמתאים", "אין מה להשוות");
  if (!view.offer) return tradeoff(`${view.product.name} מתאים למה שביקשת`, "אין הצעה שעומדת בכל התנאים");
  const loses = [];
  if (hasCheaper) loses.push("לא האפשרות הזולה");
  if (hasFaster) loses.push("לא האפשרות המהירה");
  if (view.offer.condition === "used") loses.push("המצב משומש");
  if (loses.length === 0) loses.push("אין חלופה עדיפה בקטלוג הדוגמה");
  const fits = [
    view.product.pitch || view.product.name,
    `${formatShekel(totalPrice(view.offer))} כולל משלוח`,
    daysLabel(view.offer.days),
  ].join(", ");
  return tradeoff(fits, loses.join(", "));
}

function explainCheaper(view, match, similarIsCheaper) {
  if (!view?.offer) {
    if (similarIsCheaper) return tradeoff("הדגם הדומה זול יותר", "אין מוצר זול נוסף מעבר אליו");
    return tradeoff("אין אפשרות זולה יותר בתנאים", "נשארים עם ההתאמה");
  }
  const same = view.product.id === match?.product?.id;
  const fits = [];
  if (match?.offer) fits.push(`זול יותר ב־${formatShekel(totalPrice(match.offer) - totalPrice(view.offer))}`);
  else fits.push("יש מחיר בקטלוג הדוגמה");
  fits.push(same ? "אותו מוצר" : view.product.name);
  const loses = [];
  if (!same) loses.push(view.product.pitch || "דגם אחר");
  if (match?.offer && view.offer.days > match.offer.days) loses.push(`משלוח ארוך יותר (${daysLabel(view.offer.days)})`);
  if (view.offer.condition === "used" && match?.offer?.condition !== "used") loses.push("המצב משומש");
  if (loses.length === 0) loses.push(same ? "מוכר אחר" : "פחות קרוב למה שביקשת");
  return tradeoff(fits.join(", "), loses.join(", "));
}

function explainFaster(view, match) {
  if (!view?.offer) return tradeoff("אין משלוח מהיר יותר", "נשארים עם זמן ההתאמה");
  const same = view.product.id === match?.product?.id;
  const fits = [`מגיע מהר יותר (${daysLabel(view.offer.days)})`, same ? "אותו מוצר" : view.product.name];
  const loses = [];
  if (view.overBudget) loses.push(`חורג מהתקציב (${formatShekel(totalPrice(view.offer))})`);
  else if (match?.offer && totalPrice(view.offer) > totalPrice(match.offer)) {
    loses.push(`יקר יותר ב־${formatShekel(totalPrice(view.offer) - totalPrice(match.offer))}`);
  }
  if (!same) loses.push(view.product.pitch || "דגם אחר");
  if (loses.length === 0) loses.push("אין חיסכון במחיר");
  return tradeoff(fits.join(", "), loses.join(", "));
}

function explainSimilar(view, match) {
  if (!view?.product) return tradeoff("אין דגם דומה אחרי הסינון", "אין חלופה מאותו סוג");
  const shared = view.product.type && view.product.type === match?.product?.type
    ? view.product.type
    : (view.product.category || "אותו סוג");
  const loses = [view.product.pitch || "דגם אחר"];
  if (match?.offer && view.offer && totalPrice(view.offer) > totalPrice(match.offer)) loses.push("יקר יותר");
  if (match?.offer && view.offer && view.offer.days > match.offer.days) loses.push("משלוח ארוך יותר");
  return tradeoff(`דומה: גם ${shared}`, loses.join(", "));
}

function toSlot(role, view, text) {
  return {
    role,
    title: SLOT_TITLES[role],
    product: view?.product ?? null,
    offer: view?.offer ?? null,
    overBudget: Boolean(view?.overBudget),
    priceKind: view?.offer ? "demo" : null,
    fits: text.fits,
    loses: text.loses,
    line: text.line,
  };
}

export function shapeAnswer(spec, rows) {
  const match = pickMatch(rows, spec);
  const pool = alternativeRows(spec, rows, match);
  const views = offerViews(pool);
  const similar = pickSimilar(match, pool);
  const faster = pickFaster(match, views);
  const cheaper = pickCheaper(match, views, similar, faster);
  const similarIsCheaper = Boolean(
    match?.offer && similar?.offer && totalPrice(similar.offer) < totalPrice(match.offer),
  );
  const slots = [
    toSlot("match", match, explainMatch(match, Boolean(cheaper?.offer) || similarIsCheaper, Boolean(faster?.offer))),
    toSlot("cheaper", cheaper, explainCheaper(cheaper, match, similarIsCheaper)),
    toSlot("faster", faster, explainFaster(faster, match)),
    toSlot("similar", similar, explainSimilar(similar, match)),
  ];
  return {
    priceKind: "demo",
    note: "המחירים מקטלוג הדוגמה. אין כאן מחיר חי מחנות, מ־eBay או ממנוע קניות.",
    slots,
  };
}

