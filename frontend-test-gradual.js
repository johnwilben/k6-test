import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

const trends = {
    gql_login: new Trend('gql_action_login'),
    gql_search: new Trend('gql_action_search'),
    gql_add_to_cart: new Trend('gql_action_add_to_cart'),
    gql_checkout_init: new Trend('gql_action_checkout'),
};

export const options = {
    scenarios: {
        graphql_e2e: {
            executor: 'constant-vus',
            vus: 5,
            duration: '10m',
            options: { browser: { type: 'chromium' } },
        },
    },
};

const BASE_URL = 'https://jewelry-uat.palawanpay.com';

export default async function () {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // 1. LOGIN (GraphQL Mutation usually)
        console.log(`[VU:${__VU}] Action: Login via GQL`);
        const startLogin = Date.now();
        await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
        
        await page.locator('input[type="email"]').type('uat_test@palawanpay.com');
        await page.locator('input[type="password"]').type('UATPassword123!');
        
        // Hintayin natin ang GraphQL response ng 'login' mutation
        await Promise.all([
            page.waitForResponse(res => res.url().includes('/graphql') && res.status() === 200),
            page.locator('button[type="submit"]').click(),
        ]);
        trends.gql_login.add(Date.now() - startLogin);

        sleep(2);

        // 2. FILTERING / SEARCHING (GraphQL Query)
        console.log(`[VU:${__VU}] Action: GQL Search`);
        const startSearch = Date.now();
        await page.goto(`${BASE_URL}/search?q=ring`, { waitUntil: 'networkidle' });
        
        // Sa GraphQL, kailangan nating hintayin na mag-render yung elements 
        // kasi yung page load (200 OK) ay madalas empty shell lang.
        await page.waitForSelector('.product-item', { timeout: 15000 });
        trends.gql_search.add(Date.now() - startSearch);

        // 3. ADDING TO CART (The most heavy GraphQL Mutation)
        console.log(`[VU:${__VU}] Action: Add to Cart`);
        const startAddCart = Date.now();
        
        const addToCartBtn = page.locator('button.add-to-cart-btn').nth(0); // Adjust selector
        await Promise.all([
            // Hintayin ang specific cart mutation response
            page.waitForResponse(res => res.url().includes('/graphql')), 
            addToCartBtn.click(),
        ]);
        
        trends.gql_add_to_cart.add(Date.now() - startAddCart);
        check(page, {
            'Cart Updated': () => page.locator('.cart-count').innerText() !== '0',
        });

        // 4. ADDRESS & PURCHASES (Account Dashboard)
        console.log(`[VU:${__VU}] Action: Fetching Orders/Address`);
        await page.goto(`${BASE_URL}/customer/account`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.account-dashboard', { timeout: 10000 });

    } catch (err) {
        console.error(`[VU:${__VU}] GraphQL Flow Error: ${err.message}`);
        await page.screenshot({ path: `screenshots/gql_error_vu${__VU}.png` });
    } finally {
        await page.close();
        await context.close();
    }
}

export function handleSummary(data) {
    return {
        "graphql-frontend-report.html": htmlReport(data),
    };
}
