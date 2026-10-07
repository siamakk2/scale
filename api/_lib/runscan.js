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
const { buildMissions, aiProfile } = require('./playbook');

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

// The three small files beside the page that decide what crawlers may read.
// Each is best-effort: a timeout means "unknown" (null), never a failed check.
async function fetchText(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScaleScan/1.0; +https://scale.siamakconsulting.com)' } });
    const t = (await r.text()).slice(0, 60000);
    return { status: r.status, text: t, html: /^\s*<(!doctype|html)/i.test(t) };
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
async function fetchExtras(url) {
  const o = url.origin;
  const [robots, sitemap, llms] = await Promise.all([
    fetchText(o + '/robots.txt', 5000), fetchText(o + '/sitemap.xml', 5000), fetchText(o + '/llms.txt', 5000)]);
  const out = {};
  if (robots) out.robots = robots.status === 200 && !robots.html ? robots.text : '';
  if (sitemap || (robots && /^\s*sitemap:/im.test(robots.text || ''))) {
    out.sitemap = !!(sitemap && sitemap.status === 200 && /<(urlset|sitemapindex)/i.test(sitemap.text)) ||
      !!(robots && robots.status === 200 && /^\s*sitemap:/im.test(robots.text));
  }
  if (llms) out.llms = llms.status === 200 && !llms.html && llms.text.trim().length > 20;
  return out;
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
    const [page, extras] = await Promise.all([fetchPage(url), fetchExtras(url)]);
    if (!page.ok && !page.html) throw new Error('Site returned status ' + page.status);
    const signals = extract(page.html, url.hostname, extras);

    const { data: history } = await db.from('scans').select('overall_score, scores, started_at')
      .eq('business_id', biz.id).eq('status', 'complete')
      .order('started_at', { ascending: false }).limit(6);
    const result = score(signals, history || []);
    // Failed checks become missions (one card per job, with its lesson). The
    // plan decides how many missions come with the full lesson; the rest show
    // their title and the points they are worth, so nothing is hidden.
    const cap0 = PLANS[plan] && PLANS[plan].fixes;
    const missions = buildMissions(result.findings, signals, { url: url.toString(), host: url.hostname })
      .map((m, i, arr) => {
        // Blockers and contact details are never behind the paywall.
        const free = m.blocker || m.id === 'contact';
        const rank = arr.slice(0, i).filter((x) => !(x.blocker || x.id === 'contact')).length;
        return cap0 && !free && rank >= cap0 ? { ...m, guide: null, locked: true } : m;
      });
    result.findings = missions;
    const profile = aiProfile(signals, { host: url.hostname });

    await db.from('scans').update({
      status: 'complete', overall_score: result.overall, scores: result.scores,
      findings: result.findings, raw: { signals: { ...signals, robotsTxt: undefined }, profile, http: { status: page.status }, url: url.toString() },
      completed_at: new Date().toISOString(),
    }).eq('id', scan.id);

    // Replace the open list; leave done/dismissed items alone. Free accounts
    // get the heaviest fixes only -- the full list is part of a paid plan.
    await db.from('actions').delete().eq('business_id', biz.id).eq('status', 'open');
    // A mission the owner already ticked stays ticked; the dashboard shows it
    // as "still detected" if the scan disagrees, instead of re-adding a copy.
    const { data: kept } = await db.from('actions').select('title').eq('business_id', biz.id).neq('status', 'open');
    const keptTitles = new Set((kept || []).map((k) => k.title));
    const all = actionsFrom(result.findings, scan.id)
      .map((a) => ({ ...a, business_id: biz.id }));
    const unlocked = new Set(result.findings.filter((m) => !m.locked).map((m) => m.title));
    const actions = all.filter((a) => unlocked.has(a.title) && !keptTitles.has(a.title));
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

module.exports = { admin, runScan, planOf, normalizeUrl, fetchExtras };
