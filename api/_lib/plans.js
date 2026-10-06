'use strict';
// One place for what each plan allows. The database enforces the site count
// (enforce_site_limit trigger); the API enforces scan frequency and the fix
// list; the app reads this file's numbers back through /api/me so the screen
// can never promise something the server would refuse.

const PLANS = {
  free:   { name: 'Free',   price: 0,  sites: 1, scanEveryDays: 30, scansPerDay: 1, fixes: 5,    monthly: false },
  growth: { name: 'Growth', price: 29, sites: 1, scanEveryDays: 0,  scansPerDay: 3, fixes: null, monthly: true  },
  scale:  { name: 'Scale',  price: 99, sites: 5, scanEveryDays: 0,  scansPerDay: 3, fixes: null, monthly: true  },
};

// Live Stripe prices (account acct_1Tn0BRKBVAAPxIG1). Price ids are not secret.
const PRICE = {
  growth: 'price_1UNhJsKBVAAPxIG1IHKWNw2E',
  scale:  'price_1UNhKWKBVAAPxIG1ppS7o9b0',
};
// S.C.A.L.E.'s own billing-portal configuration, so customers can switch only
// between these two plans (the account's default portal serves other products).
const PORTAL_CONFIG = 'bpc_1UNhfTKBVAAPxIG12ZBDhrbe';

const PLAN_BY_PRICE = Object.fromEntries(Object.entries(PRICE).map(([k, v]) => [v, k]));

// Statuses that keep a paid plan switched on. past_due keeps access while
// Stripe retries the card, which is kinder than cutting someone off over a
// declined renewal they may not know about yet. Mirrors public.plan_for().
const LIVE = new Set(['active', 'trialing', 'past_due']);

function effectivePlan(row) {
  return row && LIVE.has(row.status) && PLANS[row.plan] ? row.plan : 'free';
}

module.exports = { PLANS, PRICE, PORTAL_CONFIG, PLAN_BY_PRICE, LIVE, effectivePlan };
