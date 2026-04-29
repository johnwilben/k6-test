#!/bin/bash
# ═══════════════════════════════════════════════════════
# EC2 Setup Script — k6 Stress Test (Ubuntu)
# Run: chmod +x ec2-setup.sh && sudo ./ec2-setup.sh
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
  fallocate -l 8G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "  ✅ Swap enabled (8GB)"
fi

# Optimize swap behavior for stress testing
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf

echo ""
free -h
echo ""

# ─── 2. SYSTEM PACKAGES ─────────────────────────────────
echo "▶ Installing system dependencies..."
apt-get update -y
apt-get install -y \
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
apt-get install -y libasound2t64 2>/dev/null || apt-get install -y libasound2 2>/dev/null || true

echo "  ✅ System packages installed"

# ─── 3. INSTALL k6 ──────────────────────────────────────
echo ""
echo "▶ Installing k6..."
gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 2>/dev/null

echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | tee /etc/apt/sources.list.d/k6.list

apt-get update -y
apt-get install -y k6

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

chown -R ubuntu:ubuntu "$REPO_DIR"
echo "  ✅ Repo ready at $REPO_DIR"

# ─── 5. CREATE SCREENSHOTS DIR ──────────────────────────
mkdir -p "$REPO_DIR/screenshots"
chown -R ubuntu:ubuntu "$REPO_DIR/screenshots"

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
echo "    -e TOKEN=<your_sso_jwt_token> \\"
echo "    -e BASE_URL=https://jewelry-uat.palawanpay.com \\"
echo "    lib/stress.js"
echo ""
echo "  With debug:"
echo "    -e DEBUG=true"
echo ""
echo "  Memory status:"
free -h
echo ""
