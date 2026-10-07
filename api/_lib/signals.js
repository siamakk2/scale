'use strict';
// Deterministic signal extraction.
//
// Everything here is a pure function of the HTML. No model, no network, no
// randomness -- the same page always yields the same signals.
//
// This matters more than it looks. The product sells a line on a chart, and a
// line is only meaningful if the measurement is stable. Ask a model to "score
// this site out of 100" and you get a different number every run; six of those
// in a row is not a trajectory, it is sampling noise with a subscription
// attached. So the facts are counted here, and the model is only asked to
// judge the handful of things that genuinely require reading comprehension
// (see score.js, where its answers are rubric-anchored and weight-capped).

const LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
  return m ? m[1] : null;
}

function metaContent(html, selector) {
  const re = new RegExp('<meta[^>]+(?:name|property)\\s*=\\s*["\']' + selector + '["\'][^>]*>', 'i');
  const m = html.match(re);
  return m ? attr(m[0], 'content') : null;
}

function jsonLd(html) {
  const out = [];
  let m;
  LD_RE.lastIndex = 0;
  while ((m = LD_RE.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      // @graph is the common wrapper; flatten so callers see plain nodes.
      if (parsed && parsed['@graph'] && Array.isArray(parsed['@graph'])) out.push(...parsed['@graph']);
      else if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch (e) {
      // A block that does not parse is worse than no block: it is a claim the
      // crawler drops on the floor. Recorded, not thrown.
      out.push({ __invalid: true, snippet: m[1].slice(0, 160) });
    }
  }
  return out;
}

function headings(html) {
  const out = { h1: [], h2: [], h3: [] };
  for (const lvl of ['h1', 'h2', 'h3']) {
    const re = new RegExp('<' + lvl + '\\b[^>]*>([\\s\\S]*?)<\\/' + lvl + '>', 'gi');
    let m;
    while ((m = re.exec(html))) {
      const t = textOf(m[1]);
      if (t) out[lvl].push(t.slice(0, 200));
    }
  }
  return out;
}

function links(html, host) {
  let internal = 0, external = 0, nofollowExternal = 0;
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (/^(mailto:|tel:|#|javascript:)/i.test(href)) continue;
    const isExternal = /^https?:\/\//i.test(href) && host && !href.includes(host);
    if (isExternal) {
      external++;
      if (/rel\s*=\s*["'][^"']*nofollow/i.test(m[0])) nofollowExternal++;
    } else internal++;
  }
  return { internal, external, nofollowExternal };
}

function images(html) {
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  const missingAlt = tags.filter((t) => {
    const a = attr(t, 'alt');
    return a === null || a.trim() === '';
  }).length;
  return { total: tags.length, missingAlt };
}

const decode = (s) => s == null ? s : String(s)
  .replace(/&amp;/g, '&').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Which site builder is this? Every instruction we give depends on it: "edit
// your theme.liquid" is useless to a Wix owner.
function platformOf(html) {
  const gen = (metaContent(html, 'generator') || '').toLowerCase();
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(html)) return 'shopify';
  if (gen.includes('wix') || /static\.wixstatic\.com|wix-warmup-data/i.test(html)) return 'wix';
  if (gen.includes('squarespace') || /static1\.squarespace\.com|Static\.SQUARESPACE_CONTEXT/i.test(html)) return 'squarespace';
  if (gen.includes('webflow') || /data-wf-site|webflow\.com\/css/i.test(html)) return 'webflow';
  if (gen.includes('wordpress') || /\/wp-content\/|\/wp-includes\//i.test(html)) return 'wordpress';
  if (/img\d?\.wsimg\.com|godaddy/i.test(html)) return 'godaddy';
  return 'custom';
}

const SOCIAL = [
  ['facebook', /facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)[^"'?#\s]+/i],
  ['instagram', /instagram\.com\/(?!p\/|explore)[^"'?#\s]+/i],
  ['linkedin', /linkedin\.com\/(company|in)\/[^"'?#\s]+/i],
  ['x', /(?:twitter|x)\.com\/(?!intent|share|home)[A-Za-z0-9_]{2,}/i],
  ['youtube', /youtube\.com\/(?:@|channel\/|c\/|user\/)[^"'?#\s]+/i],
  ['tiktok', /tiktok\.com\/@[^"'?#\s]+/i],
  ['pinterest', /pinterest\.com\/(?!pin\/)[^"'?#\s]+/i],
  ['yelp', /yelp\.com\/biz\/[^"'?#\s]+/i],
  ['google', /(?:g\.page|maps\.app\.goo\.gl|google\.com\/maps)\/[^"'\s]+/i],
];
// Profile links the page already shows people, so the fix can reuse them.
function socialProfiles(html) {
  const out = {};
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi; let m;
  while ((m = re.exec(html))) {
    for (const [k, rx] of SOCIAL) if (!out[k] && rx.test(m[1]) && /^https?:/i.test(m[1])) out[k] = m[1].split('#')[0];
  }
  return out;
}

// Parse robots.txt and report which AI crawlers it shuts out of the whole site.
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Bingbot'];
function aiBlocked(robots) {
  if (robots == null) return null;
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of String(robots).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...v] = line.split(':'); const key = k.trim().toLowerCase(), val = v.join(':').trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true;
    } else { lastWasAgent = false; if (cur && (key === 'disallow' || key === 'allow')) cur.rules.push([key, val]); }
  }
  const blocks = (g) => g.rules.some(([k, v]) => k === 'disallow' && v === '/') && !g.rules.some(([k, v]) => k === 'allow' && v === '/');
  return AI_BOTS.filter((bot) => {
    const own = groups.filter((g) => g.agents.includes(bot.toLowerCase()));
    const use = own.length ? own : groups.filter((g) => g.agents.includes('*'));
    return use.some(blocks);
  });
}

/**
 * Extract every deterministic signal we score on.
 * @param {string} html  raw document
 * @param {string} host  hostname, for internal/external link classification
 */
function extract(html, host, extras) {
  extras = extras || {};
  const ld = jsonLd(html);
  const types = ld
    .filter((n) => n && !n.__invalid)
    .map((n) => n['@type'])
    .flat()
    .filter(Boolean);

  const person = ld.find((n) => n && n['@type'] === 'Person') || null;
  const orgs = ld.filter((n) => n && /Organization|LocalBusiness|ProfessionalService|Store|Restaurant|Service|Corporation|Clinic|Dentist|Attorney|Agent|Contractor|Physician|Hotel|Cafe|Bakery|Business/.test(String(n['@type']))) || null;
  // Prefer the most specific type (TextileStore over Organization).
  const org = orgs.find((n) => !/^(Organization|Corporation)$/.test(String([].concat(n['@type'])[0]))) || orgs[0] || null;

  const body = textOf(html);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const h = headings(html);

  return {
    title: title ? textOf(title) : null,
    metaDescription: decode(metaContent(html, 'description')),
    canonical: (html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || []).length
      ? attr(html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)[0], 'href')
      : null,
    robots: metaContent(html, 'robots'),
    ogTitle: metaContent(html, 'og:title'),
    ogImage: metaContent(html, 'og:image'),

    headings: h,
    h1Count: h.h1.length,

    schema: {
      blocks: ld.length,
      invalid: ld.filter((n) => n && n.__invalid).length,
      types: Array.from(new Set(types)),
      hasPerson: !!person,
      hasOrg: !!org,
      // The entity declarations a model reads to answer "who is this".
      jobTitle: person ? person.jobTitle || null : null,
      knowsAbout: person && Array.isArray(person.knowsAbout) ? person.knowsAbout.length : 0,
      sameAs: Math.max(((person && person.sameAs) || []).length, ...orgs.map((o) => [].concat(o.sameAs || []).length), 0),
      knowsAboutOrg: orgs.some((o) => o.knowsAbout),
      hasFaq: types.includes('FAQPage'),
      hasBreadcrumb: types.includes('BreadcrumbList'),
    },

    links: links(html, host),
    images: images(html),

    wordCount: body ? body.split(/\s+/).length : 0,
    // Cheap, honest proxy for "is the content actually in the HTML" -- a page
    // that renders its prose client-side scores badly here, and should, because
    // that is exactly what a retrieval crawler sees.
    textToHtmlRatio: html.length ? +(body.length / html.length).toFixed(4) : 0,
    bodySample: body.slice(0, 6000),

    // ---- rubric v2: the evidence the playbook quotes back to the owner ----
    platform: platformOf(html),
    siteName: decode((org && org.name) || metaContent(html, 'og:site_name') ||
      (title ? textOf(title).split(/\s[|–—-]\s/)[0] : null) || host),
    org: org ? {
      type: [].concat(org['@type'])[0] || null,
      description: org.description ? decode(org.description).slice(0, 400) : null,
      telephone: org.telephone || null,
      address: !!org.address, logo: !!org.logo,
      city: org.address && org.address.addressLocality || null,
      region: org.address && org.address.addressRegion || null,
      street: org.address && org.address.streetAddress || null,
      postal: org.address && org.address.postalCode || null,
      logoUrl: typeof org.logo === 'string' ? org.logo : (org.logo && org.logo.url) || null,
      email: org.email || null,
    } : null,
    h1Raw: (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || []).slice(0, 4).map((x) => x.slice(0, 400)),
    h1Logo: (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || []).some((x) => /<img\b|logo/i.test(x)),
    ogSiteName: metaContent(html, 'og:site_name'),
    lang: (html.match(/<html[^>]*\blang=["']([^"']+)/i) || [])[1] || null,
    viewport: !!metaContent(html, 'viewport'),
    contact: {
      tel: /href=["']tel:/i.test(html) || !!(org && org.telephone),
      email: /href=["']mailto:/i.test(html) || !!(org && org.email),
      phoneText: /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(body),
    },
    social: socialProfiles(html),
    robotsTxt: extras.robots === undefined ? undefined : extras.robots,
    aiBlocked: extras.robots === undefined ? null : aiBlocked(extras.robots),
    sitemap: extras.sitemap === undefined ? null : !!extras.sitemap,
    llmsTxt: extras.llms === undefined ? null : !!extras.llms,
  };
}

module.exports = { extract, textOf, jsonLd, headings, aiBlocked, platformOf, AI_BOTS };
