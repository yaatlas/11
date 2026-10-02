import assert from "node:assert/strict";
import test from "node:test";
import { buildSpec, collect, describeSpec, storeById } from "../js/collector.js";
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

test("the live web source is not pretending to be connected", () => {
  const spec = buildSpec("בקבוק", {});
  const result = collect(spec);
  const live = result.sources.find((source) => source.id === "live-web");
  assert.equal(live.connected, false);
  assert.ok(result.connectedSources.length >= 2);
});
