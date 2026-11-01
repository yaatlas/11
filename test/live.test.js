import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildSpec } from "../js/collector.js";
import { formatMoney } from "../js/engine.js";
import {
  assertAllowedHost,
  mapEbayResponse,
  mapShoppingResponse,
  runSearch,
  shapeLiveAnswer,
} from "../server/live.js";

const NOW = new Date("2026-11-01T00:00:00.000Z");
const SERP_SECRET = "test-serp-key";
const EBAY_SECRET = "test-ebay-secret";

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function shoppingSample() {
  return {
    shopping_results: [
      { title: "אוזניות SoundMini", source: "חנות הנקודה", extracted_price: 180, extracted_delivery_price: 0, currency: "ILS", delivery: "3 ימים", link: "https://example.test/nekuda" },
      { title: "אוזניות SoundMini", source: "מחסן החסכון", extracted_price: 150, extracted_delivery_price: 10, currency: "ILS", delivery: "5 ימים", link: "https://example.test/machsan" },
      { title: "אוזניות SoundMini", source: "מהיר עד הבית", extracted_price: 210, extracted_delivery_price: 0, currency: "ILS", delivery: "מחר", link: "https://example.test/mahir" },
      { title: "אוזניות ספורט FitBeat", source: "דיל ישיר", extracted_price: 99, extracted_delivery_price: 0, currency: "ILS", delivery: "4 ימים", link: "https://example.test/fit" },
      { title: "אוזניות חוטיות", source: "אתר השוק", extracted_price: 45, extracted_delivery_price: 0, currency: "ILS", delivery: "6 ימים", link: "https://example.test/wired" },
      { title: "אוזניות בלי חנות", extracted_price: 70, extracted_delivery_price: 0, currency: "ILS", delivery: "Free delivery" },
      { title: "בלי מחיר", source: "חנות דמיונית", delivery: "יום אחד" },
    ],
  };
}

function ebaySample() {
  return {
    itemSummaries: [
      {
        itemId: "a",
        title: "אוזניות SoundMini",
        condition: "Used",
        conditionId: "3000",
        price: { value: "40.00", currency: "ILS" },
        seller: { username: "seller_a" },
        itemWebUrl: "https://www.ebay.com/itm/a",
        shippingOptions: [{ shippingCost: { value: "5.00", currency: "ILS" }, maxEstimatedDeliveryDate: "2026-11-08T00:00:00.000Z" }],
      },
      {
        itemId: "b",
        title: "אוזניות SoundMini",
        condition: "Used",
        conditionId: "3000",
        price: { value: "55.00", currency: "ILS" },
        seller: { username: "seller_b" },
        itemWebUrl: "https://www.ebay.com/itm/b",
        shippingOptions: [{ shippingCost: { value: "0.00", currency: "ILS" }, maxEstimatedDeliveryDate: "2026-11-03T00:00:00.000Z" }],
      },
      {
        itemId: "c",
        title: "אוזניות ספורט FitBeat",
        condition: "Used",
        conditionId: "3000",
        price: { value: "30.00", currency: "ILS" },
        seller: { username: "seller_c" },
        itemWebUrl: "https://www.ebay.com/itm/c",
        shippingOptions: [{ shippingCost: { value: "5.00", currency: "ILS" }, maxEstimatedDeliveryDate: "2026-11-06T00:00:00.000Z" }],
      },
      {
        itemId: "d",
        title: "אוזניות חוטיות",
        condition: "Used",
        conditionId: "3000",
        price: { value: "15.00", currency: "ILS" },
        seller: { username: "seller_d" },
        itemWebUrl: "https://www.ebay.com/itm/d",
        shippingOptions: [{ shippingCost: { value: "5.00", currency: "ILS" }, maxEstimatedDeliveryDate: "2026-11-09T00:00:00.000Z" }],
      },
      {
        itemId: "e",
        title: "אוזניות בלי זמן",
        conditionId: "3000",
        price: { value: "70.00", currency: "ILS" },
        seller: { username: "no_time" },
      },
      { itemId: "f", title: "בלי מחיר", seller: { username: "nobody" } },
    ],
  };
}

function assertTradeoff(slot) {
  assert.match(slot.line, /^מתאים: /);
  assert.match(slot.line, /מפסידים: /);
  assert.equal(slot.line, `מתאים: ${slot.fits}. מפסידים: ${slot.loses}.`);
}

function assertNoInventedFacts(slot) {
  assert.equal(slot.offer?.sizeLabel, undefined);
  assert.equal(slot.product?.sizes, undefined);
  if (!slot.offer) {
    assert.equal(slot.priceKind, null);
    assert.match(slot.fits, /אין/);
    return;
  }
  assert.equal(slot.priceKind, "live");
  assert.equal(slot.offer.priceKind, "live");
  assert.equal(slot.offer.label, "מהחיפוש הזה");
  assert.equal(slot.offer.storeId, null);
}

test("a shopping sample maps onto the four cards without invented delivery or a missing price", () => {
  const listings = mapShoppingResponse(shoppingSample());
  assert.equal(listings.some((item) => item.title === "בלי מחיר"), false);
  const untimed = listings.find((item) => item.title === "אוזניות בלי חנות");
  assert.equal(untimed.seller, null);
  assert.equal(untimed.days, null);
  assert.equal(listings.find((item) => item.seller === "מהיר עד הבית").days, 1);

  const spec = buildSpec("אוזניות משלוח מהיר", {});
  const answer = shapeLiveAnswer(spec, listings);
  assert.equal(answer.priceKind, "live");
  assert.match(answer.note, /מהחיפוש הזה/);
  assert.deepEqual(answer.slots.map((slot) => slot.role), ["match", "cheaper", "faster", "similar"]);
  for (const slot of answer.slots) assertTradeoff(slot);

  const [match, cheaper, faster, similar] = answer.slots;
  assert.equal(match.offer.seller, "מהיר עד הבית");
  assert.equal(match.offer.price, 210);
  assert.equal(match.offer.days, 1);
  assert.equal(match.offer.currency, "ILS");
  assert.equal(match.offer.source, "shopping");
  assert.equal(match.product.categoryId, "live");
  assert.equal(cheaper.product.name, "אוזניות חוטיות");
  assert.equal(cheaper.offer.price, 45);
  assert.equal(faster.offer, null);
  assert.match(faster.line, /אין משלוח מהיר יותר/);
  assert.equal(similar.product.name, "אוזניות ספורט FitBeat");
  assert.doesNotMatch(faster.line, /\d+ ימ/);
  for (const slot of answer.slots) assertNoInventedFacts(slot);
});

test("an ebay sample maps onto the four cards using only stated prices and dates", () => {
  const listings = mapEbayResponse(ebaySample(), NOW);
  assert.equal(listings.some((item) => item.title === "בלי מחיר"), false);
  assert.equal(listings.find((item) => item.seller === "seller_b").days, 2);
  assert.equal(listings.find((item) => item.seller === "no_time").days, null);
  assert.equal(listings.find((item) => item.seller === "seller_d").price, 15);
  assert.equal(listings.find((item) => item.seller === "seller_d").shipping, 5);

  const spec = buildSpec("אוזניות משומשות", {});
  const answer = shapeLiveAnswer(spec, listings);
  assert.equal(answer.priceKind, "live");
  assert.deepEqual(answer.slots.map((slot) => slot.title), ["ההתאמה", "חלופה זולה יותר", "חלופה מהירה יותר", "חלופה דומה"]);
  for (const slot of answer.slots) assertTradeoff(slot);

  const [match, cheaper, faster, similar] = answer.slots;
  assert.equal(match.offer.seller, "seller_d");
  assert.equal(match.offer.price + match.offer.shipping, 20);
  assert.equal(match.offer.condition, "used");
  assert.equal(match.offer.currency, "ILS");
  assert.equal(cheaper.offer, null);
  assert.match(cheaper.line, /אין חלופה זולה יותר/);
  assert.equal(faster.offer.seller, "seller_b");
  assert.equal(faster.offer.days, 2);
  assert.match(faster.fits, /מגיע מהר יותר/);
  assert.equal(similar.offer.seller, "seller_c");
  for (const slot of answer.slots) assertNoInventedFacts(slot);
  assert.match(match.line, /משומש/);
});

test("a single shopping result does not invent a store, a delivery time, or a clothing size", () => {
  const listings = mapShoppingResponse({
    shopping_results: [
      { title: "מאוורר שולחני", extracted_price: 80, extracted_delivery_price: 0, currency: "ILS", delivery: "Free delivery", link: "https://example.test/fan" },
      { title: "מאוורר שולחני", source: "חנות ב", extracted_price: 120, extracted_delivery_price: 0, currency: "ILS", delivery: "5 ימים" },
    ],
  });
  const spec = buildSpec("מאוורר משלוח מהיר", { category: "appliances" });
  const answer = shapeLiveAnswer(spec, listings);
  const [match, cheaper, faster, similar] = answer.slots;
  assert.equal(match.offer.days, 5);
  assert.equal(match.offer.seller, "חנות ב");
  assert.equal(match.product.categoryId, "appliances");
  assert.equal(listings.find((item) => item.seller == null).days, null);
  assert.equal(cheaper.offer.price, 80);
  assert.match(cheaper.line, /החנות לא צוינה/);
  assert.equal(faster.offer, null);
  assert.match(faster.line, /אין זמן משלוח|אין משלוח מהיר/);
  assert.equal(similar.offer, null);
  for (const slot of answer.slots) {
    assertNoInventedFacts(slot);
    assert.doesNotMatch(slot.line, /מידה/);
    if (slot.offer) assert.equal(slot.offer.sizeLabel, undefined);
  }
  assert.equal(match.line.includes(formatMoney(120, "ILS")), true);
});

test("a dataforseo shopping payload maps a real price and drops an empty title", () => {
  const listings = mapShoppingResponse({
    tasks: [{
      result: [{
        items: [
          {
            title: "קומקום חשמלי",
            price: 79,
            currency: "ILS",
            seller: "דיל ישיר",
            url: "https://example.test/kettle",
            delivery_info: { delivery_message: "4 ימים", delivery_price: { current: 0, currency: "ILS" } },
          },
          { title: "", price: 10, currency: "ILS" },
        ],
      }],
    }],
  });
  assert.equal(listings.length, 1);
  const answer = shapeLiveAnswer(buildSpec("קומקום", { category: "appliances" }), listings);
  assert.equal(answer.slots[0].offer.price, 79);
  assert.equal(answer.slots[0].offer.seller, "דיל ישיר");
  assert.equal(answer.slots[0].offer.days, 4);
  assert.equal(answer.slots[0].offer.shipping, 0);
  assert.equal(answer.slots[0].product.categoryId, "appliances");
  assert.equal(answer.slots[0].offer.sizeLabel, undefined);
  assert.match(answer.slots[1].line, /אין/);
});

test("a cheaper card does not treat another currency as a shekel price", () => {
  const listings = [
    { id: "ils", title: "אוזניות SoundMini", seller: "חנות", price: 200, shipping: 0, currency: "ILS", days: 3, condition: "new", source: "shopping" },
    { id: "usd", title: "אוזניות SoundMini", seller: "seller_usd", price: 1, shipping: 0, currency: "USD", days: 1, condition: "used", source: "ebay" },
  ];
  const answer = shapeLiveAnswer(buildSpec("אוזניות", {}), listings);
  assert.equal(answer.slots[0].offer.currency, "ILS");
  assert.equal(answer.slots[0].offer.price, 200);
  assert.equal(answer.slots.find((slot) => slot.role === "cheaper").offer, null);
  const similar = answer.slots.find((slot) => slot.role === "similar");
  assert.equal(similar.offer.currency, "USD");
  assert.match(similar.loses, /מטבע אחר/);
  assert.doesNotMatch(similar.line, /זול יותר/);
  assert.equal(answer.slots.find((slot) => slot.role === "faster").offer, null);
});

test("without a server password the call stays local and the sample prices remain", async () => {
  let calls = 0;
  const payload = await runSearch({
    prompt: "אוזניות עד 200 משלוח מהיר",
    filters: {},
    env: {},
    fetchImpl: async () => {
      calls += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(calls, 0);
  assert.equal(payload.result.live.shopping.sent, false);
  assert.equal(payload.result.live.shopping.reason, "missing-secret");
  assert.equal(payload.result.live.shopping.query, "אוזניות");
  assert.equal(payload.result.live.ebay.sent, false);
  assert.equal(payload.result.live.ebay.reason, "missing-secret");
  assert.equal(payload.result.live.facebook.sent, false);
  assert.equal(payload.result.live.yad2.sent, false);
  assert.equal(payload.result.answer.priceKind, "demo");
  assert.match(payload.result.answer.note, /דוגמה/);
  assert.match(payload.result.answer.note, /אין סיסמה/);
  const [match, cheaper, faster, similar] = payload.result.answer.slots;
  assert.deepEqual(payload.result.answer.slots.map((slot) => slot.role), ["match", "cheaper", "faster", "similar"]);
  assert.equal(match.product.id, "soundmini");
  assert.equal(match.priceKind, "demo");
  assert.equal(cheaper.priceKind, "demo");
  assert.equal(faster.priceKind, "demo");
  assert.equal(similar.priceKind, "demo");
  const facebook = payload.result.plan.kinds.find((kind) => kind.id === "used").providers.find((item) => item.id === "facebook");
  const yad2 = payload.result.plan.kinds.find((kind) => kind.id === "used").providers.find((item) => item.id === "yad2");
  assert.equal(facebook.role, "phrase");
  assert.equal(yad2.role, "phrase");
  assert.equal(facebook.call.sent, false);
  assert.equal(Object.hasOwn(facebook, "price"), false);
  assert.equal(Object.hasOwn(yad2, "price"), false);
  assert.match(payload.result.plan.phrase, /אוזניות/);
  assert.equal(payload.result.plan.kinds.find((kind) => kind.id === "new-online").providers[0].connected, false);
  assert.equal(payload.result.plan.kinds.find((kind) => kind.id === "used").providers.find((item) => item.id === "ebay").connected, false);
});

test("a store search does not call the shopping engine even when a password is present", async () => {
  let calls = 0;
  const payload = await runSearch({
    prompt: "נעליים בחנות",
    filters: {},
    env: { SERPAPI_API_KEY: SERP_SECRET, EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: EBAY_SECRET },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(calls, 0);
  assert.equal(payload.result.live.shopping.reason, "not-fit");
  assert.equal(payload.result.live.ebay.reason, "not-fit");
  assert.equal(payload.result.answer.priceKind, "demo");
  assert.match(payload.result.answer.note, /דוגמה/);
  assert.doesNotMatch(payload.result.answer.note, /אין סיסמה/);
  assert.equal(JSON.stringify(payload).includes(SERP_SECRET), false);
  assert.equal(JSON.stringify(payload).includes(EBAY_SECRET), false);
});

test("shopping and ebay samples returned together fill the cards and stay off the page secrets", async () => {
  const calls = [];
  const payload = await runSearch({
    prompt: "אוזניות משלוח מהיר",
    filters: {},
    env: {
      SERPAPI_API_KEY: SERP_SECRET,
      EBAY_CLIENT_ID: "test-ebay-id",
      EBAY_CLIENT_SECRET: EBAY_SECRET,
    },
    now: NOW,
    fetchImpl: async (url) => {
      const host = new URL(url).host;
      calls.push(String(url));
      if (host === "serpapi.com") return jsonResponse(shoppingSample());
      if (String(url).includes("oauth2/token")) return jsonResponse({ access_token: "token-123" });
      if (host === "api.ebay.com") return jsonResponse(ebaySample());
      throw new Error(`unexpected host ${host}`);
    },
  });

  assert.equal(payload.result.live.shopping.sent, true);
  assert.equal(payload.result.live.ebay.sent, true);
  assert.equal(payload.result.live.facebook.sent, false);
  assert.equal(payload.result.live.yad2.sent, false);
  const hosts = new Set(calls.map((url) => new URL(url).host));
  assert.deepEqual(hosts, new Set(["serpapi.com", "api.ebay.com"]));
  const shoppingUrl = new URL(calls.find((url) => url.includes("serpapi.com")));
  assert.equal(shoppingUrl.searchParams.get("engine"), "google_shopping");
  assert.equal(shoppingUrl.searchParams.get("q"), "אוזניות");
  assert.equal(shoppingUrl.searchParams.get("api_key"), SERP_SECRET);
  const ebayUrl = new URL(calls.find((url) => url.includes("item_summary")));
  assert.equal(ebayUrl.searchParams.get("q"), "אוזניות");
  assert.match(ebayUrl.searchParams.get("filter"), /FIXED_PRICE/);
  const body = JSON.stringify(payload);
  assert.equal(body.includes(SERP_SECRET), false);
  assert.equal(body.includes(EBAY_SECRET), false);
  assert.equal(body.includes("token-123"), false);
  assert.equal(body.includes("Authorization"), false);

  const { answer } = payload.result;
  assert.equal(answer.priceKind, "live");
  assert.match(answer.note, /מהחיפוש הזה/);
  const [match, cheaper, faster, similar] = answer.slots;
  for (const slot of answer.slots) assertTradeoff(slot);
  assert.equal(match.offer.seller, "מהיר עד הבית");
  assert.equal(match.offer.days, 1);
  assert.equal(match.offer.source, "shopping");
  assert.equal(match.offer.price, 210);
  assert.equal(cheaper.offer.source, "ebay");
  assert.equal(cheaper.offer.seller, "seller_d");
  assert.equal(cheaper.offer.price, 15);
  assert.equal(faster.offer, null);
  assert.match(faster.line, /אין/);
  assert.equal(similar.offer.seller, "seller_b");
  assert.equal(similar.offer.condition, "used");
  assert.equal(similar.offer.days, 2);
  for (const slot of answer.slots) assertNoInventedFacts(slot);
  const facebook = payload.result.plan.kinds.find((kind) => kind.id === "used").providers.find((item) => item.id === "facebook");
  assert.equal(facebook.role, "phrase");
  assert.equal(facebook.call.sent, false);
  assert.equal(Object.hasOwn(facebook, "price"), false);
});

test("an empty engine response does not fall back to a made-up price", async () => {
  const payload = await runSearch({
    prompt: "אוזניות",
    filters: {},
    env: { SERPAPI_API_KEY: SERP_SECRET, EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: EBAY_SECRET },
    fetchImpl: async (url) => {
      if (String(url).includes("oauth2/token")) return jsonResponse({ access_token: "token-123" });
      if (String(url).includes("serpapi.com")) return jsonResponse({ shopping_results: [] });
      return jsonResponse({ itemSummaries: [] });
    },
  });
  assert.equal(payload.result.answer.priceKind, "none");
  assert.match(payload.result.answer.note, /אין תוצאה/);
  assert.match(payload.result.answer.note, /לא מוצג מחיר/);
  for (const slot of payload.result.answer.slots) {
    assert.equal(slot.offer, null);
    assert.equal(slot.product, null);
    assert.match(slot.line, /אין/);
    assertTradeoff(slot);
  }
  assert.equal(JSON.stringify(payload.result.answer).includes("149"), false);
});

test("facebook and yad2 are not hosts the server is allowed to call", () => {
  assert.throws(() => assertAllowedHost("https://www.facebook.com/marketplace/search"), /blocked/);
  assert.throws(() => assertAllowedHost("https://www.yad2.co.il/products/all"), /blocked/);
  assert.equal(assertAllowedHost("https://serpapi.com/search.json"), "serpapi.com");
  assert.equal(assertAllowedHost("https://api.ebay.com/buy/browse/v1/item_summary/search"), "api.ebay.com");
});

test("the search command keeps a missing password out of the call", () => {
  const child = spawnSync("node", ["--import", "./test/register.mjs", "server/search-cli.js"], {
    input: JSON.stringify({ prompt: "אוזניות עד 200 משלוח מהיר", filters: {} }),
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.result.live.shopping.sent, false);
  assert.equal(payload.result.live.ebay.sent, false);
  assert.equal(payload.result.answer.priceKind, "demo");
  assert.equal(payload.result.answer.slots[0].product.id, "soundmini");
  assert.match(payload.result.answer.note, /דוגמה/);
  assert.match(payload.result.answer.note, /סיסמה/);
  assert.equal(child.stdout.includes("api_key"), false);
});
