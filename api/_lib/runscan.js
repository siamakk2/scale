'use strict';
// The scan itself: fetch -> extract -> score against history -> persist.
// Shared by the user-triggered scan (api/scan.js) and the monthly automatic
// scan (api/cron/monthly.js), so both produce identical rows.
//
// Deliberate, carried over from the original scan.js:
//   * A scan is always an INSERT. History is the product.
//   * Writes happen under the service role; users hold select-only on scans.
//   * A failed fetch is recorded as a failed scan, not swallowed.

const { createClient } = require('@supabase/supabase-js');
const { extract } = require('./signals');
const { score, actionsFrom } = require('./score');
const { PLANS } = require('./plans');

const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 400000;

function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
}

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    // Public hostnames only. Without this the scanner is an SSRF gadget.
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const o = h.split('.').map(Number);
      if (o[0] === 10 || o[0] === 127 || o[0] === 0 ||
          (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
          (o[0] === 192 && o[1] === 168) ||
          (o[0] === 169 && o[1] === 254)) return null;
    }
    if (!h.includes('.')) return null;
    return u;
  } catch (e) { return null; }
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScaleScan/1.0; +https://scale.siamakconsulting.com)' },
    });
    const html = (await resp.text()).slice(0, MAX_HTML_BYTES);
    return { ok: resp.ok, status: resp.status, html };
  } finally { clearTimeout(timer); }
}

// Returns { ok:true, scan_id, overall, scores, findings, actions, actions_total }
// or { ok:false, status, error }.
async function runScan(db, biz, { trigger = 'manual', plan = 'free' } = {}) {
  const url = normalizeUrl(biz.website_url);
  if (!url) return { ok: false, status: 400, error: 'That website address cannot be scanned.' };

  // The partial unique index makes this insert the concurrency gate.
  const { data: scan, error: claimErr } = await db.from('scans')
    .insert({ business_id: biz.id, status: 'running', trigger })
    .select('id').single();
  if (claimErr) return { ok: false, status: 409, error: 'A scan is already running for this website.' };

  try {
    const page = await fetchPage(url);
    if (!page.ok && !page.html) throw new Error('Site returned status ' + page.status);
    const signals = extract(page.html, url.hostname);

    const { data: history } = await db.from('scans').select('overall_score, started_at')
      .eq('business_id', biz.id).eq('status', 'complete')
      .order('started_at', { ascending: false }).limit(6);
    const result = score(signals, history || []);

    await db.from('scans').update({
      status: 'complete', overall_score: result.overall, scores: result.scores,
      findings: result.findings, raw: { signals, http: { status: page.status }, url: url.toString() },
      completed_at: new Date().toISOString(),
    }).eq('id', scan.id);

    // Replace the open list; leave done/dismissed items alone. Free accounts
    // get the heaviest fixes only -- the full list is part of a paid plan.
    await db.from('actions').delete().eq('business_id', biz.id).eq('status', 'open');
    const all = actionsFrom(result.findings, scan.id)
      .map((a) => ({ ...a, business_id: biz.id }))
      .sort((a, b) => b.impact - a.impact);
    const cap = PLANS[plan] && PLANS[plan].fixes;
    const actions = cap ? all.slice(0, cap) : all;
    if (actions.length) await db.from('actions').insert(actions);

    await db.from('stage_progress').update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('business_id', biz.id).eq('stage', 'scan');
    await db.from('stage_progress').update({ status: 'available' })
      .eq('business_id', biz.id).eq('stage', 'clarify').eq('status', 'locked');

    return { ok: true, scan_id: scan.id, overall: result.overall, scores: result.scores,
             findings: result.findings.slice(0, 20), actions: actions.length, actions_total: all.length };
  } catch (err) {
    await db.from('scans').update({
      status: 'failed', error: String(err && err.message || err).slice(0, 500),
      completed_at: new Date().toISOString(),
    }).eq('id', scan.id);
    return { ok: false, status: 502, error: 'We could not read that site. ' + (err.message || '') };
  }
}

async function planOf(db, ownerId) {
  const { data } = await db.from('subscriptions').select('plan, status').eq('owner_id', ownerId).maybeSingle();
  return require('./plans').effectivePlan(data);
}

module.exports = { admin, runScan, planOf, normalizeUrl };
