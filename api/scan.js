'use strict';
// POST /api/scan  { business_id }
//
// Ownership is proven by reading the business through the caller's own JWT
// (RLS returns nothing unless they own it). Plan limits are enforced here, on
// the server, so the screen can only ever describe them, never decide them:
//
//   Free    one scan every 30 days, top 5 fixes
//   Growth  rescan any time (3 a day, per website), full fix list
//   Scale   same as Growth, across up to 5 websites

const { createClient } = require('@supabase/supabase-js');
const { admin, runScan, planOf } = require('./_lib/runscan');
const { PLANS } = require('./_lib/plans');

function asCaller(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  const token = h && /^Bearer\s+(.+)$/i.test(h) ? h.replace(/^Bearer\s+/i, '') : null;
  if (!token) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + token } } });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const businessId = body && body.business_id;
  if (!businessId) return res.status(400).json({ error: 'business_id required' });

  const caller = asCaller(req);
  if (!caller) return res.status(401).json({ error: 'Sign in to run a scan.' });
  const { data: biz, error: bizErr } = await caller.from('businesses')
    .select('id, owner_id, website_url').eq('id', businessId).single();
  if (bizErr || !biz) return res.status(404).json({ error: 'Business not found' });

  const db = admin();
  const plan = await planOf(db, biz.owner_id);
  const P = PLANS[plan];

  if (P.scanEveryDays) {
    const since = new Date(Date.now() - P.scanEveryDays * 864e5).toISOString();
    const { data: recent } = await db.from('scans').select('started_at')
      .eq('business_id', biz.id).eq('status', 'complete').gte('started_at', since)
      .order('started_at', { ascending: false }).limit(1);
    if (recent && recent.length) {
      const next = new Date(new Date(recent[0].started_at).getTime() + P.scanEveryDays * 864e5);
      return res.status(402).json({
        code: 'upgrade', plan, next_at: next.toISOString(),
        error: 'The Free plan includes one scan every 30 days. Your next free scan is on ' +
               next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) +
               '. Upgrade to Growth to rescan any time.' });
    }
  }
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from('scans').select('id', { count: 'exact', head: true })
    .eq('business_id', biz.id).gte('started_at', dayAgo);
  if ((count || 0) >= P.scansPerDay && !P.scanEveryDays) {
    return res.status(429).json({ code: 'daily_limit', error: 'That is ' + P.scansPerDay +
      ' scans of this website today. Changes take time to show up anyway; try again tomorrow.' });
  }

  const trigger = ['manual', 'onboarding'].includes(body.trigger) ? body.trigger : 'manual';
  const out = await runScan(db, biz, { trigger, plan });
  if (trigger === 'onboarding' && out.ok) {
    try {
      const { data: u } = await db.auth.admin.getUserById(biz.owner_id);
      await require('./_lib/notify').newSignup(u && u.user && u.user.email, biz.website_url);
    } catch (e) {}
  }
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  return res.status(200).json({ ...out, plan, ok: undefined });
};
