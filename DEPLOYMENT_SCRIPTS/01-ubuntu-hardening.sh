#!/bin/bash

# Mini PC Server Hardening Script
# Run as: sudo bash 01-ubuntu-hardening.sh

set -e

echo "================================"
echo "Ubuntu Server Hardening Setup"
echo "================================"

# Update system
echo "[1/6] Updating system packages..."
apt update && apt upgrade -y

# Install essential tools
echo "[2/6] Installing essential tools..."
apt install -y \
  curl \
  wget \
  git \
  htop \
  net-tools \
  vim \
  build-essential \
  certbot \
  fail2ban \
  ufw

# Enable firewall
echo "[3/6] Configuring firewall..."
ufw enable
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw status

# Configure fail2ban
echo "[4/6] Setting up fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# Enable automatic security updates
echo "[5/6] Enabling automatic security updates..."
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Create app directory
echo "[6/6] Creating application directory..."
mkdir -p ~/docker/certs
mkdir -p ~/backups
chmod 700 ~/backups

echo ""
echo "✅ Ubuntu Server Hardening Complete!"
echo ""
echo "Next steps:"
echo "1. Configure static IP in /etc/netplan/00-installer-config.yaml"
echo "2. Run: sudo netplan apply"
echo "3. Run: bash 02-docker-install.sh"
echo ""
