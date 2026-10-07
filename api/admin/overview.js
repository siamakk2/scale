'use strict';
// GET /api/admin/overview -- everything the owner needs to run S.C.A.L.E.
// without opening Stripe: who signed up, who pays, what they're doing, and
// whether their scores are moving.
//
// Locked to the addresses in ADMIN_EMAILS (comma-separated env var), falling
// back to the owner's address. The check uses Supabase's own verification of
// the caller's token; reads then run under the service role.
const { userFrom } = require('../_lib/auth');
const { admin } = require('../_lib/runscan');
const { PLANS, effectivePlan } = require('../_lib/plans');

const ADMINS = (process.env.ADMIN_EMAILS || 'siamakk2@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = (u) => !!u && !!u.email && u.email_confirmed_at !== null && ADMINS.includes(u.email.toLowerCase());

async function allUsers(db) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await userFrom(req);
  if (!me) return res.status(401).json({ error: 'Sign in first.' });
  if (!isAdmin(me)) return res.status(403).json({ error: 'Not authorized.' });

  const db = admin();
  const [users, subsQ, bizQ, scansQ, actsQ] = await Promise.all([
    allUsers(db),
    db.from('subscriptions').select('*'),
    db.from('businesses').select('id, owner_id, name, website_url, created_at'),
    db.from('scans').select('id, business_id, status, trigger, overall_score, scores, started_at, error')
      .order('started_at', { ascending: false }).limit(5000),
    db.from('actions').select('business_id, status, title, impact, completed_at, created_at').limit(20000),
  ]);
  for (const q of [subsQ, bizQ, scansQ, actsQ]) if (q.error) return res.status(500).json({ error: q.error.message });

  const subs = new Map((subsQ.data || []).map((s) => [s.owner_id, s]));
  const bizByOwner = new Map();
  for (const b of bizQ.data || []) (bizByOwner.get(b.owner_id) || bizByOwner.set(b.owner_id, []).get(b.owner_id)).push(b);
  const scansByBiz = new Map();
  for (const s of scansQ.data || []) (scansByBiz.get(s.business_id) || scansByBiz.set(s.business_id, []).get(s.business_id)).push(s);
  const actsByBiz = new Map();
  for (const a of actsQ.data || []) (actsByBiz.get(a.business_id) || actsByBiz.set(a.business_id, []).get(a.business_id)).push(a);

  const now = Date.now(), d7 = now - 7 * 864e5, d30 = now - 30 * 864e5;
  const customers = users.map((u) => {
    const sub = subs.get(u.id) || null;
    const plan = effectivePlan(sub);
    const sites = (bizByOwner.get(u.id) || []).map((b) => {
      const sc = (scansByBiz.get(b.id) || []).filter((s) => s.status === 'complete');
      const acts = actsByBiz.get(b.id) || [];
      return {
        id: b.id, name: b.name, url: b.website_url, created_at: b.created_at,
        scans: sc.length,
        failed_scans: (scansByBiz.get(b.id) || []).filter((s) => s.status === 'failed').length,
        last_scan: sc[0] ? sc[0].started_at : null,
        score: sc[0] ? sc[0].overall_score : null,
        prev_score: sc[1] ? sc[1].overall_score : null,
        dims: sc[0] ? sc[0].scores : null,
        history: sc.slice(0, 12).reverse().map((s) => ({ at: s.started_at, score: s.overall_score })),
        fixes_open: acts.filter((a) => a.status === 'open').length,
        fixes_done: acts.filter((a) => a.status === 'done').length,
        open_list: acts.filter((a) => a.status === 'open').sort((x, y) => y.impact - x.impact).slice(0, 8)
          .map((a) => ({ title: a.title, impact: a.impact })),
      };
    });
    const lastScan = sites.map((s) => s.last_scan).filter(Boolean).sort().pop() || null;
    return {
      id: u.id, email: u.email, created_at: u.created_at, last_sign_in: u.last_sign_in_at,
      confirmed: !!u.email_confirmed_at, plan,
      status: sub ? sub.status : 'none',
      renews: sub ? sub.current_period_end : null,
      cancel_at_period_end: sub ? sub.cancel_at_period_end : false,
      stripe_customer: sub ? sub.stripe_customer_id : null,
      mrr: plan === 'free' ? 0 : PLANS[plan].price,
      sites, last_scan: lastScan,
      fixes_done: sites.reduce((n, s) => n + s.fixes_done, 0),
      fixes_open: sites.reduce((n, s) => n + s.fixes_open, 0),
    };
  }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // Activity: the newest things that happened, newest first.
  const nameOf = new Map(users.map((u) => [u.id, u.email]));
  const ownerOfBiz = new Map((bizQ.data || []).map((b) => [b.id, b]));
  const activity = [];
  for (const u of users) activity.push({ at: u.created_at, kind: 'signup', who: u.email, text: 'Created an account' });
  for (const b of bizQ.data || []) activity.push({ at: b.created_at, kind: 'site', who: nameOf.get(b.owner_id), text: 'Added ' + b.website_url });
  for (const s of (scansQ.data || []).slice(0, 300)) {
    const b = ownerOfBiz.get(s.business_id); if (!b) continue;
    activity.push({ at: s.started_at, kind: s.status === 'failed' ? 'fail' : 'scan', who: nameOf.get(b.owner_id),
      text: s.status === 'failed' ? 'Scan failed on ' + b.website_url + (s.error ? ': ' + s.error.slice(0, 80) : '')
        : (s.trigger === 'scheduled' ? 'Monthly scan ' : 'Scanned ') + b.website_url + (s.overall_score != null ? ' → ' + s.overall_score : '') });
  }
  for (const a of actsQ.data || []) if (a.status === 'done' && a.completed_at) {
    const b = ownerOfBiz.get(a.business_id); if (!b) continue;
    activity.push({ at: a.completed_at, kind: 'fix', who: nameOf.get(b.owner_id), text: 'Completed: ' + a.title });
  }
  for (const s of subsQ.data || []) if (s.status !== 'none') {
    activity.push({ at: s.updated_at, kind: 'billing', who: nameOf.get(s.owner_id),
      text: (s.cancel_at_period_end ? 'Cancelling ' : 'Plan ') + s.plan + ' · ' + s.status });
  }
  activity.sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  const paying = customers.filter((c) => c.plan !== 'free');
  const scans = (scansQ.data || []).filter((s) => s.status === 'complete');
  const improved = customers.flatMap((c) => c.sites).filter((s) => s.prev_score != null && s.score > s.prev_score).length;
  const kpis = {
    mrr: paying.reduce((n, c) => n + c.mrr, 0),
    customers: customers.length,
    paying: paying.length,
    by_plan: { free: customers.length - paying.length,
               growth: paying.filter((c) => c.plan === 'growth').length,
               scale: paying.filter((c) => c.plan === 'scale').length },
    cancelling: paying.filter((c) => c.cancel_at_period_end).length,
    past_due: customers.filter((c) => c.status === 'past_due').length,
    signups_7: users.filter((u) => Date.parse(u.created_at) > d7).length,
    signups_30: users.filter((u) => Date.parse(u.created_at) > d30).length,
    scans_7: scans.filter((s) => Date.parse(s.started_at) > d7).length,
    scans_30: scans.filter((s) => Date.parse(s.started_at) > d30).length,
    websites: (bizQ.data || []).length,
    sites_improved: improved,
    fixes_done: customers.reduce((n, c) => n + c.fixes_done, 0),
  };
  return res.status(200).json({ kpis, customers, activity: activity.slice(0, 120), generated_at: new Date().toISOString() });
};
