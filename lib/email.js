// BOX email: the mail account the site sends from, kept in the data folder or the
// environment, and sendEmail, which every box that writes to someone goes through.
// On the staging copy it never reaches real people (lib/staging.js).
import fs from 'fs';
import nodemailer from 'nodemailer';
import { isStaging, stagingMail } from './staging.js';

export function registerEmail(app, { settingsPath, rateLimit, adminAuth, audit }) {
  // Only saving is rate limited: reading needs an admin session anyway, and a
  // limited read made the dashboard report working email as "not set up".
  app.use('/api/email-config', (req, res, next) => (req.method === 'GET' ? next() : rateLimit(req, res, next)));

  const emailConfigPath = settingsPath('EMAIL_CONFIG_PATH', 'email-config.json');

  // Initialize email config if it doesn't exist
  function initializeEmailConfig() {
    if (!fs.existsSync(emailConfigPath)) {
      const defaultConfig = {
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        smtpUser: '',
        smtpPassword: '',
        recipientEmail: 'info@oliraagroindustry.com',
        fromName: 'Olira Agro Industry'
      };
      fs.writeFileSync(emailConfigPath, JSON.stringify(defaultConfig, null, 2));
    }
  }

  // Load email configuration (environment variables take precedence over JSON file)
  function loadEmailConfig() {
    // Try environment variables first
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
      return {
        smtpHost: process.env.SMTP_HOST,
        smtpPort: parseInt(process.env.SMTP_PORT || '587'),
        smtpUser: process.env.SMTP_USER,
        smtpPassword: process.env.SMTP_PASSWORD,
        recipientEmail: process.env.RECIPIENT_EMAIL || 'info@oliraagroindustry.com',
        fromName: process.env.SMTP_FROM_NAME || 'Olira Agro Industry'
      };
    }

    // Fall back to JSON file if env vars not set
    try {
      if (fs.existsSync(emailConfigPath)) {
        const data = fs.readFileSync(emailConfigPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading email config from file:', error);
    }
    return null;
  }

  // Save email configuration
  function saveEmailConfig(config) {
    try {
      fs.writeFileSync(emailConfigPath, JSON.stringify(config, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving email config:', error);
      return false;
    }
  }

  // Send email using configured SMTP
  async function sendEmail(to, subject, htmlContent, extra = {}) {
    const config = loadEmailConfig();

    if (!config || !config.smtpUser || !config.smtpPassword) {
      throw new Error('Email not configured. Please configure SMTP settings in admin panel.');
    }

    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword
      }
    });

    // extra: text, replyTo, bcc, attachments, and fromName to send as a team member
    const fromName = String(extra.fromName || config.fromName || '').replace(/[\r\n"<>]/g, '').slice(0, 120);
    let mailOptions = {
      from: `"${fromName}" <${config.smtpUser}>`,
      to: to,
      subject: subject,
      html: htmlContent
    };
    if (extra.text) mailOptions.text = extra.text;
    if (extra.replyTo) mailOptions.replyTo = extra.replyTo;
    if (extra.bcc) mailOptions.bcc = extra.bcc;
    if (Array.isArray(extra.attachments) && extra.attachments.length) mailOptions.attachments = extra.attachments;
    // the staging copy never writes to buyers or staff: only to STAGING_MAIL_TO, or nobody
    if (isStaging()) {
      mailOptions = stagingMail(mailOptions);
      if (!mailOptions) { console.log(`[staging] mail not sent: "${subject}"`); return { messageId: null, staging: true }; }
    }

    return new Promise((resolve, reject) => {
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          reject(error);
        } else {
          resolve(info);
        }
      });
    });
  }

  // Get email configuration (admin only)
  app.get('/api/email-config', adminAuth, (req, res) => {
    const config = loadEmailConfig();
    if (!config) {
      return res.status(500).json({ error: 'Failed to load email configuration' });
    }

    // Don't send password back to client
    const safeConfig = { ...config };
    delete safeConfig.smtpPassword;
    res.json(safeConfig);
  });

  // Update email configuration (admin only)
  app.post('/api/email-config', adminAuth, (req, res) => {
    const { smtpHost, smtpPort, smtpUser, smtpPassword, recipientEmail, fromName } = req.body;

    if (!smtpHost || !smtpPort || !smtpUser || !recipientEmail) {
      return res.status(400).json({ error: 'Missing required email configuration fields' });
    }

    const config = {
      smtpHost,
      smtpPort: parseInt(smtpPort),
      smtpUser,
      smtpPassword: smtpPassword || loadEmailConfig()?.smtpPassword || '',
      recipientEmail,
      fromName: fromName || 'Olira Agro Industry'
    };

    if (saveEmailConfig(config)) {
      audit('email_config_saved', req);
      res.json({ success: true, message: 'Email configuration updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to save email configuration' });
    }
  });

  return { sendEmail, loadEmailConfig, initializeEmailConfig };
}
