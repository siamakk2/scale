'use strict';
// GET /api/cron/monthly -- run daily by Vercel Cron (see vercel.json).
// Rescans every website on a paid plan whose last complete scan is 30+ days
// old. That is the "automatic monthly scan" the plans promise, and it is what
// draws the trend line without the customer having to remember.
//
// If CRON_SECRET is set in Vercel, only Vercel's scheduler can call this. If
// it isn't, a stranger calling it can only trigger scans that were due anyway.
const { admin, runScan } = require('../_lib/runscan');
const { LIVE } = require('../_lib/plans');

const BUDGET_MS = 50000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || '') !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const started = Date.now();
  const db = admin();
  const { data: subs } = await db.from('subscriptions').select('owner_id, plan, status')
    .in('plan', ['growth', 'scale']);
  const paid = (subs || []).filter((s) => LIVE.has(s.status));
  const due = new Date(Date.now() - 30 * 864e5).toISOString();
  const done = [];

  outer:
  for (const s of paid) {
    const { data: bizs } = await db.from('businesses').select('id, owner_id, website_url').eq('owner_id', s.owner_id);
    for (const biz of bizs || []) {
      if (Date.now() - started > BUDGET_MS) break outer;
      const { data: last } = await db.from('scans').select('started_at')
        .eq('business_id', biz.id).eq('status', 'complete').gte('started_at', due).limit(1);
      if (last && last.length) continue;
      const out = await runScan(db, biz, { trigger: 'scheduled', plan: s.plan });
      done.push({ business: biz.id, ok: out.ok, overall: out.overall, error: out.error });
    }
  }
  console.log(JSON.stringify({ source: 'cron-monthly', paid: paid.length, scanned: done.length }));
  return res.status(200).json({ paid: paid.length, scanned: done });
};
