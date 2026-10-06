'use strict';
// POST /api/scan  { business_id }
//
// Fetch -> extract signals -> score against history -> persist a new scan row
// and its action list.
//
// Three things are deliberate here:
//
//   A scan is always an INSERT. Re-scanning never updates a prior row, because
//   the history is the product; destroying it to save a row would destroy the
//   only thing worth subscribing to.
//
//   The worker writes under the service role. Users hold select-only on scans
//   (see db/001_init.sql), so nobody can author their own score. For a tool
//   whose output is meant to be shown to other people, that matters.
//
//   A failed fetch is recorded as a failed scan, not swallowed. "We could not
//   reach your site" is itself a finding, and a gap in the chart is a question
//   the customer will ask.

const { createClient } = require('@supabase/supabase-js');
const { extract } = require('./_lib/signals');
const { score, actionsFrom } = require('./_lib/score');

const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 400000;

function admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

// The caller's own client, carrying their JWT. Reads through this are subject
// to RLS, which is the point: it is how we establish that the person asking
// actually owns the business they named.
//
// Without this the endpoint takes a business_id from the body and scans it, so
// anyone could trigger scans against any account, burn its rate limit and read
// its findings back out of the response. The service role is used for the
// writes only, after ownership has been proven.
function asCaller(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  const token = h && /^Bearer\s+(.+)$/i.test(h) ? h.replace(/^Bearer\s+/i, '') : null;
  if (!token) return null;
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + token } } }
  );
}

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    // Refuse anything that is not a public hostname. Without this the scanner
    // is an SSRF gadget: a user could point it at internal addresses and read
    // the response back out of the findings.
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
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScaleScan/1.0; +https://scale.siamakconsulting.com)' },
    });
    const html = (await resp.text()).slice(0, MAX_HTML_BYTES);
    return { ok: resp.ok, status: resp.status, html };
  } finally { clearTimeout(timer); }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const businessId = body && body.business_id;
  if (!businessId) return res.status(400).json({ error: 'business_id required' });

  const caller = asCaller(req);
  if (!caller) return res.status(401).json({ error: 'Sign in to run a scan.' });

  // Read through the caller's own client: RLS returns nothing unless they own
  // this business, so a miss is indistinguishable from "does not exist" --
  // which is also what we want, since a different error would confirm the id.
  const { data: biz, error: bizErr } = await caller
    .from('businesses').select('id, website_url, plan').eq('id', businessId).single();
  if (bizErr || !biz) return res.status(404).json({ error: 'Business not found' });

  const db = admin();

  const url = normalizeUrl(biz.website_url);
  if (!url) return res.status(400).json({ error: 'That website address cannot be scanned.' });

  // Claim the slot. The partial unique index makes this the concurrency gate:
  // a second scan while one is live fails here rather than racing.
  const { data: scan, error: claimErr } = await db
    .from('scans')
    .insert({ business_id: businessId, status: 'running', trigger: body.trigger || 'manual' })
    .select('id').single();
  if (claimErr) {
    return res.status(409).json({ error: 'A scan is already running for this business.' });
  }

  try {
    const page = await fetchPage(url);
    if (!page.ok && !page.html) throw new Error('Site returned status ' + page.status);

    const signals = extract(page.html, url.hostname);

    // History drives momentum, so it must be read before the new row counts.
    const { data: history } = await db
      .from('scans').select('overall_score, started_at')
      .eq('business_id', businessId).eq('status', 'complete')
      .order('started_at', { ascending: false }).limit(6);

    const result = score(signals, history || []);

    await db.from('scans').update({
      status: 'complete',
      overall_score: result.overall,
      scores: result.scores,
      findings: result.findings,
      raw: { signals, http: { status: page.status }, url: url.toString() },
      completed_at: new Date().toISOString(),
    }).eq('id', scan.id);

    // Replace the open action list with this scan's. Anything the user already
    // marked done or dismissed is left alone -- re-raising a dismissed item
    // every month is how a tool teaches people to ignore it.
    await db.from('actions').delete().eq('business_id', businessId).eq('status', 'open');
    const actions = actionsFrom(result.findings, scan.id)
      .map((a) => ({ ...a, business_id: businessId }));
    if (actions.length) await db.from('actions').insert(actions);

    await db.from('stage_progress')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('business_id', businessId).eq('stage', 'scan');
    await db.from('stage_progress')
      .update({ status: 'available' })
      .eq('business_id', businessId).eq('stage', 'clarify');

    return res.status(200).json({
      scan_id: scan.id,
      overall: result.overall,
      scores: result.scores,
      findings: result.findings.slice(0, 20),
      actions: actions.length,
    });
  } catch (err) {
    await db.from('scans').update({
      status: 'failed',
      error: String(err && err.message || err).slice(0, 500),
      completed_at: new Date().toISOString(),
    }).eq('id', scan.id);
    return res.status(502).json({ error: 'We could not read that site. ' + (err.message || '') });
  }
};
