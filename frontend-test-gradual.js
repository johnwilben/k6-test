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

const homeDuration = new Trend('home_duration');
const searchDuration = new Trend('search_duration');
const cartDuration = new Trend('cart_duration');

export const options = {
  scenarios: {
    browser_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 5 },  
        { duration: '4m', target: 10 }, 
        { duration: '1m', target: 0 },  
      ],
      options: { 
        browser: { 
          type: 'chromium',
        } 
      },
    },
  },
  thresholds: {
    'browser_errors': ['rate<0.05'], 
    'page_load_time': ['p(95)<10000'], 
    'home_duration': ['p(95)<12000'],  
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
    
    // Check using wait and visibility
    const logoExists = await page.waitForSelector('a.logo', { state: 'visible', timeout: 10000 });
    check(page, {
      'Home: Logo visible': () => logoExists !== null,
    });

    sleep(Math.random() * 3 + 2); 

    // 2. SEARCH PAGE
    console.log(`[VU:${__VU}] Searching for products...`);
    const searchStart = Date.now();
    await page.goto(`${BASE_URL}/search?q=ring`, { waitUntil: 'networkidle' });
    searchDuration.add(Date.now() - searchStart);
    
    // RE-FIXED: Ginamit ang waitForSelector (state: attached/visible) sa halip na nth/first
    const productItem = await page.waitForSelector('.product-item', { state: 'visible', timeout: 10000 });
    check(page, {
      'Search: Results shown': () => productItem !== null,
    });

    sleep(Math.random() * 2 + 1);

    // 3. CART PAGE
    console.log(`[VU:${__VU}] Checking Cart...`);
    const cartStart = Date.now();
    await page.goto(`${BASE_URL}/cart`, { waitUntil: 'networkidle' });
    cartDuration.add(Date.now() - cartStart);

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
    await page.screenshot({ path: `screenshots/error_vu${__VU}.png` });
  } finally {
    await page.close();
    await context.close();
  }
}

export function handleSummary(data) {
  return {
    "frontend-10vu-report.html": htmlReport(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
