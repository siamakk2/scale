'use strict';
// Payments for the S.C.A.L.E. Academy course on siamakconsulting.com/academy.
// The course site has no Stripe key of its own, so its server calls this
// endpoint (server to server) to open a Checkout session and to confirm one.
// Nothing here can charge anyone: it only creates hosted Checkout pages for
// the one Academy price and reports whether a given session was paid.
//
//   POST { op: 'checkout', email, t }  -> { url }
//   POST { op: 'verify', session_id }  -> { paid, email }
const { stripe } = require('../_lib/stripe');

const PRICE = process.env.ACADEMY_PRICE_ID || 'price_1UPqOkKBVAAPxIG15m9OSgFP';
const SITE = 'https://siamakconsulting.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = stripe();
  if (!s) return res.status(200).json({ error: 'Payments are not set up yet.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  try {
    if (body.op === 'checkout') {
      const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(200).json({ error: 'A valid email is required.' });
      const t = /^[A-Za-z0-9_.-]{10,200}$/.test(String(body.t || '')) ? String(body.t) : '';
      const session = await s.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: PRICE, quantity: 1 }],
        customer_email: email,
        customer_creation: 'always',
        allow_promotion_codes: true,
        metadata: { app: 'academy', email },
        payment_intent_data: { metadata: { app: 'academy', email }, description: 'S.C.A.L.E. Academy — Full Course' },
        success_url: SITE + '/academy?paid={CHECKOUT_SESSION_ID}' + (t ? '&t=' + t : ''),
        cancel_url: SITE + '/academy/week-2' + (t ? '?t=' + t : '')
      });
      return res.status(200).json({ url: session.url });
    }
    if (body.op === 'verify') {
      const id = String(body.session_id || '');
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id)) return res.status(200).json({ paid: false });
      const session = await s.checkout.sessions.retrieve(id, { expand: ['line_items'] });
      const forAcademy = (session.metadata && session.metadata.app === 'academy') ||
        ((session.line_items && session.line_items.data) || []).some((li) => li.price && li.price.id === PRICE);
      const paid = forAcademy && session.status === 'complete' && (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
      const email = (session.metadata && session.metadata.email) || (session.customer_details && session.customer_details.email) || '';
      return res.status(200).json({ paid, email: paid ? email.toLowerCase() : '', amount: paid ? session.amount_total : 0 });
    }
    return res.status(400).json({ error: 'Unknown op.' });
  } catch (e) {
    console.error(JSON.stringify({ source: 'academy-billing', op: body.op, error: e.message }));
    return res.status(200).json({ error: 'Payment service error. Please try again.' });
  }
};
