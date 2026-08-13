# Olira — Improvement Backlog

Prioritized, actionable audit for Claude Code to execute **one task at a time,
top of the list first**. Each item is scoped to a single focused change.
Severity weights blast radius × likelihood × how hard it was to diagnose.

The strongest evidence is what already broke during launch:
- Empty `CORS_ORIGINS` threw on rejected origins → every POST returned an
  undiagnosable 500 for hours (analytics + contact form dead). → F1, F2
- A 10-char `ADMIN_PASSWORD` hit `process.exit(1)` → whole public site offline. → F3
- Code cloned to `~/repositories/Olira` but app ran from `~/olira` → deploys
  silently did nothing. → F8

---

## P0 — Reliability & resilience (do first)

- [ ] **F1 · Global error handler.** No `app.use((err,req,res,next))` in `server.js`.
  Add error-handling middleware last: log stack + request context (method, path,
  correlation id), return clean JSON, never leak internals. Add
  `process.on('unhandledRejection'|'uncaughtException')` logging.
- [ ] **F2 · Persisted structured logging.** Logging is `console.*` only and was
  unreachable on LiteSpeed. Write errors + key events (login, deploy, flush
  failures) to a rotating file under `DATA_DIR/logs/`, one JSON line per event.
  Document the path.
- [ ] **F3 · Decouple admin-auth failure from the public site.** `server.js` ~1458
  calls `process.exit(1)` on weak `ADMIN_PASSWORD`, darkening the whole storefront.
  Keep hard-failing on unsafe JWT secret, but on admin-auth weakness start the
  server, serve the public site + read-only APIs, and 503 only `/api/admin/*`.
- [ ] **F4 · Atomic JSON writes.** `writeJsonFile()` does a bare `writeFileSync`;
  a crash/concurrent write corrupts `products.json` etc. Write to `path.tmp` then
  `renameSync`; serialize writes through a small queue.
- [ ] **F5 · Real health check.** `/api/health` returns OK unconditionally. Make it
  verify DATA_DIR/uploads writable, analytics parseable, dist present; 503 with
  reasons otherwise. Point an uptime monitor at it.

## P1 — Architecture, testability & data integrity

- [ ] **F6 · Split app/listen.** `app.listen()` runs at import, so `server.js` is
  untestable. Extract `app.js` (exports app, no listen) + `server.js` (listen).
- [ ] **F7 · Replace flat-file store.** JSON files, no locking/schema/migrations.
  Migrate to `better-sqlite3` (single file, synchronous, transactional); keep JSON
  as seed/import. Validate at the API boundary (e.g. `zod`).
- [ ] **F9 · Add tests.** Zero exist. After F6, `supertest` for: admin login +
  lockout, CORS accept/reject, `/api/track` shapes, inquiry validation + honeypot,
  analytics aggregation math. Playwright smoke for homepage + admin login.
- [ ] **F11 · Split `admin.astro` (1,866 lines).** Extract per-tab components; move
  client JS to typed modules under `src/scripts/admin/`.

## P2 — Deployment & operations

- [ ] **F8 · Verify the real deploy path.** `.cpanel.yml` rsync bridge
  (repositories/Olira → ~/olira) is committed but never run. Do one real
  `Deploy HEAD Commit`; confirm sync + rebuild + restart. Passenger ignored
  `tmp/restart.txt` on LiteSpeed — script an explicit restart if needed.
- [ ] **F10 · CI.** No workflow. On push run `npm ci`, `npm run build`, tests (F9),
  `npm audit`. Red build blocks deploy.
- [ ] **F12 · Automated backups.** `~/olira-data` + `~/olira-uploads` are the only
  copies and are outside git. Daily cron tar to a dated archive, prune old, ideally
  copy off-server.
- [ ] **F13 · Config guardrails.** Fat-finger surface (`DATA-DIR` hyphen, short
  password, unset `CORS_ORIGINS` all happened). At startup log a masked config
  summary (set/missing/malformed); warn on unknown `*_DIR` spellings; ship a
  `config-check` script.
- [ ] **F14 · Persist rate-limit/lockout.** In-memory Maps aren't shared across
  LiteSpeed workers and reset on restart. Persist attempt counters in the store (F7).

## P3 — Security, frontend & accessibility

- [x] **F15 · Dependency vulns.** Triaged. `npm audit fix` patched multer (2.2.0);
  sharp upgraded to 0.35.x. CI gates on **critical** prod vulns (`--omit=dev`).
  Deferred as low practical risk / needs integration testing, tracked here:
  - **nodemailer** 6→9 (major): advisories are header/envelope injection via
    fields we never populate from user input (inquiry data goes in the body).
    Upgrade + test email delivery before bumping.
  - **express** 4→5, **astro** major: framework majors; upgrade deliberately with
    full build+test, not as a security auto-fix.
  - Build-chain (dev) advisories don't ship to the server; report-only in CI.
- [ ] **F16 · Tighten CSP.** Remove `'unsafe-inline'` from script-src after F17.
- [ ] **F17 · Extract inline frontend scripts.** 5 inline blocks in `index.astro` +
  `BaseLayout.astro`; move to `src/scripts/`, unit-test the render/diff logic.
- [ ] **F18 · Accessibility audit.** Mixed `<img>`/`<Image>`; run axe/Lighthouse;
  fix alt gaps, focus-visible, contrast; confirm reduced-motion covers parallax.
- [ ] **F19 · Performance baseline.** Lighthouse the live site (LCP/CLS/TBT);
  lazy-load below-fold images; sanity-check WebP sizes; audit per-frame scroll JS.
- [ ] **F20 · SEO verification.** Validate structured data (Rich Results Test),
  `sitemap.xml`/`robots.txt` on the live domain, canonical host (www vs apex).

---

## Suggested order (some items unblock others)

1. Visibility: **F1 → F2 → F5**
2. Protect data: **F4 → F12**
3. Contain blast radius: **F3**
4. Make change safe: **F6 → F9 → F10**
5. Fix pipeline: **F8 → F13**
6. Deeper integrity: **F7 → F14**
7. Refactor & polish: **F11/F17 → F16 → F15/F18/F19/F20**
