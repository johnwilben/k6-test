import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const homeDuration = new Trend('home_duration');

export const options = {
  scenarios: {
    browser_test: {
      executor: 'constant-vus',
      vus: 5, 
      duration: '3m',
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
    const startHome = Date.now();
    // 1. Gawin nating 'networkidle' para sigurado kaming tapos na ang loading
    await page.goto('https://jewelry-uat.palawanpay.com', { waitUntil: 'networkidle', timeout: 60000 });
    homeDuration.add(Date.now() - startHome);
    
    const actualTitle = await page.title();
    console.log(`[VU:${__VU}] Nakitang Title: "${actualTitle}"`); // Dito natin malalaman ang totoo

    check(actualTitle, {
      'Home Loaded (Title check)': (t) => t.length > 0, // Kahit anong title basta hindi empty
      'Contains Palawan': (t) => t.toLowerCase().includes('palawan'),
    });

    sleep(5);
  } catch (err) {
    console.log(`[VU:${__VU}] Error: ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }
}
