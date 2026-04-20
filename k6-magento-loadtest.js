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
const metrics = {};
const flows = ['login','storeConfig','currency','categories','searchProducts','filterByCategory','pdp','profile','viewCart','addToCart','removeFromCart','addWishlist','removeWishlist','addAddress','updateAddress','removeAddress','orders','orderDetail','shippingFee'];
flows.forEach(f => metrics[f] = new Trend(f + '_duration'));

// ============================================
// OPTIONS — 10 users, 5 mins (adjust for scale)
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
const headers = { 'Content-Type': 'application/json' };
const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CUSTOMER_TOKEN}` };

function gql(query, useAuth = true) {
  return http.post(BASE_URL, JSON.stringify({ query }), { headers: useAuth ? authHeaders : headers });
}

function ok(res, name) {
  const pass = check(res, {
    [`${name} status 200`]: r => r.status === 200,
    [`${name} no errors`]: r => { try { return !r.json().errors; } catch(e) { return false; } },
  });
  errorRate.add(!pass);
  if (metrics[name]) metrics[name].add(res.timings.duration);
  return res;
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ============================================
// CATEGORY UIDs (from introspection)
// ============================================
const CATEGORIES = [
  { uid: 'NA==', name: 'Rings' },
  { uid: 'NQ==', name: 'Necklaces' },
  { uid: 'Ng==', name: 'Bracelets' },
  { uid: 'Nw==', name: 'Earrings' },
  { uid: 'OA==', name: 'Pendants' },
  { uid: 'OQ==', name: 'Diamonds' },
];

const SEARCH_TERMS = ['ring', 'gold', 'necklace', 'bracelet', 'earring', 'diamond', 'pendant', 'silver'];
const PRODUCT_SKUS = ['Ring A', 'Gold Ring', 'Gold Necklace', 'Ladies Ring', 'Gold variations'];

// ============================================
// TEST FLOW
// ============================================
export default function () {

  // ── PAGE LOAD QUERIES (every page loads these) ──
  group('Page Load', () => {
    ok(gql(`{ storeConfig { store_name base_currency_code locale default_title } }`, true), 'storeConfig');
    ok(gql(`{ currency { base_currency_code available_currency_codes } }`, true), 'currency');
  });
  sleep(0.5);

  // ── BROWSE CATEGORIES ──
  group('Browse Categories', () => {
    ok(gql(`{ categories(filters: { parent_id: { eq: "2" } }, pageSize: 10) {
      items { uid name product_count children { uid name product_count } }
    } }`, true), 'categories');
  });
  sleep(0.5);

  // ── SEARCH PRODUCTS ──
  group('Search Products', () => {
    const term = rand(SEARCH_TERMS);
    const res = ok(gql(`{ products(search: "${term}", pageSize: 12, sort: { relevance: DESC }) {
      items { sku name url_key thumbnail { url } price_range { minimum_price { regular_price { value currency } final_price { value currency } } } }
      total_count page_info { current_page total_pages }
    } }`, true), 'searchProducts');
    console.log(`[Search] "${term}" → ${res.json().data?.products?.total_count || 0} results`);
  });
  sleep(0.5);

  // ── FILTER BY CATEGORY ──
  group('Filter by Category', () => {
    const cat = rand(CATEGORIES);
    const res = ok(gql(`{ products(filter: { category_uid: { eq: "${cat.uid}" } }, pageSize: 12, sort: { position: ASC }) {
      items { sku name url_key thumbnail { url } price_range { minimum_price { regular_price { value currency } } } }
      total_count
    } }`, true), 'filterByCategory');
    console.log(`[Category] ${cat.name} → ${res.json().data?.products?.total_count || 0} products`);
  });
  sleep(0.5);

  // ── PRODUCT DETAIL PAGE ──
  group('Product Detail Page', () => {
    const sku = rand(PRODUCT_SKUS);
    const res = ok(gql(`{ products(filter: { sku: { eq: "${sku}" } }) {
      items {
        sku name url_key
        description { html } short_description { html }
        price_range { minimum_price { regular_price { value currency } final_price { value currency } discount { amount_off percent_off } } }
        media_gallery { url label position }
        review_count rating_summary
        ... on ConfigurableProduct { configurable_options { attribute_code label values { label value_index } } }
      }
    } }`, true), 'pdp');
    console.log(`[PDP] ${res.json().data?.products?.items?.[0]?.name || 'not found'}`);
  });
  sleep(1);

  // ── CUSTOMER PROFILE ──
  group('Customer Profile', () => {
    const res = ok(gql(`{ customer {
      email firstname lastname date_of_birth gender
      addresses { id firstname lastname street city region { region region_code } postcode telephone country_code default_shipping default_billing }
      wishlists { id items_count }
      orders { total_count }
    } }`, true), 'profile');
    console.log(`[Profile] ${res.json().data?.customer?.email || 'no auth'}`);
  });
  sleep(0.5);

  // ── VIEW CART ──
  let cartId = '';
  group('View Cart', () => {
    const res = ok(gql(`{ customerCart {
      id total_quantity
      items { id uid product { sku name thumbnail { url } } quantity prices { price { value currency } row_total { value currency } } }
      prices { grand_total { value currency } subtotal_excluding_tax { value } applied_taxes { label amount { value } } discounts { label amount { value } } }
    } }`, true), 'viewCart');
    const cart = res.json().data?.customerCart;
    cartId = cart?.id || '';
    console.log(`[Cart] ${cart?.items?.length || 0} items, total: ${cart?.prices?.grand_total?.value || 0} PHP`);
  });
  sleep(0.5);

  // ── ADD TO CART ──
  let addedItemId = '';
  if (cartId) {
    group('Add to Cart', () => {
      const sku = rand(PRODUCT_SKUS);
      const res = ok(gql(`mutation { addProductsToCart(cartId: "${cartId}", cartItems: [{ sku: "${sku}", quantity: 1 }]) {
        cart { total_quantity items { id product { sku name } quantity } }
      } }`, true), 'addToCart');
      const items = res.json().data?.addProductsToCart?.cart?.items;
      if (items && items.length > 0) addedItemId = items[items.length - 1].id;
      console.log(`[AddToCart] ${sku} → item id: ${addedItemId}`);
    });
    sleep(0.5);

    // ── REMOVE FROM CART ──
    if (addedItemId) {
      group('Remove from Cart', () => {
        ok(gql(`mutation { removeItemFromCart(input: { cart_id: "${cartId}", cart_item_id: ${addedItemId} }) {
          cart { total_quantity items { id product { sku } quantity } }
        } }`, true), 'removeFromCart');
        console.log(`[RemoveFromCart] item ${addedItemId} removed`);
      });
      sleep(0.5);
    }
  }

  // ── WISHLIST ADD ──
  let wishlistId = '';
  group('Wishlist', () => {
    const wlRes = gql(`{ customer { wishlists { id items_count items_v2(currentPage: 1, pageSize: 5) { items { id product { sku } } } } } }`, true);
    const wl = wlRes.json().data?.customer?.wishlists?.[0];
    wishlistId = wl?.id || '';

    if (wishlistId) {
      // Add
      const sku = rand(PRODUCT_SKUS);
      const addRes = ok(gql(`mutation { addProductsToWishlist(wishlistId: "${wishlistId}", wishlistItems: [{ sku: "${sku}", quantity: 1 }]) {
        wishlist { id items_count items_v2(currentPage: 1, pageSize: 5) { items { id product { sku } } } }
      } }`, true), 'addWishlist');
      console.log(`[WishlistAdd] ${sku}`);

      sleep(0.5);

      // Remove (find the item we just added)
      const wlItems = addRes.json().data?.addProductsToWishlist?.wishlist?.items_v2?.items;
      const target = wlItems?.find(i => i.product.sku === sku);
      if (target) {
        ok(gql(`mutation { removeProductsFromWishlist(wishlistId: "${wishlistId}", wishlistItemsIds: ["${target.id}"]) {
          wishlist { id items_count }
        } }`, true), 'removeWishlist');
        console.log(`[WishlistRemove] item ${target.id}`);
      }
    }
  });
  sleep(0.5);

  // ── ADDRESS MANAGEMENT ──
  group('Address Management', () => {
    // Add
    const addRes = ok(gql(`mutation { createCustomerAddress(input: {
      firstname: "K6Test", lastname: "LoadTest", street: ["${Math.floor(Math.random()*999)} Test St"]
      city: "Manila", postcode: "1000", telephone: "0917${Math.floor(Math.random()*9999999)}", country_code: PH
      default_shipping: false, default_billing: false
    }) { id firstname lastname street city } }`, true), 'addAddress');
    const addrId = addRes.json().data?.createCustomerAddress?.id;
    console.log(`[AddAddress] id: ${addrId}`);

    if (addrId) {
      sleep(0.5);
      // Update
      ok(gql(`mutation { updateCustomerAddress(id: ${addrId}, input: {
        firstname: "K6Updated", street: ["${Math.floor(Math.random()*999)} Updated Ave"]
        city: "Quezon City", postcode: "1100", telephone: "0918${Math.floor(Math.random()*9999999)}", country_code: PH
      }) { id firstname city } }`, true), 'updateAddress');
      console.log(`[UpdateAddress] id: ${addrId}`);

      sleep(0.5);
      // Remove
      ok(gql(`mutation { deleteCustomerAddress(id: ${addrId}) }`, true), 'removeAddress');
      console.log(`[RemoveAddress] id: ${addrId}`);
    }
  });
  sleep(0.5);

  // ── PURCHASES PAGE (Order List) ──
  group('Purchases Page', () => {
    const res = ok(gql(`{ customer { orders(pageSize: 10, currentPage: 1, sort: { sort_direction: DESC, sort_field: CREATED_AT }) {
      items { number order_date status total { grand_total { value currency } } }
      total_count page_info { current_page total_pages }
    } } }`, true), 'orders');
    console.log(`[Orders] ${res.json().data?.customer?.orders?.total_count || 0} total orders`);
  });
  sleep(0.5);

  // ── ORDER DETAIL ──
  group('Order Detail', () => {
    const res = ok(gql(`{ customer { orders(filter: { number: { eq: "000000564" } }) {
      items {
        number order_date status
        items { product_name product_sku quantity_ordered product_sale_price { value currency } }
        shipping_address { firstname lastname street city postcode telephone }
        payment_methods { name type }
        total { grand_total { value currency } subtotal { value } total_shipping { value } total_tax { value } discounts { label amount { value } } }
      }
    } } }`, true), 'orderDetail');
    console.log(`[OrderDetail] #000000564`);
  });
  sleep(0.5);

  // ── PALAWANPAY SHIPPING FEE ──
  group('Shipping Fee Calc', () => {
    const res = gql(`{ palawanpayCustomShippingFees(storeCode: "jewelry", shop: "default", productLabel: "jewelry") {
      freight_fee packing_fee service_fee vat macro_region source
    } }`, true);
    metrics['shippingFee'].add(res.timings.duration);
    // This may error in UAT — just log it
    const body = res.json();
    console.log(`[ShippingFee] ${body.data ? 'OK' : body.errors?.[0]?.message || 'error'}`);
  });

  sleep(1);
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
