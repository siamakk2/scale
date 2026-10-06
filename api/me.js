'use strict';
// GET /api/me -> the caller's plan, what it allows, and billing status.
// The screen reads its limits from here so it can never promise more than
// the server will allow.
const { userFrom } = require('./_lib/auth');
const { admin } = require('./_lib/runscan');
const { PLANS, effectivePlan } = require('./_lib/plans');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await userFrom(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });
  const db = admin();
  const { data: sub } = await db.from('subscriptions')
    .select('plan, status, current_period_end, cancel_at_period_end, stripe_customer_id')
    .eq('owner_id', user.id).maybeSingle();
  const plan = effectivePlan(sub);
  return res.status(200).json({
    plan, limits: PLANS[plan], plans: PLANS,
    billing: sub ? { status: sub.status, renews: sub.current_period_end,
                     cancel_at_period_end: sub.cancel_at_period_end,
                     has_customer: !!sub.stripe_customer_id } : null,
    billing_ready: !!process.env.STRIPE_SECRET_KEY,
  });
};
