// BOX site-health: GET /api/health, what an uptime monitor watches. Data and upload
// folders writable, the build present, the enquiry store answering.
import fs from 'fs';
import path from 'path';

export function registerHealth(app, { dataDir, uploadsDir, distPath, analyticsPath, isLoginDisabled, leads }) {
  // Health check
  // F5: a health check that actually checks health. Verifies the things that have
  // silently broken in production — data/uploads writable, analytics parseable,
  // build present, admin login state. Returns 503 (with reasons) when degraded so
  // an uptime monitor has something real to watch.
  function runHealthChecks() {
    const checks = {};
    const canWrite = (dir) => {
      try {
        const probe = path.join(dir, `.health-${process.pid}`);
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return true;
      } catch { return false; }
    };

    checks.dataDirWritable = canWrite(dataDir);
    checks.uploadsDirWritable = canWrite(uploadsDir);
    checks.distPresent = !process.env.NODE_ENV || process.env.NODE_ENV !== 'production' || fs.existsSync(path.join(distPath, 'index.html'));
    try { JSON.parse(fs.readFileSync(analyticsPath, 'utf8')); checks.analyticsParseable = true; }
    catch (e) { checks.analyticsParseable = !fs.existsSync(analyticsPath); } // absent is fine (fresh)
    checks.adminLoginEnabled = !isLoginDisabled();
    checks.enquiryStore = leads.health(); // the database (or inquiries.json) answered its last call

    // adminLoginEnabled is informational, not a failure condition (the public site
    // is healthy even when admin login is intentionally disabled).
    const failing = Object.entries(checks)
      .filter(([k, v]) => v === false && k !== 'adminLoginEnabled')
      .map(([k]) => k);
    return { checks, failing };
  }
  app.get('/api/health', (req, res) => {
    const { checks, failing } = runHealthChecks();
    const healthy = failing.length === 0;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks,
      failing,
      timestamp: new Date().toISOString()
    });
  });

  return { runHealthChecks };
}
