# ─── Default (30 VUs, normal ramp) ──────────────────────
k6 run \
  -e TOKEN=<paste_token_dito> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  lib/stress.js

# ─── Custom VUs ──────────────────────────────────────────
# 50 VUs peak:
k6 run \
  -e TOKEN=<paste_token_dito> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=50 \
  lib/stress.js

# 100 VUs peak:
k6 run \
  -e TOKEN=<paste_token_dito> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=100 \
  lib/stress.js

# ─── Ramp Presets ────────────────────────────────────────
# Fast (6 min total):
k6 run \
  -e TOKEN=<token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=50 -e RAMPUP=fast \
  lib/stress.js

# Long (20 min total):
k6 run \
  -e TOKEN=<token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=50 -e RAMPUP=long \
  lib/stress.js

# ─── With Debug ──────────────────────────────────────────
k6 run \
  -e TOKEN=<token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=30 -e DEBUG=true \
  lib/stress.js
