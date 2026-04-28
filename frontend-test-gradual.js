import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

const trends = {
    gql_search: new Trend('gql_action_search'),
    gql_pdp: new Trend('gql_action_pdp'),
    gql_cart: new Trend('gql_action_cart'),
    gql_account: new Trend('gql_action_account'),
};

export const options = {
    scenarios: {
        authenticated_flow: {
            executor: 'constant-vus',
            vus: 5,
            duration: '5m',
            options: { browser: { type: 'chromium' } },
        },
    },
};

const BASE_URL = 'https://jewelry-uat.palawanpay.com';
const AUTH_TOKEN = 'ILAGAY_DITO_ANG_TOKEN_MO'; // Kunin mo ito sa DevTools > Application > LocalStorage/Cookie

export default async function () {
    const context = await browser.newContext();
    
    // 1. INJECT AUTHENTICATION (Para logged in na agad)
    // Kung Cookie ang gamit niyo:
    await context.addCookies([{
        name: 'auth_token', // Palitan base sa actual name sa UAT
        value: AUTH_TOKEN,
        domain: 'jewelry-uat.palawanpay.com',
        path: '/',
    }]);

    const page = await context.newPage();

    // Kung LocalStorage naman ang gamit ng Next.js niyo:
    // await page.evaluate((token) => {
    //     localStorage.setItem('apollo-token', token);
    // }, AUTH_TOKEN);

    try {
        // --- STEP 1: DIRECT TO PROFILE (Check if logged in) ---
        console.log(`[VU:${__VU}] Navigating to Account Dashboard...`);
        const startAcc = Date.now();
        await page.goto(`${BASE_URL}/customer/account`, { waitUntil: 'networkidle' });
        trends.gql_account.add(Date.now() - startAcc);
        
        const bodyText = await page.evaluate(() => document.body.innerText);
        check(page, {
            'Auth Success': () => bodyText.includes('My Account') || bodyText.includes('Welcome'),
        });

        sleep(2);

        // --- STEP 2: SEARCH & FILTER ---
        console.log(`[VU:${__VU}] Action: Search & Filter`);
        const startSearch = Date.now();
        await page.goto(`${BASE_URL}/search?q=ring`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.product-item', { timeout: 15000 });
        trends.gql_search.add(Date.now() - startSearch);

        // --- STEP 3: PDP ---
        console.log(`[VU:${__VU}] Action: PDP Access`);
        const startPdp = Date.now();
        const firstProduct = page.locator('.product-item a').nth(0);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            firstProduct.click(),
        ]);
        trends.gql_pdp.add(Date.now() - startPdp);

        // --- STEP 4: WISHLIST / CART (GraphQL Interaction) ---
        console.log(`[VU:${__VU}] Action: Cart Interaction`);
        const startCart = Date.now();
        // Wait for a specific GraphQL response to confirm action
        await Promise.all([
            page.waitForResponse(res => res.url().includes('/graphql')),
            page.locator('button.add-to-cart-btn').nth(0).click(),
        ]);
        trends.gql_cart.add(Date.now() - startCart);

    } catch (err) {
        console.log(`[VU:${__VU}] Flow Error: ${err.message}`);
    } finally {
        await page.close();
        await context.close();
    }
}

export function handleSummary(data) {
    return {
        "authenticated-e2e-report.html": htmlReport(data),
    };
}
