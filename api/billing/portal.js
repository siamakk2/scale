'use strict';
// POST /api/billing/portal -> { url } for Stripe's billing portal: change
// card, switch plan, cancel, download invoices. California's auto-renewal law
// expects cancelling online to be as easy as signing up; this is that path.
const { userFrom, SITE } = require('../_lib/auth');
const { admin } = require('../_lib/runscan');
const { stripe } = require('../_lib/stripe');
const { PORTAL_CONFIG } = require('../_lib/plans');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Billing is being switched on. Please try again shortly.' });
  const user = await userFrom(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });
  const { data: sub } = await admin().from('subscriptions').select('stripe_customer_id')
    .eq('owner_id', user.id).maybeSingle();
  if (!sub || !sub.stripe_customer_id) return res.status(404).json({ error: 'No billing account yet.' });
  const portal = await s.billingPortal.sessions.create({ configuration: PORTAL_CONFIG, customer: sub.stripe_customer_id, return_url: SITE + '/app/' });
  return res.status(200).json({ url: portal.url });
};
