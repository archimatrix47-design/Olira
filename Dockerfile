# Multi-stage Dockerfile for Olira Website
# Stage 1: Build the Astro static bundle
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all deps (including devDeps needed for `astro build`)
RUN npm ci

# Copy source and build the static bundle into /app/dist
COPY . .
RUN npm run build

# Stage 2: Production runtime
# node:20-alpine ships with the C libraries sharp's prebuilt binaries need.
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install only production deps (multer, sharp, express, etc.)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built static site
COPY --from=builder /app/dist ./dist

# Server + scripts (server.js imports scripts/convert-to-webp.mjs at startup)
COPY server.js ./
COPY scripts ./scripts
COPY astro.config.mjs ./
COPY tailwind.config.mjs ./

# Static assets needed at runtime (logos, product photos, topo map, icons).
# public/uploads/ is excluded here on purpose — it's a volume mount in
# docker-compose so admin uploads persist across container rebuilds.
COPY public ./public

# Data directory for runtime JSON (products, certs, contacts, branding).
# In production this is a mounted volume so admin edits survive rebuilds.
RUN mkdir -p /app/data /app/public/uploads/products

# Internal port the express server listens on
EXPOSE 5000

# Health check — hits the express health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
