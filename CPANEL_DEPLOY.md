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
| `SMTP_PASS` | its password |

`server.js` refuses to start in production with weak or default secrets, so a
missing `JWT_SECRET` or `ADMIN_PASSWORD` stops the app rather than running it
insecurely. If the app will not boot, check these first.

### Step 6 — Fill in `.cpanel.yml` and deploy

Edit the two `EDIT ME` lines at the top of `.cpanel.yml` with your cPanel
username and the Node version from step 3, then commit and push.

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

Everything the admin panel manages — products, certifications, contact details,
branding, social links, uploaded images, and analytics history — is stored as
files, not in a database.

`data/*.json` is **tracked in git**. If `DATA_DIR` pointed at the repo folder,
the next deploy would check out the committed versions over the live ones and
silently reset every edit made through the admin panel. Uploaded images, which
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
