import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// Metrics
const errorRate = new Rate('browser_errors');
const homeDuration = new Trend('home_duration');
const searchDuration = new Trend('search_duration');

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
        browser: { type: 'chromium' } 
      },
    },
  },
  thresholds: {
    'browser_errors': ['rate<0.1'],
    'home_duration': ['p(95)<20000'],
  },
};

const BASE_URL = 'https://jewelry-uat.palawanpay.com';

export default async function () {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. HOME PAGE
    console.log(`[VU:${__VU}] Opening Home...`);
    const startHome = Date.now();
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
    homeDuration.add(Date.now() - startHome);
    
    // Check using a simple selector
    const logo = await page.$('a.logo');
    check(page, {
      'Home: Logo exists': () => logo !== null,
    });

    sleep(3);

    // 2. SEARCH PAGE
    console.log(`[VU:${__VU}] Searching...`);
    const startSearch = Date.now();
    await page.goto(`${BASE_URL}/search?q=ring`, { waitUntil: 'load', timeout: 60000 });
    searchDuration.add(Date.now() - startSearch);
    
    const results = await page.$('.product-item');
    check(page, {
      'Search: Has results': () => results !== null,
    });

    errorRate.add(0);
  } catch (err) {
    // Kung mag-error, i-log natin ang exact message
    console.log(`[VU:${__VU}] Caught Error: ${err}`);
    errorRate.add(1);
  } finally {
    await page.close();
    await context.close();
  }
}

export function handleSummary(data) {
  return {
    "frontend-stripped-report.html": htmlReport(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
