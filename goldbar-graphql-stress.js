import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { randomItem } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import { SharedArray } from "k6/data";
import papaparse from "https://jslib.k6.io/papaparse/5.1.1/index.js";

// ─── CONFIG ─────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "https://goldbar-uat.palawanpay.com";
const GRAPHQL_URL = `${BASE_URL}/api/graphql`;
const BACKEND_GRAPHQL = __ENV.BACKEND_GRAPHQL || "https://gold-magento-backend-uat.palawanpay.com/graphql";

// ─── TOKEN HANDLING ─────────────────────────────────────
const TOKENS = new SharedArray("tokens", function () {
  if (__ENV.TOKENS_CSV) {
    const csv = papaparse.parse(open(__ENV.TOKENS_CSV), { header: true });
    return csv.data.map((row) => row.token).filter(Boolean);
  }
  if (__ENV.TOKENS_JSON) {
    return JSON.parse(open(__ENV.TOKENS_JSON));
  }
  if (__ENV.TOKENS_FILE) {
    const raw = open(__ENV.TOKENS_FILE);
    return raw.split("\n").map((t) => t.trim()).filter(Boolean);
  }
  if (__ENV.TOKEN) {
    return [__ENV.TOKEN];
  }
  return [];
});

function getToken() {
  if (TOKENS.length === 0) return null;
  return TOKENS[(__VU - 1) % TOKENS.length];
}

// ─── VU SCALING ─────────────────────────────────────────
const PEAK_VUS = parseInt(__ENV.VUS || "50", 10);
const RAMP_PRESET = __ENV.RAMPUP || "normal";

function getStages() {
  const p = PEAK_VUS;
  if (RAMP_PRESET === "fast") {
    return [
      { duration: "1m", target: Math.ceil(p * 0.3) },
      { duration: "2m", target: p },
      { duration: "3m", target: p },
      { duration: "1m", target: 0 },
    ];
  }
  if (RAMP_PRESET === "long") {
    return [
      { duration: "3m", target: Math.ceil(p * 0.2) },
      { duration: "5m", target: Math.ceil(p * 0.5) },
      { duration: "5m", target: p },
      { duration: "5m", target: p },
      { duration: "2m", target: 0 },
    ];
  }
  // normal
  return [
    { duration: "2m", target: Math.ceil(p * 0.2) },
    { duration: "3m", target: Math.ceil(p * 0.5) },
    { duration: "5m", target: p },
    { duration: "2m", target: 0 },
  ];
}

// ─── METRICS ────────────────────────────────────────────
const gqlErrors = new Rate("gql_errors");
const gqlSuccess = new Rate("gql_success");
const searchDuration = new Trend("gql_search_duration", true);
const pdpDuration = new Trend("gql_pdp_duration", true);
const cartCreateDuration = new Trend("gql_cart_create_duration", true);
const cartAddDuration = new Trend("gql_cart_add_duration", true);
const cartViewDuration = new Trend("gql_cart_view_duration", true);
const wishlistDuration = new Trend("gql_wishlist_duration", true);
const profileDuration = new Trend("gql_profile_duration", true);
const ordersDuration = new Trend("gql_orders_duration", true);
const menuDuration = new Trend("gql_menu_duration", true);
const cmsBlocksDuration = new Trend("gql_cms_blocks_duration", true);

// ─── OPTIONS ────────────────────────────────────────────
export const options = {
  scenarios: {
    graphql_stress: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: getStages(),
    },
  },
  thresholds: {
    gql_errors: ["rate<0.10"],
    gql_success: ["rate>0.90"],
    gql_search_duration: ["p(95)<10000"],
    gql_pdp_duration: ["p(95)<8000"],
  },
};

// ─── GRAPHQL HELPER ─────────────────────────────────────
function gql(query, variables = {}, token = null, tags = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const payload = JSON.stringify({ query, variables });
  const res = http.post(GRAPHQL_URL, payload, { headers, tags });

  const success = check(res, {
    "status 200": (r) => r.status === 200,
    "no errors": (r) => {
      try {
        const body = JSON.parse(r.body);
        return !body.errors;
      } catch {
        return false;
      }
    },
  });

  gqlSuccess.add(success ? 1 : 0);
  gqlErrors.add(success ? 0 : 1);

  return res;
}

function parseResponse(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

// ─── QUERIES ────────────────────────────────────────────
const SEARCH_PRODUCTS = `
  query SearchProducts($search: String!, $pageSize: Int, $currentPage: Int) {
    products(search: $search, pageSize: $pageSize, currentPage: $currentPage) {
      total_count
      items {
        id
        sku
        name
        url_key
        price_range {
          minimum_price {
            regular_price { value currency }
            final_price { value currency }
          }
        }
        small_image { url label }
      }
      page_info { current_page page_size total_pages }
    }
  }
`;

const GET_PRODUCT_DETAIL = `
  query GetProductDetail($urlKey: String!) {
    products(filter: { url_key: { eq: $urlKey } }) {
      items {
        id
        sku
        name
        description { html }
        price_range {
          minimum_price {
            regular_price { value currency }
            final_price { value currency }
            discount { amount_off percent_off }
          }
        }
        media_gallery { url label }
        ... on ConfigurableProduct {
          configurable_options {
            attribute_code
            label
            values { uid label swatch_data { value } }
          }
          variants {
            attributes { uid code value_index label }
            product { id sku price_range { minimum_price { final_price { value currency } } } }
          }
        }
      }
    }
  }
`;

const CREATE_EMPTY_CART = `
  mutation CreateEmptyCart {
    createEmptyCart
  }
`;

const ADD_TO_CART = `
  mutation AddSimpleProductToCart($cartId: String!, $sku: String!, $quantity: Float!) {
    addSimpleProductsToCart(
      input: {
        cart_id: $cartId
        cart_items: [{ data: { sku: $sku, quantity: $quantity } }]
      }
    ) {
      cart {
        id
        total_quantity
        items { id quantity product { sku name } }
      }
    }
  }
`;

const GET_CART = `
  query GetCart($cartId: String!) {
    cart(cart_id: $cartId) {
      id
      total_quantity
      items {
        id
        quantity
        product { id sku name price_range { minimum_price { final_price { value currency } } } }
      }
      prices { grand_total { value currency } subtotal_including_tax { value currency } }
    }
  }
`;

const GET_CUSTOMER_PROFILE = `
  query GetCustomerProfile {
    customer {
      id
      firstname
      lastname
      email
      addresses { id firstname lastname street city postcode telephone country_code }
      wishlist { id items_count }
      orders { total_count }
    }
  }
`;

const GET_ORDERS = `
  query GetOrders($pageSize: Int, $currentPage: Int) {
    customer {
      orders(pageSize: $pageSize, currentPage: $currentPage) {
        total_count
        items {
          id
          number
          order_date
          status
          total { grand_total { value currency } }
        }
        page_info { current_page page_size total_pages }
      }
    }
  }
`;

const ADD_TO_WISHLIST = `
  mutation AddToWishlist($sku: String!) {
    addProductsToWishlist(
      wishlistId: "0"
      wishlistItems: [{ sku: $sku, quantity: 1 }]
    ) {
      wishlist { id items_count }
      user_errors { code message }
    }
  }
`;

const GET_MENU = `
  query GetMenu {
    categories(filters: { parent_id: { eq: "2" } }) {
      items {
        id
        name
        url_key
        children {
          id
          name
          url_key
        }
      }
    }
  }
`;

const GET_CMS_BLOCKS = `
  query GetCmsBlocks($identifiers: [String!]!) {
    cmsBlocks(identifiers: $identifiers) {
      items {
        identifier
        title
        content
      }
    }
  }
`;

// ─── DATA ───────────────────────────────────────────────
const SEARCH_TERMS = ["gold", "bar", "coin", "variant", "test"];
const PRODUCT_URL_KEYS = [
  "gold-empty-featured-test",
  "gold-bar-variant",
  "new-gold-bar-with-variant",
  "gold-with-variant",
  "test-gold-details",
  "test-gold-2",
];
const PRODUCT_SKUS = [
  "gold-empty-featured-test",
  "gold-bar-variant",
  "new-gold-bar-with-variant",
  "gold-with-variant",
  "test-gold-details",
  "test-gold-2",
];

// ═══════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════
export default function () {
  const token = getToken();

  // ── 1. GET MENU (homepage load) ─────────────────────
  {
    const start = Date.now();
    gql(GET_MENU, {}, token, { name: "menu" });
    menuDuration.add(Date.now() - start);
  }
  sleep(1);

  // ── 2. CMS BLOCKS (homepage banners) ────────────────
  {
    const start = Date.now();
    gql(GET_CMS_BLOCKS, { identifiers: ["homepage-banner", "gold-banner"] }, token, { name: "cmsBlocks" });
    cmsBlocksDuration.add(Date.now() - start);
  }
  sleep(1);

  // ── 3. SEARCH ───────────────────────────────────────
  {
    const term = randomItem(SEARCH_TERMS);
    const start = Date.now();
    gql(SEARCH_PRODUCTS, { search: term, pageSize: 12, currentPage: 1 }, token, { name: "search" });
    searchDuration.add(Date.now() - start);
  }
  sleep(1);

  // ── 4. PDP ──────────────────────────────────────────
  {
    const urlKey = randomItem(PRODUCT_URL_KEYS);
    const start = Date.now();
    gql(GET_PRODUCT_DETAIL, { urlKey }, token, { name: "pdp" });
    pdpDuration.add(Date.now() - start);
  }
  sleep(1);

  // ── 5. CUSTOMER PROFILE (authenticated) ─────────────
  if (token) {
    const start = Date.now();
    gql(GET_CUSTOMER_PROFILE, {}, token, { name: "profile" });
    profileDuration.add(Date.now() - start);
    sleep(1);
  }

  // ── 6. CREATE CART + ADD ITEM ───────────────────────
  {
    const startCreate = Date.now();
    const cartRes = gql(CREATE_EMPTY_CART, {}, token, { name: "createCart" });
    cartCreateDuration.add(Date.now() - startCreate);

    const cartData = parseResponse(cartRes);
    const cartId = cartData?.data?.createEmptyCart;

    if (cartId) {
      sleep(1);
      const sku = randomItem(PRODUCT_SKUS);
      const startAdd = Date.now();
      gql(ADD_TO_CART, { cartId, sku, quantity: 1 }, token, { name: "cartAdd" });
      cartAddDuration.add(Date.now() - startAdd);

      sleep(1);
      const startView = Date.now();
      gql(GET_CART, { cartId }, token, { name: "cartView" });
      cartViewDuration.add(Date.now() - startView);
    }
  }
  sleep(1);

  // ── 7. WISHLIST (authenticated) ─────────────────────
  if (token) {
    const sku = randomItem(PRODUCT_SKUS);
    const start = Date.now();
    gql(ADD_TO_WISHLIST, { sku }, token, { name: "wishlist" });
    wishlistDuration.add(Date.now() - start);
    sleep(1);
  }

  // ── 8. ORDERS (authenticated) ───────────────────────
  if (token) {
    const start = Date.now();
    gql(GET_ORDERS, { pageSize: 5, currentPage: 1 }, token, { name: "orders" });
    ordersDuration.add(Date.now() - start);
  }

  sleep(randInt(1, 3));
}

// ─── REPORTING ──────────────────────────────────────────
export function handleSummary(data) {
  return {
    "goldbar-graphql-report.html": htmlReport(data),
    "goldbar-graphql-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
