import { categories, collectedFeed, products, stores } from "./data.js?v=5";
import {
  compareProduct,
  formatShekel,
  intentNotes,
  normalize,
  parseQuery,
  searchProducts,
} from "./engine.js?v=5";

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

  return {
    rows,
    sources,
    connectedSources: sources.filter((source) => source.connected).map((source) => source.title),
  };
}

