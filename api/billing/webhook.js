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

async function sync(db, sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const priceId = item && item.price && item.price.id;
  const plan = PLAN_BY_PRICE[priceId] || (item && item.price && item.price.metadata && item.price.metadata.plan);
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;
  let owner = sub.metadata && sub.metadata.owner_id;
  if (!owner && customer) {
    const { data } = await db.from('subscriptions').select('owner_id').eq('stripe_customer_id', customer).maybeSingle();
    owner = data && data.owner_id;
  }
  if (!owner) return { skipped: 'no owner for ' + sub.id };
  if (!plan) return { skipped: 'price not a S.C.A.L.E. plan: ' + priceId };
  // current_period_end moved from the subscription to its items in newer API
  // versions; read whichever is present.
  const end = sub.current_period_end || (item && item.current_period_end);
  const row = {
    owner_id: owner, plan, status: sub.status,
    stripe_customer_id: customer, stripe_subscription_id: sub.id,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('subscriptions').upsert(row, { onConflict: 'owner_id' });
  if (error) throw new Error(error.message);
  return { owner, plan, status: sub.status };
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
    if (event.type === 'checkout.session.completed') {
      const cs = event.data.object;
      if (cs.mode === 'subscription' && cs.subscription) {
        out = await sync(db, await s.subscriptions.retrieve(cs.subscription));
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      out = await sync(db, event.data.object);
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
