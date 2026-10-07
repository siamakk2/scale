'use strict';
// POST /api/billing/webhook  (Stripe -> us)
//
// The only writer of public.subscriptions. A plan changes because Stripe says
// money moved, never because a browser said so. The signature is checked
// against the raw request body, so this function must not let the platform
// parse JSON first -- see readRaw().
const { admin } = require('../_lib/runscan');
const { PLAN_BY_PRICE } = require('../_lib/plans');
const { stripe } = require('../_lib/stripe');

// Read the stream before anything touches req.body: on Vercel, req.body is a
// lazy getter that parses JSON, and a re-serialised body no longer matches
// Stripe's signature. Fall back to a Buffer/string body if a platform already
// consumed the stream.
function readRaw(req) {
  return new Promise((resolve, reject) => {
    if (req.readableEnded || req.complete && !req.readable) {
      const b = req.body;
      return resolve(Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : ''));
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Stripe does not guarantee event order: on 2026-10-07 a "created (incomplete)"
// event was processed 0.4s AFTER "updated (active)" and left a paying customer
// shown as Free, who then paid a second time. So events are only a nudge here.
// We ignore what the event says and re-read the customer's subscriptions from
// Stripe, then store the best live one. Order no longer matters, and a
// cancelled duplicate can never overwrite an active subscription.
const RANK = { active: 4, trialing: 4, past_due: 3, incomplete: 1, unpaid: 0, canceled: 0, incomplete_expired: 0, paused: 0 };

async function ownerFor(db, sub, customer) {
  if (sub && sub.metadata && sub.metadata.owner_id) return sub.metadata.owner_id;
  const { data } = await db.from('subscriptions').select('owner_id').eq('stripe_customer_id', customer).maybeSingle();
  return data && data.owner_id;
}

async function syncCustomer(s, db, customer, hint) {
  const list = await s.subscriptions.list({ customer, status: 'all', limit: 20 });
  const ours = list.data.filter((x) => {
    const pid = x.items && x.items.data[0] && x.items.data[0].price && x.items.data[0].price.id;
    return !!PLAN_BY_PRICE[pid];
  });
  if (!ours.length) return { skipped: 'no S.C.A.L.E. subscription on ' + customer };
  ours.sort((a, b) => (RANK[b.status] || 0) - (RANK[a.status] || 0) || b.created - a.created);
  const best = ours[0];
  const item = best.items.data[0];
  const owner = await ownerFor(db, best.metadata && best.metadata.owner_id ? best : hint, customer);
  if (!owner) return { skipped: 'no owner for ' + customer };
  const end = best.current_period_end || item.current_period_end;
  const row = {
    owner_id: owner, plan: PLAN_BY_PRICE[item.price.id], status: best.status,
    stripe_customer_id: customer, stripe_subscription_id: best.id,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: !!best.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('subscriptions').upsert(row, { onConflict: 'owner_id' });
  if (error) throw new Error(error.message);
  const live = ours.filter((x) => ['active', 'trialing', 'past_due'].includes(x.status));
  return { owner, plan: row.plan, status: row.status, sub: best.id, live_subs: live.length };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return res.status(503).json({ error: 'billing not configured' });

  let event;
  try {
    const raw = await readRaw(req);
    event = s.webhooks.constructEvent(raw, req.headers['stripe-signature'], secret);
  } catch (e) {
    return res.status(400).json({ error: 'bad signature' });
  }

  const db = admin();
  try {
    let out = { ignored: event.type };
    const obj = event.data.object;
    const customer = typeof obj.customer === 'string' ? obj.customer : obj.customer && obj.customer.id;
    if ((event.type === 'checkout.session.completed' && obj.mode === 'subscription') ||
        event.type.startsWith('customer.subscription.')) {
      if (customer) out = await syncCustomer(s, db, customer, obj);
    }
    console.log(JSON.stringify({ source: 'stripe-webhook', type: event.type, id: event.id, ...out }));
    return res.status(200).json({ received: true });
  } catch (e) {
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    console.error(JSON.stringify({ source: 'stripe-webhook', type: event.type, id: event.id, error: e.message }));
    return res.status(500).json({ error: 'sync failed' });
  }
};

// Keep the raw body intact for signature verification.
module.exports.config = { api: { bodyParser: false } };
module.exports.syncCustomer = syncCustomer;
