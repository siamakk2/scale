'use strict';
// POST /api/answers  { business_id, force? }
//
// Asks ChatGPT and Perplexity the questions a customer would ask, and stores
// what they said on the business's latest scan (raw.answers), so each scan
// carries its own snapshot and the history shows whether the business starts
// being named.
//
// Cost guard: runs once per scan. Free accounts get it with their monthly
// scan; paid accounts with every scan. A server-wide daily cap (AI_DAILY_CAP,
// default 300 runs) stops runaway spend whatever happens.
const { createClient } = require('@supabase/supabase-js');
const { admin, planOf } = require('./_lib/runscan');
const { runAnswers, configured } = require('./_lib/answers');

function asCaller(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  const token = h && /^Bearer\s+(.+)$/i.test(h) ? h.replace(/^Bearer\s+/i, '') : null;
  if (!token) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + token } } });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!configured()) return res.status(503).json({ code: 'not_configured', error: 'AI answer checks are not switched on yet.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const caller = asCaller(req);
  if (!caller) return res.status(401).json({ error: 'Sign in first.' });
  const { data: biz } = await caller.from('businesses').select('id, owner_id, website_url, name').eq('id', body && body.business_id).single();
  if (!biz) return res.status(404).json({ error: 'Business not found' });

  const db = admin();
  const { data: scans } = await db.from('scans').select('id, started_at, raw')
    .eq('business_id', biz.id).eq('status', 'complete').order('started_at', { ascending: false }).limit(1);
  const scan = scans && scans[0];
  if (!scan || !scan.raw || !scan.raw.profile) return res.status(409).json({ code: 'rescan', error: 'Run a scan first.' });
  if (scan.raw.answers) return res.status(200).json({ answers: scan.raw.answers, cached: true });

  const plan = await planOf(db, biz.owner_id);
  if (plan === 'free') {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data: recent } = await db.from('scans').select('id').eq('business_id', biz.id).eq('status', 'complete')
      .gte('started_at', since).not('raw->answers', 'is', null).limit(1);
    if (recent && recent.length) return res.status(402).json({ code: 'upgrade', error: 'The Free plan checks AI answers once a month.' });
  }
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from('scans').select('id', { count: 'exact', head: true })
    .gte('started_at', dayAgo).not('raw->answers', 'is', null);
  if ((count || 0) >= Number(process.env.AI_DAILY_CAP || 300)) {
    return res.status(429).json({ code: 'busy', error: 'AI checks are at today\'s limit. Try again tomorrow.' });
  }

  let host;
  try { host = new URL(/^https?:/i.test(biz.website_url) ? biz.website_url : 'https://' + biz.website_url).hostname.replace(/^www\./, ''); }
  catch (e) { host = biz.website_url; }
  const answers = await runAnswers({ ...scan.raw.profile, name: scan.raw.profile.name || biz.name }, host);
  if (!answers.results.some((r) => !r.error)) {
    return res.status(502).json({ error: 'ChatGPT and Perplexity did not answer just now. Try again in a few minutes.' });
  }
  // Re-read just before writing, so a scan finishing meanwhile isn't clobbered.
  const { data: fresh } = await db.from('scans').select('raw').eq('id', scan.id).single();
  await db.from('scans').update({ raw: { ...(fresh && fresh.raw || scan.raw), answers } }).eq('id', scan.id);
  console.log(JSON.stringify({ source: 'answers', business: biz.id, named: answers.summary.named, asked: answers.summary.asked }));
  return res.status(200).json({ answers });
};
