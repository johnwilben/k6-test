/**
 * k6 Stress Test — PalawanPay Jewelry Frontend
 *
 * Covers:
 *  - User Profile navigation
 *  - Product search & filter
 *  - PDP navigation
 *  - Cart (view, add, remove)
 *  - Wishlist (add, remove)
 *  - Address CRUD
 *  - Purchases/Orders page
 *
 * Usage:
 *   k6 run \
 *     -e TOKEN=<jwt> \
 *     -e BASE_URL=https://jewelry-uat.palawanpay.com \
 *     tests/stress.js
 */

import { sleep, group } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { randomItem } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { gqlRequest, parseGQL } from "../lib/graphql.js";
import {
  GET_CUSTOMER_PROFILE,
  SEARCH_PRODUCTS,
  FILTER_PRODUCTS,
  GET_PRODUCT_DETAIL,
  CREATE_CUSTOMER_CART,
  GET_CART,
  ADD_SIMPLE_PRODUCT_TO_CART,
  ADD_CONFIGURABLE_PRODUCT_TO_CART,
  REMOVE_CART_ITEM,
  GET_WISHLIST,
  ADD_TO_WISHLIST,
  REMOVE_FROM_WISHLIST,
  CREATE_ADDRESS,
  UPDATE_ADDRESS,
  DELETE_ADDRESS,
  GET_ORDERS,
} from "../lib/queries.js";

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const profileLoadTime = new Trend("profile_load_time", true);
const searchLoadTime = new Trend("search_load_time", true);
const pdpLoadTime = new Trend("pdp_load_time", true);
const cartLoadTime = new Trend("cart_load_time", true);
const wishlistLoadTime = new Trend("wishlist_load_time", true);
const ordersLoadTime = new Trend("orders_load_time", true);
const gqlErrors = new Counter("graphql_errors");
const successRate = new Rate("success_rate");

// ─── Load Stages ──────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    stress_test: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "2m", target: 10 },   // ramp-up
        { duration: "5m", target: 25 },   // stress
        { duration: "3m", target: 50 },  // peak
        { duration: "2m", target: 25 },   // scale-down
        { duration: "2m", target: 0 },    // cooldown
      ],
      gracefulRampDown: "30s",
    },
    spike_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 0 },
        { duration: "10s", target: 100 }, // spike
        { duration: "1m",  target: 100 },
        { duration: "10s", target: 0 },
      ],
      startTime: "15m", // runs after stress_test
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<3000", "p(99)<5000"],
    http_req_failed: ["rate<0.05"],
    success_rate: ["rate>0.95"],
    graphql_errors: ["count<100"],
  },
};

// ─── Seed Data ────────────────────────────────────────────────────────────────

const SEARCH_TERMS = ["ring", "necklace", "bracelet", "earring", "gold", "silver", "diamond"];
const CATEGORY_IDS = ["4", "5", "6", "7", "8"];
const SAMPLE_SKUS = ["earring_1", "earring_2", "earring_3", "earring_4"];
const SAMPLE_URL_KEYS = ["earring-1", "earring-2", "earring-3", "earring-4"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recordMetric(metric, res) {
  metric.add(res.timings.duration);
  const body = parseGQL(res);
  if (!body || body.errors) {
    gqlErrors.add(1);
    successRate.add(false);
  } else {
    successRate.add(true);
  }
  return body;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

export default function () {
  const token = __ENV.TOKEN;

  if (!token) {
    console.error("TOKEN env variable is required. Pass -e TOKEN=<jwt>");
    return;
  }

  // ── 1. User Profile ─────────────────────────────────────────────────────────
  group("user_profile", () => {
    const res = gqlRequest(GET_CUSTOMER_PROFILE, {}, token);
    recordMetric(profileLoadTime, res);
    sleep(1);
  });

  // ── 2. Search / Filter Products ──────────────────────────────────────────────
  group("product_search_and_filter", () => {
    const term = randomItem(SEARCH_TERMS);
    const searchRes = gqlRequest(
      SEARCH_PRODUCTS,
      { search: term, pageSize: 20, currentPage: 1 },
      token
    );
    recordMetric(searchLoadTime, searchRes);
    sleep(0.5);

    const filterRes = gqlRequest(
      FILTER_PRODUCTS,
      {
        categoryId: randomItem(CATEGORY_IDS),
        pageSize: 20,
        currentPage: 1,
        sortField: { name: "ASC" },
      },
      token
    );
    recordMetric(searchLoadTime, filterRes);
    sleep(1);
  });

  // ── 3. PDP ───────────────────────────────────────────────────────────────────
  group("product_detail_page", () => {
    const urlKey = randomItem(SAMPLE_URL_KEYS);
    const res = gqlRequest(GET_PRODUCT_DETAIL, { urlKey }, token);
    recordMetric(pdpLoadTime, res);
    sleep(2);
  });

  // ── 4. Cart — View, Add, Remove ──────────────────────────────────────────────
  group("shopping_cart", () => {
    // Create cart
    const createRes = gqlRequest(CREATE_CUSTOMER_CART, {}, token);
    const createBody = parseGQL(createRes);
    const cartId = createBody?.data?.createEmptyCart;

    if (!cartId) {
      gqlErrors.add(1);
      successRate.add(false);
      return;
    }

    // View cart
    const viewRes = gqlRequest(GET_CART, { cartId }, token);
    recordMetric(cartLoadTime, viewRes);
    sleep(0.5);

    // Add product
    const sku = randomItem(SAMPLE_SKUS);
    const addRes = gqlRequest(
      ADD_SIMPLE_PRODUCT_TO_CART,
      { cartId, sku, quantity: 1 },
      token
    );
    const addBody = recordMetric(cartLoadTime, addRes);
    sleep(0.5);

    // Remove product
    const items = addBody?.data?.addSimpleProductsToCart?.cart?.items;
    if (items && items.length > 0) {
      const itemId = items[0].id;
      const removeRes = gqlRequest(REMOVE_CART_ITEM, { cartId, itemId }, token);
      recordMetric(cartLoadTime, removeRes);
    }
    sleep(1);
  });

  // ── 5. Wishlist — Add, Remove ─────────────────────────────────────────────────
  group("wishlist", () => {
    // Get wishlist
    const getRes = gqlRequest(GET_WISHLIST, {}, token);
    recordMetric(wishlistLoadTime, getRes);
    sleep(0.5);

    // Add to wishlist
    const sku = randomItem(SAMPLE_SKUS);
    const addRes = gqlRequest(ADD_TO_WISHLIST, { sku }, token);
    const addBody = recordMetric(wishlistLoadTime, addRes);
    sleep(0.5);

    // Remove from wishlist
    const wishlistItems = addBody?.data?.addProductsToWishlist?.wishlist?.items;
    if (wishlistItems && wishlistItems.length > 0) {
      const wishlistItemId = wishlistItems[0].id;
      const removeRes = gqlRequest(
        REMOVE_FROM_WISHLIST,
        { wishlistItemId: String(wishlistItemId) },
        token
      );
      recordMetric(wishlistLoadTime, removeRes);
    }
    sleep(1);
  });

  // ── 6. Addresses — Add, Update, Remove ───────────────────────────────────────
  group("addresses", () => {
    // Create address
    const createRes = gqlRequest(
      CREATE_ADDRESS,
      {
        firstname: "Test",
        lastname: "User",
        street: ["123 Test Street"],
        city: "Manila",
        postcode: "1000",
        telephone: "09171234567",
        countryCode: "PH",
      },
      token
    );
    const createBody = parseGQL(createRes);
    const newAddressId = createBody?.data?.createCustomerAddress?.id;
    successRate.add(!createBody?.errors);
    sleep(0.5);

    if (newAddressId) {
      // Update address
      const updateRes = gqlRequest(
        UPDATE_ADDRESS,
        {
          id: newAddressId,
          city: "Quezon City",
          postcode: "1100",
        },
        token
      );
      successRate.add(!parseGQL(updateRes)?.errors);
      sleep(0.5);

      // Delete address
      const deleteRes = gqlRequest(DELETE_ADDRESS, { id: newAddressId }, token);
      successRate.add(!parseGQL(deleteRes)?.errors);
    }
    sleep(1);
  });

  // ── 7. Orders / Purchases Page ───────────────────────────────────────────────
  group("orders_page", () => {
    const res = gqlRequest(
      GET_ORDERS,
      { pageSize: 10, currentPage: 1 },
      token
    );
    recordMetric(ordersLoadTime, res);
    sleep(1);
  });

  // Simulate realistic think time between user actions
  sleep(Math.random() * 3 + 1);
}

export function handleSummary(data) {
  return {
    "stdout": textSummary(data, { indent: " ", enableColors: true }),
    "results/summary.json": JSON.stringify(data, null, 2),
  };
}

// Inline textSummary (avoids external import issues in some k6 versions)
function textSummary(data, opts = {}) {
  const { indent = "  " } = opts;
  const lines = ["\n=== k6 Test Summary ==="];

  const metrics = data.metrics || {};
  const thresholds = data.thresholds || {};

  // HTTP
  const dur = metrics.http_req_duration;
  if (dur) {
    lines.push(`\n${indent}HTTP Request Duration:`);
    lines.push(`${indent}  avg=${dur.values.avg?.toFixed(0)}ms  p95=${dur.values["p(95)"]?.toFixed(0)}ms  p99=${dur.values["p(99)"]?.toFixed(0)}ms`);
  }

  // Error rate
  const failed = metrics.http_req_failed;
  if (failed) {
    lines.push(`${indent}HTTP Failures: ${(failed.values.rate * 100).toFixed(2)}%`);
  }

  // Custom metrics
  [
    ["Profile Load", "profile_load_time"],
    ["Search Load", "search_load_time"],
    ["PDP Load", "pdp_load_time"],
    ["Cart Load", "cart_load_time"],
    ["Wishlist Load", "wishlist_load_time"],
    ["Orders Load", "orders_load_time"],
  ].forEach(([label, key]) => {
    const m = metrics[key];
    if (m) {
      lines.push(
        `${indent}${label}: avg=${m.values.avg?.toFixed(0)}ms  p95=${m.values["p(95)"]?.toFixed(0)}ms`
      );
    }
  });

  // GQL errors
  const gqlErr = metrics["graphql_errors"];
  if (gqlErr) {
    lines.push(`${indent}GraphQL Errors: ${gqlErr.values.count}`);
  }

  // Success rate
  const sr = metrics["success_rate"];
  if (sr) {
    lines.push(`${indent}Success Rate: ${(sr.values.rate * 100).toFixed(2)}%`);
  }

  // Threshold results
  lines.push(`\n${indent}Thresholds:`);
  Object.entries(thresholds).forEach(([name, result]) => {
    const passed = !result.ok === false;
    const icon = result.ok ? "✓" : "✗";
    lines.push(`${indent}  ${icon} ${name}`);
  });

  lines.push("\n======================\n");
  return lines.join("\n");
}
