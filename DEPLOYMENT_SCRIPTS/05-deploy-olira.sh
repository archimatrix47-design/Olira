#!/bin/bash

# Deploy Olira Website to Docker
# Run as: bash 05-deploy-olira.sh

set -e

echo "================================"
echo "Deploying Olira Website"
echo "================================"

# Create olira directory
mkdir -p ~/docker/olira
cd ~/docker/olira

echo "[1/4] Cloning Olira repository..."
if [ -d ".git" ]; then
    git pull origin main
else
    git clone https://github.com/archimatrix47-design/Olira.git .
fi

echo "[2/4] Creating Dockerfile..."
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy project files
COPY . .

# Build Astro project
RUN npm run build

# Expose port
EXPOSE 3004

# Start Astro server
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "3004"]
EOF

echo "[3/4] Creating docker-compose.yml..."
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  olira:
    build: .
    container_name: olira
    ports:
      - "3004:3004"
    environment:
      - NODE_ENV=production
    networks:
      - web-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3004/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  web-network:
    external: true
EOF

echo "[4/4] Building and starting Olira..."
docker compose up -d --build

echo ""
echo "✅ Olira Website Deployment Started!"
echo ""
echo "Build logs (this may take 2-5 minutes):"
docker compose logs -f &
LOGS_PID=$!
sleep 5

# Wait for healthcheck to pass
echo ""
echo "Waiting for container to be healthy..."
for i in {1..30}; do
    if docker compose exec olira wget --quiet --tries=1 --spider http://localhost:3004/ 2>/dev/null; then
        echo "✅ Container is healthy!"
        kill $LOGS_PID 2>/dev/null || true
        break
    fi
    echo -n "."
    sleep 2
done

echo ""
echo "Verification:"
docker ps | grep olira
echo ""
echo "Test URL (from mini PC):"
echo "  curl http://localhost:3004/"
echo ""
echo "Next steps:"
echo "1. Create Nginx config: bash 06-create-website-config.sh olira olira.com"
echo "2. Test from browser: https://olira.com"
echo ""
