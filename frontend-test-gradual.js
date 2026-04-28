import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

const homeDuration = new Trend('home_duration');
const errorRate = new Rate('browser_errors');

export const options = {
  scenarios: {
    browser_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 5 },
        { duration: '3m', target: 10 }, // Balik sa 10 VUs
        { duration: '1m', target: 0 },
      ],
      options: { 
        browser: { type: 'chromium' } 
      },
    },
  },
  thresholds: {
    'browser_errors': ['rate<0.1'],
    'home_duration': ['p(95)<15000'],
  },
};

export default async function () {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const startHome = Date.now();
    await page.goto('https://jewelry-uat.palawanpay.com', { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });
    homeDuration.add(Date.now() - startHome);
    
    // Kumuha ng sample text sa body para sa check
    const bodyText = await page.evaluate(() => document.body.innerText);

    check(bodyText, {
      'Site Rendered (Has Rings)': (t) => t.includes('Rings'),
      'Site Rendered (Has Jewelry)': (t) => t.includes('JEWELRY'),
    });

    errorRate.add(0);
    sleep(5);
  } catch (err) {
    console.log(`[VU:${__VU}] Error: ${err.message}`);
    errorRate.add(1);
  } finally {
    await page.close();
    await context.close();
  }
}

export function handleSummary(data) {
  return {
    "palawan-jewelry-final-report.html": htmlReport(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
