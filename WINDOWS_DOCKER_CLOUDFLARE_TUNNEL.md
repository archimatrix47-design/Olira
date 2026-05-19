# 🐳 Windows + Docker + Cloudflare Tunnel Setup

**Time**: 30 minutes  
**Result**: Website live at https://olira.com (no port forwarding needed)

---

## BEFORE YOU START

✅ Download:
- **Docker Desktop for Windows**: https://www.docker.com/products/docker-desktop
- **Have olira.com domain ready** (with Cloudflare account)

---

## STEP 1: INSTALL DOCKER DESKTOP (10 min)

1. Download Docker Desktop from link above
2. Install it (follow wizard)
3. Restart Windows
4. Open PowerShell/Command Prompt:
   ```bash
   docker --version
   # Should show: Docker version XX.X.X
   ```

✅ **Docker installed!**

---

## STEP 2: CLONE OLIRA & BUILD CONTAINER (5 min)

```bash
# Create folder
mkdir C:\websites
cd C:\websites

# Clone repo
git clone https://github.com/archimatrix47-design/Olira.git olira
cd olira

# Create Dockerfile (copy this exactly):
```

Create file: `C:\websites\olira\Dockerfile`

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3004
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "3004"]
```

Create file: `C:\websites\olira\docker-compose.yml`

```yaml
version: '3.8'

services:
  olira:
    build: .
    container_name: olira-website
    ports:
      - "3004:3004"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

Now run:

```bash
# Build and start
docker compose up -d --build

# Watch progress
docker logs olira-website -f

# When you see "Server running at http://0.0.0.0:3004/" - done!
# Press Ctrl+C to exit logs
```

✅ **Website running in Docker!**

Test locally:
```bash
# Open browser: http://localhost:3004
# Should load: Olira website
```

---

## STEP 3: SET UP CLOUDFLARE TUNNEL (10 min)

### 3.1: In Cloudflare Dashboard

1. Go to **https://dash.cloudflare.com**
2. Select your domain (olira.com)
3. Go to: **Networks → Tunnels**
4. Click: **Create a tunnel**
5. Name it: `olira-tunnel`
6. Choose: **Docker**
7. Copy the token (long string)

### 3.2: Run Cloudflare Tunnel in Docker

```bash
# In PowerShell, run:
docker run -d ^
  --name cloudflare-tunnel ^
  --restart unless-stopped ^
  cloudflare/cloudflared:latest ^
  tunnel run --token YOUR_TOKEN_HERE

# Replace YOUR_TOKEN_HERE with the token from step 3.1
```

### 3.3: Connect Domain to Website

Back in Cloudflare Dashboard (still on Tunnels page):

1. Click: **Configure routing**
2. Under "Public Hostname":
   - Domain: `olira.com`
   - Service type: `HTTP`
   - URL: `localhost:3004`
   - Click: **Save hostname**
3. Also add:
   - Domain: `www.olira.com`
   - Service type: `HTTP`
   - URL: `localhost:3004`
   - Click: **Save hostname**

Wait 1 minute for DNS to update.

✅ **Tunnel is live!**

---

## STEP 4: TEST (5 min)

Open browser:
```
https://olira.com
```

You should see:
- ✅ Olira website loads
- ✅ Lock icon (HTTPS)
- ✅ No warnings

✅ **DONE! Website is LIVE!**

---

## MANAGING YOUR SETUP

### Check if running:
```bash
docker ps

# Should show:
# - olira-website (running on port 3004)
# - cloudflare-tunnel (running)
```

### View logs:
```bash
# Website logs
docker logs olira-website -f

# Tunnel logs
docker logs cloudflare-tunnel -f
```

### Stop everything:
```bash
docker compose -f C:\websites\olira\docker-compose.yml down
docker stop cloudflare-tunnel
```

### Start again:
```bash
cd C:\websites\olira
docker compose up -d
docker start cloudflare-tunnel
```

### Update website:
```bash
cd C:\websites\olira
git pull
docker compose up -d --build
```

---

## AUTO-START ON WINDOWS REBOOT

### Option 1: Use Windows Task Scheduler

1. Open **Task Scheduler**
2. Create Basic Task
3. Name: `Start Olira`
4. Trigger: `At startup`
5. Action: Start a program
6. Program: `C:\Program Files\Docker\Docker\Docker Desktop.exe`
7. Add argument: `--start-docker`

Docker and containers auto-restart.

### Option 2: Simpler - Docker Desktop Settings

1. Open Docker Desktop
2. Settings → General
3. Check: **Start Docker Desktop when you log in**
4. Check: **Use the WSL 2 based engine**

Done! Everything auto-starts.

---

## TROUBLESHOOTING

| Problem | Fix |
|---------|-----|
| `docker: command not found` | Restart PowerShell after Docker install |
| `port 3004 already in use` | `docker kill olira-website`, then restart |
| `Website won't load` | Check: `docker logs olira-website -f` |
| `Cloudflare tunnel disconnected` | Check token is correct, restart tunnel |
| `DNS not resolving` | Wait 5 minutes, then refresh browser |
| `Untrusted certificate` | Check Cloudflare SSL/TLS is "Full (strict)" |

---

## SCALING TO MORE WEBSITES

Add design.com:

```bash
# 1. Create folder
mkdir C:\websites\design
cd C:\websites\design

# 2. Clone repo
git clone <design-repo-url> .

# 3. Copy Dockerfile and docker-compose.yml from olira
# 4. Change in docker-compose.yml:
#    - container_name: design-website
#    - ports: "3005:3005"

# 5. Start
docker compose up -d --build

# 6. In Cloudflare Tunnels, add:
#    - Domain: design.com
#    - URL: localhost:3005
```

---

## ✅ YOU'RE DONE!

Your website is:
- ✅ Running in Docker (professional setup)
- ✅ Live at https://olira.com
- ✅ Secure with Cloudflare
- ✅ Auto-restart on reboot
- ✅ Easy to manage

**No more work. It just runs.**

---

## QUICK COMMANDS

```bash
# Status
docker ps

# Logs
docker logs olira-website -f
docker logs cloudflare-tunnel -f

# Restart
docker restart olira-website
docker restart cloudflare-tunnel

# Update
cd C:\websites\olira && git pull && docker compose up -d --build

# Stop all
docker compose down
docker stop cloudflare-tunnel

# Start all
cd C:\websites\olira && docker compose up -d
docker start cloudflare-tunnel
```

---

**Enjoy! 🚀**
