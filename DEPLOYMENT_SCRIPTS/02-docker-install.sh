#!/bin/bash

# Docker Installation & Setup Script
# Run as: bash 02-docker-install.sh

set -e

echo "================================"
echo "Docker Installation & Setup"
echo "================================"

# Add Docker repository
echo "[1/4] Adding Docker repository..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository \
  "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"

# Install Docker
echo "[2/4] Installing Docker..."
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add user to docker group
echo "[3/4] Configuring docker group..."
sudo usermod -aG docker $USER
echo "⚠️  Please log out and log back in for docker group changes to take effect"

# Create docker network
echo "[4/4] Creating docker network..."
sudo docker network create web-network || echo "Network already exists"

# Verify installation
echo ""
echo "✅ Docker Installation Complete!"
echo ""
echo "Verification:"
docker --version
docker compose version

echo ""
echo "Next steps:"
echo "1. Log out and log back in (for docker group)"
echo "2. Run: bash 03-nginx-proxy-setup.sh"
echo ""
