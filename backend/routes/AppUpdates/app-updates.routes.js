const express = require('express');
const { CURRENT_RELEASE } = require('../../services/AppUpdates/app-updates.service');

const router = express.Router();

router.get('/current', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: CURRENT_RELEASE.version });
});

module.exports = router;
