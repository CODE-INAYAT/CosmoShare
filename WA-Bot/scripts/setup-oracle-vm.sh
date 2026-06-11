#!/bin/bash
# ============================================
# CosmoShare WA-Bot - Oracle Cloud VM Setup Script
# Supports: Oracle Linux 8 / Ubuntu 22.04 ARM
# Run as:   bash setup-oracle-vm.sh
# ============================================

set -e

echo "========================================="
echo "  CosmoShare WA-Bot Setup"
echo "========================================="

# Detect OS
if [ -f /etc/oracle-release ] || [ -f /etc/redhat-release ]; then
    OS="oracle"
elif [ -f /etc/lsb-release ]; then
    OS="ubuntu"
else
    echo "Unsupported OS. This script supports Oracle Linux 8 and Ubuntu 22.04."
    exit 1
fi

echo "Detected OS: $OS"
echo ""

# ---------- 1. Update system ----------
echo "[1/6] Updating system packages..."
if [ "$OS" = "oracle" ]; then
    sudo dnf update -y
else
    sudo apt update && sudo apt upgrade -y
fi
echo "✓ System updated"
echo ""

# ---------- 2. Install Node.js 20 LTS ----------
echo "[2/6] Installing Node.js 20 LTS..."
if [ "$OS" = "oracle" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf install -y nodejs
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "✓ Node.js version: $(node --version)"
echo "✓ npm version:     $(npm --version)"
echo ""

# ---------- 3. Install Chromium dependencies ----------
echo "[3/6] Installing Chromium dependencies (required by whatsapp-web.js / Puppeteer)..."
if [ "$OS" = "oracle" ]; then
    sudo dnf install -y chromium nss atk at-spi2-atk cups-libs libXcomposite \
        libXdamage libXrandr mesa-libgbm pango alsa-lib
else
    sudo apt install -y chromium-browser libnss3 libatk1.0-0 libatk-bridge2.0-0 \
        libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
        libasound2 libxshmfence1
fi
echo "✓ Chromium dependencies installed"
echo ""

# ---------- 4. Install PM2 ----------
echo "[4/6] Installing PM2 globally..."
sudo npm install -g pm2
echo "✓ PM2 version: $(pm2 --version)"
echo ""

# ---------- 5. Configure PM2 startup ----------
echo "[5/6] Configuring PM2 startup (auto-start on boot)..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$(whoami)" --hp "$HOME"
echo "✓ PM2 startup configured"
echo ""

# ---------- 6. Create app directory ----------
echo "[6/6] Setting up application directory..."
APP_DIR="$HOME/wa-bot"
if [ ! -d "$APP_DIR" ]; then
    mkdir -p "$APP_DIR"
    echo "✓ Created $APP_DIR"
else
    echo "✓ $APP_DIR already exists"
fi

# Create required subdirectories
mkdir -p "$APP_DIR/sessions" "$APP_DIR/temp" "$APP_DIR/logs"
echo "✓ Created sessions/, temp/, logs/ subdirectories"
echo ""

echo "========================================="
echo "  ✅ Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Copy WA-Bot files to $APP_DIR/"
echo "  2. cd $APP_DIR && npm install"
echo "  3. cp .env.example .env && nano .env"
echo "  4. pm2 start ecosystem.config.js --env production"
echo "  5. Scan the QR code with WhatsApp"
echo "  6. pm2 save"
echo ""
