#!/bin/bash

# Nginx Reverse Proxy Setup Script
# Run as: bash 03-nginx-proxy-setup.sh

set -e

echo "================================"
echo "Nginx Reverse Proxy Setup"
echo "================================"

# Create nginx-proxy directory
mkdir -p ~/docker/nginx-proxy
cd ~/docker/nginx-proxy

echo "[1/3] Creating docker-compose.yml..."
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  nginx:
    image: nginx:latest
    container_name: nginx-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
      - ./conf.d:/etc/nginx/conf.d:ro
    networks:
      - web-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  web-network:
    external: true
EOF

echo "[2/3] Creating nginx.conf (basic configuration)..."
cat > nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    # Log format
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name _;
        return 301 https://$host$request_uri;
    }

    # SSL configuration defaults
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Include additional config files
    include /etc/nginx/conf.d/*.conf;
}
EOF

echo "[3/3] Creating conf.d directory..."
mkdir -p conf.d

cat > conf.d/default.conf << 'EOF'
# Placeholder for website configs
# Each website will have its own .conf file
# Example: olira.conf, design.conf, portfolio.conf
EOF

echo ""
echo "✅ Nginx Proxy Configuration Complete!"
echo ""
echo "⚠️  Important: Add your Origin Certificate files:"
echo "   1. Download from Cloudflare: SSL/TLS > Origin Server"
echo "   2. Save as: ~/docker/nginx-proxy/certs/origin-cert.pem"
echo "   3. Save as: ~/docker/nginx-proxy/certs/origin-cert.key"
echo ""
echo "Then run: bash 04-start-nginx.sh"
echo ""
