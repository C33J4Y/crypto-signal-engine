const db = require('../../db/database');

function getWebhooks(req, res) {
  const webhooks = db.getWebhookConfigs();
  res.json({ webhooks });
}

function upsertWebhook(req, res) {
  const { id, name, url, platform, enabled, minGrade } = req.body;

  if (!name || !url || !platform) {
    return res.status(400).json({ error: 'name, url, and platform are required' });
  }

  if (!['discord', 'telegram', 'custom'].includes(platform)) {
    return res.status(400).json({ error: 'platform must be discord, telegram, or custom' });
  }

  db.upsertWebhook({ id, name, url, platform, enabled: enabled !== false, minGrade });
  res.json({ success: true });
}

module.exports = { getWebhooks, upsertWebhook };
