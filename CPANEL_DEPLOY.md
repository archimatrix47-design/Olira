# Deploying to cPanel

The site is an Express app (`server.js`) that serves the Astro build (`dist/`)
**and** the API. It is not a static site, so it runs under cPanel's Node.js
application support (Passenger) rather than being dropped into `public_html`.

Deployment is: **push to GitHub → pull in cPanel → click Deploy.**

---

## One-time setup

### 1. Create the Node.js app

cPanel → **Setup Node.js App** → Create Application:

| Field | Value |
|---|---|
| Node.js version | 20 (or any 18.17+) |
| Application mode | Production |
| Application root | `olira` |
| Application URL | your domain |
| Application startup file | `server.js` |

Note the Node version you picked — it goes in `.cpanel.yml`.

Creating the app makes `/home/<user>/nodevenv/olira/<version>/` — that is the
environment `.cpanel.yml` activates.

### 2. Create the persistent data directories

Run this in **Terminal** (or create the folders in File Manager):

```bash
mkdir -p ~/olira-data ~/olira-uploads
```

These live **outside** the repo on purpose. See "Why this matters" below.

### 3. Set environment variables

In **Setup Node.js App**, add these to your application. They belong here, not
in git — `.env` is gitignored precisely so these never get committed.

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
| `SMTP_PASS` | its password |

`server.js` refuses to start in production with weak or default secrets, so a
missing `JWT_SECRET` or `ADMIN_PASSWORD` will stop the app rather than run
insecurely. If the app won't boot, check these first.

### 4. Connect the repository

cPanel → **Git Version Control** → Create:

- Clone URL: `https://github.com/archimatrix47-design/Olira.git`
- Repository path: `/home/<user>/olira` — the **same** directory as the
  Application root above. The repo and the app are the same folder, which is
  why no file copying is needed.

Private repo? Add a deploy key in cPanel and paste the public key into GitHub
under Settings → Deploy keys.

### 5. Fill in `.cpanel.yml`

Edit the two `EDIT ME` lines at the top with your cPanel username and Node
version, then commit and push. Deployment does nothing useful until this is
done — the placeholder paths won't resolve.

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

## Why `DATA_DIR` and `UPLOADS_DIR` must be outside the repo

Everything the admin panel manages — products, certifications, contact details,
branding, social links, uploaded images, and analytics history — is stored as
files, not in a database.

`data/*.json` is **tracked in git**. If `DATA_DIR` pointed at the repo folder,
the next deploy would check out the committed versions over the live ones and
silently reset every edit made through the admin panel. Uploaded images, which
aren't in git at all, would be deleted outright.

Pointing both variables outside the repo keeps live content on a completely
separate path from anything git touches. On first boot the app copies the
committed defaults into an empty `DATA_DIR` to seed it, then never overwrites
them again.

**Back up `~/olira-data` and `~/olira-uploads` before any risky change.** They
are not in git, so nothing else holds a copy.

---

## Verifying a deploy actually worked

A green "deployment succeeded" in cPanel only means the tasks exited without
error. Confirm the site is genuinely live:

1. Load the homepage and confirm your latest change is visible.
2. Load `/admin` and log in.
3. Submit a test inquiry and confirm the email arrives.
4. Confirm products still show your admin edits, not the git defaults —
   this is the check that catches a wrong `DATA_DIR`.

## When something goes wrong

**Deploy log:** cPanel → Git Version Control → Manage → *Pull or Deploy*.
**App log:** the log path shown in Setup Node.js App.

| Symptom | Likely cause |
|---|---|
| `npm: command not found` | Node version in `.cpanel.yml` ≠ the one in Setup Node.js App, so the `nodevenv` path doesn't exist |
| `source: not found` | The task shell isn't bash — change `source` to `.` in `.cpanel.yml` |
| `npm ci` fails on lockfile | `package-lock.json` missing from the repo; it must stay committed |
| Deploy succeeds, site unchanged | Passenger didn't restart — check the `tmp/restart.txt` task ran |
| App won't start | Missing `JWT_SECRET` / `ADMIN_PASSWORD`, or the startup file isn't `server.js` |
| Admin edits reverted after deploy | `DATA_DIR` is pointing inside the repo |
