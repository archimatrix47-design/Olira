// THE WIRING. Every function of the site is a box in lib/, described in boxes/. This
// file is the one place boxes are connected and it holds no logic of its own: each
// line below plugs in one box and hands it the wires it needs from the boxes above.
//
// Order matters: Express runs routes and guards in the order they are added, and a
// box can only be given what already exists. To add a function, see boxes/README.md.
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBoard } from './lib/board.js';
import { registerStorage } from './lib/storage.js';
import { registerStaging } from './lib/staging.js';
import { registerWebGuards } from './lib/web-guards.js';
import { registerAdminAuth } from './lib/admin-auth.js';
import { registerEmail } from './lib/email.js';
import { registerIntegrations } from './lib/integrations.js';
import { registerSearchVerification } from './lib/search-verification.js';
import { registerStaffAccounts } from './lib/staff-accounts.js';
import { registerCertificates } from './lib/certificates.js';
import { registerLeadStore } from './lib/lead-store.js';
import { registerWorkspace } from './lib/workspace.js';
import { registerTargets } from './lib/targets.js';
import { registerPartners } from './lib/partners.js';
import { registerPackaging } from './lib/packaging.js';
import { registerThumbs } from './lib/thumbs.js';
import { registerAgriProducts } from './lib/agri-products.js';
import { registerSocialLinks } from './lib/social-links.js';
import { registerContact } from './lib/contact.js';
import { registerBranding } from './lib/branding.js';
import { registerAnalytics } from './lib/analytics.js';
import { registerEnquiries } from './lib/enquiries.js';
import { registerHealth } from './lib/health.js';
import { registerSiteLog } from './lib/site-log.js';
import { registerAiAccess } from './lib/ai-access.js';
import { registerAdminTools } from './lib/admin-tools.js';
import { registerStaticSite } from './lib/static-site.js';
import { registerStartup } from './lib/startup.js';
import { registerPackaging3d } from './lib/packaging-3d.js';

// Before any box is plugged in: boxes read the environment when they are set up.
dotenv.config();

const app = express();
// `--port N` wins over the PORT env var. In dev, the tooling that launches the
// Astro dev server exports PORT for *its* port, and npm passes that down to
// this process too, so the API would steal Astro's port and serve the stale
// built site instead. An explicit flag can't be clobbered that way.
// Production (cPanel/Passenger) sets PORT and passes no flag, so it still wins.
const portFlagIndex = process.argv.indexOf('--port');
const portFlag = portFlagIndex !== -1 ? Number(process.argv[portFlagIndex + 1]) : NaN;
const PORT = Number.isInteger(portFlag) && portFlag > 0 ? portFlag : (process.env.PORT || 3000);

const board = createBoard(app);
const { plug, later } = board;

/* ---------- foundations ---------- */
const { repoDataDir, dataDir, uploadsDir, distPath, publicDirs, productImagesDir, auditLogPath, settingsPath, audit, logError, readJsonFile, writeJsonFile } = plug('storage', registerStorage);
plug('staging', (a) => registerStaging(a));
const { rateLimit, makeRateLimiter } = plug('web-guards', registerWebGuards, { distPath, connectSource: later('ai-access', 'connectSource', (req) => ai.connectSource(req)) });
const { adminAuth, verifyTokenDetailed, generateToken, checkOrigin, isAdminRequest, adoptResetIfPresent, hasUsableAdminCredential, isLoginDisabled, disableLogin, tokenSecret } = plug('admin-sign-in', registerAdminAuth, { dataDir, writeJsonFile, audit, logError, makeRateLimiter });
const { sendEmail, loadEmailConfig, initializeEmailConfig } = plug('email', registerEmail, { settingsPath, rateLimit, adminAuth, audit });
const { readTeam, teamAuth, roleAuth, teamEmailsFor, managerEmails } = plug('staff-accounts', registerStaffAccounts, { dataDir, readJsonFile, writeJsonFile, audit, verifyTokenDetailed, generateToken, checkOrigin, makeRateLimiter, isLoginDisabled });

/* ---------- what the admin looks after ---------- */
const { loadIntegrationsConfig, saveIntegrationsConfig } = plug('marketing-tags', registerIntegrations, { settingsPath, rateLimit, adminAuth, audit });
plug('search-verification', registerSearchVerification, { rateLimit, adminAuth, audit, loadIntegrationsConfig, saveIntegrationsConfig });
const certificates = plug('certificates', registerCertificates, { dataDir, uploadsDir, readJsonFile, writeJsonFile, audit, logError, adminAuth, sendEmail, loadEmailConfig, managerEmails });
plug('branding', registerBranding, { dataDir, uploadsDir, readJsonFile, writeJsonFile, audit, adminAuth });

/* ---------- catalogues and contact links ---------- */
const { agriProducts } = plug('agri-catalogue', registerAgriProducts, { dataDir, productImagesDir, readJsonFile, writeJsonFile, audit, roleAuth });
const { view3dOn } = plug('packaging-3d', registerPackaging3d, { dataDir, readJsonFile, writeJsonFile, audit, roleAuth });
const { catalogue } = plug('packaging-catalogue', registerPackaging, { dataDir, repoDataDir, uploadsDir, publicDirs, readJsonFile, writeJsonFile, audit, logError, roleAuth, view3dOn });
plug('thumbs', registerThumbs, { dataDir, uploadsDir, publicDirs, logError });
plug('partners', registerPartners, { dataDir, uploadsDir, readJsonFile, writeJsonFile, audit, logError, roleAuth });
const { readSocialLinks } = plug('social-links', registerSocialLinks, { dataDir, readJsonFile, writeJsonFile, audit, roleAuth });
plug('contact', registerContact, { dataDir, readJsonFile, writeJsonFile, audit, adminAuth, checkOrigin, isAdminRequest, makeRateLimiter, readSocialLinks });

/* ---------- enquiries, from arrival to the sale ---------- */
const leads = plug('lead-store', registerLeadStore, { dataDir, readJsonFile, writeJsonFile, logError, onDrop: later('enquiry-work', 'removeLeadFiles', (old) => { if (old.files?.length) work.removeLeadFiles(old.id); }) });
const work = plug('enquiry-work', registerWorkspace, { dataDir, audit, logError, sendEmail, loadEmailConfig, makeRateLimiter, leads, teamAuth, readTeam, certificateFile: certificates.attachmentFor });
plug('targets', registerTargets, { dataDir, readJsonFile, writeJsonFile, audit, roleAuth });
const { recordInquiry, aggregateAnalytics, analyticsPath, todayKey, firstTracked } = plug('analytics', registerAnalytics, { dataDir, readJsonFile, writeJsonFile, tokenSecret, makeRateLimiter, roleAuth, catalogue, agriProducts });
plug('enquiries', registerEnquiries, { rateLimit, audit, logError, leads, sendEmail, loadEmailConfig, parseIntake: work.parseIntake, saveIntakeFiles: work.saveIntakeFiles, teamEmailsFor, workspaceUrl: work.workspaceUrl, catalogue, recordInquiry });

/* ---------- keeping an eye on the site ---------- */
const { runHealthChecks } = plug('site-health', registerHealth, { dataDir, uploadsDir, distPath, analyticsPath, isLoginDisabled, leads });
const { buildLog, history } = plug('site-log', registerSiteLog, { dataDir, distPath, readJsonFile, logError, leads, aggregateAnalytics, todayKey, firstTracked, catalogue, agriProducts, listCertificates: certificates.list, runHealthChecks });
const ai = plug('ai-access', registerAiAccess, { dataDir, readJsonFile, writeJsonFile, adminAuth, roleAuth, makeRateLimiter, audit, buildLog, history });
plug('admin-tools', registerAdminTools, { adminAuth, rateLimit, auditLogPath, dataDir, uploadsDir, distPath, readJsonFile, writeJsonFile, sendEmail, loadEmailConfig, audit, logError, healthChecks: runHealthChecks, leads, aggregateAnalytics });

/* ---------- last: the pages, the 404 and the error handler ---------- */
plug('static-site', registerStaticSite, { uploadsDir, distPath, logError });
const { startServer } = plug('startup', registerStartup, { PORT, dataDir, uploadsDir, distPath, adoptResetIfPresent, hasUsableAdminCredential, disableLogin, isLoginDisabled, initializeEmailConfig, startReminders: certificates.startReminders, logError });

// Run the startup side effects (validation, email init, listen) unless the test
// suite imported this file: `import { app } from './server.js'` in a test builds
// the Express app without binding a port.
//
// "Executed directly" is not enough on its own. cPanel's Node.js hosting
// (LiteSpeed lsnode.js, and Passenger) loads the startup file through its own
// wrapper, so argv[1] is the wrapper, not server.js. With only that check the
// app never listened there, and every request got a 503.
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const underTest = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);

if (isMainModule || !underTest) {
  startServer();
}

export { app, startServer, board };
