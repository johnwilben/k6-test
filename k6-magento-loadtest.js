import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// --- Configuration ---
const BASE = 'https://jewelry-uat.palawanpay.com';
const AUTH_TOKEN = __ENV.CUSTOMER_TOKEN; 

// --- Custom Metrics ---
const errorRate = new Rate('browser_errors');
const pageLoad = new Trend('page_load_time');
const ttfb = new Trend('time_to_first_byte');
const fcp = new Trend('first_contentful_paint');

const pages = [
  { name: 'Home', path: '/' },
  { name: 'Search', path: '/search?q=ring' },
  { name: 'Cart', path: '/cart' },
  { name: 'Account', path: '/account' },
  { name: 'Checkout', path: '/checkout' },
];

// Per-page metrics setup
const pageDurations = {};
pages.forEach(p => {
  pageDurations[p.name] = new Trend(p.name.toLowerCase() + '_duration');
});

export const options = {
  scenarios: {
    browser_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 5 },  // Warm-up: 0 to 5 VUs
        { duration: '3m', target: 12 }, // Scaling Phase: 5 to 12 VUs (ECS trigger point)
        { duration: '5m', target: 20 }, // Stress Phase: Hold at 20 VUs
        { duration: '2m', target: 0 },  // Cool-down
      ],
      options: { 
        browser: { 
          type: 'chromium',
        } 
      },
    },
  },
  thresholds: {
    'browser_errors': ['rate<0.15'], // Allow 15% error rate for heavy stress
    'page_load_time': ['p(95)<15000'], // 15 seconds target for frontend
  },
};

// --- Helper Functions ---
function randInt(min, max) { 
  return Math.floor(Math.random() * (max - min + 1)) + min; 
}

async function visitPage(page, name, path, metric) {
  try {
    console.log(`[VU:${__VU}] Visiting ${name}...`);
    const start = Date.now();
    
    // Go to page
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    
    const dur = Date.now() - start;
    metric.add(dur);

    check(page, { [`${name} loaded`]: p => p.url().includes(BASE) });

    // Collect Web Vitals via Performance API
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');
      const fcpEntry = paint.find(p => p.name === 'first-contentful-paint');
      return {
        loadTime: nav ? nav.loadEventEnd - nav.startTime : 0,
        ttfb: nav ? nav.responseStart - nav.startTime : 0,
        fcp: fcpEntry ? fcpEntry.startTime : 0,
      };
    });

    if (perf.loadTime > 0) pageLoad.add(perf.loadTime);
    if (perf.ttfb > 0) ttfb.add(perf.ttfb);
    if (perf.fcp > 0) fcp.add(perf.fcp);

    errorRate.add(0);
  } catch (e) {
    console.log(`[VU:${__VU}] ERROR on ${name}: ${e.message}`);
    errorRate.add(1);
    await page.screenshot({ path: `screenshots/ERROR_${name}_VU${__VU}.png` });
  }
}

// --- Main Execution ---
export default async function () {
  const context = await browser.newContext();
  
  // OPTIONAL: I-inject ang token kung kailangan mo ng authenticated session
  /*
  await context.addCookies([{
    name: 'token', 
    value: AUTH_TOKEN,
    domain: 'jewelry-uat.palawanpay.com',
    path: '/',
  }]);
  */

  const page = await context.newPage();

  try {
    // 1. Loop through all defined pages
    for (const p of pages) {
      await visitPage(page, p.name, p.path, pageDurations[p.name]);
      sleep(randInt(2, 5)); // Realistic think time
    }

    // 2. Realistic Interaction: Search and go to Product Detail Page (PDP)
    try {
      console.log(`[VU:${__VU}] Testing PDP Interaction...`);
      await page.goto(BASE + '/search?q=gold', { waitUntil: 'networkidle' });
      const productLink = page.locator('a[href*="/p/"]').first();
      
      if (await productLink.isVisible()) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle' }),
          productLink.click(),
        ]);
        console.log(`[VU:${__VU}] PDP loaded successfully`);
      }
    } catch (err) {
      console.log(`[VU:${__VU}] PDP Interaction failed`);
    }

  } finally {
    await page.close();
    await context.close();
  }
}

// --- Reporting ---
export function handleSummary(data) {
  return {
    "frontend-gradual-report.html": htmlReport(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
