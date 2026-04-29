import { sleep, group } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { randomItem, uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { gqlRequest, parseGQL } from "./graphql.js";
import * as queries from "./queries.js";

// ─── ENV ────────────────────────────────────────────────
const DEBUG = __ENV.DEBUG === "true";

// ─── GLOBAL METRICS ─────────────────────────────────────
const httpDuration = new Trend("http_duration", true);
const gqlDuration = new Trend("gql_duration", true);

const gqlErrors = new Counter("gql_errors");
const httpErrors = new Counter("http_errors");

const successRate = new Rate("success_rate");

// ✅ PRE-DECLARED endpoint metrics
const m = {
  profile: new Trend("endpoint_profile_duration", true),
  search: new Trend("endpoint_search_duration", true),
  pdp: new Trend("endpoint_pdp_duration", true),
  create_cart: new Trend("endpoint_create_cart_duration", true),
  add_to_cart: new Trend("endpoint_add_to_cart_duration", true),
  remove_from_cart: new Trend("endpoint_remove_from_cart_duration", true),
  orders: new Trend("endpoint_orders_duration", true),
};

const e = {
  profile: new Counter("endpoint_profile_errors"),
  search: new Counter("endpoint_search_errors"),
  pdp: new Counter("endpoint_pdp_errors"),
  create_cart: new Counter("endpoint_create_cart_errors"),
  add_to_cart: new Counter("endpoint_add_to_cart_errors"),
  remove_from_cart: new Counter("endpoint_remove_from_cart_errors"),
  orders: new Counter("endpoint_orders_errors"),
};

// ─── LOGGER ─────────────────────────────────────────────
function log(msg) {
  if (DEBUG) console.log(`VU ${__VU} | ITER ${__ITER} | ${msg}`);
}

function logError(msg, data) {
  console.error(`❌ ${msg}`, data || "");
}

// ─── TRACKED REQUEST ────────────────────────────────────
function trackedRequest(name, query, variables, token) {
  const correlationId = uuidv4();

  const start = Date.now();

  const res = gqlRequest(query, variables, token, {
    headers: { "x-correlation-id": correlationId },
    tags: { endpoint: name },
  });

  const duration = Date.now() - start;

  // Global
  httpDuration.add(res.timings.duration);
  gqlDuration.add(duration);

  // Endpoint
  m[name].add(duration);

  const body = parseGQL(res);

  // HTTP error
  if (res.status !== 200) {
    httpErrors.add(1);
    e[name].add(1);

    logError(`${name} HTTP ERROR`, {
      status: res.status,
      cid: correlationId,
    });
  }

  // GQL error
  if (!body || body.errors) {
    gqlErrors.add(1);
    e[name].add(1);
    successRate.add(false);

    logError(`${name} GQL ERROR`, {
      cid: correlationId,
      errors: body?.errors,
    });

    if (DEBUG) logError("Response", res.body);
  } else {
    successRate.add(true);
    log(`${name} ✅ ${duration}ms | CID=${correlationId}`);
  }

  return body;
}

// ─── OPTIONS ────────────────────────────────────────────
export const options = {
  scenarios: {
    stress: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "2m", target: 10 },
        { duration: "5m", target: 50 },
        { duration: "3m", target: 100 },
        { duration: "2m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_duration: ["p(95)<3000"],
    gql_duration: ["p(95)<3000"],
    success_rate: ["rate>0.95"],
  },
};

// ─── DATA ───────────────────────────────────────────────
const TERMS = ["ring", "gold", "diamond"];
const SKUS = ["SKU001", "SKU002"];
const URL_KEYS = ["gold-ring-001"];

// ─── FLOW ───────────────────────────────────────────────
export default function () {
  const token = __ENV.TOKEN;

  if (!token) {
    logError("TOKEN required");
    return;
  }

  group("profile", () => {
    trackedRequest("profile", queries.GET_CUSTOMER_PROFILE, {}, token);
    sleep(1);
  });

  group("search", () => {
    trackedRequest(
      "search",
      queries.SEARCH_PRODUCTS,
      { search: randomItem(TERMS), pageSize: 10 },
      token
    );
    sleep(1);
  });

  group("pdp", () => {
    trackedRequest(
      "pdp",
      queries.GET_PRODUCT_DETAIL,
      { urlKey: randomItem(URL_KEYS) },
      token
    );
    sleep(1);
  });

  group("cart", () => {
    const cart = trackedRequest(
      "create_cart",
      queries.CREATE_CUSTOMER_CART,
      {},
      token
    );

    const cartId = cart?.data?.createEmptyCart;
    if (!cartId) return;

    const add = trackedRequest(
      "add_to_cart",
      queries.ADD_SIMPLE_PRODUCT_TO_CART,
      { cartId, sku: randomItem(SKUS), quantity: 1 },
      token
    );

    const itemId =
      add?.data?.addSimpleProductsToCart?.cart?.items?.[0]?.id;

    if (itemId) {
      trackedRequest(
        "remove_from_cart",
        queries.REMOVE_CART_ITEM,
        { cartId, itemId },
        token
      );
    }

    sleep(1);
  });

  group("orders", () => {
    trackedRequest(
      "orders",
      queries.GET_ORDERS,
      { pageSize: 5 },
      token
    );
    sleep(1);
  });

  sleep(Math.random() * 2 + 1);
}
