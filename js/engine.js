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
  "חדשות",
  "חדשים",
  "מחודש",
  "יקר",
  "יקרה",
  "יקרים",
  "יקרות",
  "גדול",
  "גדולה",
  "ענק",
  "קטן",
  "קטנה",
  "מחר",
  "שבוע",
  "יומיים",
  "ימים",
  "שלושה",
  "צריך",
  "משהו",
  "איתו",
  "שלא",
  "ייקח",
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

function parseMaxDays(original) {
  if (/מחר/.test(original)) return 1;
  if (/יומיים/.test(original)) return 2;
  if (/שלושה ימים/.test(original)) return 3;
  const numbered = original.match(/(\d{1,2})\s*ימים/);
  if (numbered) return Number(numbered[1]);
  if (/שבוע/.test(original)) return /שלא|לא יותר|לפני|פחות/.test(original) ? 6 : 7;
  return null;
}

function parseUses(original) {
  const uses = [];
  if (/ספורט|ריצה|לרוץ|זיעה/.test(original)) uses.push("sport");
  if (/בית ספר|בית-ספר|כיתה|כיתתי|שיעור|לתיק/.test(original)) uses.push("school");
  if (/גיימינג|למשחקים|משחקי מחשב/.test(original)) uses.push("gaming");
  return uses;
}

function parseSize(original) {
  if (/לא ענק|לא גדול|קטן|קטנה|קטנים/.test(original)) return "small";
  if (/ענק|גדול/.test(original)) return "large";
  return null;
}

export function parseQuery(raw) {
  const original = String(raw ?? "").trim();
  const wantsFast = /מהיר|דחוף|מחר|שיגיע מהר|עדיף משלוח/.test(original);
  const wantsCheap = /זול|לא יקר/.test(original);
  let mode = null;
  if (wantsFast && wantsCheap) mode = "balance";
  else if (wantsFast) mode = "fast";
  else if (wantsCheap) mode = "cheap";

  const budgetMatch = original.match(/(?:עד|מתחת ל-?|פחות מ-?|לא יותר מ-?)\s*(\d{1,6})/);
  const budget = budgetMatch ? Number(budgetMatch[1]) : null;
  const condition = /בלי מחודש|לא מחודש|אל תראה מחודש|רק חדש|חדש/.test(original) ? "new" : null;
  const stripped = original
    .replace(/(?:עד|מתחת ל-?|פחות מ-?|לא יותר מ-?)\s*\d{1,6}\s*(?:שקל(?:ים)?|ש״ח|ש"ח|שח|₪)?/g, " ")
    .replace(/בית ספר|בית-ספר|עדיף משלוח מהיר|שיגיע מהר|משלוח מהיר|בלי מחודש|לא מחודש|אל תראה מחודש|רק חדש|לא ענק|לא גדול|לא יקר(?:ה|ות|ים)?|למשחקים|משחקי מחשב|שלא ייקח שבוע|לא יותר משבוע/g, " ")
    .replace(/לשיעור|שיעור|ספורט|ריצה|לרוץ|לתיק|גיימינג|כיתה|כיתתי/g, " ");
  const tokens = normalize(stripped)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token) && !/^\d+$/.test(token));

  return {
    text: tokens.join(" "),
    tokens,
    budget,
    mode,
    condition,
    maxDays: parseMaxDays(original),
    uses: parseUses(original),
    size: parseSize(original),
  };
}

function facetScore(product, uses, size) {
  let score = 0;
  const productUses = product.uses ?? [];
  for (const use of uses) {
    if (productUses.includes(use)) score += 8;
    else if (use === "sport" || use === "gaming") score -= 3;
  }
  if (size && product.size) {
    if (product.size === size) score += 6;
    else if (
      (size === "small" && product.size === "large") ||
      (size === "large" && product.size === "small")
    ) {
      score -= 5;
    }
  }
  return score;
}

export function searchProducts(products, text, intent = {}) {
  const needle = normalize(text);
  const tokens = needle ? needle.split(" ").filter((token) => token.length > 1) : [];
  const uses = intent.uses ?? [];
  const size = intent.size ?? null;
  if (tokens.length === 0 && uses.length === 0 && !size) return [];

  return products
    .map((product) => {
      const name = normalize(product.name);
      const category = normalize(product.category);
      const blurb = normalize(product.blurb);
      const tags = product.tags.map(normalize);
      let score = facetScore(product, uses, size);
      if (needle && name.includes(needle)) score += 8;
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
  return explainDecision(offer, { mode });
}

export function explainDecision(offer, intent = {}) {
  const sum = formatShekel(totalPrice(offer));
  const parts = [];
  if (intent.condition === "new") parts.push("הוא חדש");
  if (intent.maxDays != null) parts.push(`המשלוח עומד בזמן שביקשת (${daysLabel(offer.days)})`);
  if (intent.budget != null) parts.push("המחיר בתוך התקציב");
  if (intent.mode === "fast") parts.push("הוא המהיר ביותר מבין מה שנשאר");
  else if (intent.mode === "balance") parts.push("יש לו את השילוב הטוב ביותר של מחיר וזמן משלוח");
  else parts.push("הוא הזול ביותר כולל משלוח");
  return `${parts.join(", ")}: ${sum}`;
}

export function explainProduct(product, matches, intent) {
  const reasons = [];
  const uses = intent.uses ?? [];
  if (uses.includes("sport") && uses.includes("school") && product.uses?.includes("sport")) {
    reasons.push("מתאים לשיעור ספורט");
  } else if (uses.includes("sport") && product.uses?.includes("sport")) {
    reasons.push("מתאים לספורט");
  } else if (uses.includes("school") && product.uses?.includes("school")) {
    reasons.push("מתאים לבית הספר");
  }
  if (uses.includes("gaming") && product.uses?.includes("gaming")) reasons.push("מיועד למשחקים");
  if (intent.size === "large" && product.size === "large") reasons.push("מהגדולים");
  if (intent.size === "small" && product.size === "small") reasons.push("מהקטנים");
  if (reasons.length === 0) return "";
  const other = (matches ?? []).find(
    (match, index) =>
      index > 0 &&
      match.product.category === product.category &&
      match.score >= matches[0].score - 6,
  );
  const contrast = other ? ` לא ${other.product.name}.` : "";
  return `בחרתי במוצר הזה כי הוא ${reasons.join(" ו")}.${contrast}`;
}

export function intentNotes(intent) {
  if (!intent) return [];
  const notes = [];
  if (intent.text) notes.push(intent.text);
  const uses = intent.uses ?? [];
  if (uses.includes("sport") && uses.includes("school")) notes.push("לשיעור ספורט");
  else if (uses.includes("sport")) notes.push("לספורט");
  else if (uses.includes("school")) notes.push("לבית הספר");
  if (uses.includes("gaming")) notes.push("למשחקים");
  if (intent.size === "large") notes.push("גדול");
  if (intent.size === "small") notes.push("קטן");
  if (intent.condition === "new") notes.push("רק חדש");
  if (intent.maxDays === 1) notes.push("משלוח עד מחר");
  else if (intent.maxDays != null) notes.push(`משלוח עד ${intent.maxDays} ימים`);
  if (intent.budget != null) notes.push(`תקציב עד ${formatShekel(intent.budget)}`);
  if (intent.askedMode === "fast") notes.push("עדיפות למשלוח מהיר");
  else if (intent.askedMode === "cheap") notes.push("עדיפות למחיר");
  else if (intent.askedMode === "balance") notes.push("גם מחיר וגם מהירות");
  return notes;
}

export function noMatchMessage(intent) {
  const bits = [];
  if (intent?.budget != null) bits.push(`עד ${formatShekel(intent.budget)}`);
  if (intent?.condition === "new") bits.push("רק חדש");
  if (intent?.maxDays != null) bits.push(`משלוח עד ${intent.maxDays} ימים`);
  if (bits.length === 0) return "אף הצעה לא עומדת במה שביקשת.";
  return `אין הצעה שעומדת בכל התנאים (${bits.join(", ")}). אלה ההצעות שלא נכנסו.`;
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
    askedMode: parsed.mode,
    mode,
    matches: searchProducts(products, parsed.text, parsed),
  };
}

function asIntent(modeOrIntent, budget) {
  if (modeOrIntent && typeof modeOrIntent === "object") return modeOrIntent;
  return {
    mode: modeOrIntent ?? "cheap",
    budget: budget ?? null,
    condition: null,
    maxDays: null,
  };
}

export function compareProduct(product, modeOrIntent, budget = null) {
  const intent = asIntent(modeOrIntent, budget);
  const eligible = [];
  const overBudget = [];
  const excluded = [];
  for (const offer of product.offers) {
    if (intent.condition === "new" && offer.condition !== "new") {
      excluded.push({ offer, reason: "משומש, וביקשת מוצר חדש" });
      continue;
    }
    if (intent.maxDays != null && offer.days > intent.maxDays) {
      excluded.push({ offer, reason: `${daysLabel(offer.days)} זה יותר מהזמן שביקשת` });
      continue;
    }
    if (intent.budget != null && totalPrice(offer) > intent.budget) {
      overBudget.push(offer);
      continue;
    }
    eligible.push(offer);
  }
  const ranked = rankOffers(eligible, intent.mode ?? "cheap");
  return {
    winner: ranked[0] ?? null,
    ranked,
    overBudget: rankOffers(overBudget, "cheap"),
    excluded,
  };
}

export function productById(products, id) {
  return products.find((product) => product.id === id) ?? null;
}
