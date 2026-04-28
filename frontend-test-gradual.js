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

  console.log(`[VU:${__VU}] --- NEW ITERATION START ---`);

  try {
    const startHome = Date.now();
    console.log(`[VU:${__VU}] Navigating to Home...`);
    
    // Tinaasan ko ang timeout sa 90s para sa debug
    const response = await page.goto('https://jewelry-uat.palawanpay.com', { 
      waitUntil: 'networkidle', 
      timeout: 90000 
    });

    homeDuration.add(Date.now() - startHome);
    
    // 1. Check HTTP Status (kung support ng k6 version mo)
    if (response) {
        console.log(`[VU:${__VU}] HTTP Status: ${response.status()}`);
    }

    // 2. Log Page Title
    const actualTitle = await page.title();
    console.log(`[VU:${__VU}] Actual Title found: "${actualTitle}"`);

    // 3. Log HTML Snippet (para makita kung error page to)
    const content = await page.content();
    console.log(`[VU:${__VU}] HTML Snippet (first 200 chars): ${content.substring(0, 200)}`);

    check(actualTitle, {
      'Title is not empty': (t) => t.length > 0,
      'Contains Palawan': (t) => t.toLowerCase().includes('palawan'),
    });

    // 4. Screenshot on fail (Manual debug)
    if (!actualTitle.toLowerCase().includes('palawan')) {
        console.log(`[VU:${__VU}] WARNING: 'Palawan' not in title. Saving screenshot...`);
        await page.screenshot({ path: `screenshots/failed_title_vu${__VU}.png` });
    }

    sleep(5);
  } catch (err) {
    console.log(`[VU:${__VU}] !!! CATCHED ERROR: ${err.message}`);
    // I-log kung timeout ba o crash
    if (err.message.includes('timeout')) {
        console.log(`[VU:${__VU}] Result: Connection Timeout after 90s`);
    }
  } finally {
    console.log(`[VU:${__VU}] Closing context...`);
    await page.close();
    await context.close();
  }
}
