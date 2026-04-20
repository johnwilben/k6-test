import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ============================================
// CONFIG — Update before each run
// ============================================
const BASE_URL = 'https://magento-backend-uat.palawanpay.com/graphql';
const CUSTOMER_TOKEN = __ENV.CUSTOMER_TOKEN || 'PASTE_TOKEN_HERE';

// ============================================
// CUSTOM METRICS
// ============================================
const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');
const profileDuration = new Trend('profile_duration');
const searchDuration = new Trend('search_duration');
const pdpDuration = new Trend('pdp_duration');
const cartViewDuration = new Trend('cart_view_duration');
const addCartDuration = new Trend('add_cart_duration');
const removeCartDuration = new Trend('remove_cart_duration');
const wishlistAddDuration = new Trend('wishlist_add_duration');
const wishlistRemoveDuration = new Trend('wishlist_remove_duration');
const addAddressDuration = new Trend('add_address_duration');
const updateAddressDuration = new Trend('update_address_duration');
const removeAddressDuration = new Trend('remove_address_duration');
const ordersDuration = new Trend('orders_duration');

// ============================================
// TEST OPTIONS — Start small, scale up
// ============================================
export const options = {
  stages: [
    { duration: '30s', target: 10 },    // ramp to 10
    { duration: '1m',  target: 10 },    // hold 10
    { duration: '30s', target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],   // 95% under 5s
    errors: ['rate<0.1'],                // <10% error rate
  },
};

// ============================================
// HELPERS
// ============================================
const headers = {
  'Content-Type': 'application/json',
};

const authHeaders = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${CUSTOMER_TOKEN}`,
};

function gql(query, vars = {}, useAuth = false) {
  const payload = JSON.stringify({ query, variables: vars });
  return http.post(BASE_URL, payload, {
    headers: useAuth ? authHeaders : headers,
  });
}

function checkGql(res, name) {
  const ok = check(res, {
    [`${name} status 200`]: (r) => r.status === 200,
    [`${name} no errors`]: (r) => {
      const body = r.json();
      return !body.errors || body.errors.length === 0;
    },
  });
  errorRate.add(!ok);
  return res;
}

// ============================================
// TEST SCENARIOS
// ============================================
export default function () {

  // 1. Search Products
  group('Search Products', () => {
    const searches = ['ring', 'gold', 'necklace', 'bracelet', 'earring'];
    const term = searches[Math.floor(Math.random() * searches.length)];
    const res = gql(`{
      products(search: "${term}", pageSize: 10) {
        items { sku name price_range { minimum_price { regular_price { value currency } } } }
        total_count
      }
    }`);
    searchDuration.add(res.timings.duration);
    checkGql(res, 'Search');
  });

  sleep(1);

  // 2. PDP (Product Detail Page)
  group('Product Detail Page', () => {
    const skus = ['Ring A', 'Gold Ring', 'Gold Necklace', 'Ladies Ring'];
    const sku = skus[Math.floor(Math.random() * skus.length)];
    const res = gql(`{
      products(filter: { sku: { eq: "${sku}" } }) {
        items {
          sku name description { html }
          price_range { minimum_price { regular_price { value currency } } }
          media_gallery { url label }
        }
      }
    }`);
    pdpDuration.add(res.timings.duration);
    checkGql(res, 'PDP');
  });

  sleep(1);

  // 3. Customer Profile
  group('Customer Profile', () => {
    const res = gql(`{
      customer {
        email firstname lastname
        addresses { id firstname lastname street city postcode telephone }
      }
    }`, {}, true);
    profileDuration.add(res.timings.duration);
    checkGql(res, 'Profile');
  });

  sleep(1);

  // 4. View Cart
  group('View Cart', () => {
    const res = gql(`{
      customerCart {
        id
        items { id product { sku name } quantity prices { price { value } } }
        prices { grand_total { value currency } }
      }
    }`, {}, true);
    cartViewDuration.add(res.timings.duration);
    checkGql(res, 'ViewCart');

    // Get cart ID for later
    const body = res.json();
    if (body.data && body.data.customerCart) {
      const cartId = body.data.customerCart.id;

      // 5. Add to Cart
      group('Add to Cart', () => {
        const addRes = gql(`mutation {
          addProductsToCart(
            cartId: "${cartId}"
            cartItems: [{ sku: "Ring A", quantity: 1 }]
          ) {
            cart { items { id product { sku } quantity } }
          }
        }`, {}, true);
        addCartDuration.add(addRes.timings.duration);
        checkGql(addRes, 'AddToCart');

        sleep(0.5);

        // 6. Remove from Cart (remove what we just added)
        const addBody = addRes.json();
        if (addBody.data && addBody.data.addProductsToCart) {
          const items = addBody.data.addProductsToCart.cart.items;
          const lastItem = items[items.length - 1];
          if (lastItem) {
            group('Remove from Cart', () => {
              const rmRes = gql(`mutation {
                removeItemFromCart(input: { cart_id: "${cartId}", cart_item_id: ${lastItem.id} }) {
                  cart { items { id product { sku } quantity } }
                }
              }`, {}, true);
              removeCartDuration.add(rmRes.timings.duration);
              checkGql(rmRes, 'RemoveFromCart');
            });
          }
        }
      });
    }
  });

  sleep(1);

  // 7. Wishlist — Add then Remove
  group('Wishlist', () => {
    // Get wishlist ID
    const wlRes = gql(`{
      customer { wishlists { id items_count items_v2 { items { id product { sku } } } } }
    }`, {}, true);

    const wlBody = wlRes.json();
    if (wlBody.data && wlBody.data.customer && wlBody.data.customer.wishlists[0]) {
      const wlId = wlBody.data.customer.wishlists[0].id;

      // Add to wishlist
      const addWl = gql(`mutation {
        addProductsToWishlist(
          wishlistId: "${wlId}"
          wishlistItems: [{ sku: "Gold Ring", quantity: 1 }]
        ) { wishlist { id items_count } }
      }`, {}, true);
      wishlistAddDuration.add(addWl.timings.duration);
      checkGql(addWl, 'WishlistAdd');

      sleep(0.5);

      // Remove from wishlist
      const addWlBody = addWl.json();
      if (addWlBody.data && addWlBody.data.addProductsToWishlist) {
        const updatedWl = gql(`{
          customer { wishlists { id items_v2 { items { id product { sku } } } } }
        }`, {}, true);
        const uwlBody = updatedWl.json();
        if (uwlBody.data) {
          const wlItems = uwlBody.data.customer.wishlists[0].items_v2.items;
          const goldItem = wlItems.find(i => i.product.sku === 'Gold Ring');
          if (goldItem) {
            const rmWl = gql(`mutation {
              removeProductsFromWishlist(
                wishlistId: "${wlId}"
                wishlistItemsIds: ["${goldItem.id}"]
              ) { wishlist { id items_count } }
            }`, {}, true);
            wishlistRemoveDuration.add(rmWl.timings.duration);
            checkGql(rmWl, 'WishlistRemove');
          }
        }
      }
    }
  });

  sleep(1);

  // 8. Address — Add, Update, Remove
  group('Address Management', () => {
    // Add address
    const addAddr = gql(`mutation {
      createCustomerAddress(input: {
        firstname: "K6"
        lastname: "LoadTest"
        street: ["123 Test Street"]
        city: "Manila"
        postcode: "1000"
        telephone: "09171234567"
        country_code: PH
        default_shipping: false
        default_billing: false
      }) { id firstname lastname }
    }`, {}, true);
    addAddressDuration.add(addAddr.timings.duration);
    checkGql(addAddr, 'AddAddress');

    const addrBody = addAddr.json();
    if (addrBody.data && addrBody.data.createCustomerAddress) {
      const addrId = addrBody.data.createCustomerAddress.id;

      sleep(0.5);

      // Update address
      const updAddr = gql(`mutation {
        updateCustomerAddress(id: ${addrId}, input: {
          firstname: "K6Updated"
          lastname: "LoadTest"
          street: ["456 Updated Street"]
          city: "Quezon City"
          postcode: "1100"
          telephone: "09179876543"
          country_code: PH
        }) { id firstname city }
      }`, {}, true);
      updateAddressDuration.add(updAddr.timings.duration);
      checkGql(updAddr, 'UpdateAddress');

      sleep(0.5);

      // Remove address
      const rmAddr = gql(`mutation {
        deleteCustomerAddress(id: ${addrId})
      }`, {}, true);
      removeAddressDuration.add(rmAddr.timings.duration);
      checkGql(rmAddr, 'RemoveAddress');
    }
  });

  sleep(1);

  // 9. Purchases Page
  group('Purchases Page', () => {
    const res = gql(`{
      customer {
        orders(pageSize: 10, currentPage: 1) {
          items {
            number order_date status
            total { grand_total { value currency } }
          }
          total_count
        }
      }
    }`, {}, true);
    ordersDuration.add(res.timings.duration);
    checkGql(res, 'Orders');
  });

  sleep(1);
}
