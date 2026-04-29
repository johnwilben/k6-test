import http from "k6/http";
import { sleep, group } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { randomItem, uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { gqlRequest, parseGQL } from "../lib/graphql.js";
import * as queries from "../lib/queries.js";

// ─── ENV ─────────────────────────────────────────────────
const DEBUG = __ENV.DEBUG === "true";
const BASE_URL = __ENV.BASE_URL;

// ─── GLOBAL METRICS ──────────────────────────────────────
const httpDuration = new Trend("http_duration", true);
const gqlDuration = new Trend("gql_duration", true);

const gqlErrors = new Counter("gql_errors");
const httpErrors = new Counter("http_errors");

const successRate = new Rate("success_rate");

// Endpoint-level metrics
const endpointTrends = {};
const endpointErrors = {};

// ─── METRIC FACTORY ──────────────────────────────────────
function getTrend(name) {
  if (!endpointTrends[name]) {
    endpointTrends[name] = new Trend(`endpoint_${name}_duration`, true);
  }
  return endpointTrends[name];
}

function getErrorCounter(name) {
  if (!endpointErrors[name]) {
    endpointErrors[name] = new Counter(`endpoint_${name}_errors`);
  }
  return endpointErrors[name];
}

// ─── LOGGER ──────────────────────────────────────────────
function log(msg) {
  if (DEBUG) console.log(`VU ${__VU} | ITER ${__ITER} | ${msg}`);
}

function logError(msg, data) {
  console.error(`❌ ${msg}`, data || "");
}

// ─── CORE REQUEST WRAPPER ────────────────────────────────
function trackedRequest(name, query, variables, token) {
  const correlationId = uuidv4();

  const tags = {
    name,
    group: __ENV.K6_GROUP || "default",
  };

  const start = Date.now();

  const res = gqlRequest(query, variables, token, {
    headers: {
      "x-correlation-id": correlationId,
    },
    tags,
  });

  const duration = Date.now() - start;

  // Global metrics
  httpDuration.add(res.timings.duration, tags);
  gqlDuration.add(duration, tags);

  // Endpoint metrics
  getTrend(name).add(duration);

  const body = parseGQL(res);

  // HTTP errors
  if (res.status !== 200) {
    httpErrors.add(1);
    getErrorCounter(name).add(1);

    logError(`${name} HTTP ERROR`, {
      status: res.status,
      correlationId,
    });
  }

  // GraphQL errors
  if (!body || body.errors) {
    gqlErrors.add(1);
    getErrorCounter(name).add(1);
    successRate.add(false);

    logError(`${name} GQL ERROR`, {
      correlationId,
      errors: body?.errors,
    });

    if (DEBUG) {
      logError("Response Body", res.body);
    }
  } else {
    successRate.add(true);
    log(`${name} ✅ ${duration}ms | CID=${correlationId}`);
  }

  return body;
}

// ─── OPTIONS ─────────────────────────────────────────────
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
    gql_errors: ["count<100"],
  },
};

// ─── DATA ────────────────────────────────────────────────
const TERMS = ["ring", "gold", "diamond"];
const SKUS = ["SKU001", "SKU002"];
const URL_KEYS = ["gold-ring-001"];

// ─── FLOW ────────────────────────────────────────────────
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
