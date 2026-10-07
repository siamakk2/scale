'use strict';
// Owner alerts by email (Resend). Fire-and-forget: an alert that fails must
// never break a payment sync or a scan, so every error is swallowed and logged.
//
// Needs RESEND_API_KEY in Vercel. Sends from the verified siamakconsulting.com
// domain to ALERT_EMAIL (default: the owner).

const TO = process.env.ALERT_EMAIL || 'siamakk2@gmail.com';
const FROM = 'S.C.A.L.E. Alerts <alerts@siamakconsulting.com>';
const ADMIN = 'https://scale.siamakconsulting.com/admin/';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function card(title, rows, accent) {
  const lines = rows.filter(Boolean).map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:#7f8ea3;font-size:13px;width:120px;vertical-align:top">${esc(k)}</td>
     <td style="padding:6px 0;color:#eef4ff;font-size:14px">${v}</td></tr>`).join('');
  return `<!DOCTYPE html><html><body style="margin:0;background:#070b14;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#101826;border:1px solid #223047;border-radius:14px">
  <tr><td style="height:4px;background:${accent};border-radius:14px 14px 0 0;font-size:0">&nbsp;</td></tr>
  <tr><td style="padding:24px 26px 6px">
    <div style="font-size:11px;letter-spacing:2px;color:#7f8ea3;text-transform:uppercase">S.C.A.L.E. alert</div>
    <div style="font-size:21px;font-weight:700;color:#eef4ff;margin-top:6px">${esc(title)}</div></td></tr>
  <tr><td style="padding:8px 26px 18px"><table role="presentation" width="100%">${lines}</table></td></tr>
  <tr><td style="padding:0 26px 26px"><a href="${ADMIN}" style="display:inline-block;background:#ffb454;color:#0b1220;
    font-weight:700;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px">Open admin dashboard &rarr;</a></td></tr>
  </table></td></tr></table></body></html>`;
}

async function send(subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log(JSON.stringify({ source: 'notify', skipped: 'no RESEND_API_KEY', subject })); return; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [TO], subject, html }),
    });
    if (!r.ok) console.error(JSON.stringify({ source: 'notify', status: r.status, body: (await r.text()).slice(0, 200) }));
  } catch (e) { console.error(JSON.stringify({ source: 'notify', error: e.message })); }
}

const PRICE = { growth: 29, scale: 99 };
const LIVE = new Set(['active', 'trialing', 'past_due']);
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const day = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : '—';

// Compare the subscription row before and after a Stripe sync and email the
// owner about anything that changed. Duplicate webhook deliveries produce no
// change, so they produce no email.
async function billingChange(prev, next, email, liveCount) {
  const was = prev && LIVE.has(prev.status) ? prev.plan : 'free';
  const now = LIVE.has(next.status) ? next.plan : 'free';
  const who = ['Customer', esc(email || 'unknown')];
  const stripe = next.stripe_customer_id
    ? ['Stripe', `<a style="color:#2dd4ff" href="https://dashboard.stripe.com/customers/${esc(next.stripe_customer_id)}">${esc(next.stripe_customer_id)}</a>`] : null;
  const dup = liveCount > 1 ? ['Warning', `<b style="color:#ffb454">${liveCount} active subscriptions on this customer, likely a duplicate charge</b>`] : null;

  if (was === 'free' && now !== 'free') {
    return send(`💰 New ${cap(now)} customer: ${email} ($${PRICE[now]}/mo)`,
      card(`New paying customer: ${cap(now)}`, [who, ['Plan', `${cap(now)} · $${PRICE[now]}/month`],
        ['Renews', day(next.current_period_end)], stripe, dup], '#4ade80'));
  }
  if (was !== 'free' && now !== 'free' && was !== now) {
    return send(`↕ ${email} switched ${cap(was)} → ${cap(now)}`,
      card(`Plan changed: ${cap(was)} → ${cap(now)}`, [who, ['New price', `$${PRICE[now]}/month`], stripe, dup], '#2dd4ff'));
  }
  if (now !== 'free' && next.cancel_at_period_end && !(prev && prev.cancel_at_period_end)) {
    return send(`⚠ ${email} cancelled ${cap(now)} (ends ${day(next.current_period_end)})`,
      card('Cancellation scheduled', [who, ['Plan', cap(now)], ['Access ends', day(next.current_period_end)],
        ['Worth doing', 'A personal email before the end date often saves the customer.'], stripe], '#ffb454'));
  }
  if (next.status === 'past_due' && (!prev || prev.status !== 'past_due')) {
    return send(`⚠ Payment failed: ${email}`,
      card('Renewal payment failed', [who, ['Plan', cap(now)], ['What happens', 'Stripe retries the card; the plan stays on meanwhile.'], stripe], '#ff7a7a'));
  }
  if (was !== 'free' && now === 'free') {
    return send(`✕ ${email} is no longer paying (${cap(was)} ended)`,
      card('Subscription ended', [who, ['Was on', cap(was)], ['Status', esc(next.status)], stripe], '#ff7a7a'));
  }
  if (dup && (!prev || prev.stripe_subscription_id !== next.stripe_subscription_id)) {
    return send(`⚠ Possible duplicate charge: ${email}`, card('Two active subscriptions', [who, dup, stripe], '#ffb454'));
  }
}

async function newSignup(email, site) {
  return send(`👤 New S.C.A.L.E. sign-up: ${email}`,
    card('New account, first scan', [['Customer', esc(email)], ['Website', esc(site)], ['Plan', 'Free']], '#a06bff'));
}

module.exports = { billingChange, newSignup, send };
