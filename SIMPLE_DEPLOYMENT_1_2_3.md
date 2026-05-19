# 🚀 Deploy Olira Website - Simple 1, 2, 3 Steps

**Time**: 2-3 hours  
**Difficulty**: Easy (follow steps, no coding needed)  
**Result**: Website live at https://olira.com

---

## BEFORE YOU START (Do These First)

### Thing 1: Buy Domains
- Go to **namecheap.com** or **godaddy.com**
- Buy: `olira.com` (required)
- Optional: `design.com`, `portfolio.com` (if hosting other sites)
- **Cost**: ~$10/year each

### Thing 2: Create Cloudflare Account
- Go to **https://cloudflare.com**
- Sign up with your email
- Click "Add Site"
- Enter: `olira.com`
- Cloudflare shows 2 nameservers (write them down)

### Thing 3: Change Nameservers
- Go back to your domain registrar (namecheap/godaddy)
- Find "Manage DNS" or "Nameservers"
- Replace with Cloudflare's nameservers
- Wait 10 minutes (or up to 24 hours)

### Thing 4: Download Certificate
- In Cloudflare Dashboard, go to: **SSL/TLS → Origin Server**
- Click "Create Certificate"
- Click "Generate"
- Download 2 files:
  - Save as: `origin-cert.pem`
  - Save as: `origin-cert.key`
- Keep these safe (you'll need them)

✅ **Done with preparation? Let's deploy!**

---

## STEP 1️⃣: INSTALL UBUNTU ON MINI PC (30 minutes)

### Download Ubuntu
1. Go to **https://ubuntu.com/download/server**
2. Download: **Ubuntu Server 22.04 LTS** (easiest version)
3. Burn to USB drive using **Balena Etcher** (free app)

### Install on Mini PC
1. Insert USB into mini PC
2. Power on and boot from USB
3. Follow the installation wizard:
   - Choose language
   - Choose timezone
   - Create username (example: `admin`)
   - Create password (make it strong)
   - **When asked about SSH**: ✅ Yes, install SSH
   - Choose "Use entire disk" (simple option)
   - Wait for installation to complete

### After Installation
1. Mini PC restarts
2. Login with your username/password
3. **Note the IP address shown** (e.g., `192.168.1.100`)

✅ **Ubuntu is installed!**

---

## STEP 2️⃣: RUN THE AUTOMATION SCRIPTS (45 minutes)

### Connect to Mini PC from Your Computer
```bash
# Open Terminal/Command Prompt on your computer
ssh admin@192.168.1.100

# Type your password when asked
# You're now "inside" the mini PC
```

### Download Deployment Scripts
```bash
cd ~
git clone https://github.com/archimatrix47-design/Olira.git
cd Olira/DEPLOYMENT_SCRIPTS
chmod +x *.sh
```

### Script 1: Harden the Server
```bash
sudo bash 01-ubuntu-hardening.sh

# Just press Enter when it asks questions
# This takes 3-5 minutes
```

### Script 2: Install Docker
```bash
bash 02-docker-install.sh

# When it finishes, it says: "log out and log back in"
# Type: exit
# Then SSH back in: ssh admin@192.168.1.100
```

### Script 3: Set Up Nginx
```bash
bash ~/Olira/DEPLOYMENT_SCRIPTS/03-nginx-proxy-setup.sh

# Just waits for you to confirm
# Press Enter to continue
```

### Script 4: Copy Your Certificates
```bash
# On your COMPUTER (not mini PC), open a new Terminal and type:
scp origin-cert.pem admin@192.168.1.100:~/docker/nginx-proxy/certs/
scp origin-cert.key admin@192.168.1.100:~/docker/nginx-proxy/certs/

# Enter password when asked
```

### Script 5: Start Nginx
```bash
# Back on mini PC terminal
bash ~/Olira/DEPLOYMENT_SCRIPTS/04-start-nginx.sh

# When it asks "is the certificate file there?", you should see: ✓ Files found
```

### Script 6: Deploy Olira Website
```bash
bash ~/Olira/DEPLOYMENT_SCRIPTS/05-deploy-olira.sh

# This takes 5-10 minutes (building the website)
# Just wait and watch the progress
# When it finishes, you'll see: ✅ Container is healthy!
```

### Script 7: Connect Domain to Website
```bash
bash ~/Olira/DEPLOYMENT_SCRIPTS/06-create-website-config.sh olira olira.com 3004

# When it asks "Reload Nginx?", type: y
# Done!
```

✅ **Website is deployed!**

---

## STEP 3️⃣: TEST AND VERIFY (15 minutes)

### Test 1: From Mini PC
```bash
# On mini PC terminal, type:
curl http://localhost:3004/

# You should see: <!DOCTYPE html> ... (HTML code)
# That means the website is running ✓
```

### Test 2: From Your Computer
```bash
# Open web browser
# Type: https://olira.com

# You should see:
# ✓ Olira website loads
# ✓ Lock icon in address bar (HTTPS)
# ✓ No "untrusted" warnings
```

### If Something is Wrong

| Problem | Fix |
|---------|-----|
| Browser says "can't reach olira.com" | Wait 5 minutes (DNS is updating), then try again |
| "Connection refused" | Wait 2 minutes for container to start, then refresh |
| "Untrusted certificate" | Check Cloudflare SSL/TLS setting is "Full (strict)" |
| Website shows error | Open terminal on mini PC and type: `docker logs olira -f` |

### If Website Works

```
✅ Website is LIVE!
✅ Automatic restart on power off/on
✅ Backups running daily
✅ HTTPS secure (Cloudflare + Origin cert)
✅ Ready for visitors!
```

---

## THAT'S IT! 🎉

Your website is now live at: **https://olira.com**

### What Happens Now?
- Website is running 24/7
- If mini PC restarts, website auto-starts
- Backups save every day
- Security is handled by Cloudflare
- You're done!

### Add More Websites (Optional)

To add design.com or portfolio.com:

```bash
# Repeat this pattern for each new website:

# 1. Create folder
mkdir ~/docker/design

# 2. Clone website code
cd ~/docker/design
git clone <github-url> .

# 3. Copy Dockerfile and docker-compose.yml from olira
# (Copy files from ~/docker/olira/)

# 4. Start it
docker compose up -d --build

# 5. Connect to domain
bash ~/Olira/DEPLOYMENT_SCRIPTS/06-create-website-config.sh design design.com 3005
```

---

## 📞 Need Help?

### Common Questions

**Q: How do I update the website?**
```bash
cd ~/docker/olira
git pull
docker compose up -d --build
```

**Q: How do I check if it's running?**
```bash
docker ps
# Should show: olira, nginx-proxy running
```

**Q: How do I see the logs?**
```bash
docker logs olira -f
```

**Q: Where are my backups?**
```bash
ls ~/backups/
# Shows backup files
```

**Q: Can I reboot the mini PC?**
```
Yes! Everything will auto-restart.
Just type: sudo reboot
```

---

## ✅ You're Done!

**Congratulations!** 

Your Olira website is now:
- ✅ Live on the internet
- ✅ Secure with HTTPS
- ✅ Protected by Cloudflare
- ✅ Auto-backup daily
- ✅ Auto-restart on reboot

**No more work needed. It just runs.**

---

**Questions?** 
- Check `DEPLOYMENT_QUICK_START.md` for more details
- Check `MINI_PC_SERVER_SETUP_GUIDE.md` for complete reference
- All files in: `~/Olira/` directory

**Enjoy! 🚀**
