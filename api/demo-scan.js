'use strict';
// POST /api/demo-scan  { url }
//
// The free, account-less Scan. Same engine as the real one, no persistence --
// this is the hook, and asking for a signup before showing any value is how
// these tools die.
//
// It deliberately returns findings but NOT momentum: momentum needs history,
// history needs an account. The locked dimension is the product's honest
// upgrade prompt, and it is honest precisely because the number is withheld
// rather than invented.

const { extract } = require('./_lib/signals');
const { score } = require('./_lib/score');
const { fetchExtras } = require('./_lib/runscan');
const { buildMissions, aiProfile } = require('./_lib/playbook');

const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 3000000; // Shopify home pages often pass 1 MB; cutting them short hid their content

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;

  // Dev only. Without this the scanner cannot be exercised against a page
  // served on the loopback interface, which is the only way to test it in a
  // sandbox. Never set in production -- see the SSRF guard below.
  if (process.env.SCALE_ALLOW_LOCAL === '1') return u;

  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (!h.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const o = h.split('.').map(Number);
    if (o[0] === 10 || o[0] === 127 || o[0] === 0 ||
        (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
        (o[0] === 192 && o[1] === 168) ||
        (o[0] === 169 && o[1] === 254)) return null;
  }
  return u;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.method === 'GET' ? { url: req.query && req.query.url } : req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  const url = normalizeUrl(body && body.url);
  if (!url) {
    return res.status(400).json({ error: "That doesn't look like a website address. Try yourbusiness.com" });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const extrasP = fetchExtras(url);
    const resp = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScaleScan/1.0; +https://scale.siamakconsulting.com)' },
    });
    const html = (await resp.text()).slice(0, MAX_HTML_BYTES);
    if (!html) throw new Error('That site returned an empty page.');

    const signals = extract(html, url.hostname, await extrasP);
    const result = score(signals, []);   // no history without an account
    // The free scan teaches one lesson in full (the biggest), so people see
    // what an account gives them. Previews show every lesson, for testing.
    const all = buildMissions(result.findings, signals, { url: url.toString(), host: url.hostname });
    const full = process.env.VERCEL_ENV !== 'production';
    result.findings = all.map((f, i) => (full || i === 0 ? f : { ...f, guide: undefined }));

    return res.status(200).json({
      host: url.hostname,
      overall: result.overall,
      scores: result.scores,
      findings: result.findings,
      profile: aiProfile(signals, { host: url.hostname }),
      checkedAt: result.checkedAt,
    });
  } catch (e) {
    const msg = e.name === 'AbortError'
      ? 'That site took too long to respond.'
      : 'We could not reach that site.';
    return res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
};
