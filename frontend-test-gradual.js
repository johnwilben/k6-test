import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const homeDuration = new Trend('home_duration');
const searchDuration = new Trend('search_duration');

export const options = {
  scenarios: {
    browser_test: {
      executor: 'constant-vus',
      vus: 5,               // Itaas natin sa 5
      duration: '5m',
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
    // 1. HOME
    const startHome = Date.now();
    await page.goto('https://jewelry-uat.palawanpay.com', { waitUntil: 'domcontentloaded' });
    homeDuration.add(Date.now() - startHome);
    
    const title = await page.title();
    check(title, { 'Home Loaded': (t) => t.includes('Palawan') });

    sleep(3);

    // 2. SEARCH
    const startSearch = Date.now();
    await page.goto('https://jewelry-uat.palawanpay.com/search?q=ring', { waitUntil: 'domcontentloaded' });
    searchDuration.add(Date.now() - startSearch);
    
    // Check if body exists (simplest check)
    const body = await page.$('body');
    check(page, { 'Search Page OK': () => body !== null });

  } catch (err) {
    console.log(`[VU:${__VU}] Error: ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }
}
