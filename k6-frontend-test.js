import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

const BASE = 'https://jewelry-uat.palawanpay.com';
const errorRate = new Rate('browser_errors');
const pageLoad = new Trend('page_load_time');
const ttfb = new Trend('time_to_first_byte');
const fcp = new Trend('first_contentful_paint');

const pages = [
  { name: 'Home', path: '/' },
  { name: 'Search', path: '/search?q=ring' },
  { name: 'Categories', path: '/categories' },
  { name: 'Cart', path: '/cart' },
  { name: 'Account', path: '/account' },
  { name: 'Account_Reviews', path: '/account/reviews' },
  { name: 'Account_Name', path: '/account/name' },
  { name: 'Account_Contact', path: '/account/contact' },
  { name: 'Account_Delete', path: '/account/delete' },
  { name: 'Account_Downloads', path: '/account/downloads' },
  { name: 'Account_PaymentTokens', path: '/account/payment-tokens' },
  { name: 'Account_Address', path: '/account/addresses' },
  { name: 'Checkout', path: '/checkout' },
];

// Create per-page metrics
const pageDurations = {};
pages.forEach(p => pageDurations[p.name] = new Trend(p.name.toLowerCase() + '_duration'));

export const options = {
  scenarios: {
    browser_test: {
      executor: 'constant-vus',
      vus: 3,
      duration: '5m',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    page_load_time: ['p(95)<10000'],
    browser_errors: ['rate<0.1'],
  },
};

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function visitPage(page, name, path, metric) {
  try {
    console.log(`[${name}] Loading...`);
    const start = Date.now();
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
    const dur = Date.now() - start;
    metric.add(dur);

    check(page, { [`${name} loaded`]: p => p.url().includes(BASE) });

    // Collect web vitals
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
      if (perf.loadTime > 0) pageLoad.add(perf.loadTime);
      if (perf.ttfb > 0) ttfb.add(perf.ttfb);
      if (perf.fcp > 0) fcp.add(perf.fcp);
      console.log(`[${name}] ${dur}ms | TTFB: ${Math.round(perf.ttfb)}ms | FCP: ${Math.round(perf.fcp)}ms`);
    } catch (e) {}

    // Screenshot
    await page.screenshot({ path: `screenshots/${name}.png` });
    errorRate.add(0);
  } catch (e) {
    console.log(`[${name}] ERROR: ${e.message}`);
    errorRate.add(1);
  }
}

export default async function () {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Visit all pages
    for (const p of pages) {
      await visitPage(page, p.name, p.path, pageDurations[p.name]);
      sleep(randInt(1, 3));
    }

    // PDP — search then click a product
    try {
      console.log('[PDP] Navigating to product...');
      const pdpStart = Date.now();
      await page.goto(BASE + '/search?q=gold', { waitUntil: 'networkidle', timeout: 30000 });
      const link = await page.locator('a[href*="/p/"]').first();
      if (link) {
        await link.click();
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
      }
      if (!pageDurations['PDP']) pageDurations['PDP'] = new Trend('pdp_duration');
      pageDurations['PDP'].add(Date.now() - pdpStart);
      await page.screenshot({ path: 'screenshots/PDP.png' });
      console.log(`[PDP] ${Date.now() - pdpStart}ms`);
      errorRate.add(0);
    } catch (e) {
      console.log(`[PDP] ERROR: ${e.message}`);
      errorRate.add(1);
    }
    sleep(randInt(1, 3));

  } finally {
    await page.close();
    await context.close();
  }
}

export function handleSummary(data) {
  return {
    "frontend-report.html": htmlReport(data),
    "frontend-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
