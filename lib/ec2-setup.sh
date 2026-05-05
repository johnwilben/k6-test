#!/bin/bash
# ═══════════════════════════════════════════════════════
# EC2 Setup Script — k6 Stress Test (Ubuntu x86_64)
# Run: chmod +x ec2-setup.sh && ./ec2-setup.sh
# ═══════════════════════════════════════════════════════

set -e

echo "══════════════════════════════════════════"
echo "  k6 Stress Test — EC2 Setup"
echo "══════════════════════════════════════════"

# ─── 1. SWAP (8GB) ──────────────────────────────────────
echo ""
echo "▶ Setting up 8GB swap..."
if [ -f /swapfile ]; then
  echo "  Swap already exists, skipping."
else
  sudo fallocate -l 8G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo "  ✅ Swap enabled (8GB)"
fi

# Optimize swap behavior for stress testing
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf

echo ""
free -h
echo ""

# ─── 2. SYSTEM PACKAGES ─────────────────────────────────
echo "▶ Installing system dependencies..."
sudo apt-get update -y
sudo apt-get install -y \
  gnupg \
  software-properties-common \
  curl \
  git \
  chromium-browser \
  fonts-liberation \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libgbm1

# libasound2 was renamed to libasound2t64 in newer Ubuntu
sudo apt-get install -y libasound2t64 2>/dev/null || sudo apt-get install -y libasound2 2>/dev/null || true

echo "  ✅ System packages installed"

# ─── 3. INSTALL k6 ──────────────────────────────────────
echo ""
echo "▶ Installing k6..."
curl -LO https://github.com/grafana/k6/releases/download/v0.56.0/k6-v0.56.0-linux-amd64.tar.gz
tar xzf k6-v0.56.0-linux-amd64.tar.gz
sudo mv k6-v0.56.0-linux-amd64/k6 /usr/local/bin/k6
rm -rf k6-v0.56.0-linux-amd64 k6-v0.56.0-linux-amd64.tar.gz

echo "  ✅ k6 $(k6 version) installed"

# ─── 4. CLONE REPO ──────────────────────────────────────
echo ""
echo "▶ Cloning k6-test repo..."
REPO_DIR="/home/ubuntu/k6-test"

if [ -d "$REPO_DIR" ]; then
  echo "  Repo exists, pulling latest..."
  cd "$REPO_DIR"
  git pull origin fix/k6-stress-test-bugs
else
  git clone https://github.com/johnwilben/k6-test.git "$REPO_DIR"
  cd "$REPO_DIR"
  git checkout fix/k6-stress-test-bugs
fi

sudo chown -R ubuntu:ubuntu "$REPO_DIR"
echo "  ✅ Repo ready at $REPO_DIR"

# ─── 5. CREATE SCREENSHOTS DIR ──────────────────────────
mkdir -p "$REPO_DIR/screenshots"
sudo chown -R ubuntu:ubuntu "$REPO_DIR/screenshots"

# ─── 6. KERNEL SETTINGS ─────────────────────────────────
echo ""
echo "▶ Configuring kernel settings..."
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope
echo 'kernel.yama.ptrace_scope = 0' | sudo tee /etc/sysctl.d/99-ptrace.conf
sudo sysctl -p /etc/sysctl.d/99-ptrace.conf
sudo mount -o remount,size=4G /dev/shm
echo "  ✅ Kernel settings configured"

# ─── 7. ENVIRONMENT VARIABLES ───────────────────────────
echo ""
echo "▶ Setting environment variables..."
cat >> ~/.bashrc << 'EOF'
export K6_BROWSER_EXECUTABLE_PATH=$(which chromium-browser || which chromium)
export DBUS_SESSION_BUS_ADDRESS=/dev/null
export K6_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-setuid-sandbox --incognito --no-first-run --disable-background-networking --disable-features=MetricsReporting,UkmEngine"
ulimit -n 65536
EOF
source ~/.bashrc
echo "  ✅ Environment variables set"

# ─── DONE ────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo "══════════════════════════════════════════"
echo ""
echo "  Run the stress test:"
echo ""
echo "  cd $REPO_DIR"
echo "  k6 run \\"
echo "    -e TOKENS_FILE=/home/ubuntu/k6-test/tokens.txt \\"
echo "    -e BASE_URL=https://jewelry-uat.palawanpay.com \\"
echo "    -e VUS=150 \\"
echo "    lib/stress.js"
echo ""
echo "  With debug:"
echo "    -e DEBUG=true"
echo ""
echo "  Memory status:"
free -h
echo ""
