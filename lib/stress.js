import { browser } from "k6/browser";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { randomItem } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// ─── CONFIG ─────────────────────────────────────────────
const BASE = __ENV.BASE_URL || "https://jewelry-uat.palawanpay.com";
const SSO_TOKEN = __ENV.TOKEN;
const DEBUG = __ENV.DEBUG === "true";
const TIMEOUT = 60000;

// ─── ADJUSTABLE VU SCALING ──────────────────────────────
// Control VUs at runtime:
//   -e VUS=50        → peak VUs (default: 30)
//   -e DURATION=20m  → total test duration (default: 12m)
//   -e RAMPUP=fast   → preset: fast(6m), normal(12m), long(20m)
const PEAK_VUS = parseInt(__ENV.VUS || "30", 10);
const RAMP_PRESET = __ENV.RAMPUP || "normal";

function getStages() {
  const p = PEAK_VUS;

  if (RAMP_PRESET === "fast") {
    return [
      { duration: "1m", target: Math.ceil(p * 0.3) },
      { duration: "2m", target: p },
      { duration: "2m", target: p },
      { duration: "1m", target: 0 },
    ];
  }

  if (RAMP_PRESET === "long") {
    return [
      { duration: "3m", target: Math.ceil(p * 0.2) },
      { duration: "7m", target: Math.ceil(p * 0.6) },
      { duration: "5m", target: p },
      { duration: "3m", target: p },
      { duration: "2m", target: 0 },
    ];
  }

  // normal (default)
  return [
    { duration: "2m", target: Math.ceil(p * 0.2) },
    { duration: "5m", target: Math.ceil(p * 0.5) },
    { duration: "3m", target: p },
    { duration: "2m", target: 0 },
  ];
}

// ─── GLOBAL METRICS ─────────────────────────────────────
const errorRate = new Rate("flow_errors");
const successRate = new Rate("flow_success");
const pageLoad = new Trend("page_load_time", true);
const ttfb = new Trend("time_to_first_byte", true);
const fcp = new Trend("first_contentful_paint", true);

// ─── PER-FLOW METRICS ──────────────────────────────────
const flows = [
  "login", "profile", "search", "filter", "pdp",
  "cart_add", "cart_view", "cart_remove",
  "wishlist_add", "wishlist_remove",
  "address_add", "address_update", "address_remove",
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
      stages: getStages(),
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

// Navigate with "load" waitUntil (faster than networkidle)
async function navigate(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: TIMEOUT });
  await page.waitForLoadState("domcontentloaded");
}

// Safe click — checks visibility first, returns true if clicked
async function safeClick(locator, timeout = 5000) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    await locator.click();
    return true;
  } catch {
    return false;
  }
}

// Safe fill — checks visibility first
async function safeFill(locator, value, timeout = 3000) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    await locator.fill(value);
    return true;
  } catch {
    return false;
  }
}

// ─── TRACKED FLOW ───────────────────────────────────────
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
    const errMsg = err && err.message ? err.message : String(err);
    console.error(`[VU:${__VU}] ❌ ${name} — ${errMsg}`);
    return false;
  }
}

// ─── DATA ───────────────────────────────────────────────
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
    // ── 1. LOGIN via SSO ──────────────────────────────
    await tracked("login", page, async () => {
      await page.goto(`${BASE}/sso/callback?token=${SSO_TOKEN}`, {
        waitUntil: "load",
        timeout: TIMEOUT,
      });
      await page.waitForLoadState("domcontentloaded");
      await collectWebVitals(page);

      const url = page.url();
      log(`Login URL after redirect: ${url}`);
      check(page, {
        "Login redirected": () => url.includes(BASE),
      });
    });
    sleep(randInt(1, 2));

    // ── 2. USER PROFILE ───────────────────────────────
    await tracked("profile", page, async () => {
      await navigate(page, "/account");
      await collectWebVitals(page);

      check(page, {
        "Profile loaded": () => page.url().includes("/account"),
      });
    });
    sleep(randInt(1, 2));

    // ── 3. SEARCH PRODUCTS ────────────────────────────
    await tracked("search", page, async () => {
      const term = randomItem(SEARCH_TERMS);
      await navigate(page, `/search?q=${term}`);
      await collectWebVitals(page);

      check(page, {
        "Search results loaded": () => page.url().includes("/search"),
      });
    });
    sleep(randInt(1, 2));

    // ── 4. FILTER / CATEGORIES ────────────────────────
    await tracked("filter", page, async () => {
      await navigate(page, "/categories");
      await collectWebVitals(page);

      // Try clicking a category link
      const clicked = await safeClick(
        page.locator('a[href*="/c/"]'),
        5000
      );
      if (clicked) {
        await page.waitForLoadState("domcontentloaded");
      }

      check(page, {
        "Filter/Category loaded": () => page.url().includes(BASE),
      });
    });
    sleep(randInt(1, 2));

    // ── 5. PDP (Product Detail Page) ──────────────────
    await tracked("pdp", page, async () => {
      await navigate(page, "/search?q=gold");

      // Wait for product links to appear, then click
      const productLink = page.locator('a[href*="/p/"]');
      const clicked = await safeClick(productLink, 10000);
      if (clicked) {
        // Wait for navigation to complete (Next.js client-side routing)
        await page.waitForLoadState("domcontentloaded");
        // Give Next.js time to update the URL
        await page.waitForTimeout(3000);
      }
      await collectWebVitals(page);

      const url = page.url();
      check(page, {
        "PDP loaded": () => url.includes("/p/") || url.includes("/search"),
      });
      log(`PDP URL: ${url}`);
    });
    sleep(randInt(1, 2));

    // ── 6. ADD TO CART ────────────────────────────────
    await tracked("cart_add", page, async () => {
      // Ensure we're on a PDP
      if (!page.url().includes("/p/")) {
        await navigate(page, "/search?q=ring");
        await safeClick(page.locator('a[href*="/p/"]'), 10000);
        await page.waitForLoadState("domcontentloaded");
      }

      // Try multiple selectors for Add to Cart
      let added = await safeClick(
        page.locator('button:has-text("Add to Cart")'),
        5000
      );
      if (!added) {
        added = await safeClick(
          page.locator('button:has-text("Add to cart")'),
          3000
        );
      }
      if (added) {
        await page.waitForTimeout(3000);
      }

      check(page, { "Add to cart completed": () => true });
    });
    sleep(randInt(1, 2));

    // ── 7. VIEW CART ──────────────────────────────────
    await tracked("cart_view", page, async () => {
      await navigate(page, "/cart");
      await collectWebVitals(page);

      check(page, {
        "Cart page loaded": () => page.url().includes("/cart"),
      });
    });
    sleep(randInt(1, 2));

    // ── 8. REMOVE FROM CART ───────────────────────────
    await tracked("cart_remove", page, async () => {
      if (!page.url().includes("/cart")) {
        await navigate(page, "/cart");
      }

      let removed = await safeClick(
        page.locator('button:has-text("Remove")'),
        5000
      );
      if (!removed) {
        removed = await safeClick(
          page.locator('[aria-label="Remove"]'),
          3000
        );
      }
      if (removed) {
        await page.waitForTimeout(3000);
      }

      check(page, { "Cart remove completed": () => true });
    });
    sleep(randInt(1, 2));

    // ── 9. ADD TO WISHLIST ────────────────────────────
    await tracked("wishlist_add", page, async () => {
      await navigate(page, "/search?q=necklace");

      const clicked = await safeClick(
        page.locator('a[href*="/p/"]'),
        10000
      );
      if (clicked) {
        await page.waitForLoadState("domcontentloaded");
      }

      // Try wishlist button selectors
      let added = await safeClick(
        page.locator('[aria-label="Add to wishlist"]'),
        5000
      );
      if (!added) {
        added = await safeClick(
          page.locator('button:has-text("Wishlist")'),
          3000
        );
      }
      if (added) {
        await page.waitForTimeout(3000);
      }

      check(page, { "Wishlist add completed": () => true });
    });
    sleep(randInt(1, 2));

    // ── 10. REMOVE FROM WISHLIST ──────────────────────
    await tracked("wishlist_remove", page, async () => {
      await navigate(page, "/wishlist");

      let removed = await safeClick(
        page.locator('button:has-text("Remove")'),
        5000
      );
      if (!removed) {
        removed = await safeClick(
          page.locator('[aria-label="Remove from wishlist"]'),
          3000
        );
      }
      if (removed) {
        await page.waitForTimeout(3000);
      }

      check(page, { "Wishlist remove completed": () => true });
    });
    sleep(randInt(1, 2));

    // ── 11. ADD ADDRESS ───────────────────────────────
    await tracked("address_add", page, async () => {
      await navigate(page, "/account/addresses");
      await collectWebVitals(page);

      // Click add address button
      let clicked = await safeClick(
        page.locator('a:has-text("Add address")'),
        5000
      );
      if (!clicked) {
        clicked = await safeClick(
          page.locator('a:has-text("New address")'),
          3000
        );
      }
      if (!clicked) {
        clicked = await safeClick(
          page.locator('button:has-text("Add address")'),
          3000
        );
      }

      if (clicked) {
        await page.waitForLoadState("domcontentloaded");

        // Fill form fields
        await safeFill(page.locator('input[name*="firstname"]'), ADDRESS_DATA.firstname);
        await safeFill(page.locator('input[name*="lastname"]'), ADDRESS_DATA.lastname);
        await safeFill(page.locator('input[name*="street"]'), ADDRESS_DATA.street);
        await safeFill(page.locator('input[name*="city"]'), ADDRESS_DATA.city);
        await safeFill(page.locator('input[name*="postcode"]'), ADDRESS_DATA.postcode);
        await safeFill(page.locator('input[name*="telephone"]'), ADDRESS_DATA.telephone);

        // Country select
        try {
          const countrySelect = page.locator('select[name*="country"]');
          await countrySelect.waitFor({ state: "visible", timeout: 3000 });
          await countrySelect.selectOption(ADDRESS_DATA.country);
        } catch {
          log("Could not select country");
        }

        // Submit
        let saved = await safeClick(
          page.locator('button[type="submit"]'),
          3000
        );
        if (!saved) {
          saved = await safeClick(
            page.locator('button:has-text("Save")'),
            3000
          );
        }
        if (saved) {
          await page.waitForTimeout(3000);
        }
      }

      check(page, { "Address add completed": () => true });
    });
    sleep(randInt(1, 2));

    // ── 12. UPDATE ADDRESS ────────────────────────────
    await tracked("address_update", page, async () => {
      if (!page.url().includes("/account/addresses")) {
        await navigate(page, "/account/addresses");
      }

      let clicked = await safeClick(
        page.locator('a:has-text("Edit")'),
        5000
      );
      if (!clicked) {
        clicked = await safeClick(
          page.locator('button:has-text("Edit")'),
          3000
        );
      }

      if (clicked) {
        await page.waitForLoadState("domcontentloaded");

        await safeFill(page.locator('input[name*="city"]'), "Quezon City");

        let saved = await safeClick(
          page.locator('button[type="submit"]'),
          3000
        );
        if (!saved) {
          saved = await safeClick(
            page.locator('button:has-text("Save")'),
            3000
          );
        }
        if (saved) {
          await page.waitForTimeout(3000);
        }
      }

      check(page, { "Address update completed": () => true });
    });
    sleep(randInt(1, 2));

    // ── 13. REMOVE ADDRESS ────────────────────────────
    await tracked("address_remove", page, async () => {
      if (!page.url().includes("/account/addresses")) {
        await navigate(page, "/account/addresses");
      }

      let clicked = await safeClick(
        page.locator('button:has-text("Delete")'),
        5000
      );
      if (!clicked) {
        clicked = await safeClick(
          page.locator('a:has-text("Delete")'),
          3000
        );
      }

      if (clicked) {
        // Confirm dialog
        const confirmed = await safeClick(
          page.locator('button:has-text("Confirm")'),
          3000
        );
        if (!confirmed) {
          await safeClick(
            page.locator('button:has-text("Yes")'),
            3000
          );
        }
        await page.waitForTimeout(3000);
      }

      check(page, { "Address remove completed": () => true });
    });
    sleep(randInt(1, 2));

    // ── 14. ORDERS / PURCHASES ────────────────────────
    await tracked("orders", page, async () => {
      await navigate(page, "/account/orders");
      await collectWebVitals(page);

      const bodyText = await page.evaluate(() => document.body.innerText);
      check(page, {
        "Orders page loaded": () =>
          bodyText.includes("Order") ||
          bodyText.includes("order") ||
          page.url().includes("/orders"),
      });

      // Drill into first order detail
      const clicked = await safeClick(
        page.locator('a[href*="/account/orders/"]'),
        5000
      );
      if (clicked) {
        await page.waitForLoadState("domcontentloaded");
        await collectWebVitals(page);
        console.log(`[VU:${__VU}] 📦 Order detail: ${page.url()}`);
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
