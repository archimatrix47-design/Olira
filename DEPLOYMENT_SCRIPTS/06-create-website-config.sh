#!/bin/bash

# Create Website-Specific Nginx Config
# Run as: bash 06-create-website-config.sh <container-name> <domain>
# Example: bash 06-create-website-config.sh olira olira.com

CONTAINER_NAME=$1
DOMAIN=$2
PORT=$3

if [ -z "$CONTAINER_NAME" ] || [ -z "$DOMAIN" ]; then
    echo "Usage: bash 06-create-website-config.sh <container-name> <domain> [port]"
    echo ""
    echo "Examples:"
    echo "  bash 06-create-website-config.sh olira olira.com 3004"
    echo "  bash 06-create-website-config.sh design design.com 3005"
    echo "  bash 06-create-website-config.sh portfolio portfolio.com 3006"
    echo ""
    exit 1
fi

# Default port if not specified
if [ -z "$PORT" ]; then
    PORT=3004
fi

echo "================================"
echo "Creating Nginx Config"
echo "================================"
echo "Container: $CONTAINER_NAME"
echo "Domain: $DOMAIN"
echo "Port: $PORT"

# Create config file
CONFIG_FILE=~/docker/nginx-proxy/conf.d/${CONTAINER_NAME}.conf

cat > $CONFIG_FILE << EOF
# $DOMAIN - Nginx Configuration
# Created: $(date)

upstream ${CONTAINER_NAME}_app {
    server ${CONTAINER_NAME}:${PORT};
}

# HTTPS Server
server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    # SSL Certificates (from Cloudflare Origin CA)
    ssl_certificate /etc/nginx/certs/origin-cert.pem;
    ssl_certificate_key /etc/nginx/certs/origin-cert.key;

    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Proxy Configuration
    location / {
        proxy_pass http://\${CONTAINER_NAME}_app;

        # Headers
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;

        # Connection settings
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;

        # Buffering
        proxy_buffering on;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
    }

    # Cache static assets (CSS, JS, images)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://\${CONTAINER_NAME}_app;
        proxy_cache_valid 200 30d;
        proxy_set_header Cache-Control "public, max-age=2592000";
        expires 30d;
    }
}
EOF

echo ""
echo "✅ Configuration created: $CONFIG_FILE"
echo ""
echo "Next steps:"
echo "1. Reload Nginx: docker exec nginx-proxy nginx -s reload"
echo "2. Test configuration: docker exec nginx-proxy nginx -t"
echo "3. Test URL: curl -k https://$DOMAIN/"
echo "4. Visit in browser: https://$DOMAIN"
echo ""
echo "Reload Nginx now? (y/n)"
read -r RELOAD

if [ "$RELOAD" = "y" ]; then
    docker exec nginx-proxy nginx -t && docker exec nginx-proxy nginx -s reload
    echo "✅ Nginx reloaded successfully!"
else
    echo "Manual reload: docker exec nginx-proxy nginx -s reload"
fi
