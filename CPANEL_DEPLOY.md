# Deploying to cPanel

The site is an Express app (`server.js`) that serves the Astro build (`dist/`)
**and** the API. It is not a static site, so it runs under cPanel's Node.js
application support (Passenger) rather than being dropped into `public_html`.

Deployment is: **push to GitHub → pull in cPanel → click Deploy.**

> **Replacing an existing site?** Start at
> [Replacing the current website](#replacing-the-current-website) instead — the
> order of operations differs, and step 0 is a backup.

---

## Replacing the current website

The domain already points at this cPanel account, so nothing here touches DNS.
That is worth knowing: rollback takes effect immediately, with no waiting for
propagation.

### Step 0 — Back up, and download the backup

**cPanel → Backup Wizard → Back Up → Full Backup**, then **download the file to
your own computer.**

Downloading is the part that matters. A backup left on the server is not a
backup — if the account itself has a problem, it is gone with everything else.
This archive is the only way back to the current site once step 1 runs.

Email accounts, forwarders, and DNS live outside `public_html` and are not
affected by replacing the website. Your `info@` mailbox keeps working.

### Step 1 — Clear the old site

Once the backup is downloaded, empty `public_html` in File Manager.

Delete the old `.htaccess` too. This matters more than it looks: a leftover
`.htaccess` (WordPress rewrite rules especially) can intercept requests before
Passenger sees them, and a leftover `index.html` or `index.php` can keep being
served for `/`. The symptom is the old site still appearing after a deploy that
reported success — confusing, and it sends you looking in the wrong place.

cPanel regenerates the `.htaccess` it needs in step 3.

### Step 2 — Clone the repository

**cPanel → Git Version Control → Create:**

- Clone URL: `https://github.com/archimatrix47-design/Olira.git`
- Repository path: `/home/<user>/olira`

**Clone before creating the Node.js app.** cPanel refuses to clone into a
directory that already has files in it, and creating the app populates that
directory first. Doing it the other way round fails.

Private repo? Add a deploy key in cPanel and paste the public key into GitHub
under Settings → Deploy keys.

### Step 3 — Create the Node.js app

**cPanel → Setup Node.js App → Create Application:**

| Field | Value |
|---|---|
| Node.js version | 20 (or any 18.17+) |
| Application mode | Production |
| Application root | `olira` (the directory you just cloned into) |
| Application URL | your domain |
| Application startup file | `server.js` |

Note the Node version — it goes in `.cpanel.yml` in step 6.

This creates `/home/<user>/nodevenv/olira/<version>/`, the environment
`.cpanel.yml` activates, and writes the `.htaccess` that routes the domain to
the app.

### Step 4 — Create the persistent data directories

In **Terminal**:

```bash
mkdir -p ~/olira-data ~/olira-uploads
```

These live **outside** the repo deliberately. See
[Why DATA_DIR must be outside the repo](#why-data_dir-and-uploads_dir-must-be-outside-the-repo).

### Step 5 — Set environment variables

In **Setup Node.js App**, add these to the application. They belong here, not in
git — `.env` is gitignored precisely so they are never committed.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ADMIN_PASSWORD` | your admin password |
| `JWT_SECRET` | a long random string |
| `DATA_DIR` | `/home/<user>/olira-data` |
| `UPLOADS_DIR` | `/home/<user>/olira-uploads` |
| `SMTP_HOST` | your mail host |
| `SMTP_PORT` | usually `465` |
| `SMTP_USER` | the sending mailbox |
| `SMTP_PASSWORD` | its password |
| `CORS_ORIGINS` | `https://oliraagroindustry.com,https://www.oliraagroindustry.com` |
| `SITE_URL` | `https://oliraagroindustry.com` |

`SMTP_PASSWORD` is the name the code reads. `SMTP_PASS` is ignored, and email
silently stays off.

`CORS_ORIGINS` is the list of sites allowed to post to the API. Admin sign in,
the team workspaces and the enquiry form all fail with a 403 if the live domain
is missing from it. `SITE_URL` is the address used in the workspace links inside
team notification email; it falls back to the first `CORS_ORIGINS` entry.

Weak or missing secrets do **not** stop the app. The public site keeps serving
and only `/admin` is locked, with `ADMIN LOGIN DISABLED` printed in the startup
log and `adminLoginEnabled: false` in `/api/health`. If sign in is refused after
a deploy, check those first.

### Step 6 — Check `.cpanel.yml` and deploy

`.cpanel.yml` sets `DEPLOY_HOME` (your home folder) and `NODEVER` (the Node
version from step 3) and runs `scripts/deploy.sh`, which copies the checkout
into the app, installs, builds from the app's data folder, restarts it and pings
IndexNow. Check both lines, then commit and push. To see what a deploy would do
without changing anything, in Terminal:

```bash
cd ~/repositories/Olira && DEPLOY_DRY=1 NODEVER=20 sh scripts/deploy.sh
```

Then: **Git Version Control → Manage → Pull or Deploy → Update from Remote →
Deploy HEAD Commit.**

### Step 7 — Verify before calling it done

Work through [Verifying a deploy](#verifying-a-deploy-actually-worked) below.
A green "deployment succeeded" only means the tasks exited without error — it
does not mean the site is serving.

---

## Every deploy after that

1. `git push` from here
2. cPanel → Git Version Control → **Manage** → *Pull or Deploy* tab
3. **Update from Remote** (fetches from GitHub)
4. **Deploy HEAD Commit** (runs `.cpanel.yml`)

Steps 3–4 are manual. cPanel does not deploy automatically when you push to
GitHub — GitHub has no way to notify it without extra webhook plumbing. If the
two clicks become tiresome, that can be automated later.

---

## A staging copy: staging.oliraagroindustry.com

A second copy of the site, with its own data, for checking a change before it
goes live. It asks for a password, tells search engines to stay out, loads no
Analytics or Ads tag, and never mails buyers or staff (`lib/staging.js`).

`scripts/deploy.sh` decides by branch: the checkout on `main` deploys to
`~/olira` (live), the checkout on `staging` to `~/olira-staging`. Any other
branch stops. So deploying the staging checkout cannot touch the live site,
**provided the `staging` branch is made from a commit that has this
`scripts/deploy.sh`** (an older `.cpanel.yml` copied to the live folder).

One-time setup, in this order:

1. **Domains → Create a New Domain:** `staging.oliraagroindustry.com`. The
   wildcard certificate already covers it, so it is on https at once.
2. **Terminal:** copy the live data so the copy has real products to show:
   ```bash
   mkdir -p ~/olira-staging-data ~/olira-staging-uploads
   cp -a ~/olira-data/. ~/olira-staging-data/ && cp -a ~/olira-uploads/. ~/olira-staging-uploads/
   ```
   (Enquiries come along. Delete `~/olira-staging-data/inquiries.json` first if
   the copy should start without them.)
3. **Git Version Control → Create:** clone the same GitHub URL into
   `/home/oliraagr/repositories/Olira-staging`, then **Manage** and set the
   checked-out branch to `staging` (push a `staging` branch from GitHub first).
4. **Setup Node.js App → Create Application:** same Node version as live,
   application root `olira-staging`, application URL
   `staging.oliraagroindustry.com`, startup file `server.js`. Environment
   variables: the live list from step 5 with `DATA_DIR` and `UPLOADS_DIR`
   pointing at the staging folders, `SITE_URL` and `CORS_ORIGINS` set to
   `https://staging.oliraagroindustry.com`, a **different** `JWT_SECRET`, and:

   | Variable | Value |
   |---|---|
   | `SITE_ENV` | `staging` |
   | `STAGING_PASSWORD` | the password testers type (user name `olira`, or set `STAGING_USER`) |
   | `STAGING_MAIL_TO` | optional: one address that receives every email the copy sends |

5. **Git Version Control → Manage (Olira-staging) → Deploy HEAD Commit.**

From then on: push to `staging`, deploy the staging checkout, check
https://staging.oliraagroindustry.com, then merge to `main` and deploy live.

---

## The enquiry database (MariaDB)

Without database settings the website keeps enquiries in `~/olira-data/inquiries.json`
(the newest 1,000). With them it keeps every enquiry in MariaDB, in the table
`olira_enquiries` (`lib/lead-store.js`): one row each, the whole record as JSON in
`doc`, and name, email, company, product, line, stage and owner as columns to sort
and filter in phpMyAdmin. cPanel's database backups include it.

One-time setup (the database `oliraagr_site` already exists):

1. **MySQL Databases → Add New User:** a user (for example `oliraagr_site`) with a
   strong password you keep. Then **Add User To Database**: that user,
   `oliraagr_site`, **ALL PRIVILEGES**.
2. **Setup Node.js App → the olira app → Environment variables:** add
   `DB_NAME` = `oliraagr_site`, `DB_USER` = the user from step 1 (with its
   `oliraagr_` prefix), `DB_PASSWORD` = its password. `DB_HOST` defaults to
   `localhost`. Save.
3. Restart the app so it reads them (a deploy restarts it reliably; see
   "Reliably restarting the app").
4. **Admin → Overview → Site health:** "Enquiries kept in" shows MariaDB with the
   count, and **Check the database** runs the website's own steps in a scratch
   table and removes it.

On its first start with the database the app makes the table and copies
`inquiries.json` in once, then renames the file `inquiries.imported-<date>.json`.

If the database stops answering, a new enquiry from the website is kept in
`~/olira-data/inquiries-pending.json` and moves in as soon as the database answers
again; the staff screens say the list cannot be reached; `/api/health` reports
`enquiryStore`, so the uptime check mails info@.

To go back to the file: remove `DB_NAME` and `DB_USER` and restart. The file then
starts empty; export the table from phpMyAdmin first if you need the enquiries.

---

## Cron jobs (cPanel → Cron Jobs)

Set **Cron Email** to the address that should hear about problems. Cron mails
whatever a job prints, so both jobs are set up to print only when there is news.
Create the backup folder once first (Terminal: `mkdir -p ~/olira-backups`), or
the first night's job cannot open its log.

| When | Command | What it does |
|---|---|---|
| Daily 03:15 | `/bin/sh /home/oliraagr/olira/scripts/backup-data.sh >> /home/oliraagr/olira-backups/backup.log` | Archives `~/olira-data` and `~/olira-uploads` to `~/olira-backups`, keeps 14 days. Successes go to `backup.log`; a failure is mailed |
| Every 10 minutes | `/bin/sh /home/oliraagr/olira/scripts/uptime-check.sh` | Mails once when `/api/health` stops answering "ok", once when it is back |

The uptime check runs on the same server: it catches the app failing, not the
whole server going down. A free outside monitor watching
`https://oliraagroindustry.com/api/health` covers that case.

The backups also sit on the same server. Download one now and then (File
Manager, `olira-backups`), or keep using cPanel's own backup if the host makes
one.

---

## Rolling back

Because DNS never changed, rollback is immediate.

**If the new site is broken but the old one is still needed:** restore the
downloaded full backup through cPanel → Backup Wizard → Restore, or upload the
old `public_html` contents and `.htaccess` back through File Manager. Then stop
or remove the Node.js app in Setup Node.js App so it stops claiming the domain.

**If a deploy broke a working new site:** you do not need the backup. Roll the
code back instead —

```bash
git revert <bad-commit>
git push
```

— then Update from Remote + Deploy HEAD Commit. Reverting is safer than
`reset --hard` here, because the deployed commit stays in history rather than
disappearing from under the server.

Live content in `~/olira-data` and `~/olira-uploads` is untouched by either
path, since neither is in git.

---

## Why `DATA_DIR` and `UPLOADS_DIR` must be outside the repo

Everything edited on the site — in the admin panel (certifications, contact
details, branding, staff accounts), the marketing workspaces (products, social
links, partner logos) and the manager's workspace (enquiries) — together with
uploaded images and analytics history, is stored as files, not in a database.

`data/*.json` is **tracked in git**. If `DATA_DIR` pointed at the repo folder,
the next deploy would check out the committed versions over the live ones and
silently reset every edit made through the admin panel and the workspaces. Uploaded images, which
are not in git at all, would be deleted outright.

Pointing both variables outside the repo keeps live content on a completely
separate path from anything git touches. On first boot the app copies the
committed defaults into an empty `DATA_DIR` to seed it, then never overwrites
them again.

**Back up `~/olira-data` and `~/olira-uploads` before any risky change.** They
are not in git, so nothing else holds a copy.

---

## Verifying a deploy actually worked

1. Load the homepage and confirm your latest change is visible.
2. Hard-refresh (Ctrl+F5). A cached copy of the *old* site is the most common
   reason a correct deploy looks like it failed.
3. Load `/admin` and log in.
4. Submit a test inquiry and confirm the email arrives.
5. Confirm products show your admin edits, not the git defaults — this is the
   check that catches a wrong `DATA_DIR`.

## When something goes wrong

**Deploy log:** cPanel → Git Version Control → Manage → *Pull or Deploy*.
**App log:** the path shown in Setup Node.js App.

| Symptom | Likely cause |
|---|---|
| Old site still showing | Leftover `index.html`/`index.php`/`.htaccess` in `public_html`, or browser cache |
| `npm: command not found` | Node version in `.cpanel.yml` ≠ the one in Setup Node.js App, so the `nodevenv` path does not exist |
| `source: not found` | The task shell is not bash — change `source` to `.` in `.cpanel.yml` |
| Clone fails, directory not empty | The Node.js app was created before the clone — see step 2 |
| `npm ci` fails on lockfile | `package-lock.json` missing from the repo; it must stay committed |
| Deploy succeeds, site unchanged | Passenger did not restart — check the `tmp/restart.txt` task ran |
| App will not start | Missing `JWT_SECRET` / `ADMIN_PASSWORD`, or startup file is not `server.js` |
| Admin edits reverted after deploy | `DATA_DIR` is pointing inside the repo |
| 503 / "Application error" | App crashed on boot — read the app log, usually a missing env var |

---

## Restart-free admin password recovery

This host's LiteSpeed/CloudLinux setup does not reliably restart the Node app, so
changing `ADMIN_PASSWORD` via the env var can silently never take effect (this
caused a long lockout). The app now supports changing/recovering the admin
password **without any restart**, by reading from `DATA_DIR` live:

**Routine change (logged in):** `POST /api/admin/change-password` with
`{ "newPassword": "…" }` and your admin token. Writes `DATA_DIR/auth.json` (a
hash); effective on the next login. (A form for this can be added to the admin panel.)

**Recovery (locked out or password unknown):**
1. cPanel → **File Manager** → go to your `DATA_DIR` (`/home/oliraagr/olira-data`).
2. Create a file named **`admin-reset.txt`** containing only the new password
   (12+ characters), no quotes, no trailing spaces.
3. Go to `/admin` and log in with that new password. The app adopts it, deletes
   `admin-reset.txt`, clears any lockout, and re-enables login — **no restart**.

Precedence: `auth.json` override → else the `ADMIN_PASSWORD` env var. The env var
remains the fallback for a fresh deploy.

The admin-login flood guard is now `ADMIN_LOGIN_RATE_PER_MIN` (default 10).

---

## Reliably restarting the app (this host)

The cPanel Restart button, Stop/Start, cloudlinux-selector, and tmp/restart.txt
do NOT reliably cycle the process on this host — a worker once ran 20+ days
ignoring every restart, which caused an outage and a password that never updated.
The process serving requests is a LiteSpeed worker named lsnode:/home/oliraagr/olira/
(not server.js). To force a real restart after any deploy or env-var change:



Then load the site once to trigger a fresh spawn, and check /api/health. The
Deploy HEAD Commit flow runs this automatically now.
