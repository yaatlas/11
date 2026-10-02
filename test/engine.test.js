import assert from "node:assert/strict";
import test from "node:test";
import { products } from "../js/data.js";
import {
  compareProduct,
  interpret,
  parseQuery,
  productById,
  totalPrice,
} from "../js/engine.js";

test("a hebrew query keeps the product, the budget, and the speed preference", () => {
  const result = interpret(products, "אוזניות עד 200 משלוח מהיר");
  assert.equal(result.budget, 200);
  assert.equal(result.mode, "fast");
  assert.match(result.text, /אוזניות/);
  assert.ok(result.matches.some((match) => match.product.id === "soundmini"));
});

test("asking for both cheap and fast chooses balance", () => {
  const parsed = parseQuery("מטען נייד זול ומהיר");
  assert.equal(parsed.mode, "balance");
  assert.match(parsed.text, /מטען/);
});

test("space lego is preferred over the small car set", () => {
  const result = interpret(products, "לגו תחנת חלל");
  assert.equal(result.matches[0].product.id, "lego");
});

test("power bank winners change with the sorting choice", () => {
  const power = productById(products, "power");
  assert.equal(compareProduct(power, "cheap", null).winner.store, "מחסן החסכון");
  assert.equal(compareProduct(power, "fast", null).winner.store, "מהיר עד הבית");
  assert.equal(compareProduct(power, "balance", null).winner.store, "חנות הנקודה");
});

test("budget removes offers whose total price is too high", () => {
  const headphones = productById(products, "soundmini");
  const within = compareProduct(headphones, "fast", 180);
  assert.equal(within.winner.store, "מחסן החסכון");
  assert.equal(within.overBudget.length, 2);
  assert.ok(within.ranked.every((offer) => totalPrice(offer) <= 180));

  const under200 = compareProduct(headphones, "fast", 200);
  assert.equal(under200.winner.store, "חנות הנקודה");
  assert.equal(under200.overBudget[0].store, "מהיר עד הבית");
});

test("a query without a product does not invent a match", () => {
  const result = interpret(products, "הכי זול");
  assert.equal(result.text, "");
  assert.equal(result.matches.length, 0);
  assert.equal(result.mode, "cheap");
});

test("every similar product exists and every product has several offers", () => {
  const ids = new Set(products.map((product) => product.id));
  for (const product of products) {
    assert.ok(product.offers.length >= 3);
    for (const similarId of product.similar) {
      assert.ok(ids.has(similarId), `${product.id} points at missing ${similarId}`);
      assert.notEqual(similarId, product.id);
    }
  }
});
