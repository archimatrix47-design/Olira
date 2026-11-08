// BOX startup: what happens once when the server really starts: a masked summary of
// the settings, the safety checks, and listening for requests. Tests import the app
// without any of this.
import fs from 'fs';
import path from 'path';

export function registerStartup(app, { PORT, dataDir, uploadsDir, distPath, adoptResetIfPresent, hasUsableAdminCredential, disableLogin, isLoginDisabled, initializeEmailConfig, startReminders, logError }) {
  // F13: masked config summary — logged at startup so a misconfiguration is
  // visible immediately instead of surfacing as a mysterious failure later.
  // Never prints secret VALUES, only whether each is set and looks sane.
  function logConfigSummary() {
    const isProd = process.env.NODE_ENV === 'production';
    const mask = (v) => (v ? `set (${v.length} chars)` : 'MISSING');
    const rows = [
      ['NODE_ENV', process.env.NODE_ENV || 'development'],
      ['PORT', String(PORT)],
      ['JWT_SECRET', mask(process.env.JWT_SECRET)],
      ['ADMIN_PASSWORD', mask(process.env.ADMIN_PASSWORD)],
      ['DATA_DIR', dataDir],
      ['UPLOADS_DIR', uploadsDir],
      ['CORS_ORIGINS', process.env.CORS_ORIGINS || (isProd ? 'MISSING (same-origin still allowed)' : 'dev: localhost allowed')],
      ['SMTP', (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) ? 'configured' : 'not configured (email disabled)'],
    ];
    console.log('\nConfiguration:');
    for (const [k, v] of rows) console.log(`   ${k.padEnd(15)} ${v}`);

    // Catch a common fat-finger: env var names with hyphens instead of underscores
    // (DATA-DIR vs DATA_DIR) are silently ignored by the code — surface them.
    const suspects = Object.keys(process.env).filter((k) => /-(DIR|SECRET|PASSWORD|ORIGINS|HOST|USER|PORT)$/i.test(k) || /^(DATA|UPLOADS|JWT|ADMIN|SMTP|CORS)-/i.test(k));
    if (suspects.length) {
      console.warn(`   WARNING: env vars with hyphens look like typos (use underscores): ${suspects.join(', ')}`);
    }
  }

  // Startup validation.
  // F3: weak/missing ADMIN secrets DISABLE admin login but do NOT stop the server
  // — the public storefront must stay up. Only conditions that make the app unable
  // to serve at all are surfaced as errors (and even those no longer exit, so a
  // deploy always comes up and the /api/health check can report what's wrong).
  function validateStartup() {
    const warnings = [];
    const adminIssues = [];
    const isProd = process.env.NODE_ENV === 'production';

    // Build artifacts (only required in production, dev runs from src)
    if (isProd) {
      if (!fs.existsSync(distPath)) warnings.push('dist directory not found — run "npm run build". Static site will 404 until built.');
      else if (!fs.existsSync(path.join(distPath, 'index.html'))) warnings.push('dist/index.html not found — build is incomplete.');
    }

    // Adopt a dropped reset file at boot too (restart-free recovery also works the
    // moment the app does start).
    adoptResetIfPresent();

    // Admin secrets — weakness disables admin login, never kills the site.
    const jwtDefault = !process.env.JWT_SECRET || process.env.JWT_SECRET === 'default_secret_change_in_production';
    const jwtWeak = process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32;
    if (jwtDefault) adminIssues.push('JWT_SECRET is missing or default');
    else if (jwtWeak) adminIssues.push('JWT_SECRET is shorter than 32 chars');

    // A DATA_DIR/auth.json override (set via the panel or a reset file) is a valid
    // 12+ char credential and keeps login enabled even if the env var is weak.
    if (!hasUsableAdminCredential()) {
      const pwDefault = !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'change_me_in_production';
      adminIssues.push(pwDefault ? 'no usable admin credential (ADMIN_PASSWORD missing/default and no auth.json)' : 'ADMIN_PASSWORD is shorter than 12 chars and no auth.json override');
    }

    // In production, unsafe admin secrets lock the admin door. In dev they're only
    // a warning (localhost convenience).
    if (isProd && adminIssues.length) {
      disableLogin();
    }

    if (isProd && (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD)) {
      warnings.push('SMTP not configured — the contact form cannot send email.');
    }

    if (adminIssues.length) {
      (isProd ? console.error : console.warn)(
        `\n${isProd ? 'ADMIN LOGIN DISABLED' : 'ADMIN WARNINGS (dev)'}: ${adminIssues.join('; ')}.`
      );
      if (isProd) console.error('  The public site is serving normally; fix these and restart to re-enable /admin.');
    }
    if (warnings.length) {
      console.warn('\nSTARTUP WARNINGS');
      warnings.forEach((w) => console.warn('  ' + w));
    }
    return true;
  }

  function startServer() {
    logConfigSummary();
    validateStartup();
    initializeEmailConfig();
    startReminders();

    // F1 backstops. These catch errors that escape the request lifecycle (stray
    // async rejections, etc.). We log but do NOT exit: a single stray error should
    // not take the whole storefront down. Registered only when actually serving,
    // so the test runner's own error handling is left untouched.
    process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason));
    process.on('uncaughtException', (err) => logError('uncaughtException', err));

    return app.listen(PORT, () => {
      console.log(`\nOlira Agro API Server running on http://localhost:${PORT}`);
      console.log(`Email configuration: ${process.env.SMTP_USER ? 'Environment variables' : 'File-based'}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Admin login: ${isLoginDisabled() ? 'DISABLED (weak/missing ADMIN_PASSWORD)' : 'enabled'}`);
      console.log(`\nStatic files: ${fs.existsSync(distPath) ? 'Found' : 'Not found'}\n`);
    });
  }

  return { startServer };
}
