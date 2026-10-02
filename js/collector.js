import { collectedFeed, products, stores } from "./data.js";
import {
  compareProduct,
  formatShekel,
  intentNotes,
  parseQuery,
  searchProducts,
} from "./engine.js";

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
  return {
    ...parsed,
    askedMode: parsed.mode,
    mode: modeOverride ?? parsed.mode ?? previousMode ?? "cheap",
    budget,
    priceMin,
    condition,
    channel: filters.channel || "all",
    category: filters.category || "all",
    brand: filters.brand || "all",
    color: filters.color || "all",
    sizeLabel: filters.sizeLabel || "all",
  };
}

export function describeSpec(spec) {
  const notes = intentNotes(spec);
  if (spec.condition === "used") notes.push("רק משומש");
  if (spec.channel === "online") notes.push("רק אתרים");
  if (spec.channel === "store") notes.push("רק חנויות");
  if (spec.category && spec.category !== "all") notes.push(spec.category);
  if (spec.brand && spec.brand !== "all") notes.push(spec.brand);
  if (spec.color && spec.color !== "all") notes.push(spec.color);
  if (spec.sizeLabel && spec.sizeLabel !== "all") notes.push(`מידה ${spec.sizeLabel}`);
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
  if (spec.category !== "all" && product.category !== spec.category) return false;
  if (spec.brand !== "all" && product.brand !== spec.brand) return false;
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
  const matches = searchProducts(products, spec.text, spec).filter(({ product }) => {
    if (spec.category !== "all" && product.category !== spec.category) return false;
    if (spec.brand !== "all" && product.brand !== spec.brand) return false;
    return true;
  });

  const rows = matches.map(({ product, score }) => {
    const offers = [...product.offers, ...feedOffersFor(product.id)].filter((offer) =>
      hardFilter(offer, product, spec),
    );
    const comparison = compareProduct({ ...product, offers }, spec);
    return { product, score, ...comparison };
  });

  return {
    rows,
    sources,
    connectedSources: sources.filter((source) => source.connected).map((source) => source.title),
  };
}

export function filterChoices() {
  const brands = [...new Set(products.map((product) => product.brand))].sort((a, b) => a.localeCompare(b, "he"));
  const categories = [...new Set(products.map((product) => product.category))].sort((a, b) =>
    a.localeCompare(b, "he"),
  );
  const colors = [...new Set(products.flatMap((product) => product.colors))].sort((a, b) =>
    a.localeCompare(b, "he"),
  );
  const sizes = [...new Set(products.flatMap((product) => product.sizes))].sort((a, b) =>
    a.localeCompare(b, "he"),
  );
  return { brands, categories, colors, sizes };
}
