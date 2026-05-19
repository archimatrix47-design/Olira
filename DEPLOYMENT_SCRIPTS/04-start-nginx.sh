#!/bin/bash

# Start Nginx Reverse Proxy
# Run as: bash 04-start-nginx.sh

set -e

echo "================================"
echo "Starting Nginx Proxy"
echo "================================"

cd ~/docker/nginx-proxy

# Check for certificate files
if [ ! -f "certs/origin-cert.pem" ] || [ ! -f "certs/origin-cert.key" ]; then
    echo "❌ Error: Certificate files not found!"
    echo ""
    echo "Please download Origin Certificate from Cloudflare:"
    echo "  1. Go to Cloudflare Dashboard"
    echo "  2. SSL/TLS > Origin Server > Create Certificate"
    echo "  3. Save .pem file as: ~/docker/nginx-proxy/certs/origin-cert.pem"
    echo "  4. Save .key file as: ~/docker/nginx-proxy/certs/origin-cert.key"
    echo ""
    exit 1
fi

echo "[1/3] Starting Nginx container..."
docker compose up -d

echo "[2/3] Waiting for container to be healthy..."
sleep 3

echo "[3/3] Verifying..."
docker compose logs -n 5

echo ""
echo "✅ Nginx Proxy Started!"
echo ""
echo "Verification:"
docker ps | grep nginx-proxy
echo ""
echo "Next steps:"
echo "1. Deploy websites using: bash 05-deploy-olira.sh"
echo "2. Create website-specific configs in: ~/docker/nginx-proxy/conf.d/"
echo ""
