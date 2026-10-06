'use strict';
const Stripe = require('stripe');
let client = null;
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!client) client = Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}
module.exports = { stripe };
