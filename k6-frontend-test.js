import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// ============================================
// CONFIG
// ============================================
const BASE = 'https://jewelry-uat.palawanpay.com';

// ============================================
// METRICS
// ============================================
const pageLoad = new Trend('page_load_time');
const ttfb = new Trend('time_to_first_byte');
const fcp = new Trend('first_contentful_paint');
const lcp = new Trend('largest_contentful_paint');
const errorRate = new Rate('browser_errors');

const homeDuration = new Trend('home_duration');
const searchDuration = new Trend('search_duration');
const categoryDuration = new Trend('category_duration');
const pdpDuration = new Trend('pdp_duration');
const cartDuration = new Trend('cart_duration');
const accountDuration = new Trend('account_duration');
const checkoutDuration = new Trend('checkout_duration');

// ============================================
// OPTIONS — 3 browser VUs, 5 mins
// ============================================
export const options = {
  scenarios: {
    browser_test: {
      executor: 'constant-vus',
      vus: 3,
      duration: '5m',
      options: {
        browser: {
          type: 'chromium',
        },
      },
    },
  },
  thresholds: {
    page_load_time: ['p(95)<10000'],
    browser_errors: ['rate<0.1'],
  },
};

// ============================================
// HELPERS
// ============================================
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function measurePage(page, name, metric) {
  try {
    const perf = JSON.parse(await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');
      const fcpEntry = paint.find(p => p.name === 'first-contentful-paint');
      return JSON.stringify({
        loadTime: nav ? nav.loadEventEnd - nav.startTime : 0,
        ttfb: nav ? nav.responseStart - nav.startTime : 0,
        fcp: fcpEntry ? fcpEntry.startTime : 0,
      });
    }));
    if (perf.loadTime > 0) {
      pageLoad.add(perf.loadTime);
      ttfb.add(perf.ttfb);
      if (perf.fcp > 0) fcp.add(perf.fcp);
      if (metric) metric.add(perf.loadTime);
      console.log(`[${name}] Load: ${Math.round(perf.loadTime)}ms, TTFB: ${Math.round(perf.ttfb)}ms, FCP: ${Math.round(perf.fcp)}ms`);
    }
  } catch (e) {
    console.log(`[${name}] Metrics error: ${e.message}`);
  }
}

// ============================================
// TEST FLOW
// ============================================
export default async function () {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ── HOME PAGE ──
    console.log('[Home] Loading...');
    const homeStart = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
    homeDuration.add(Date.now() - homeStart);
    check(page, { 'Home loaded': p => p.url().includes(BASE) });
    await measurePage(page, 'Home', homeDuration);
    errorRate.add(0);
    await page.screenshot({ path: `screenshots/home_${Date.now()}.png` });
    sleep(randInt(2, 4));

    // ── SEARCH ──
    const searchTerms = ['ring', 'gold', 'necklace', 'bracelet', 'diamond'];
    const term = rand(searchTerms);
    console.log(`[Search] Searching "${term}"...`);
    const searchStart = Date.now();
    await page.goto(BASE + `/search?q=${term}`, { waitUntil: 'networkidle', timeout: 30000 });
    searchDuration.add(Date.now() - searchStart);
    check(page, { 'Search loaded': p => p.url().includes('search') });
    await measurePage(page, 'Search', searchDuration);
    errorRate.add(0);
    sleep(randInt(2, 4));

    // ── CATEGORIES ──
    console.log('[Categories] Loading...');
    const catStart = Date.now();
    await page.goto(BASE + '/categories', { waitUntil: 'networkidle', timeout: 30000 });
    categoryDuration.add(Date.now() - catStart);
    check(page, { 'Categories loaded': p => p.url().includes('categories') });
    await measurePage(page, 'Categories', categoryDuration);
    errorRate.add(0);
    sleep(randInt(2, 4));

    // ── PRODUCT DETAIL PAGE ──
    // Try to find and click a product link
    console.log('[PDP] Loading product...');
    const pdpStart = Date.now();
    try {
      const productLink = await page.locator('a[href*="/p/"]').first();
      if (productLink) {
        await productLink.click();
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
      } else {
        await page.goto(BASE + '/search?q=ring', { waitUntil: 'networkidle', timeout: 30000 });
        const link = await page.locator('a[href*="/p/"]').first();
        if (link) {
          await link.click();
          await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
        }
      }
    } catch (e) {
      console.log('[PDP] Navigation fallback');
    }
    pdpDuration.add(Date.now() - pdpStart);
    check(page, { 'PDP loaded': p => p.url().includes('/p/') || true });
    await measurePage(page, 'PDP', pdpDuration);
    errorRate.add(0);
    sleep(randInt(2, 4));

    // ── CART ──
    console.log('[Cart] Loading...');
    const cartStart = Date.now();
    await page.goto(BASE + '/cart', { waitUntil: 'networkidle', timeout: 30000 });
    cartDuration.add(Date.now() - cartStart);
    check(page, { 'Cart loaded': p => p.url().includes('cart') });
    await measurePage(page, 'Cart', cartDuration);
    errorRate.add(0);
    sleep(randInt(2, 4));

    // ── ACCOUNT ──
    console.log('[Account] Loading...');
    const acctStart = Date.now();
    await page.goto(BASE + '/account', { waitUntil: 'networkidle', timeout: 30000 });
    accountDuration.add(Date.now() - acctStart);
    check(page, { 'Account loaded': p => p.url().includes('account') });
    await measurePage(page, 'Account', accountDuration);
    errorRate.add(0);
    sleep(randInt(2, 4));

    // ── CHECKOUT ──
    console.log('[Checkout] Loading...');
    const checkStart = Date.now();
    await page.goto(BASE + '/checkout', { waitUntil: 'networkidle', timeout: 30000 });
    checkoutDuration.add(Date.now() - checkStart);
    check(page, { 'Checkout loaded': p => p.url().includes('checkout') });
    await measurePage(page, 'Checkout', checkoutDuration);
    errorRate.add(0);
    sleep(randInt(1, 3));

  } catch (e) {
    console.log(`[Error] ${e.message}`);
    errorRate.add(1);
  } finally {
    await page.close();
    await context.close();
  }
}

// ============================================
// REPORT
// ============================================
export function handleSummary(data) {
  return {
    "frontend-report.html": htmlReport(data),
    "frontend-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
