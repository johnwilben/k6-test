# k6 Stress Tests — PalawanPay Jewelry Frontend

GraphQL-based k6 stress test suite covering all major user flows.

---

## Project Structure

```
k6-tests/
├── lib/
│   ├── graphql.js      # HTTP helper + response checker
│   └── queries.js      # All GraphQL queries & mutations
├── tests/
│   └── stress.js       # Main test entry point (stress + spike scenarios)
├── results/            # Auto-generated: JSON output after each run
└── README.md

.github/
└── workflows/
    └── k6-stress-test.yml
```

---

## Test Coverage

| Flow | Group Name |
|------|------------|
| User Profile | `user_profile` |
| Product Search & Filter | `product_search_and_filter` |
| Product Detail Page (PDP) | `product_detail_page` |
| Shopping Cart (view, add, remove) | `shopping_cart` |
| Wishlist (add, remove) | `wishlist` |
| Address CRUD (add, update, remove) | `addresses` |
| Orders / Purchases Page | `orders_page` |

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

### Run the test
```bash
k6 run \
  -e TOKEN=<your_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  k6-tests/tests/stress.js
```

> ⚠️ **NEVER hardcode the token.** Always pass via `-e TOKEN=...` or a GitHub Secret.

---

## GitHub Actions Setup

### 1. Add the secret
Go to: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|-------|
| `PALAWANPAY_JWT_TOKEN` | Your JWT token (without the URL prefix) |

### 2. Trigger manually
Go to: **Actions → k6 Stress Test → Run workflow**

You can choose:
- **base_url** — target environment
- **scenario** — `stress_test`, `spike_test`, or `both`

### 3. Scheduled runs
The workflow automatically runs daily at **10 AM PHT** (2 AM UTC).

---

## Load Profile

### Stress Test
| Phase | Duration | VUs |
|-------|----------|-----|
| Ramp-up | 2m | 0 → 10 |
| Stress | 5m | 10 → 50 |
| Peak | 3m | 50 → 100 |
| Scale-down | 2m | 100 → 50 |
| Cooldown | 2m | 50 → 0 |

### Spike Test (runs after stress test at T+15m)
| Phase | Duration | VUs |
|-------|----------|-----|
| Idle | 30s | 0 |
| Spike | 10s | 0 → 200 |
| Hold | 1m | 200 |
| Drop | 10s | 200 → 0 |

---

## Thresholds (Pass/Fail Criteria)

| Metric | Threshold |
|--------|-----------|
| `http_req_duration` p95 | < 3000ms |
| `http_req_duration` p99 | < 5000ms |
| `http_req_failed` | < 5% |
| `success_rate` | > 95% |
| `graphql_errors` | < 100 total |

---

## Customization Required

Before running, update these in `tests/stress.js`:

```js
// Adjust to real category IDs from your Magento instance
const CATEGORY_IDS = ["3", "4", "5", "6"];

// Adjust to real SKUs from your product catalog
const SAMPLE_SKUS = ["SKU001", "SKU002", "SKU003"];

// Adjust to real product URL keys
const SAMPLE_URL_KEYS = ["gold-ring-001", "silver-necklace-001"];
```

---

## Results

After each run, a `results/summary.json` is saved and uploaded as a GitHub Actions artifact (retained for 30 days).
