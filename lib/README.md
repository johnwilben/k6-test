# k6 Stress Tests — PalawanPay Jewelry Frontend

Browser-based k6 stress test suite covering all major authenticated user flows.

---

## Project Structure

```
lib/
├── graphql.js          # HTTP helper (for direct GraphQL tests)
├── queries.js          # GraphQL queries & mutations
├── stress.js           # Main browser-based stress test
├── k6-stress-test.yml  # GitHub Actions workflow
└── README.md

Root files:
├── k6-frontend-test.js       # Page-level browser test
├── k6-magento-loadtest.js     # Gradual ramping browser test
├── frontend-test-gradual.js   # Authenticated E2E browser test
└── command                    # Quick-run command reference
```

---

## Test Coverage (stress.js)

| # | Flow | Description |
|---|------|-------------|
| 1 | User Login | SSO callback authentication |
| 2 | User Profile | Navigate to /account |
| 3 | Search Products | Search with random terms |
| 4 | Filter Products | Navigate categories, click into category |
| 5 | Product Detail (PDP) | Search → click product |
| 6 | Add to Cart | Add product from PDP |
| 7 | View Cart | Navigate to /cart |
| 8 | Remove from Cart | Remove item from cart |
| 9 | Add to Wishlist | Add product from PDP |
| 10 | Remove from Wishlist | Remove item from wishlist |
| 11 | Add Address | Fill and submit new address |
| 12 | Update Address | Edit existing address |
| 13 | Remove Address | Delete an address |
| 14 | Orders / Purchases | View orders + drill into detail |

---

## Running Locally

### Prerequisites

```bash
# macOS
brew install k6

# Ubuntu / EC2
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Run the stress test

```bash
k6 run \
  -e TOKEN=<your_sso_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  lib/stress.js
```

### With debug logging

```bash
k6 run \
  -e TOKEN=<your_sso_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e DEBUG=true \
  lib/stress.js
```

> ⚠️ **NEVER hardcode the token.** Always pass via `-e TOKEN=...` or a GitHub Secret.
> ⚠️ **Browser tests require Chromium.** k6 will download it automatically on first run.

---

## Load Profile

| Phase | Duration | VUs |
|-------|----------|-----|
| Warm-up | 2m | 1 → 5 |
| Ramp-up | 5m | 5 → 15 |
| Peak | 3m | 15 → 30 |
| Cool-down | 2m | 30 → 0 |

> VU counts are lower than protocol-level tests because each browser VU
> consumes significantly more CPU/memory.

---

## Thresholds (Pass/Fail)

| Metric | Threshold |
|--------|-----------|
| `page_load_time` p95 | < 15,000ms |
| `flow_errors` | < 15% |
| `flow_success` | > 85% |

---

## Metrics Collected

### Global
- `page_load_time` — browser page load duration
- `time_to_first_byte` — TTFB from navigation API
- `first_contentful_paint` — FCP from paint API
- `flow_errors` / `flow_success` — overall pass/fail rate

### Per-Flow
- `flow_{name}_duration` — timing for each flow step
- `flow_{name}_errors` — error count per flow

---

## Reports

After each run, two files are generated:
- `stress-report.html` — visual HTML report
- `stress-summary.json` — raw JSON data

---

## GitHub Actions

### Setup
1. Add secret: **Settings → Secrets → `PALAWANPAY_JWT_TOKEN`**
2. Trigger: **Actions → k6 Stress Test → Run workflow**

### Scheduled
Daily at **10 AM PHT** (2 AM UTC).
