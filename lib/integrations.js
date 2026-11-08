// BOX marketing-tags: the optional Google Analytics and Ads tags, saved by the admin.
// Nothing from Google loads until an ID is saved; never on the staging copy.
import fs from 'fs';
import { isStaging } from './staging.js';

export function registerIntegrations(app, { settingsPath, rateLimit, adminAuth, audit }) {
  // ============================================
  // MARKETING INTEGRATIONS API
  // ============================================

  // Path to integrations config file
  const integrationsConfigPath = settingsPath('INTEGRATIONS_CONFIG_PATH', 'integrations-config.json');

  // Initialize integrations config if it doesn't exist
  function initializeIntegrationsConfig() {
    if (!fs.existsSync(integrationsConfigPath)) {
      const defaultConfig = {
        analytics: {
          measurementId: '',
          propertyId: ''
        },
        ads: {
          conversionId: '',
          conversionLabel: '',
          conversionValue: 10
        },
        lastUpdated: null
      };
      fs.writeFileSync(integrationsConfigPath, JSON.stringify(defaultConfig, null, 2));
      console.log('Integrations config initialized');
    }
  }

  // Load integrations configuration
  function loadIntegrationsConfig() {
    try {
      if (fs.existsSync(integrationsConfigPath)) {
        const data = fs.readFileSync(integrationsConfigPath, 'utf8');
        return JSON.parse(data);
      }
      return {
        analytics: { measurementId: '', propertyId: '' },
        ads: { conversionId: '', conversionLabel: '', conversionValue: 10 }
      };
    } catch (error) {
      console.error('Error loading integrations config:', error);
      return {
        analytics: { measurementId: '', propertyId: '' },
        ads: { conversionId: '', conversionLabel: '', conversionValue: 10 }
      };
    }
  }

  // Save integrations configuration
  function saveIntegrationsConfig(config) {
    try {
      config.lastUpdated = new Date().toISOString();
      fs.writeFileSync(integrationsConfigPath, JSON.stringify(config, null, 2));
      console.log('Integrations config saved');
      return true;
    } catch (error) {
      console.error('Error saving integrations config:', error);
      return false;
    }
  }

  // Initialize on startup
  initializeIntegrationsConfig();

  // GET /api/integrations - Get current integration settings
  app.get('/api/integrations', (req, res) => {
    if (isStaging()) return res.json({}); // no Analytics or Ads tags on the staging copy
    const config = loadIntegrationsConfig();
    res.json(config);
  });

  // POST /api/integrations/analytics - Update Google Analytics settings
  // Writes require an admin session: an open endpoint let anyone point the site's
  // analytics or ads tags at their own Google account.
  app.post('/api/integrations/analytics', rateLimit, adminAuth, (req, res) => {
    try {
      const { measurementId, propertyId } = req.body;

      // Validate Measurement ID format
      if (measurementId && !measurementId.match(/^G-[A-Z0-9]{10}$/)) {
        return res.status(400).json({ error: 'Invalid Measurement ID format. Must be G-XXXXXXXXXX' });
      }

      const config = loadIntegrationsConfig();
      config.analytics = {
        measurementId: measurementId || '',
        propertyId: propertyId || ''
      };

      if (saveIntegrationsConfig(config)) {
        audit('integrations_saved', req, { what: 'Google Analytics' });
        res.json({ success: true, message: 'Analytics configuration saved', config: config.analytics });
      } else {
        res.status(500).json({ error: 'Failed to save configuration' });
      }
    } catch (error) {
      console.error('Error updating analytics config:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  // POST /api/integrations/ads - Update Google Ads settings
  app.post('/api/integrations/ads', rateLimit, adminAuth, (req, res) => {
    try {
      const { conversionId, conversionLabel, conversionValue } = req.body;

      // Validate Conversion ID format
      if (conversionId && !conversionId.match(/^[0-9]{10}$/)) {
        return res.status(400).json({ error: 'Invalid Conversion ID format. Must be 10 digits' });
      }

      const config = loadIntegrationsConfig();
      config.ads = {
        conversionId: conversionId || '',
        conversionLabel: conversionLabel || '',
        conversionValue: parseFloat(conversionValue) || 10
      };

      if (saveIntegrationsConfig(config)) {
        audit('integrations_saved', req, { what: 'Google Ads' });
        res.json({ success: true, message: 'Ads configuration saved', config: config.ads });
      } else {
        res.status(500).json({ error: 'Failed to save configuration' });
      }
    } catch (error) {
      console.error('Error updating ads config:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  return { loadIntegrationsConfig, saveIntegrationsConfig };
}
