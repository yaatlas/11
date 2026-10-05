import assert from "node:assert/strict";
import test from "node:test";
import { applyFacet, buildSpec, collect, describeSpec, facetOptions, searchCategories, storeById } from "../js/collector.js";
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

test("the live web source is not pretending to be connected", () => {
  const spec = buildSpec("בקבוק", {});
  const result = collect(spec);
  const live = result.sources.find((source) => source.id === "live-web");
  assert.equal(live.connected, false);
  assert.ok(result.connectedSources.length >= 2);
});
