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

/**
 * Extract every deterministic signal we score on.
 * @param {string} html  raw document
 * @param {string} host  hostname, for internal/external link classification
 */
function extract(html, host) {
  const ld = jsonLd(html);
  const types = ld
    .filter((n) => n && !n.__invalid)
    .map((n) => n['@type'])
    .flat()
    .filter(Boolean);

  const person = ld.find((n) => n && n['@type'] === 'Person') || null;
  const org = ld.find((n) => n && /Organization|LocalBusiness|ProfessionalService/.test(String(n['@type']))) || null;

  const body = textOf(html);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const h = headings(html);

  return {
    title: title ? textOf(title) : null,
    metaDescription: metaContent(html, 'description'),
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
      sameAs: ((person && person.sameAs) || (org && org.sameAs) || []).length,
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
  };
}

module.exports = { extract, textOf, jsonLd, headings };
