const phoneService = require('../services/phone.service');

exports.checkWhatsApp = async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    const result = await phoneService.checkWhatsApp(phone);
    return res.json(result);
  } catch (err) {
    console.error('checkWhatsApp error', err);
    return res.status(err.status || 500).json({ error: err.message || 'internal' });
  }
};
