import assert from "node:assert/strict";
import test from "node:test";
import { applyFacet, buildSpec, collect, describeSpec, facetOptions, searchCategories, storeById } from "../js/collector.js";
import { totalPrice } from "../js/engine.js";
import { products, stores } from "../js/data.js";

test("every offer points at a store, and every store has reviews", () => {
  for (const store of stores) {
    assert.ok(store.reviews.length >= 2);
    assert.ok(store.rating >= 1 && store.rating <= 5);
    assert.ok(store.channel === "online" || store.channel === "store");
  }
  for (const product of products) {
    assert.ok(product.brand);
    assert.ok(product.colors.length > 0);
    const channels = new Set(product.offers.map((offer) => storeById(offer.storeId).channel));
    assert.ok(channels.has("online"), product.id);
    assert.ok(channels.has("store"), product.id);
  }
});

test("a prompt and a lower price filter use the stricter budget", () => {
  const spec = buildSpec("אוזניות עד 200 שקל, עדיף משלוח מהיר", { priceMax: "150" });
  assert.equal(spec.budget, 150);
  assert.equal(spec.mode, "fast");
  assert.ok(describeSpec(spec).some((note) => note.includes("200") || note.includes("150") || note.includes("תקציב")));
});

test("headphones search returns both a shop and an online site", () => {
  const spec = buildSpec("אוזניות", {});
  const result = collect(spec);
  const row = result.rows.find((item) => item.product.id === "soundmini");
  const channels = new Set(row.ranked.map((offer) => storeById(offer.storeId).channel));
  assert.ok(channels.has("online"));
  assert.ok(channels.has("store"));
  assert.ok(row.ranked.some((offer) => offer.storeId === "shuk"));
});

test("the online filter hides physical stores", () => {
  const spec = buildSpec("אוזניות", { channel: "online" });
  const result = collect(spec);
  const offers = result.rows.flatMap((row) => [...row.ranked, ...row.overBudget, ...row.excluded.map((item) => item.offer)]);
  assert.ok(offers.length > 0);
  assert.ok(offers.every((offer) => storeById(offer.storeId).channel === "online"));
});

test("new-only filter drops used offers", () => {
  const spec = buildSpec("אוזניות", { condition: "new" });
  const row = collect(spec).rows.find((item) => item.product.id === "soundmini");
  assert.ok(row.ranked.every((offer) => offer.condition === "new"));
  assert.ok(row.excluded.some((item) => item.offer.condition === "used"));
});

test("each category exposes only its own filters", () => {
  const clothing = facetOptions("clothing", {});
  const electric = facetOptions("appliances", {});
  assert.ok(clothing.some((facet) => facet.key === "size" && facet.values.includes("M")));
  assert.ok(clothing.some((facet) => facet.key === "color"));
  assert.ok(electric.some((facet) => facet.key === "power" && facet.values.includes("30W")));
  assert.ok(!electric.some((facet) => facet.key === "size" || facet.key === "color"));
});

test("a clothing type narrows the later filters", () => {
  const shirts = facetOptions("clothing", { type: "חולצה" });
  assert.deepEqual(shirts.find((facet) => facet.key === "size").values, ["S", "M", "L"]);
  assert.deepEqual(shirts.find((facet) => facet.key === "brand").values, ["Cottona"]);
  const cleaned = applyFacet("clothing", { type: "חולצה", brand: "Northline", size: "XL" }, "type", "חולצה");
  assert.equal(cleaned.brand, undefined);
  assert.equal(cleaned.size, undefined);
  assert.equal(cleaned.type, "חולצה");
});

test("category search matches a garment word and not appliances", () => {
  const found = searchCategories("חולצה");
  assert.ok(found.some((category) => category.id === "clothing"));
  assert.ok(!found.some((category) => category.id === "appliances"));
  assert.ok(searchCategories("חשמל").some((category) => category.id === "appliances"));
});

test("browsing a category without a sentence stays inside that category", () => {
  const spec = buildSpec("", { category: "appliances", facets: {} });
  const rows = collect(spec).rows;
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((row) => row.product.categoryId === "appliances"));
  assert.ok(describeSpec(spec).includes("מוצרי חשמל"));
  const dropped = buildSpec("", { category: "clothing", facets: { type: "חולצה", size: "XL" } });
  assert.equal(dropped.facets.size, undefined);
  const sized = buildSpec("", { category: "clothing", facets: { type: "חולצה", size: "S" } });
  const shirts = collect(sized).rows;
  assert.equal(shirts.length, 1);
  assert.equal(shirts[0].product.id, "tee");
  assert.ok(shirts[0].ranked.every((offer) => offer.sizeLabel === "S"));
});

test("each search plans new-online, used, and local sources", () => {
  const open = collect(buildSpec("אוזניות עד 200 משלוח מהיר", {})).plan;
  assert.deepEqual(open.kinds.map((kind) => kind.id), ["new-online", "used", "local"]);
  assert.deepEqual(open.kinds.map((kind) => kind.fit), [true, true, true]);

  const fresh = collect(buildSpec("אוזניות חדשות", {})).plan;
  assert.equal(fresh.kinds.find((kind) => kind.id === "new-online").fit, true);
  assert.equal(fresh.kinds.find((kind) => kind.id === "used").fit, false);
  assert.equal(fresh.kinds.find((kind) => kind.id === "local").fit, true);
  assert.equal(fresh.kinds.find((kind) => kind.id === "used").providers.find((item) => item.id === "yad2").phrase, "");

  const secondHand = collect(buildSpec("אוזניות משומשות באתר", {})).plan;
  assert.equal(secondHand.kinds.find((kind) => kind.id === "new-online").fit, false);
  assert.equal(secondHand.kinds.find((kind) => kind.id === "used").fit, true);
  assert.equal(secondHand.kinds.find((kind) => kind.id === "local").fit, false);
  const facebook = secondHand.kinds.find((kind) => kind.id === "used").providers.find((item) => item.id === "facebook");
  const yad2 = secondHand.kinds.find((kind) => kind.id === "used").providers.find((item) => item.id === "yad2");
  assert.equal(facebook.role, "phrase");
  assert.equal(yad2.role, "phrase");
  assert.equal(facebook.connected, false);
  assert.equal(yad2.connected, false);
  assert.match(facebook.phrase, /אוזניות/);
  assert.match(yad2.phrase, /משומש/);
  assert.doesNotMatch(facebook.phrase, /https?:/i);
  assert.equal(Object.hasOwn(facebook, "price"), false);
  assert.equal(Object.hasOwn(yad2, "price"), false);

  const shop = collect(buildSpec("נעליים בחנות", {})).plan;
  assert.equal(shop.kinds.find((kind) => kind.id === "new-online").fit, false);
  assert.equal(shop.kinds.find((kind) => kind.id === "used").fit, false);
  assert.equal(shop.kinds.find((kind) => kind.id === "local").fit, true);

  for (const kind of open.kinds) {
    for (const provider of kind.providers) {
      assert.equal(Object.hasOwn(provider, "price"), false);
      if (provider.id === "shopping" || provider.id === "ebay" || provider.id === "published-stock") {
        assert.equal(provider.connected, false);
      }
    }
  }
  assert.equal(JSON.stringify(open).includes("apiKey"), false);
  assert.equal(open.kinds.find((kind) => kind.id === "new-online").providers[0].id, "shopping");
  assert.equal(open.kinds.find((kind) => kind.id === "used").providers.find((item) => item.id === "ebay").connected, false);
});

test("a search answer has a match and three tradeoff alternatives", () => {
  const result = collect(buildSpec("אוזניות עד 200 משלוח מהיר", {}));
  const { answer } = result;
  assert.equal(answer.priceKind, "demo");
  assert.match(answer.note, /קטלוג הדוגמה/);
  assert.deepEqual(answer.slots.map((slot) => slot.role), ["match", "cheaper", "faster", "similar"]);
  assert.deepEqual(answer.slots.map((slot) => slot.title), ["ההתאמה", "חלופה זולה יותר", "חלופה מהירה יותר", "חלופה דומה"]);
  for (const slot of answer.slots) {
    assert.match(slot.line, /מתאים:/);
    assert.match(slot.line, /מפסידים:/);
    assert.equal(slot.line, `מתאים: ${slot.fits}. מפסידים: ${slot.loses}.`);
  }
  const [match, cheaper, faster, similar] = answer.slots;
  assert.equal(match.product.id, "soundmini");
  assert.equal(match.priceKind, "demo");
  assert.ok(totalPrice(match.offer) <= 200);
  assert.equal(cheaper.product.id, "wiredbuds");
  assert.ok(totalPrice(cheaper.offer) < totalPrice(match.offer));
  assert.match(cheaper.loses, /חוט|משלוח/);
  assert.equal(faster.product.id, "soundmini");
  assert.ok(faster.offer.days < match.offer.days);
  assert.equal(faster.overBudget, true);
  assert.match(faster.loses, /תקציב/);
  assert.equal(similar.product.id, "sportbuds");
  assert.notEqual(similar.product.id, cheaper.product.id);
  assert.match(similar.fits, /אוזניות/);
  assert.match(similar.loses, /ספורט|ריצה/);
});

test("category filters still keep clothing sizes away from appliances", () => {
  const fan = collect(buildSpec("מאוורר", {})).answer;
  assert.ok(fan.slots.every((slot) => !slot.product || slot.product.categoryId === "appliances"));
  assert.equal(fan.slots.find((slot) => slot.role === "similar").product.id, "kettle");
  assert.equal(facetOptions("appliances", {}).some((facet) => facet.key === "size"), false);
  assert.equal(facetOptions("clothing", {}).some((facet) => facet.key === "size"), true);

  const sized = collect(buildSpec("", { category: "clothing", facets: { size: "S" } })).answer;
  assert.deepEqual(sized.slots.map((slot) => slot.role), ["match", "cheaper", "faster", "similar"]);
  for (const slot of sized.slots) {
    if (slot.product) assert.equal(slot.product.categoryId, "clothing");
    if (slot.offer) assert.equal(slot.offer.sizeLabel, "S");
    assert.match(slot.line, /מתאים:/);
  }

  const online = collect(buildSpec("אוזניות באתר", {}));
  assert.equal(online.plan.kinds.find((kind) => kind.id === "local").fit, false);
  for (const slot of online.answer.slots) {
    if (slot.offer) assert.equal(storeById(slot.offer.storeId).channel, "online");
  }
  const shop = collect(buildSpec("נעליים בחנות", {}));
  for (const slot of shop.answer.slots) {
    if (slot.offer) assert.equal(storeById(slot.offer.storeId).channel, "store");
  }
});

test("a query without a product still has the four-slot shape and no live price", () => {
  const answer = collect(buildSpec("הכי זול", {})).answer;
  assert.equal(answer.priceKind, "demo");
  assert.equal(answer.slots.length, 4);
  assert.equal(answer.slots[0].product, null);
  assert.equal(answer.slots.every((slot) => slot.offer == null), true);
  assert.equal(answer.slots.every((slot) => slot.priceKind == null), true);
});

test("the live web source is not pretending to be connected", () => {
  const spec = buildSpec("בקבוק", {});
  const result = collect(spec);
  const live = result.sources.find((source) => source.id === "live-web");
  assert.equal(live.connected, false);
  assert.ok(result.connectedSources.length >= 2);
});
