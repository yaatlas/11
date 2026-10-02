export function totalPrice(offer) {
  return offer.price + offer.shipping;
}

export function daysLabel(days) {
  if (days === 1) return "יום משלוח אחד";
  return `${days} ימי משלוח`;
}

export function formatShekel(amount) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

const STOPWORDS = new Set([
  "עד",
  "מתחת",
  "ל",
  "פחות",
  "מ",
  "שקל",
  "שקלים",
  "שח",
  "מהיר",
  "מהירה",
  "מהירים",
  "זול",
  "זולה",
  "זולים",
  "הכי",
  "משלוח",
  "דחוף",
  "דחופה",
  "עם",
  "של",
  "את",
  "אני",
  "רוצה",
  "לי",
  "בבקשה",
  "חדש",
  "חדשה",
  "ו",
  "או",
  "גם",
  "חשוב",
  "עדיף",
  "שיהיה",
  "תמצא",
  "תחפש",
]);

export function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[״"׳']/g, "")
    .replace(/־/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseQuery(raw) {
  const original = String(raw ?? "").trim();
  let mode = null;
  if (/מהיר|דחוף/.test(original)) mode = "fast";
  if (/זול/.test(original)) mode = mode ? "balance" : "cheap";

  const budgetMatch = original.match(/(?:עד|מתחת ל-?|פחות מ-?)\s*(\d{1,6})/);
  const budget = budgetMatch ? Number(budgetMatch[1]) : null;
  const withoutBudget = original.replace(
    /(?:עד|מתחת ל-?|פחות מ-?)\s*\d{1,6}\s*(?:שקל(?:ים)?|ש״ח|ש"ח|שח|₪)?/g,
    " ",
  );
  const tokens = normalize(withoutBudget)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token) && !/^\d+$/.test(token));

  return {
    text: tokens.join(" "),
    tokens,
    budget,
    mode,
  };
}

export function searchProducts(products, text) {
  const needle = normalize(text);
  if (!needle) return [];
  const tokens = needle.split(" ").filter((token) => token.length > 1);

  return products
    .map((product) => {
      const name = normalize(product.name);
      const category = normalize(product.category);
      const blurb = normalize(product.blurb);
      const tags = product.tags.map(normalize);
      let score = 0;
      if (name.includes(needle)) score += 8;
      for (const token of tokens) {
        if (name.includes(token)) score += 4;
        if (tags.some((tag) => tag.includes(token) || token.includes(tag))) score += 3;
        if (category.includes(token)) score += 2;
        if (blurb.includes(token)) score += 1;
      }
      return { product, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, "he"));
}

function balanceScore(offer, bounds) {
  const price = totalPrice(offer);
  const priceSpan = bounds.maxPrice - bounds.minPrice;
  const daySpan = bounds.maxDays - bounds.minDays;
  const pricePart = priceSpan === 0 ? 0 : (price - bounds.minPrice) / priceSpan;
  const dayPart = daySpan === 0 ? 0 : (offer.days - bounds.minDays) / daySpan;
  return pricePart * 0.6 + dayPart * 0.4;
}

export function rankOffers(offers, mode) {
  const ranked = [...offers];
  if (mode === "fast") {
    ranked.sort((a, b) => a.days - b.days || totalPrice(a) - totalPrice(b) || b.rating - a.rating);
    return ranked;
  }
  if (mode === "balance" && ranked.length > 0) {
    const totals = ranked.map(totalPrice);
    const days = ranked.map((offer) => offer.days);
    const bounds = {
      minPrice: Math.min(...totals),
      maxPrice: Math.max(...totals),
      minDays: Math.min(...days),
      maxDays: Math.max(...days),
    };
    ranked.sort(
      (a, b) => balanceScore(a, bounds) - balanceScore(b, bounds) || totalPrice(a) - totalPrice(b),
    );
    return ranked;
  }
  ranked.sort((a, b) => totalPrice(a) - totalPrice(b) || a.days - b.days || b.rating - a.rating);
  return ranked;
}

export function splitByBudget(offers, budget) {
  if (budget == null) return { eligible: [...offers], overBudget: [] };
  const eligible = [];
  const overBudget = [];
  for (const offer of offers) {
    if (totalPrice(offer) <= budget) eligible.push(offer);
    else overBudget.push(offer);
  }
  return { eligible, overBudget };
}

export function explainWinner(offer, mode) {
  const sum = formatShekel(totalPrice(offer));
  if (mode === "fast") return `מגיע הכי מהר: ${daysLabel(offer.days)}, סה״כ ${sum}`;
  if (mode === "balance") {
    return `השילוב הטוב ביותר של מחיר וזמן משלוח: ${sum}, ${daysLabel(offer.days)}`;
  }
  return `הזול ביותר כולל משלוח: ${sum}`;
}

export function understoodLine(parsed, mode) {
  const parts = [];
  if (parsed.text) parts.push(parsed.text);
  if (parsed.budget != null) parts.push(`תקציב עד ${formatShekel(parsed.budget)}`);
  if (mode === "fast") parts.push("חשוב משלוח מהיר");
  else if (mode === "balance") parts.push("חשוב גם מחיר וגם מהירות");
  else parts.push("חשוב המחיר הכולל");
  return parts.join(" · ");
}

export function interpret(products, raw, previousMode = "cheap") {
  const parsed = parseQuery(raw);
  const mode = parsed.mode ?? previousMode ?? "cheap";
  return {
    ...parsed,
    mode,
    matches: searchProducts(products, parsed.text),
  };
}

export function compareProduct(product, mode, budget) {
  const { eligible, overBudget } = splitByBudget(product.offers, budget);
  return {
    winner: rankOffers(eligible, mode)[0] ?? null,
    ranked: rankOffers(eligible, mode),
    overBudget: rankOffers(overBudget, "cheap"),
  };
}

export function productById(products, id) {
  return products.find((product) => product.id === id) ?? null;
}
