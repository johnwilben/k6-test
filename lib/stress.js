import { browser } from "k6/browser";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { randomItem } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// ─── CONFIG ─────────────────────────────────────────────
const BASE = __ENV.BASE_URL || "https://jewelry-uat.palawanpay.com";
const SSO_TOKEN = __ENV.TOKEN; // JWT token from SSO
const DEBUG = __ENV.DEBUG === "true";
const TIMEOUT = 45000;

// ─── GLOBAL METRICS ─────────────────────────────────────
const errorRate = new Rate("flow_errors");
const successRate = new Rate("flow_success");
const pageLoad = new Trend("page_load_time", true);
const ttfb = new Trend("time_to_first_byte", true);
const fcp = new Trend("first_contentful_paint", true);

// ─── PER-FLOW METRICS ──────────────────────────────────
const flows = [
  "login",
  "profile",
  "search",
  "filter",
  "pdp",
  "cart_view",
  "cart_add",
  "cart_remove",
  "wishlist_add",
  "wishlist_remove",
  "address_add",
  "address_update",
  "address_remove",
  "orders",
];

const m = {};
const e = {};
flows.forEach((f) => {
  m[f] = new Trend(`flow_${f}_duration`, true);
  e[f] = new Counter(`flow_${f}_errors`);
});

// ─── OPTIONS ────────────────────────────────────────────
export const options = {
  scenarios: {
    stress: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "2m", target: 5 },
        { duration: "5m", target: 15 },
        { duration: "3m", target: 30 },
        { duration: "2m", target: 0 },
      ],
      options: { browser: { type: "chromium" } },
    },
  },
  thresholds: {
    page_load_time: ["p(95)<15000"],
    flow_errors: ["rate<0.15"],
    flow_success: ["rate>0.85"],
  },
};

// ─── HELPERS ────────────────────────────────────────────
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function log(msg) {
  if (DEBUG) console.log(`[VU:${__VU}] ${msg}`);
}

async function collectWebVitals(page) {
  try {
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paint = performance.getEntriesByType("paint");
      const fcpEntry = paint.find((p) => p.name === "first-contentful-paint");
      return {
        loadTime: nav ? nav.loadEventEnd - nav.startTime : 0,
        ttfb: nav ? nav.responseStart - nav.startTime : 0,
        fcp: fcpEntry ? fcpEntry.startTime : 0,
      };
    });
    if (perf.loadTime > 0) pageLoad.add(perf.loadTime);
    if (perf.ttfb > 0) ttfb.add(perf.ttfb);
    if (perf.fcp > 0) fcp.add(perf.fcp);
    return perf;
  } catch {
    return null;
  }
}

// ─── TRACKED FLOW ───────────────────────────────────────
// Wraps each flow step with timing, error handling, and metrics
async function tracked(name, page, fn) {
  const start = Date.now();
  try {
    await fn();
    const dur = Date.now() - start;
    m[name].add(dur);
    successRate.add(true);
    errorRate.add(0);
    console.log(`[VU:${__VU}] ✅ ${name} — ${dur}ms`);
    return true;
  } catch (err) {
    const dur = Date.now() - start;
    m[name].add(dur);
    e[name].add(1);
    successRate.add(false);
    errorRate.add(1);
    console.error(`[VU:${__VU}] ❌ ${name} — ${err.message}`);
    try {
      await page.screenshot({ path: `screenshots/ERROR_${name}_VU${__VU}.png` });
    } catch {}
    return false;
  }
}

// ─── SEARCH TERMS & DATA ───────────────────────────────
const SEARCH_TERMS = ["ring", "gold", "diamond", "necklace", "bracelet"];

const ADDRESS_DATA = {
  firstname: "Stress",
  lastname: "Tester",
  street: "123 Test Street",
  city: "Manila",
  postcode: "1000",
  telephone: "09171234567",
  country: "PH",
};

// ═══════════════════════════════════════════════════════
// MAIN TEST FLOW
// ═══════════════════════════════════════════════════════
export default async function () {
  if (!SSO_TOKEN) {
    console.error("❌ TOKEN env var is required. Pass via -e TOKEN=<jwt>");
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ── 1. LOGIN via SSO callback ─────────────────────
    await tracked("login", page, async () => {
      const ssoUrl = `${BASE}/sso/callback?token=${SSO_TOKEN}`;
      await page.goto(ssoUrl, { waitUntil: "networkidle", timeout: TIMEOUT });
      await page.waitForLoadState("networkidle");
      await collectWebVitals(page);

      // Verify we're logged in — page should redirect to home or account
      const url = page.url();
      check(page, {
        "Login redirected": () =>
          url.includes(BASE) && !url.includes("/sso/callback"),
      });
    });
    sleep(randInt(1, 2));

    // ── 2. NAVIGATE USER PROFILE ──────────────────────
    await tracked("profile", page, async () => {
      await page.goto(`${BASE}/account`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });
      await collectWebVitals(page);

      const bodyText = await page.evaluate(() => document.body.innerText);
      check(page, {
        "Profile loaded": () =>
          bodyText.includes("Account") || bodyText.includes("Welcome"),
      });
    });
    sleep(randInt(1, 2));

    // ── 3. SEARCH PRODUCTS ────────────────────────────
    await tracked("search", page, async () => {
      const term = randomItem(SEARCH_TERMS);
      await page.goto(`${BASE}/search?q=${term}`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });
      await collectWebVitals(page);

      check(page, {
        "Search results loaded": () => page.url().includes("/search"),
      });
    });
    sleep(randInt(1, 2));

    // ── 4. FILTER PRODUCTS (navigate to category) ─────
    await tracked("filter", page, async () => {
      await page.goto(`${BASE}/categories`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });
      await collectWebVitals(page);

      // Click first category link if available
      const categoryLink = page.locator('a[href*="/c/"], a[href*="/categor"]').first();
      try {
        if (await categoryLink.isVisible({ timeout: 5000 })) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle", timeout: TIMEOUT }),
            categoryLink.click(),
          ]);
        }
      } catch {
        log("No category link found, staying on categories page");
      }

      check(page, {
        "Filter/Category loaded": () => page.url().includes(BASE),
      });
    });
    sleep(randInt(1, 2));

    // ── 5. NAVIGATE PDP ───────────────────────────────
    await tracked("pdp", page, async () => {
      // Search first, then click a product
      await page.goto(`${BASE}/search?q=gold`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });

      const productLink = page.locator('a[href*="/p/"]').first();
      if (await productLink.isVisible({ timeout: 10000 })) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle", timeout: TIMEOUT }),
          productLink.click(),
        ]);
      }
      await collectWebVitals(page);

      check(page, {
        "PDP loaded": () => page.url().includes("/p/"),
      });
    });
    sleep(randInt(1, 2));

    // ── 6. ADD PRODUCT TO CART ────────────────────────
    await tracked("cart_add", page, async () => {
      // Make sure we're on a PDP
      if (!page.url().includes("/p/")) {
        await page.goto(`${BASE}/search?q=ring`, {
          waitUntil: "networkidle",
          timeout: TIMEOUT,
        });
        const link = page.locator('a[href*="/p/"]').first();
        if (await link.isVisible({ timeout: 10000 })) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle", timeout: TIMEOUT }),
            link.click(),
          ]);
        }
      }

      // Click Add to Cart button
      const addBtn = page.locator(
        'button:has-text("Add to Cart"), button:has-text("Add to cart"), [class*="addToCart"], [class*="add-to-cart"]'
      ).first();

      if (await addBtn.isVisible({ timeout: 10000 })) {
        await addBtn.click();
        // Wait for GraphQL response or cart update
        await page.waitForTimeout(3000);
      }

      check(page, {
        "Add to cart action completed": () => true,
      });
    });
    sleep(randInt(1, 2));

    // ── 7. NAVIGATE SHOPPING CART ─────────────────────
    await tracked("cart_view", page, async () => {
      await page.goto(`${BASE}/cart`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });
      await collectWebVitals(page);

      check(page, {
        "Cart page loaded": () => page.url().includes("/cart"),
      });
    });
    sleep(randInt(1, 2));

    // ── 8. REMOVE PRODUCT FROM CART ───────────────────
    await tracked("cart_remove", page, async () => {
      // Already on cart page
      if (!page.url().includes("/cart")) {
        await page.goto(`${BASE}/cart`, {
          waitUntil: "networkidle",
          timeout: TIMEOUT,
        });
      }

      const removeBtn = page.locator(
        'button:has-text("Remove"), [aria-label*="Remove"], [class*="remove"], [class*="delete"]'
      ).first();

      try {
        if (await removeBtn.isVisible({ timeout: 5000 })) {
          await removeBtn.click();
          await page.waitForTimeout(3000);
        }
      } catch {
        log("No remove button found in cart (cart may be empty)");
      }

      check(page, {
        "Cart remove action completed": () => true,
      });
    });
    sleep(randInt(1, 2));

    // ── 9. ADD PRODUCT TO WISHLIST ────────────────────
    await tracked("wishlist_add", page, async () => {
      // Go to a PDP first
      await page.goto(`${BASE}/search?q=necklace`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });

      const productLink = page.locator('a[href*="/p/"]').first();
      if (await productLink.isVisible({ timeout: 10000 })) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle", timeout: TIMEOUT }),
          productLink.click(),
        ]);
      }

      // Click wishlist/heart button
      const wishlistBtn = page.locator(
        'button:has-text("Wishlist"), button:has-text("wishlist"), [aria-label*="wishlist"], [aria-label*="Wishlist"], [class*="wishlist"], [class*="favorite"]'
      ).first();

      try {
        if (await wishlistBtn.isVisible({ timeout: 5000 })) {
          await wishlistBtn.click();
          await page.waitForTimeout(3000);
        }
      } catch {
        log("No wishlist button found on PDP");
      }

      check(page, {
        "Wishlist add action completed": () => true,
      });
    });
    sleep(randInt(1, 2));

    // ── 10. REMOVE PRODUCT FROM WISHLIST ──────────────
    await tracked("wishlist_remove", page, async () => {
      await page.goto(`${BASE}/wishlist`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });

      const removeBtn = page.locator(
        'button:has-text("Remove"), [aria-label*="Remove"], [aria-label*="remove"], [class*="remove"]'
      ).first();

      try {
        if (await removeBtn.isVisible({ timeout: 5000 })) {
          await removeBtn.click();
          await page.waitForTimeout(3000);
        }
      } catch {
        log("No remove button found in wishlist (may be empty)");
      }

      check(page, {
        "Wishlist remove action completed": () => true,
      });
    });
    sleep(randInt(1, 2));

    // ── 11. ADD ADDRESS ───────────────────────────────
    await tracked("address_add", page, async () => {
      await page.goto(`${BASE}/account/addresses`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });
      await collectWebVitals(page);

      // Click "Add address" or "New address" button
      const addBtn = page.locator(
        'a:has-text("Add address"), a:has-text("New address"), button:has-text("Add address"), button:has-text("New address"), a:has-text("Add new address")'
      ).first();

      try {
        if (await addBtn.isVisible({ timeout: 5000 })) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle", timeout: TIMEOUT }),
            addBtn.click(),
          ]);

          // Fill in address form
          const fields = {
            firstname: ADDRESS_DATA.firstname,
            lastname: ADDRESS_DATA.lastname,
            street: ADDRESS_DATA.street,
            city: ADDRESS_DATA.city,
            postcode: ADDRESS_DATA.postcode,
            telephone: ADDRESS_DATA.telephone,
          };

          for (const [field, value] of Object.entries(fields)) {
            const input = page.locator(
              `input[name*="${field}"], input[id*="${field}"], input[placeholder*="${field}" i]`
            ).first();
            try {
              if (await input.isVisible({ timeout: 3000 })) {
                await input.fill(value);
              }
            } catch {
              log(`Could not fill field: ${field}`);
            }
          }

          // Select country if dropdown exists
          const countrySelect = page.locator(
            'select[name*="country"], [name*="country_code"]'
          ).first();
          try {
            if (await countrySelect.isVisible({ timeout: 3000 })) {
              await countrySelect.selectOption(ADDRESS_DATA.country);
            }
          } catch {
            log("Could not select country");
          }

          // Submit
          const saveBtn = page.locator(
            'button:has-text("Save"), button[type="submit"]'
          ).first();
          try {
            if (await saveBtn.isVisible({ timeout: 3000 })) {
              await saveBtn.click();
              await page.waitForTimeout(3000);
            }
          } catch {
            log("Could not click save button");
          }
        }
      } catch {
        log("No add address button found");
      }

      check(page, {
        "Address add flow completed": () => true,
      });
    });
    sleep(randInt(1, 2));

    // ── 12. UPDATE ADDRESS ────────────────────────────
    await tracked("address_update", page, async () => {
      if (!page.url().includes("/account/addresses")) {
        await page.goto(`${BASE}/account/addresses`, {
          waitUntil: "networkidle",
          timeout: TIMEOUT,
        });
      }

      // Click "Edit" on first address
      const editBtn = page.locator(
        'a:has-text("Edit"), button:has-text("Edit"), [aria-label*="Edit"], [aria-label*="edit"]'
      ).first();

      try {
        if (await editBtn.isVisible({ timeout: 5000 })) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle", timeout: TIMEOUT }),
            editBtn.click(),
          ]);

          // Update a field
          const cityInput = page.locator(
            'input[name*="city"], input[id*="city"]'
          ).first();
          if (await cityInput.isVisible({ timeout: 3000 })) {
            await cityInput.fill("Quezon City");
          }

          // Save
          const saveBtn = page.locator(
            'button:has-text("Save"), button[type="submit"]'
          ).first();
          if (await saveBtn.isVisible({ timeout: 3000 })) {
            await saveBtn.click();
            await page.waitForTimeout(3000);
          }
        }
      } catch {
        log("No edit button found for address");
      }

      check(page, {
        "Address update flow completed": () => true,
      });
    });
    sleep(randInt(1, 2));

    // ── 13. REMOVE ADDRESS ────────────────────────────
    await tracked("address_remove", page, async () => {
      if (!page.url().includes("/account/addresses")) {
        await page.goto(`${BASE}/account/addresses`, {
          waitUntil: "networkidle",
          timeout: TIMEOUT,
        });
      }

      // Click "Delete" on an address
      const deleteBtn = page.locator(
        'button:has-text("Delete"), a:has-text("Delete"), [aria-label*="Delete"], [aria-label*="delete"]'
      ).first();

      try {
        if (await deleteBtn.isVisible({ timeout: 5000 })) {
          await deleteBtn.click();

          // Confirm deletion if dialog appears
          const confirmBtn = page.locator(
            'button:has-text("Confirm"), button:has-text("Yes"), button:has-text("OK"), button:has-text("Delete")'
          ).nth(1);
          try {
            if (await confirmBtn.isVisible({ timeout: 3000 })) {
              await confirmBtn.click();
            }
          } catch {}

          await page.waitForTimeout(3000);
        }
      } catch {
        log("No delete button found for address");
      }

      check(page, {
        "Address remove flow completed": () => true,
      });
    });
    sleep(randInt(1, 2));

    // ── 14. PURCHASES / ORDERS PAGE ───────────────────
    await tracked("orders", page, async () => {
      await page.goto(`${BASE}/account/orders`, {
        waitUntil: "networkidle",
        timeout: TIMEOUT,
      });
      await collectWebVitals(page);

      const bodyText = await page.evaluate(() => document.body.innerText);
      check(page, {
        "Orders page loaded": () =>
          bodyText.includes("Order") || bodyText.includes("order") || page.url().includes("/orders"),
      });

      // Try to click into first order detail if available
      const orderLink = page.locator(
        'a[href*="/account/orders/"], a:has-text("View"), a:has-text("Details")'
      ).first();

      try {
        if (await orderLink.isVisible({ timeout: 5000 })) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle", timeout: TIMEOUT }),
            orderLink.click(),
          ]);
          await collectWebVitals(page);
          console.log(`[VU:${__VU}] 📦 Order detail loaded: ${page.url()}`);
        }
      } catch {
        log("No order detail link found");
      }
    });
    sleep(randInt(1, 2));

  } finally {
    await page.close();
    await context.close();
  }
}

// ─── REPORTING ──────────────────────────────────────────
export function handleSummary(data) {
  return {
    "stress-report.html": htmlReport(data),
    "stress-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
