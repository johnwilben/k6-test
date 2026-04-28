import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// --- Metrics Configuration ---
const errorRate = new Rate('browser_errors');
const pageLoad = new Trend('page_load_time');
const ttfb = new Trend('time_to_first_byte');
const fcp = new Trend('first_contentful_paint');

// Names for specific page tracking
const homeDuration = new Trend('home_duration');
const searchDuration = new Trend('search_duration');
const cartDuration = new Trend('cart_duration');

export const options = {
  scenarios: {
    browser_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 5 },  // Warm-up
        { duration: '4m', target: 10 }, // Target: 10 Users (Steady State)
        { duration: '1m', target: 0 },  // Cooldown
      ],
      options: { 
        browser: { 
          type: 'chromium',
        } 
      },
    },
  },
  thresholds: {
    'browser_errors': ['rate<0.05'], // Max 5% errors
    'page_load_time': ['p(95)<10000'], // 10s goal for 95% of users
    'home_duration': ['p(95)<12000'],  // Home page focus
  },
};

const BASE_URL = 'https://jewelry-uat.palawanpay.com';

export default async function () {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. HOME PAGE
    console.log(`[VU:${__VU}] Opening Home...`);
    const homeStart = Date.now();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    homeDuration.add(Date.now() - homeStart);
    
    check(page, {
      'Home: Has Logo': (p) => p.locator('a.logo').isVisible(),
    });

    sleep(Math.random() * 3 + 2); // 2-5s think time

    // 2. SEARCH PAGE
    console.log(`[VU:${__VU}] Searching for products...`);
    const searchStart = Date.now();
    await page.goto(`${BASE_URL}/search?q=ring`, { waitUntil: 'networkidle' });
    searchDuration.add(Date.now() - searchStart);
    
    check(page, {
      'Search: Results shown': (p) => p.locator('.product-item').first().isVisible(),
    });

    sleep(Math.random() * 2 + 1);

    // 3. CART PAGE
    console.log(`[VU:${__VU}] Checking Cart...`);
    const cartStart = Date.now();
    await page.goto(`${BASE_URL}/cart`, { waitUntil: 'networkidle' });
    cartDuration.add(Date.now() - cartStart);

    // Capture Web Vitals using Performance API
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');
      const fcpEntry = paint.find(p => p.name === 'first-contentful-paint');
      return {
        loadTime: nav ? nav.loadEventEnd - nav.startTime : 0,
        ttfb: nav ? nav.responseStart - nav.startTime : 0,
        fcp: fcpEntry ? fcpEntry.startTime : 0,
      };
    });

    if (metrics.loadTime > 0) pageLoad.add(metrics.loadTime);
    if (metrics.ttfb > 0) ttfb.add(metrics.ttfb);
    if (metrics.fcp > 0) fcp.add(metrics.fcp);

    errorRate.add(0);

  } catch (err) {
    console.error(`[VU:${__VU}] Error: ${err.message}`);
    errorRate.add(1);
    await page.screenshot({ path: `screenshots/error_vu${__VU}_${Date.now()}.png` });
  } finally {
    await page.close();
    await context.close();
  }
}

// --- Report Generation ---
export function handleSummary(data) {
  return {
    "frontend-10vu-report.html": htmlReport(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
