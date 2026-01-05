const https = require('https');

function callMetaContacts(phone) {
  return new Promise((resolve, reject) => {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) return reject({ status: 501, message: 'WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured' });

    const postData = JSON.stringify({ blocking: 'wait', contacts: [phone], force_check: true });

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v17.0/${phoneNumberId}/contacts`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject({ status: 502, message: 'invalid response from whatsapp api' });
        }
      });
    });

    req.on('error', (e) => reject({ status: 502, message: e.message }));
    req.write(postData);
    req.end();
  });
}

exports.checkWhatsApp = async (phone) => {
  // normalize phone: ensure starts with +
  let normalized = String(phone).trim();
  if (!normalized.startsWith('+')) normalized = `+${normalized}`;

  const resp = await callMetaContacts(normalized);
  // expected resp.contacts = [{ input, status, wa_id? }]
  const contacts = resp?.contacts || [];
  const first = contacts[0] || null;
  const exists = first && (first.status === 'valid' || !!first.wa_id);
  return { exists: Boolean(exists), raw: resp };
};
