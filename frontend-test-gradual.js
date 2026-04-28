import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const homeDuration = new Trend('home_duration');

export const options = {
  scenarios: {
    browser_test: {
      executor: 'constant-vus',
      vus: 3,             // SIMULAN NATIN SA 3 VUS LANG MUNA
      duration: '3m',      // 3 minutes lang para makita kung stable
      options: { 
        browser: { type: 'chromium' } 
      },
    },
  },
};

export default async function () {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const start = Date.now();
    // Gamitin ang pinaka-basic na navigation
    await page.goto('https://jewelry-uat.palawanpay.com', { waitUntil: 'domcontentloaded' });
    homeDuration.add(Date.now() - start);
    
    // Simpleng check lang kung "Palawan" ay nasa title
    const title = await page.title();
    check(title, {
      'Title contains Palawan': (t) => t.includes('Palawan'),
    });

    sleep(5); 
  } catch (err) {
    console.log(`[VU:${__VU}] Runtime Error: ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }
}
