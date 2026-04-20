import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// ============================================
// CONFIG
// ============================================
const BASE_URL = 'https://magento-backend-uat.palawanpay.com/graphql';
const CUSTOMER_TOKEN = __ENV.CUSTOMER_TOKEN || 'PASTE_TOKEN_HERE';

// ============================================
// METRICS
// ============================================
const errorRate = new Rate('errors');
const personaRate = { buyer: new Rate('buyer_errors'), shopper: new Rate('shopper_errors'), checker: new Rate('checker_errors'), manager: new Rate('manager_errors') };
const m = {};
['storeConfig','currency','categories','searchProducts','filterByCategory','pdp','profile','viewCart','addToCart','removeFromCart','addWishlist','removeWishlist','addAddress','updateAddress','removeAddress','orders','orderDetail','shippingFee'].forEach(f => m[f] = new Trend(f + '_duration'));

// ============================================
// OPTIONS
// ============================================
export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '4m',  target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    errors: ['rate<0.1'],
  },
};

// ============================================
// HELPERS
// ============================================
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CUSTOMER_TOKEN}` };

function gql(query) {
  return http.post(BASE_URL, JSON.stringify({ query }), { headers });
}

function ok(res, name) {
  const pass = check(res, {
    [`${name} ok`]: r => r.status === 200 && !r.json().errors,
  });
  errorRate.add(!pass);
  if (m[name]) m[name].add(res.timings.duration);
  return res;
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function think() { sleep(0.5 + Math.random() * 2.5); } // 0.5-3s random think time

const CATEGORIES = [
  { uid: 'NA==', name: 'Rings' }, { uid: 'NQ==', name: 'Necklaces' },
  { uid: 'Ng==', name: 'Bracelets' }, { uid: 'Nw==', name: 'Earrings' },
  { uid: 'OA==', name: 'Pendants' }, { uid: 'OQ==', name: 'Diamonds' },
];
const SEARCHES = ['ring','gold','necklace','bracelet','earring','diamond','pendant','silver','pearl','chain'];
const SKUS = ['Ring A','Gold Ring','Gold Necklace','Ladies Ring','Gold variations','pendant_450k'];
const ORDER_NUMBERS = ['000000564','000000593','000000595'];

// ============================================
// REUSABLE ACTIONS
// ============================================
function pageLoad() {
  ok(gql(`{ storeConfig { store_name base_currency_code locale } }`), 'storeConfig');
  ok(gql(`{ currency { base_currency_code available_currency_codes } }`), 'currency');
}

function browseCategories() {
  return ok(gql(`{ categories(filters: { parent_id: { eq: "2" } }, pageSize: 10) {
    items { uid name product_count children { uid name product_count } }
  } }`), 'categories');
}

function searchProducts() {
  const term = rand(SEARCHES);
  const page = randInt(1, 3);
  const res = ok(gql(`{ products(search: "${term}", pageSize: 12, currentPage: ${page}, sort: { relevance: DESC }) {
    items { sku name url_key thumbnail { url } price_range { minimum_price { regular_price { value currency } final_price { value currency } } } }
    total_count page_info { current_page total_pages }
  } }`), 'searchProducts');
  return res;
}

function filterCategory() {
  const cat = rand(CATEGORIES);
  return ok(gql(`{ products(filter: { category_uid: { eq: "${cat.uid}" } }, pageSize: 12, sort: { position: ASC }) {
    items { sku name url_key price_range { minimum_price { regular_price { value currency } } } }
    total_count
  } }`), 'filterByCategory');
}

function viewPDP() {
  const sku = rand(SKUS);
  return ok(gql(`{ products(filter: { sku: { eq: "${sku}" } }) {
    items { sku name description { html } short_description { html }
      price_range { minimum_price { regular_price { value currency } final_price { value currency } discount { amount_off percent_off } } }
      media_gallery { url label } review_count rating_summary
      ... on ConfigurableProduct { configurable_options { attribute_code label values { label value_index } } }
    }
  } }`), 'pdp');
}

function viewProfile() {
  return ok(gql(`{ customer {
    email firstname lastname date_of_birth gender
    addresses { id firstname lastname street city postcode telephone default_shipping default_billing }
    wishlists { id items_count } orders { total_count }
  } }`), 'profile');
}

function viewCart() {
  const res = ok(gql(`{ customerCart {
    id total_quantity
    items { id uid product { sku name } quantity prices { price { value currency } row_total { value currency } } }
    prices { grand_total { value currency } subtotal_excluding_tax { value } }
  } }`), 'viewCart');
  return res.json().data?.customerCart;
}

function addToCart(cartId) {
  const sku = rand(SKUS);
  const res = ok(gql(`mutation { addProductsToCart(cartId: "${cartId}", cartItems: [{ sku: "${sku}", quantity: ${randInt(1,3)} }]) {
    cart { total_quantity items { id product { sku } quantity } }
  } }`), 'addToCart');
  return res.json().data?.addProductsToCart?.cart?.items;
}

function removeFromCart(cartId, itemId) {
  ok(gql(`mutation { removeItemFromCart(input: { cart_id: "${cartId}", cart_item_id: ${itemId} }) {
    cart { total_quantity items { id product { sku } quantity } }
  } }`), 'removeFromCart');
}

function addToWishlist(wishlistId) {
  const sku = rand(SKUS);
  const res = ok(gql(`mutation { addProductsToWishlist(wishlistId: "${wishlistId}", wishlistItems: [{ sku: "${sku}", quantity: 1 }]) {
    wishlist { id items_count items_v2(currentPage: 1, pageSize: 5) { items { id product { sku } } } }
  } }`), 'addWishlist');
  return res.json().data?.addProductsToWishlist?.wishlist?.items_v2?.items;
}

function removeFromWishlist(wishlistId, itemId) {
  ok(gql(`mutation { removeProductsFromWishlist(wishlistId: "${wishlistId}", wishlistItemsIds: ["${itemId}"]) {
    wishlist { id items_count }
  } }`), 'removeWishlist');
}

function viewOrders() {
  return ok(gql(`{ customer { orders(pageSize: 10, currentPage: 1, sort: { sort_direction: DESC, sort_field: CREATED_AT }) {
    items { number order_date status total { grand_total { value currency } } }
    total_count page_info { current_page total_pages }
  } } }`), 'orders');
}

function viewOrderDetail() {
  const num = rand(ORDER_NUMBERS);
  return ok(gql(`{ customer { orders(filter: { number: { eq: "${num}" } }) {
    items { number order_date status
      items { product_name product_sku quantity_ordered product_sale_price { value currency } }
      shipping_address { firstname lastname street city postcode }
      payment_methods { name } total { grand_total { value } subtotal { value } total_shipping { value } }
    }
  } } }`), 'orderDetail');
}

function addAddress() {
  const res = ok(gql(`mutation { createCustomerAddress(input: {
    firstname: "K6Test${randInt(1,999)}", lastname: "Load", street: ["${randInt(1,999)} Test St"]
    city: "Manila", postcode: "1000", telephone: "0917${randInt(1000000,9999999)}", country_code: PH
    default_shipping: false, default_billing: false
  }) { id firstname } }`), 'addAddress');
  return res.json().data?.createCustomerAddress?.id;
}

function updateAddress(id) {
  ok(gql(`mutation { updateCustomerAddress(id: ${id}, input: {
    firstname: "K6Upd${randInt(1,999)}", street: ["${randInt(1,999)} Updated Ave"]
    city: "Quezon City", postcode: "1100", telephone: "0918${randInt(1000000,9999999)}", country_code: PH
  }) { id firstname city } }`), 'updateAddress');
}

function removeAddress(id) {
  ok(gql(`mutation { deleteCustomerAddress(id: ${id}) }`), 'removeAddress');
}

// ============================================
// PERSONAS
// ============================================
function buyerFlow() {
  group('Buyer', () => {
    pageLoad();
    think();

    const rounds = randInt(3, 5);
    let cart = null;
    for (let i = 0; i < rounds; i++) {
      // Browse
      if (Math.random() > 0.5) { searchProducts(); } else { filterCategory(); }
      think();

      // View product
      viewPDP();
      think();

      // Add to cart
      cart = viewCart();
      if (cart && cart.id) {
        const items = addToCart(cart.id);
        think();

        // Sometimes remove an item (30% chance)
        if (Math.random() < 0.3 && items && items.length > 1) {
          removeFromCart(cart.id, items[0].id);
          think();
        }
      }
    }

    // Final cart view
    viewCart();
    think();

    // Check shipping
    gql(`{ palawanpayCustomShippingFees(storeCode: "jewelry", shop: "default", productLabel: "jewelry") {
      freight_fee packing_fee service_fee vat macro_region
    } }`);
  });
}

function windowShopperFlow() {
  group('Window Shopper', () => {
    pageLoad();
    think();

    const rounds = randInt(5, 8);
    let wishlistId = '';

    // Get wishlist ID
    const wlRes = gql(`{ customer { wishlists { id items_count } } }`);
    wishlistId = wlRes.json().data?.customer?.wishlists?.[0]?.id || '';

    for (let i = 0; i < rounds; i++) {
      // Random browsing
      const action = Math.random();
      if (action < 0.3) {
        browseCategories();
        think();
        filterCategory();
      } else if (action < 0.7) {
        searchProducts();
      } else {
        searchProducts();
        think();
        searchProducts(); // search again with different term
      }
      think();

      // Always view a product
      viewPDP();
      think();

      // Sometimes add to wishlist (40% chance)
      if (Math.random() < 0.4 && wishlistId) {
        const items = addToWishlist(wishlistId);
        think();

        // Sometimes remove (50% of adds)
        if (Math.random() < 0.5 && items && items.length > 0) {
          removeFromWishlist(wishlistId, items[items.length - 1].id);
          think();
        }
      }
    }
  });
}

function orderCheckerFlow() {
  group('Order Checker', () => {
    pageLoad();
    think();

    const rounds = randInt(2, 3);
    for (let i = 0; i < rounds; i++) {
      // View profile
      viewProfile();
      think();

      // View orders list
      viewOrders();
      think();

      // View order detail
      viewOrderDetail();
      think();

      // Sometimes check another order
      if (Math.random() < 0.5) {
        viewOrderDetail();
        think();
      }
    }
  });
}

function accountManagerFlow() {
  group('Account Manager', () => {
    pageLoad();
    think();

    const rounds = randInt(2, 4);
    for (let i = 0; i < rounds; i++) {
      // View profile
      viewProfile();
      think();

      // Address management cycle
      const addrId = addAddress();
      think();

      if (addrId) {
        updateAddress(addrId);
        think();
        removeAddress(addrId);
        think();
      }

      // Wishlist management
      const wlRes = gql(`{ customer { wishlists { id items_v2(currentPage: 1, pageSize: 5) { items { id product { sku } } } } } }`);
      const wl = wlRes.json().data?.customer?.wishlists?.[0];
      if (wl && wl.id) {
        const items = addToWishlist(wl.id);
        think();
        if (items && items.length > 0) {
          removeFromWishlist(wl.id, items[items.length - 1].id);
          think();
        }
      }
    }
  });
}

// ============================================
// MAIN — Random persona per VU iteration
// ============================================
export default function () {
  const roll = Math.random();

  if (roll < 0.30) {
    buyerFlow();           // 30%
  } else if (roll < 0.70) {
    windowShopperFlow();   // 40%
  } else if (roll < 0.85) {
    orderCheckerFlow();    // 15%
  } else {
    accountManagerFlow();  // 15%
  }
}

// ============================================
// REPORT
// ============================================
export function handleSummary(data) {
  return {
    "report.html": htmlReport(data),
    "summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
