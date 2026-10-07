'use strict';
// POST /api/billing/checkout { plan: 'growth' | 'scale' } -> { url }
// Sends the caller to Stripe Checkout. Someone already on a paid plan is sent
// to the billing portal instead, where switching plans is prorated properly
// rather than stacking a second subscription on top of the first.
const { userFrom, SITE } = require('../_lib/auth');
const { admin } = require('../_lib/runscan');
const { PRICE, PORTAL_CONFIG, effectivePlan } = require('../_lib/plans');
const { stripe } = require('../_lib/stripe');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Payments are being switched on. Please try again shortly.' });
  const user = await userFrom(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const plan = body && body.plan;
  if (!PRICE[plan]) return res.status(400).json({ error: 'Unknown plan.' });

  const db = admin();
  const { data: sub } = await db.from('subscriptions').select('*').eq('owner_id', user.id).maybeSingle();

  let customer = sub && sub.stripe_customer_id;
  // Never sell a second subscription. Ask Stripe directly, not our own table,
  // because our table can lag a few seconds behind a payment that just went
  // through -- which is exactly how a customer got charged twice.
  if (customer) {
    const existing = await s.subscriptions.list({ customer, status: 'all', limit: 10 });
    const open = existing.data.filter((x) => ['active', 'trialing', 'past_due', 'incomplete'].includes(x.status));
    if (open.length) {
      try { await require('./webhook').syncCustomer(s, db, customer, open[0]); } catch (e) {}
      const portal = await s.billingPortal.sessions.create({ configuration: PORTAL_CONFIG, customer, return_url: SITE + '/app/' });
      return res.status(200).json({ url: portal.url, portal: true, already: true });
    }
  }
  if (customer && effectivePlan(sub) !== 'free') {
    const portal = await s.billingPortal.sessions.create({ configuration: PORTAL_CONFIG, customer, return_url: SITE + '/app/' });
    return res.status(200).json({ url: portal.url, portal: true });
  }
  if (!customer) {
    const c = await s.customers.create({ email: user.email, metadata: { owner_id: user.id, app: 'scale' } });
    customer = c.id;
    await db.from('subscriptions').upsert({ owner_id: user.id, stripe_customer_id: customer,
      updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
  }

  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    line_items: [{ price: PRICE[plan], quantity: 1 }],
    subscription_data: { metadata: { owner_id: user.id, app: 'scale', plan } },
    metadata: { owner_id: user.id, app: 'scale', plan },
    allow_promotion_codes: true,
    success_url: SITE + '/app/?billing=success',
    cancel_url: SITE + '/app/?billing=cancel',
  });
  return res.status(200).json({ url: session.url });
};
