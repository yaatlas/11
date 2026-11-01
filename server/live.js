import { buildSpec, categoryById, collect } from "../js/collector.js?v=7";
import { daysLabel, formatMoney, normalize } from "../js/engine.js?v=7";

const ALLOWED_HOSTS = new Set([
  "serpapi.com",
  "www.searchapi.io",
  "api.dataforseo.com",
  "api.ebay.com",
]);

const SLOT_TITLES = {
  match: "ההתאמה",
  cheaper: "חלופה זולה יותר",
  faster: "חלופה מהירה יותר",
  similar: "חלופה דומה",
};

const CATEGORY_ICONS = {
  clothing: "shirt",
  shoes: "shoe",
  appliances: "fan",
  computers: "keyboard",
  audio: "headphones",
  sport: "ball",
  toys: "bricks",
  school: "bottle",
};

export function assertAllowedHost(url) {
  const host = new URL(url).host;
  if (!ALLOWED_HOSTS.has(host)) {
    const error = new Error("blocked");
    error.code = "blocked-host";
    throw error;
  }
  return host;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function shoppingProvider(env = {}) {
  if (clean(env.SERPAPI_API_KEY)) return "serpapi";
  if (clean(env.SEARCHAPI_API_KEY)) return "searchapi";
  if (clean(env.DATAFORSEO_LOGIN) && clean(env.DATAFORSEO_PASSWORD)) return "dataforseo";
  return null;
}

export function ebayConfigured(env = {}) {
  return Boolean(clean(env.EBAY_CLIENT_ID) && clean(env.EBAY_CLIENT_SECRET));
}

export function searchText(spec) {
  const parts = [];
  if (spec.text) parts.push(spec.text);
  else if (spec.category && spec.category !== "all") {
    const name = categoryById(spec.category)?.name;
    if (name) parts.push(name);
  }
  for (const facet of categoryById(spec.category)?.facets ?? []) {
    const value = spec.facets?.[facet.key];
    if (value && value !== "all") parts.push(facet.key === "size" ? `מידה ${value}` : value);
  }
  if (spec.condition === "used") parts.push("משומש");
  if (spec.condition === "new") parts.push("חדש");
  return parts.join(" ").trim();
}

function parseAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/[^\d,.-]/g, "");
  if (!text) return null;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma !== -1 && dot !== -1) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma !== -1) {
    const parts = text.split(",");
    text = parts.length > 1 && parts[parts.length - 1].length === 3
      ? text.replace(/,/g, "")
      : text.replace(",", ".");
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function parseDeliveryDays(text) {
  if (text == null || text === "") return null;
  const value = String(text);
  if (/מחר|tomorrow/i.test(value)) return 1;
  if (/יומיים/.test(value)) return 2;
  const hebrew = [...value.matchAll(/(\d{1,2})\s*(?:ימים|ימי|יום)/g)];
  if (hebrew.length) return Number(hebrew[hebrew.length - 1][1]);
  const english = [...value.matchAll(/(\d{1,2})\s*(?:business\s*)?days?/gi)];
  if (english.length) return Number(english[english.length - 1][1]);
  return null;
}

function daysUntil(iso, now) {
  const target = new Date(iso);
  const start = new Date(now);
  if (Number.isNaN(target.getTime()) || Number.isNaN(start.getTime())) return null;
  const ms = target.getTime() - start.getTime();
  if (ms < 0) return null;
  return Math.max(1, Math.ceil(ms / 86400000));
}

function currencyFrom(item) {
  if (item.currency) return String(item.currency).toUpperCase() === "₪" ? "ILS" : String(item.currency).toUpperCase();
  const blob = `${item.price ?? ""} ${item.extracted_price_currency ?? ""}`;
  if (/₪|ILS|ש"ח|ש״ח|שח/.test(blob)) return "ILS";
  if (/\$|USD/.test(blob)) return "USD";
  if (/€|EUR/.test(blob)) return "EUR";
  return null;
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function clip(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, 180);
}

function shoppingCondition(item) {
  const blob = [item.condition, item.second_hand_condition, item.snippet].filter(Boolean).join(" ").toLowerCase();
  if (/used|refurbished|pre-owned|משומש|מחודש/.test(blob)) return "used";
  return "new";
}

function fromShoppingRow(item, index) {
  const price = parseAmount(item.extracted_price ?? item.price);
  const title = clip(item.title);
  if (price == null || !title) return null;
  const shipping = item.extracted_delivery_price != null
    ? parseAmount(item.extracted_delivery_price)
    : item.delivery_price != null
      ? parseAmount(item.delivery_price)
      : null;
  return {
    id: `shopping:${item.position ?? index}:${clip(item.source || item.seller) || "seller"}`,
    title,
    seller: clip(item.source || item.seller),
    price,
    shipping,
    currency: currencyFrom(item),
    days: parseDeliveryDays(item.delivery || item.shipping || item.delivery_message),
    condition: shoppingCondition(item),
    url: safeUrl(item.link || item.product_link),
    source: "shopping",
    rating: typeof item.rating === "number" ? item.rating : null,
  };
}

function fromDataForSeo(item, index) {
  const price = parseAmount(item.price);
  const title = clip(item.title);
  if (price == null || !title) return null;
  const delivery = item.delivery_info ?? {};
  const shipping = delivery.delivery_price?.current != null ? parseAmount(delivery.delivery_price.current) : null;
  return {
    id: `shopping:${item.rank_absolute ?? index}:${clip(item.seller) || "seller"}`,
    title,
    seller: clip(item.seller || item.shop),
    price,
    shipping,
    currency: item.currency || delivery.delivery_price?.currency || null,
    days: parseDeliveryDays(delivery.delivery_message),
    condition: shoppingCondition(item),
    url: safeUrl(item.url || item.shopping_url),
    source: "shopping",
    rating: typeof item.product_rating?.value === "number" ? item.product_rating.value : null,
  };
}

export function mapShoppingResponse(body) {
  const rows = [];
  if (Array.isArray(body?.shopping_results)) {
    body.shopping_results.forEach((item, index) => {
      const row = fromShoppingRow(item, index);
      if (row) rows.push(row);
    });
  }
  for (const task of body?.tasks ?? []) {
    for (const result of task?.result ?? []) {
      for (const [index, item] of (result?.items ?? []).entries()) {
        const row = fromDataForSeo(item, index);
        if (row) rows.push(row);
      }
    }
  }
  return rows.slice(0, 20);
}

function ebayCondition(id, label) {
  const code = String(id ?? "");
  if (code === "1000" || code === "1500") return "new";
  if (["2000", "2010", "2020", "2030", "2500", "3000", "7000"].includes(code)) return "used";
  const text = String(label ?? "").toLowerCase();
  if (/used|refurbished|pre-owned/.test(text)) return "used";
  if (/^new\b/.test(text)) return "new";
  return null;
}

export function mapEbayResponse(body, now = new Date()) {
  if (!Array.isArray(body?.itemSummaries)) return [];
  const rows = [];
  for (const [index, item] of body.itemSummaries.entries()) {
    const price = parseAmount(item.price?.value);
    const title = clip(item.title);
    if (price == null || !title) continue;
    const shippingOption = item.shippingOptions?.[0];
    const shipping = shippingOption?.shippingCost?.value != null ? parseAmount(shippingOption.shippingCost.value) : null;
    const stamp = shippingOption?.maxEstimatedDeliveryDate || shippingOption?.minEstimatedDeliveryDate;
    rows.push({
      id: `ebay:${item.itemId || index}`,
      title,
      seller: clip(item.seller?.username),
      price,
      shipping,
      currency: item.price?.currency ? String(item.price.currency).toUpperCase() : null,
      days: stamp ? daysUntil(stamp, now) : null,
      condition: ebayCondition(item.conditionId, item.condition),
      url: safeUrl(item.itemWebUrl),
      source: "ebay",
      rating: null,
    });
  }
  return rows.slice(0, 20);
}

function knownTotal(listing) {
  if (listing.shipping == null) return null;
  return Math.round((listing.price + listing.shipping) * 100) / 100;
}

function relevance(listing, spec) {
  const title = normalize(listing.title);
  const tokens = spec.tokens?.length ? spec.tokens : (spec.text ? spec.text.split(" ").filter(Boolean) : []);
  if (tokens.length === 0) return 1;
  return tokens.reduce((score, token) => score + (title.includes(token) ? 1 : 0), 0);
}

function compareForMatch(a, b, spec) {
  const rel = relevance(b, spec) - relevance(a, spec);
  if (rel !== 0) return rel;
  const mode = spec.mode ?? "cheap";
  if (mode === "fast") {
    const aDays = a.days ?? Number.POSITIVE_INFINITY;
    const bDays = b.days ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
  }
  const aTotal = knownTotal(a);
  const bTotal = knownTotal(b);
  if (a.currency === b.currency && aTotal != null && bTotal != null && aTotal !== bTotal) return aTotal - bTotal;
  const dayTie = (a.days ?? 99) - (b.days ?? 99);
  if (dayTie !== 0) return dayTie;
  return String(a.seller ?? "").localeCompare(String(b.seller ?? ""), "he")
    || a.title.localeCompare(b.title, "he");
}

function chooseCurrency(listings, spec) {
  let best = -1;
  for (const item of listings) best = Math.max(best, relevance(item, spec));
  const top = listings.filter((item) => relevance(item, spec) === best);
  if (top.some((item) => item.currency === "ILS")) return "ILS";
  return top[0]?.currency || "";
}

function withinBudget(listing, spec) {
  if (spec.budget == null || listing.currency !== "ILS") return true;
  const total = listing.shipping == null ? listing.price : listing.price + listing.shipping;
  return total <= spec.budget;
}

function filterListings(spec, listings) {
  return listings.filter((listing) => {
    if (!listing?.title || !Number.isFinite(listing.price)) return false;
    if (spec.condition === "new" && listing.condition === "used") return false;
    if (spec.condition === "used" && listing.condition === "new") return false;
    return withinBudget(listing, spec);
  });
}

function tradeoff(fits, loses) {
  return { fits, loses, line: `מתאים: ${fits}. מפסידים: ${loses}.` };
}

function moneyLine(listing) {
  const code = listing.currency;
  if (listing.shipping == null) return `${formatMoney(listing.price, code)}, משלוח לא צוין`;
  if (listing.shipping === 0) return `${formatMoney(listing.price, code)}, בלי תוספת משלוח`;
  return `${formatMoney(knownTotal(listing), code)} כולל משלוח`;
}

function factLine(listing) {
  const parts = [listing.title, moneyLine(listing), listing.seller || "החנות לא צוינה"];
  if (listing.days != null) parts.push(daysLabel(listing.days));
  return parts.join(", ");
}

function sameTitle(a, b) {
  return normalize(a.title) === normalize(b.title);
}

function explainMatch(view, cheaper, faster) {
  if (!view) return tradeoff("אין תוצאה בחיפוש הזה", "אין מחיר, חנות או זמן משלוח");
  const loses = [];
  if (cheaper) loses.push("לא האפשרות הזולה");
  if (faster) loses.push("לא האפשרות המהירה");
  if (view.condition === "used") loses.push("המצב משומש");
  if (loses.length === 0) loses.push("אין חלופה עדיפה בתוצאות שחזרו");
  return tradeoff(factLine(view), loses.join(", "));
}

function explainCheaper(view, match) {
  if (!view) return tradeoff("אין חלופה זולה יותר", "נשארים עם ההתאמה");
  const saved = Math.round((knownTotal(match) - knownTotal(view)) * 100) / 100;
  const same = sameTitle(view, match);
  const fits = [`זול יותר ב־${formatMoney(saved, view.currency)}`, same ? "אותו מוצר" : view.title];
  const loses = [];
  if (!same) loses.push("דגם אחר");
  if (match.days != null && view.days != null && view.days > match.days) loses.push(`משלוח ארוך יותר (${daysLabel(view.days)})`);
  if (view.condition === "used" && match.condition !== "used") loses.push("המצב משומש");
  if (!view.seller) loses.push("החנות לא צוינה");
  if (loses.length === 0) loses.push(same ? "מוכר אחר" : "פחות קרוב למה שביקשת");
  return tradeoff(fits.join(", "), loses.join(", "));
}

function explainFaster(view, match) {
  if (!view) {
    if (match?.days == null) return tradeoff("אין זמן משלוח בתוצאות", "אי אפשר להציג חלופה מהירה בלי זמן משלוח");
    return tradeoff("אין משלוח מהיר יותר", "נשארים עם זמן ההתאמה");
  }
  const loses = [];
  const viewTotal = knownTotal(view);
  const matchTotal = knownTotal(match);
  if (view.currency === match.currency && viewTotal != null && matchTotal != null && viewTotal > matchTotal) {
    loses.push(`יקר יותר ב־${formatMoney(Math.round((viewTotal - matchTotal) * 100) / 100, view.currency)}`);
  }
  if (!sameTitle(view, match)) loses.push("דגם אחר");
  if (view.condition === "used" && match.condition !== "used") loses.push("המצב משומש");
  if (loses.length === 0) loses.push("אין חיסכון במחיר");
  return tradeoff(`מגיע מהר יותר (${daysLabel(view.days)})`, loses.join(", "));
}

function explainSimilar(view, match) {
  if (!view) return tradeoff("אין חלופה דומה", "אין דגם אחר בתוצאות");
  const loses = [];
  if (view.currency !== match.currency) loses.push("המחיר במטבע אחר, בלי המרה");
  else {
    const viewTotal = knownTotal(view);
    const matchTotal = knownTotal(match);
    if (viewTotal != null && matchTotal != null && viewTotal > matchTotal) loses.push("יקר יותר");
  }
  if (view.condition === "used" && match.condition !== "used") loses.push("המצב משומש");
  if (match.days != null && view.days != null && view.days > match.days) loses.push("משלוח ארוך יותר");
  if (loses.length === 0) loses.push("דגם אחר");
  const fits = view.condition === "used" && match.condition !== "used"
    ? `דומה ביד שנייה: ${view.title}`
    : `דומה: ${view.title}`;
  return tradeoff(fits, loses.join(", "));
}

function productFromListing(listing, spec) {
  const category = categoryById(spec.category);
  return {
    id: listing.id,
    name: listing.title,
    brand: listing.seller || "",
    category: category?.name || "תוצאת חיפוש",
    categoryId: category?.id || "live",
    icon: CATEGORY_ICONS[category?.id] || "pack",
    accent: "#0c6b58",
    pitch: "תוצאה מהחיפוש הזה",
    type: "",
    similar: [],
  };
}

function offerFromListing(listing) {
  return {
    price: listing.price,
    shipping: listing.shipping,
    days: listing.days,
    condition: listing.condition,
    seller: listing.seller,
    currency: listing.currency,
    url: listing.url,
    storeId: null,
    priceKind: "live",
    source: listing.source,
    rating: listing.rating,
    label: "מהחיפוש הזה",
  };
}

function liveSlot(role, listing, text, spec) {
  if (!listing) {
    return {
      role,
      title: SLOT_TITLES[role],
      product: null,
      offer: null,
      overBudget: false,
      priceKind: null,
      fits: text.fits,
      loses: text.loses,
      line: text.line,
    };
  }
  return {
    role,
    title: SLOT_TITLES[role],
    product: productFromListing(listing, spec),
    offer: offerFromListing(listing),
    overBudget: false,
    priceKind: "live",
    fits: text.fits,
    loses: text.loses,
    line: text.line,
  };
}

function emptyLiveAnswer() {
  const copy = {
    match: ["אין תוצאה בחיפוש הזה", "אין מחיר, חנות או זמן משלוח"],
    cheaper: ["אין חלופה זולה יותר", "אין מחיר זול יותר להציג"],
    faster: ["אין חלופה מהירה יותר", "אין זמן משלוח קצר יותר להציג"],
    similar: ["אין חלופה דומה", "אין דגם אחר להציג"],
  };
  return {
    priceKind: "none",
    note: "אין תוצאה בחיפוש הזה. לא מוצג מחיר, חנות או זמן משלוח.",
    slots: Object.entries(copy).map(([role, [fits, loses]]) => liveSlot(role, null, tradeoff(fits, loses), {})),
  };
}

function pickCheaper(match, rest) {
  const options = rest.filter((item) => {
    if (item.currency !== match.currency) return false;
    const itemTotal = knownTotal(item);
    const matchTotal = knownTotal(match);
    return itemTotal != null && matchTotal != null && itemTotal < matchTotal;
  });
  if (options.length === 0) return null;
  const different = options.filter((item) => !sameTitle(item, match));
  const pool = different.length ? different : options;
  pool.sort((a, b) => knownTotal(a) - knownTotal(b) || (a.days ?? 99) - (b.days ?? 99));
  return pool[0];
}

function pickFaster(match, rest) {
  if (match.days == null) return null;
  const options = rest.filter((item) => item.currency === match.currency && item.days != null && item.days < match.days);
  if (options.length === 0) return null;
  options.sort((a, b) => a.days - b.days || (knownTotal(a) ?? Number.POSITIVE_INFINITY) - (knownTotal(b) ?? Number.POSITIVE_INFINITY));
  return options[0];
}

function pickSimilar(match, rest, spec) {
  if (match.condition !== "used") {
    const usedPool = rest.filter((item) => item.condition === "used");
    if (usedPool.length) {
      usedPool.sort((a, b) => compareForMatch(a, b, spec));
      return usedPool[0];
    }
  }
  const different = rest.filter((item) => !sameTitle(item, match));
  if (different.length === 0) return null;
  different.sort((a, b) => compareForMatch(a, b, spec));
  return different[0];
}

export function shapeLiveAnswer(spec, listings) {
  const pool = filterListings(spec, listings);
  if (pool.length === 0) return emptyLiveAnswer();
  const currency = chooseCurrency(pool, spec);
  const same = pool.filter((item) => (item.currency || "") === currency).sort((a, b) => compareForMatch(a, b, spec));
  const other = pool.filter((item) => (item.currency || "") !== currency);
  const match = same[0];
  if (!match) return emptyLiveAnswer();
  const rest = [...same.slice(1), ...other];
  const cheaper = pickCheaper(match, rest);
  const faster = pickFaster(match, rest.filter((item) => item !== cheaper));
  const used = new Set([cheaper, faster].filter(Boolean));
  const similar = pickSimilar(match, rest.filter((item) => !used.has(item)), spec);
  const otherCurrency = other.length > 0 && similar?.currency === currency;
  const note = otherCurrency
    ? "המחירים שמופיעים חזרו מהחיפוש הזה. יש גם תוצאות במטבע אחר, והן לא הוכנסו להשוואת המחיר כדי לא להמציא המרה."
    : "המחירים שמופיעים חזרו מהחיפוש הזה.";
  return {
    priceKind: "live",
    note,
    slots: [
      liveSlot("match", match, explainMatch(match, cheaper, faster), spec),
      liveSlot("cheaper", cheaper, explainCheaper(cheaper, match), spec),
      liveSlot("faster", faster, explainFaster(faster, match), spec),
      liveSlot("similar", similar, explainSimilar(similar, match), spec),
    ],
  };
}

function demoNote(live) {
  const missingShopping = live.shopping.reason === "missing-secret";
  const missingEbay = live.ebay.reason === "missing-secret";
  const base = "המחירים בכרטיסים הם דוגמה מקטלוג ההדגמה, לא מחיר מהחיפוש הזה.";
  if (missingShopping && missingEbay) return `${base} לא יצאה קריאה למנוע הקניות ול-eBay כי אין סיסמה בשרת.`;
  if (missingShopping) return `${base} לא יצאה קריאה למנוע הקניות כי אין סיסמה בשרת.`;
  if (missingEbay) return `${base} לא יצאה קריאה ל-eBay כי אין סיסמה בשרת.`;
  return base;
}

function liveNote(live, answer) {
  const parts = [answer.note];
  if (live.shopping.reason === "missing-secret") parts.push("מנוע הקניות לא נקרא כי אין סיסמה בשרת.");
  if (live.ebay.reason === "missing-secret") parts.push("eBay לא נקרא כי אין סיסמה בשרת.");
  if (live.shopping.sent && live.shopping.reason === "no-result") parts.push("מנוע הקניות לא החזיר תוצאה.");
  if (live.ebay.sent && live.ebay.reason === "no-result") parts.push("eBay לא החזיר תוצאה.");
  return parts.join(" ");
}

function providerReason(provider, kind, live) {
  if (provider.id === "shopping") {
    if (!kind.fit) return provider.reason;
    if (live.shopping.reason === "missing-secret") return "מנוע קניות מוכן לקריאה. לא יצאה קריאה כי אין סיסמה בשרת.";
    if (live.shopping.reason === "ok") return "מנוע הקניות החזיר תוצאות לחיפוש הזה.";
    if (live.shopping.sent) return "יצאה קריאה למנוע הקניות, ואין תוצאה להציג.";
  }
  if (provider.id === "ebay") {
    if (!kind.fit) return provider.reason;
    if (live.ebay.reason === "missing-secret") return "יש ממשק חיפוש. לא יצאה קריאה כי אין סיסמה בשרת.";
    if (live.ebay.reason === "ok") return "eBay החזיר תוצאות לחיפוש הזה.";
    if (live.ebay.sent) return "יצאה קריאה ל-eBay, ואין תוצאה להציג.";
  }
  return provider.reason;
}

function annotatePlan(plan, live) {
  return {
    ...plan,
    kinds: plan.kinds.map((kind) => ({
      ...kind,
      providers: kind.providers.map((provider) => ({
        ...provider,
        reason: providerReason(provider, kind, live),
        call: callStatus(provider.id, live),
      })),
    })),
  };
}

function callStatus(id, live) {
  if (id === "facebook" || id === "yad2") return { sent: false, role: "phrase" };
  if (id === "shopping") {
    return {
      sent: live.shopping.sent,
      reason: live.shopping.reason,
      configured: live.shopping.configured,
      query: live.shopping.query,
    };
  }
  if (id === "ebay") {
    return {
      sent: live.ebay.sent,
      reason: live.ebay.reason,
      configured: live.ebay.configured,
      query: live.ebay.query,
    };
  }
  if (id === "catalog" || id === "feed") return { sent: false, reason: "sample-file" };
  return { sent: false, reason: "not-connected" };
}

function shoppingRequest(query, env) {
  const provider = shoppingProvider(env);
  if (provider === "serpapi") {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query);
    url.searchParams.set("gl", "il");
    url.searchParams.set("hl", "he");
    url.searchParams.set("google_domain", "google.co.il");
    url.searchParams.set("num", "20");
    url.searchParams.set("api_key", clean(env.SERPAPI_API_KEY));
    return { method: "GET", url: url.toString() };
  }
  if (provider === "searchapi") {
    const url = new URL("https://www.searchapi.io/api/v1/search");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query);
    url.searchParams.set("gl", "il");
    url.searchParams.set("hl", "he");
    url.searchParams.set("num", "20");
    url.searchParams.set("api_key", clean(env.SEARCHAPI_API_KEY));
    return { method: "GET", url: url.toString() };
  }
  const body = JSON.stringify([{ language_code: "he", location_code: 2376, keyword: query }]);
  const auth = Buffer.from(`${clean(env.DATAFORSEO_LOGIN)}:${clean(env.DATAFORSEO_PASSWORD)}`).toString("base64");
  return {
    method: "POST",
    url: "https://api.dataforseo.com/v3/merchant/google/products/live/advanced",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body,
  };
}

function ebayFilter(spec) {
  const parts = ["buyingOptions:{FIXED_PRICE}"];
  if (spec.condition === "used") parts.push("conditionIds:{3000|2000|2500|7000}");
  if (spec.condition === "new") parts.push("conditionIds:{1000|1500}");
  return parts.join(",");
}

async function fetchAllowed(fetchImpl, url, options) {
  assertAllowedHost(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  if (!response?.ok || typeof response.json !== "function") return null;
  return response.json();
}

async function runShopping(query, env, fetchImpl) {
  const request = shoppingRequest(query, env);
  const response = await fetchAllowed(fetchImpl, request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const json = await readJson(response);
  const listings = json ? mapShoppingResponse(json) : [];
  return { sent: true, reason: listings.length ? "ok" : "no-result", listings };
}

async function runEbay(spec, query, env, fetchImpl, now) {
  const basic = Buffer.from(`${clean(env.EBAY_CLIENT_ID)}:${clean(env.EBAY_CLIENT_SECRET)}`).toString("base64");
  const tokenResponse = await fetchAllowed(fetchImpl, "https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });
  const tokenJson = await readJson(tokenResponse);
  const token = tokenJson?.access_token;
  if (!token) return { sent: true, reason: "no-result", listings: [] };
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("filter", ebayFilter(spec));
  const marketplace = clean(env.EBAY_MARKETPLACE_ID) || "EBAY_US";
  const searchResponse = await fetchAllowed(fetchImpl, url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
    },
  });
  const json = await readJson(searchResponse);
  const listings = json ? mapEbayResponse(json, now) : [];
  return { sent: true, reason: listings.length ? "ok" : "no-result", listings };
}

function blankCall(fit, configured, query) {
  if (!fit) return { configured, sent: false, reason: "not-fit", query: null, count: 0 };
  if (!query) return { configured, sent: false, reason: "empty-query", query: null, count: 0 };
  if (!configured) return { configured: false, sent: false, reason: "missing-secret", query, count: 0 };
  return { configured: true, sent: false, reason: null, query, count: 0 };
}

export async function runSearch({
  prompt = "",
  filters = {},
  previousMode = "cheap",
  modeOverride = null,
  env = {},
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  const spec = buildSpec(prompt, filters, previousMode, modeOverride);
  const catalog = collect(spec);
  const query = searchText(spec);
  const newFit = catalog.plan.kinds.find((kind) => kind.id === "new-online").fit;
  const usedFit = catalog.plan.kinds.find((kind) => kind.id === "used").fit;
  const live = {
    shopping: blankCall(newFit, Boolean(shoppingProvider(env)), query),
    ebay: blankCall(usedFit, ebayConfigured(env), query),
    facebook: { sent: false, role: "phrase" },
    yad2: { sent: false, role: "phrase" },
  };
  const listings = [];

  async function attempt(slot, run) {
    try {
      const outcome = await run();
      live[slot].sent = outcome.sent;
      live[slot].reason = outcome.reason;
      live[slot].count = outcome.listings.length;
      listings.push(...outcome.listings);
    } catch {
      live[slot].sent = true;
      live[slot].reason = "no-result";
      live[slot].count = 0;
    }
  }

  const tasks = [];
  if (live.shopping.configured && live.shopping.reason == null) {
    tasks.push(attempt("shopping", () => runShopping(query, env, fetchImpl)));
  }
  if (live.ebay.configured && live.ebay.reason == null) {
    tasks.push(attempt("ebay", () => runEbay(spec, query, env, fetchImpl, now)));
  }
  await Promise.all(tasks);

  const attempted = live.shopping.sent || live.ebay.sent;
  let answer;
  if (!attempted) {
    answer = { ...catalog.answer, note: demoNote(live) };
  } else if (listings.length === 0) {
    answer = emptyLiveAnswer();
    answer = { ...answer, note: liveNote(live, answer) };
  } else {
    answer = shapeLiveAnswer(spec, listings);
    answer = { ...answer, note: liveNote(live, answer) };
  }

  return {
    spec,
    result: {
      rows: catalog.rows,
      sources: catalog.sources,
      connectedSources: catalog.connectedSources,
      plan: annotatePlan(catalog.plan, live),
      answer,
      live,
    },
  };
}
