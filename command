k6 run \
  -e TOKEN=<paste_token_dito> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  k6-test/lib/stress.js
