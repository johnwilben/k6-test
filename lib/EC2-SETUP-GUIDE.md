# EC2 Setup Guide — k6 Browser Stress Test

Complete guide for setting up k6 browser-based stress testing on AWS EC2 x86 (Intel/AMD) spot instances.

---

## 1. Launch EC2 Spot Instance

### Recommended Instance Types

| VUs Target | Instance | vCPU | RAM | Spot Price |
|------------|----------|------|-----|------------|
| 30 VUs | c6i.xlarge | 4 | 8 GB | ~$0.03/hr |
| 50 VUs | c6i.2xlarge | 8 | 16 GB | ~$0.07/hr |
| 80 VUs | c6i.4xlarge | 16 | 32 GB | ~$0.14/hr |
| 150 VUs | c6i.8xlarge | 32 | 64 GB | ~$0.28/hr |
| 300 VUs | c6i.12xlarge | 48 | 96 GB | ~$0.42/hr |
| 500 VUs | c6i.16xlarge | 64 | 128 GB | ~$0.56/hr |
| 1000 VUs | c6i.24xlarge | 96 | 192 GB | ~$0.84/hr |

> Each Chromium browser VU uses ~300-500 MB RAM.

### Launch via AWS Console

1. Go to **EC2 → Launch Instance**
2. **AMI:** Ubuntu 24.04+ x86_64 (amd64)
3. **Instance type:** c6i.xlarge (or higher based on VU target)
4. **Advanced details → Purchasing option:** Check **Request Spot Instances**
5. **Storage:** 20 GB gp3
6. **Security group:** Allow SSH (port 22) from your IP
7. **Key pair:** Select or create one
8. Launch

---

## 2. SSH Into Instance

```bash
ssh -i your-key.pem ubuntu@<public-ip>
```

---

## 3. Full Setup (Copy-Paste All)

Run each section in order.

### 3.1 Swap (8GB)

```bash
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10
```

### 3.2 System Dependencies

```bash
sudo apt-get update -y
sudo apt-get install -y \
  git \
  unzip \
  curl \
  fonts-liberation \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libgbm1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libpango-1.0-0 \
  libcairo2 \
  libxshmfence1 \
  libxfixes3 \
  libxext6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcursor1 \
  libxi6 \
  libxtst6 \
  libxss1
sudo apt-get install -y libasound2t64 || sudo apt-get install -y libasound2
```

### 3.3 Install Chromium (Non-Snap via PPA)

Ubuntu redirects `apt install chromium` to snap, which has issues on EC2.
Use the xtradeb PPA for a real Chromium package:

```bash
sudo add-apt-repository -y ppa:xtradeb/apps
sudo apt-get update
sudo apt-get install -y chromium
```

Set k6 to use it:

```bash

export K6_BROWSER_EXECUTABLE_PATH=$(which chromium)
```

Verify:

```bash
chromium --no-sandbox --headless --disable-gpu --version
```

### 3.4 Install k6

```bash
sudo snap install k6
```

If snap not available:

```bash
curl -LO https://github.com/grafana/k6/releases/download/v0.56.0/k6-v0.56.0-linux-amd64.tar.gz
tar xzf k6-v0.56.0-linux-amd64.tar.gz
sudo mv k6-v0.56.0-linux-amd64/k6 /usr/local/bin/
```

Verify:

```bash
k6 version
```

### 3.5 Kernel Settings (Required for Chromium on EC2)

```bash
# Allow ptrace (Chromium debugging)
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope

# Increase shared memory
sudo mount -o remount,size=2G /dev/shm

# Increase file descriptor limits
ulimit -n 65536
```

### 3.6 Environment Variables

```bash
# Add to .bashrc so they persist
cat >> ~/.bashrc << 'EOF'
export K6_BROWSER_EXECUTABLE_PATH=$(which chromium)
export DBUS_SESSION_BUS_ADDRESS=/dev/null
export K6_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-setuid-sandbox --incognito --no-first-run --disable-background-networking --disable-features=MetricsReporting,UkmEngine"
ulimit -n 65536
EOF

source ~/.bashrc
```

### 3.7 Clone Repo

```bash
cd /home/ubuntu
git clone https://github.com/johnwilben/k6-test.git
cd k6-test
git checkout fix/k6-stress-test-bugs
mkdir -p screenshots
```

---

## 4. Run Tests

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

## 5. Test Flows Covered

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

## 6. Reports & Output

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
scp -i your-key.pem ubuntu@<ec2-ip>:/home/ubuntu/k6-test/stress-report.html .
scp -i your-key.pem ubuntu@<ec2-ip>:/home/ubuntu/k6-test/spike-report.html .
```

---

## 7. Metrics Collected

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

## 8. Thresholds (Pass/Fail)

### Stress Test

| Metric | Threshold |
|--------|-----------|
| `page_load_time` p95 | < 15,000ms |
| `flow_errors` | < 15% |
| `flow_success` | > 85% |

### Spike Test

| Metric | Threshold |
|--------|-----------|
| `page_load_time` p95 | < 20,000ms |
| `flow_errors` | < 30% |
| `flow_success` | > 70% |

---

## 9. VU Capacity Guide

| RAM | Max Browser VUs (safe) | Max Browser VUs (with swap) |
|-----|------------------------|----------------------------|
| 8 GB | 15-20 | 25-30 |
| 16 GB | 30-40 | 45-55 |
| 32 GB | 60-80 | 90-100 |
| 64 GB | 120-150 | 170-200 |
| 96 GB | 180-230 | 260-300 |
| 128 GB | 250-320 | 350-500 |
| 192 GB | 380-480 | 550-1000 |

---

## 10. Troubleshooting

### "browser process ended unexpectedly"
```bash
# Ensure all env vars are set
export K6_BROWSER_EXECUTABLE_PATH=/opt/chromium/chrome
export DBUS_SESSION_BUS_ADDRESS=/dev/null
export K6_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-setuid-sandbox"
```

### "ptrace: Input/output error"
```bash
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope
```

### "scaling_cur_freq: No such file or directory"

This is a Graviton/ARM-specific issue. On x86 instances, this file exists by default. If you still encounter it:
```bash
sudo mkdir -p /sys/devices/system/cpu/cpu0/cpufreq
echo 2500000 | sudo tee /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq
echo 2500000 | sudo tee /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq
```

### "Too many open files"
```bash
ulimit -n 65536
sudo sysctl -w fs.inotify.max_user_instances=1024
sudo sysctl -w fs.inotify.max_user_watches=524288
```

### "maximum number of active connections for UID"
```bash
export DBUS_SESSION_BUS_ADDRESS=/dev/null
```

### "Failed to connect to the bus"
Normal on EC2 — these are warnings, not errors. Ignore them.

### "signal: killed" during test
RAM is full. Reduce VUs or use a bigger instance.

### Leftover Chromium processes
```bash
pkill -9 chromium
pkill -9 chrome
pkill -9 k6
```

### k6 command not found
```bash
export PATH=$PATH:/snap/bin
# Or install via direct binary
curl -LO https://github.com/grafana/k6/releases/download/v0.56.0/k6-v0.56.0-linux-amd64.tar.gz
tar xzf k6-v0.56.0-linux-amd64.tar.gz
sudo mv k6-v0.56.0-linux-amd64/k6 /usr/local/bin/
```

---

## 11. Quick Reference — Fresh Instance Setup

Copy-paste this entire block on a fresh **Ubuntu 24.04 x86_64** EC2:

```bash
# Swap
sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# System deps
sudo apt-get update -y
sudo apt-get install -y git curl fonts-liberation libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1
sudo apt-get install -y libasound2t64 || sudo apt-get install -y libasound2

# Chromium (non-snap via PPA)
sudo add-apt-repository -y ppa:xtradeb/apps
sudo apt-get update
sudo apt-get install -y chromium

# k6 (x86_64)
curl -LO https://github.com/grafana/k6/releases/download/v0.56.0/k6-v0.56.0-linux-amd64.tar.gz
tar xzf k6-v0.56.0-linux-amd64.tar.gz
sudo mv k6-v0.56.0-linux-amd64/k6 /usr/local/bin/k6

# Kernel settings
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope
echo 'kernel.yama.ptrace_scope = 0' | sudo tee /etc/sysctl.d/99-ptrace.conf
sudo sysctl -p /etc/sysctl.d/99-ptrace.conf
sudo mount -o remount,size=4G /dev/shm

# Env vars (persist)
cat >> ~/.bashrc << 'EOF'
export K6_BROWSER_EXECUTABLE_PATH=$(which chromium)
export DBUS_SESSION_BUS_ADDRESS=/dev/null
export K6_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-setuid-sandbox --incognito --no-first-run --disable-background-networking --disable-features=MetricsReporting,UkmEngine"
ulimit -n 65536
EOF
source ~/.bashrc

# Repo
cd /home/ubuntu
git clone https://github.com/johnwilben/k6-test.git
cd k6-test
git checkout fix/k6-stress-test-bugs
mkdir -p screenshots

# Upload tokens file from local machine:
#   scp -i your-key.pem tokens.txt ubuntu@<ec2-ip>:/home/ubuntu/k6-test/

# Run (single token)
k6 run \
  -e TOKEN=<your_sso_jwt_token> \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=30 \
  lib/stress.js

# Run (multi token file)
k6 run \
  -e TOKENS_FILE=/home/ubuntu/k6-test/tokens.txt \
  -e BASE_URL=https://jewelry-uat.palawanpay.com \
  -e VUS=75 \
  lib/stress.js
```

---

## 12. After Testing

**Terminate the EC2 instance** to stop charges:

```bash
aws ec2 terminate-instances --instance-ids <instance-id>
```

Or via AWS Console: **EC2 → Instances → Select → Instance State → Terminate**

> Spot instances are billed per second. Terminate immediately after testing.
