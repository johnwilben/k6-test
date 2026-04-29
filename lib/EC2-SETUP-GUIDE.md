# EC2 Setup Guide — k6 Browser Stress Test

Complete guide for setting up k6 browser-based stress testing on AWS EC2 Graviton (ARM) spot instances.

---

## 1. Launch EC2 Spot Instance

### Recommended Instance Types

| VUs Target | Instance | vCPU | RAM | Spot Price |
|------------|----------|------|-----|------------|
| 30 VUs | c6g.xlarge | 4 | 8 GB | ~$0.03/hr |
| 50 VUs | c6g.2xlarge | 8 | 16 GB | ~$0.07/hr |
| 80 VUs | c6g.4xlarge | 16 | 32 GB | ~$0.14/hr |

> Each Chromium browser VU uses ~300-500 MB RAM.

### Launch via AWS Console

1. Go to **EC2 → Launch Instance**
2. **AMI:** Ubuntu 24.04+ ARM (Graviton)
3. **Instance type:** c6g.xlarge (or higher based on VU target)
4. **Advanced details → Purchasing option:** Check **Request Spot Instances**
5. **Storage:** 20 GB gp3 (enough for k6 + Chromium + reports)
6. **Security group:** Allow SSH (port 22) from your IP
7. **Key pair:** Select or create one
8. Launch

### Launch via AWS CLI

```bash
aws ec2 run-instances \
  --image-id ami-xxxxxxxxx \
  --instance-type c6g.2xlarge \
  --key-name <your-key-pair> \
  --security-group-ids <your-sg-id> \
  --instance-market-options '{"MarketType":"spot","SpotOptions":{"SpotInstanceType":"one-time"}}' \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=k6-stress-test}]' \
  --region ap-southeast-1
```

---

## 2. SSH Into Instance

```bash
ssh -i your-key.pem ubuntu@<public-ip>
```

---

## 3. Setup Script (Copy-Paste Everything)

```bash
# ─── SWAP (8GB) ─────────────────────────────────────────
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10

# ─── SYSTEM PACKAGES ────────────────────────────────────
sudo apt-get update -y
sudo apt-get install -y \
  chromium \
  fonts-liberation \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libgbm1 \
  git
sudo apt-get install -y libasound2t64 || sudo apt-get install -y libasound2

# ─── INSTALL k6 ─────────────────────────────────────────
# Option A: Snap (easiest)
sudo snap install k6

# Option B: Direct binary (if snap not available)
# curl -LO https://github.com/grafana/k6/releases/download/v0.56.0/k6-v0.56.0-linux-arm64.tar.gz
# tar xzf k6-v0.56.0-linux-arm64.tar.gz
# sudo mv k6-v0.56.0-linux-arm64/k6 /usr/local/bin/

# ─── KERNEL SETTINGS (required for Chromium on EC2) ─────
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope
sudo mount -o remount,size=2G /dev/shm

# ─── CLONE REPO ─────────────────────────────────────────
cd /home/ubuntu
git clone https://github.com/johnwilben/k6-test.git
cd k6-test
git checkout fix/k6-stress-test-bugs

# ─── CREATE DIRECTORIES ─────────────────────────────────
mkdir -p screenshots
```

---

## 4. Set Environment Variables (Every Session)

```bash
# Required — Chromium won't work on EC2 without these
export K6_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-setuid-sandbox"

# Optional — point k6 to system Chromium
export K6_BROWSER_EXECUTABLE_PATH=$(which chromium)
```

> Add these to `~/.bashrc` so they persist across sessions:
> ```bash
> echo 'export K6_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-setuid-sandbox"' >> ~/.bashrc
> echo 'export K6_BROWSER_EXECUTABLE_PATH=$(which chromium)' >> ~/.bashrc
> source ~/.bashrc
> ```

---

## 5. Run Tests

### Stress Test (Gradual Ramp)

VUs increase over time — good for observing how the app behaves as load grows.

```bash
cd /home/ubuntu/k6-test

# Default: 30 VUs, 12 min
k6 run \
  -e TOKEN=<your_sso_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  lib/stress.js

# Custom VUs
k6 run \
  -e TOKEN=<your_sso_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=50 \
  lib/stress.js

# With debug logging
k6 run \
  -e TOKEN=<your_sso_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=30 -e DEBUG=true \
  lib/stress.js
```

#### Stress Test Options

| Env Var | Default | Description |
|---------|---------|-------------|
| `TOKEN` | (required) | SSO JWT token |
| `BASE_URL` | jewelry-uat.palawanpay.com | Target URL |
| `VUS` | 30 | Peak virtual users |
| `RAMPUP` | normal | Preset: `fast` (6m), `normal` (12m), `long` (20m) |
| `DEBUG` | false | Enable verbose logging |

#### Ramp Presets

| Preset | Duration | Pattern |
|--------|----------|---------|
| `fast` | ~6 min | Quick ramp, good for breaking point |
| `normal` | ~12 min | Gradual ramp (default) |
| `long` | ~20 min | Slow sustained load, good for endurance |

### Spike Test (Near-Simultaneous)

All VUs hit within 10 seconds — simulates a sudden traffic surge.

```bash
# 20 users spike for 3 minutes
k6 run \
  -e TOKEN=<your_sso_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=20 \
  -e HOLD=3m \
  lib/spike.js

# 50 users spike for 5 minutes
k6 run \
  -e TOKEN=<your_sso_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=50 \
  -e HOLD=5m \
  lib/spike.js
```

#### Spike Test Options

| Env Var | Default | Description |
|---------|---------|-------------|
| `TOKEN` | (required) | SSO JWT token |
| `BASE_URL` | jewelry-uat.palawanpay.com | Target URL |
| `VUS` | 100 | Concurrent users |
| `HOLD` | 3m | How long to hold the spike |

---

## 6. Test Flows Covered

Both stress and spike tests cover these 14 user flows:

| # | Flow | What It Does |
|---|------|-------------|
| 1 | Login | SSO callback authentication |
| 2 | Profile | Navigate to /account |
| 3 | Search | Random search terms (ring, gold, diamond, etc.) |
| 4 | Filter | Navigate categories → click into category |
| 5 | PDP | Search → click product detail page |
| 6 | Add to Cart | Click "Add to Cart" on PDP |
| 7 | View Cart | Navigate to /cart |
| 8 | Remove from Cart | Remove item from cart |
| 9 | Add to Wishlist | Click wishlist button on PDP |
| 10 | Remove from Wishlist | Remove from wishlist page |
| 11 | Add Address | Fill and submit new address |
| 12 | Update Address | Edit existing address |
| 13 | Remove Address | Delete an address |
| 14 | Orders | View orders + drill into order detail |

---

## 7. Reports & Output

After each run, these files are generated:

| File | Description |
|------|-------------|
| `stress-report.html` | Visual HTML report (stress test) |
| `stress-summary.json` | Raw JSON data (stress test) |
| `spike-report.html` | Visual HTML report (spike test) |
| `spike-summary.json` | Raw JSON data (spike test) |
| `screenshots/` | Error screenshots for debugging |

### Download Reports to Local Machine

```bash
# From your local machine
scp -i your-key.pem ubuntu@<ec2-ip>:/home/ubuntu/k6-test/stress-report.html .
scp -i your-key.pem ubuntu@<ec2-ip>:/home/ubuntu/k6-test/spike-report.html .
```

---

## 8. Metrics Collected

### Global Metrics

| Metric | Description |
|--------|-------------|
| `page_load_time` | Browser page load duration |
| `time_to_first_byte` | TTFB from navigation API |
| `first_contentful_paint` | FCP from paint API |
| `flow_errors` / `flow_success` | Overall pass/fail rate |

### Per-Flow Metrics

| Metric | Description |
|--------|-------------|
| `flow_{name}_duration` | Timing for each flow step |
| `flow_{name}_errors` | Error count per flow |

### Browser Web Vitals

| Metric | Good | Needs Work | Poor |
|--------|------|------------|------|
| TTFB | < 800ms | 800ms-1.8s | > 1.8s |
| FCP | < 1.8s | 1.8s-3s | > 3s |
| LCP | < 2.5s | 2.5s-4s | > 4s |
| CLS | < 0.1 | 0.1-0.25 | > 0.25 |

---

## 9. Thresholds (Pass/Fail)

### Stress Test

| Metric | Threshold |
|--------|-----------|
| `page_load_time` p95 | < 15,000ms |
| `flow_errors` | < 15% |
| `flow_success` | > 85% |

### Spike Test (relaxed for spike conditions)

| Metric | Threshold |
|--------|-----------|
| `page_load_time` p95 | < 20,000ms |
| `flow_errors` | < 30% |
| `flow_success` | > 70% |

---

## 10. VU Capacity Guide

| RAM | Max Browser VUs (safe) | Max Browser VUs (with swap) |
|-----|------------------------|----------------------------|
| 8 GB | 15-20 | 25-30 |
| 16 GB | 30-40 | 45-55 |
| 32 GB | 60-80 | 90-100 |
| 64 GB | 120-150 | 170-200 |

---

## 11. Troubleshooting

### Chromium crashes on launch
```bash
# Fix ptrace
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope

# Fix shared memory
sudo mount -o remount,size=2G /dev/shm

# Ensure browser args are set
export K6_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-setuid-sandbox"
```

### "signal: killed" during test
RAM is full. Reduce VUs or use a bigger instance.

### k6 command not found (snap)
```bash
# Snap binary might not be in PATH
export PATH=$PATH:/snap/bin
# Or install via direct binary
curl -LO https://github.com/grafana/k6/releases/download/v0.56.0/k6-v0.56.0-linux-arm64.tar.gz
tar xzf k6-v0.56.0-linux-arm64.tar.gz
sudo mv k6-v0.56.0-linux-arm64/k6 /usr/local/bin/
```

### libasound2 not found
```bash
sudo apt-get install -y libasound2t64
```

### Timeouts during test
Normal under stress — this IS the test data. If too many timeouts, reduce VUs.

---

## 12. After Testing

**Terminate the EC2 instance** to stop charges:

```bash
# From AWS CLI
aws ec2 terminate-instances --instance-ids <instance-id>
```

Or via AWS Console: **EC2 → Instances → Select → Instance State → Terminate**

> Spot instances are billed per second. Terminate immediately after testing.
