import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// ============================================
// CONFIG & OPTIONS
// ============================================
const BASE_URL = 'https://magento-backend-uat.palawanpay.com/graphql';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '4m',  target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // 95% of requests must be under 5s
    'errors': ['rate<0.1'],            // Error rate must be less than 10%
  },
};

// ============================================
// METRICS & DATA
// ============================================
const errorRate = new Rate('errors');
const m = {};
['storeConfig','currency','categories','searchProducts','filterByCategory','pdp','profile','viewCart','addToCart','removeFromCart','addWishlist','removeWishlist','addAddress','updateAddress','removeAddress','orders','orderDetail'].forEach(f => {
    m[f] = new Trend(f + '_duration');
});

const SEARCHES = ['ring','gold','necklace','bracelet','earring'];
const SKUS = ['Ring A','Gold Ring','Gold Necklace']; 
const ORDER_NUMBERS = ['000000564','000000593'];

// ============================================
// CORE HELPER (The "Fix")
// ============================================
function gql(query, name) {
  const token = __ENV.CUSTOMER_TOKEN;
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };

  const res = http.post(BASE_URL, JSON.stringify({ query }), params);

  const pass = check(res, {
    [`${name} HTTP 200`]: (r) => r.status === 200,
    [`${name} GQL No Errors`]: (r) => {
      try {
        const body = r.json();
        return !body.errors || body.errors.length === 0;
      } catch (e) { return false; }
    },
  });

  errorRate.add(!pass);
  if (m[name]) m[name].add(res.timings.duration);
  return res;
}

function think() { sleep(Math.random() * 2 + 0.5); }
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ============================================
// ACTIONS (Refactored for Stability)
// ============================================
function pageLoad() {
  gql(`{ storeConfig { store_name } }`, 'storeConfig');
  gql(`{ currency { base_currency_code } }`, 'currency');
}

function viewCart() {
  const res = gql(`{ customerCart { id total_quantity items { id product { sku } quantity } } }`, 'viewCart');
  try { return res.json().data?.customerCart; } catch(e) { return null; }
}

function viewPDP() {
  const sku = rand(SKUS);
  gql(`{ products(filter: { sku: { eq: "${sku}" } }) { items { sku name } } }`, 'pdp');
}

// ============================================
// PERSONAS
// ============================================
function buyerFlow() {
  group('Buyer', () => {
    pageLoad();
    think();
    
    // Search & View
    gql(`{ products(search: "${rand(SEARCHES)}", pageSize: 5) { items { sku } } }`, 'searchProducts');
    think();
    viewPDP();
    
    // Cart Activity
    const cart = viewCart();
    if (cart && cart.id) {
      gql(`mutation { addProductsToCart(cartId: "${cart.id}", cartItems: [{ sku: "${rand(SKUS)}", quantity: 1 }]) { cart { id } } }`, 'addToCart');
    }
  });
}

// (Other flows follow the same pattern...)

export default function () {
  // Check muna kung may token, kung wala, huwag tumakbo.
  if (!__ENV.CUSTOMER_TOKEN) {
    console.error("Missing CUSTOMER_TOKEN! Run with: -e CUSTOMER_TOKEN=your_token");
    return;
  }

  const roll = Math.random();
  if (roll < 0.5) {
    buyerFlow();
  } else {
    group('QuickCheck', () => {
        pageLoad();
        gql(`{ customer { email } }`, 'profile');
    });
  }
}

// ============================================
// REPORTING
// ============================================
export function handleSummary(data) {
  return {
    "report.html": htmlReport(data),
    "summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
