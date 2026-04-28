import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const homeDuration = new Trend('home_duration');

export const options = {
  scenarios: {
    browser_test: {
      executor: 'constant-vus',
      vus: 3, // Safe muna tayo sa 3
      duration: '2m',
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
    console.log(`[VU:${__VU}] Navigating to Home...`);
    
    await page.goto('https://jewelry-uat.palawanpay.com', { 
      waitUntil: 'load', // 'load' muna para mabilis
      timeout: 60000 
    });

    homeDuration.add(Date.now() - startHome);
    
    // KUNIN NATIN ANG TOTOONG TITLE
    const actualTitle = await page.title();
    console.log(`[VU:${__VU}] TOTOONG TITLE NA NAKITA: "${actualTitle}"`);

    // KUNIN NATIN ANG UNANG 100 CHARACTERS NG TEXT SA BODY
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 100));
    console.log(`[VU:${__VU}] BODY TEXT SAMPLE: "${bodyText.replace(/\n/g, ' ')}"`);

    check(actualTitle, {
      'Title is not empty': (t) => t.length > 0,
    });

    // Screenshot para proof kung ano talaga ang itsura
    await page.screenshot({ path: `screenshots/actual_look_vu${__VU}.png` });

    sleep(5);
  } catch (err) {
    console.log(`[VU:${__VU}] Error: ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }
}
