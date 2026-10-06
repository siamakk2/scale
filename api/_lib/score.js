'use strict';
// Rubric scoring: signals -> the five S.C.A.L.E. dimensions.
//
// Every check is a small, named, independently testable object. A score is
// never a number someone felt was about right -- it is the sum of checks that
// passed, and every point lost names the check that lost it. Two consequences
// that both matter commercially:
//
//   1. The score is reproducible, so month-over-month movement is real signal
//      rather than model variance (see signals.js).
//   2. Every finding is explainable, so the app can always answer "why is my
//      score 61" with a list rather than a shrug. That question is the one
//      that kills trust in audit tools.
//
// Weights are declared, not buried: tuning the rubric means editing numbers in
// one table, and `raw` is kept on every scan so a re-weighting can be replayed
// over history instead of invalidating it.

const DIMENSIONS = ['visibility', 'clarity', 'structure', 'authority', 'momentum'];

// pass: true | false | null   (null = not applicable, drops out of the denominator)
const CHECKS = [
  // ---------------------------------------------------------- visibility (S)
  { id: 'indexable', dim: 'visibility', weight: 5,
    title: 'Page is open to crawlers',
    detail: 'A noindex directive removes the page from search and from the sources AI systems draw on.',
    test: (s) => !(s.robots && /noindex/i.test(s.robots)) },

  { id: 'title-present', dim: 'visibility', weight: 4,
    title: 'Has a page title',
    detail: 'The title is the single strongest statement of what a page is about.',
    test: (s) => !!(s.title && s.title.length >= 10) },

  { id: 'title-length', dim: 'visibility', weight: 2,
    title: 'Title is a usable length',
    detail: 'Under about 60 characters survives truncation in results.',
    test: (s) => (s.title ? s.title.length <= 65 : null) },

  { id: 'meta-description', dim: 'visibility', weight: 3,
    title: 'Has a meta description',
    detail: 'Often quoted verbatim as the summary of who you are.',
    test: (s) => !!(s.metaDescription && s.metaDescription.length >= 50) },

  { id: 'canonical', dim: 'visibility', weight: 3,
    title: 'Declares a canonical URL',
    detail: 'Without one, duplicate addresses split the authority of the same page.',
    test: (s) => !!s.canonical },

  { id: 'content-in-html', dim: 'visibility', weight: 6,
    title: 'Content is in the HTML',
    detail: 'Prose assembled in the browser is frequently invisible to the crawlers that feed AI answers.',
    test: (s) => s.wordCount >= 300 },

  { id: 'content-density', dim: 'visibility', weight: 3,
    title: 'Readable text outweighs markup',
    detail: 'A very low text-to-markup ratio usually means the substance is rendered client-side.',
    test: (s) => s.textToHtmlRatio >= 0.05 },

  // ------------------------------------------------------------- clarity (C)
  { id: 'single-h1', dim: 'clarity', weight: 5,
    title: 'Exactly one main heading',
    detail: 'Zero leaves the subject unstated; several leave it ambiguous.',
    test: (s) => s.h1Count === 1 },

  { id: 'h1-substantive', dim: 'clarity', weight: 4,
    title: 'The main heading says something',
    detail: 'A heading that is only a tagline spends the strongest signal on atmosphere.',
    test: (s) => (s.headings.h1[0] ? s.headings.h1[0].split(/\s+/).length >= 3 : false) },

  { id: 'heading-structure', dim: 'clarity', weight: 3,
    title: 'Has section headings',
    detail: 'Sections are the units retrieval systems quote. An unbroken wall of text gets skipped.',
    test: (s) => s.headings.h2.length >= 2 },

  { id: 'stated-role', dim: 'clarity', weight: 5,
    title: 'States what you are, in machine-readable form',
    detail: 'A jobTitle or organisation type is how a model answers "what is this business".',
    test: (s) => !!(s.schema.jobTitle || s.schema.hasOrg) },

  { id: 'og-title-agrees', dim: 'clarity', weight: 2,
    title: 'Share title agrees with the page title',
    detail: 'Two different claims about the same page is a contradiction you are publishing about yourself.',
    test: (s) => {
      if (!s.ogTitle || !s.title) return null;
      const norm = (x) => x.toLowerCase().split(/[|—–-]/)[0].trim();
      return norm(s.ogTitle) === norm(s.title);
    } },

  // ----------------------------------------------------------- structure (A)
  { id: 'schema-present', dim: 'structure', weight: 6,
    title: 'Publishes structured data',
    detail: 'Schema is the difference between a model inferring who you are and being told.',
    test: (s) => s.schema.blocks > 0 },

  { id: 'schema-valid', dim: 'structure', weight: 6,
    title: 'All structured data parses',
    detail: 'A malformed block is silently discarded — worse than none, because you believe it is working.',
    test: (s) => (s.schema.blocks > 0 ? s.schema.invalid === 0 : null) },

  { id: 'entity-declared', dim: 'structure', weight: 5,
    title: 'Declares a Person or Organization entity',
    detail: 'This is the node everything else about you attaches to.',
    test: (s) => s.schema.hasPerson || s.schema.hasOrg },

  { id: 'knows-about', dim: 'structure', weight: 3,
    title: 'Declares areas of expertise',
    detail: 'knowsAbout is how you get associated with a topic rather than only a name.',
    test: (s) => s.schema.knowsAbout >= 3 },

  { id: 'faq-schema', dim: 'structure', weight: 3,
    title: 'Publishes question-and-answer content',
    detail: 'Q&A is the shape assistants quote most readily, because it matches how people ask.',
    test: (s) => s.schema.hasFaq },

  { id: 'image-alt', dim: 'structure', weight: 2,
    title: 'Images carry alt text',
    detail: 'Alt text is content; without it an image is a hole in the page to a crawler.',
    test: (s) => (s.images.total === 0 ? null : s.images.missingAlt / s.images.total <= 0.2) },

  // ----------------------------------------------------------- authority (L)
  { id: 'same-as', dim: 'authority', weight: 6,
    title: 'Links your profiles to your entity',
    detail: 'sameAs is how a model confirms the business here is the one it has seen elsewhere.',
    test: (s) => s.schema.sameAs >= 3 },

  { id: 'cites-out', dim: 'authority', weight: 4,
    title: 'Cites sources outside your own site',
    detail: 'Pages that cite nothing read as isolated, and isolated pages are rarely cited back.',
    test: (s) => s.links.external >= 2 },

  { id: 'citations-followable', dim: 'authority', weight: 3,
    title: 'Outbound citations are followable',
    detail: 'Marking every external link nofollow severs the association you are trying to build.',
    test: (s) => (s.links.external === 0 ? null
      : s.links.nofollowExternal / s.links.external < 1) },

  { id: 'internal-linking', dim: 'authority', weight: 3,
    title: 'Links to your own related pages',
    detail: 'Internal links are how authority moves between your pages and how crawlers find them.',
    test: (s) => s.links.internal >= 5 },
];

function scoreDimension(signals, dim) {
  const checks = CHECKS.filter((c) => c.dim === dim);
  let earned = 0, possible = 0;
  const findings = [];

  for (const c of checks) {
    let pass;
    try { pass = c.test(signals); }
    catch (e) { pass = null; }           // a broken check must not sink a score
    if (pass === null) continue;          // not applicable: out of the denominator
    possible += c.weight;
    if (pass) earned += c.weight;
    else findings.push({
      id: c.id, dimension: dim, weight: c.weight,
      severity: c.weight >= 5 ? 'high' : c.weight >= 3 ? 'medium' : 'low',
      title: c.title, detail: c.detail,
    });
  }

  return {
    score: possible === 0 ? null : Math.round((earned / possible) * 100),
    earned, possible, findings,
  };
}

/**
 * @param {object} signals  from signals.extract()
 * @param {object[]} history  prior completed scans, newest first. Empty on a
 *                            first run, which is why momentum is null then --
 *                            an honest null, not a fabricated 50.
 */
function score(signals, history = []) {
  const scores = {};
  let findings = [];

  for (const dim of DIMENSIONS) {
    if (dim === 'momentum') continue;
    const r = scoreDimension(signals, dim);
    scores[dim] = r.score;
    findings = findings.concat(r.findings);
  }

  // Momentum: direction and rate of change. Needs a prior scan by definition,
  // which is the honest reason the product asks you to come back.
  const prior = history.find((h) => h && typeof h.overall_score === 'number');
  if (prior) {
    const current = baseOverall(scores);
    const delta = current - prior.overall_score;
    // +/-10 points maps onto the full 0-100 band, centred at 50 for "holding".
    scores.momentum = Math.max(0, Math.min(100, Math.round(50 + delta * 5)));
  } else {
    scores.momentum = null;
  }

  findings.sort((a, b) => b.weight - a.weight);

  return {
    overall: baseOverall(scores),
    scores,
    findings,
    checkedAt: new Date().toISOString(),
  };
}

// The headline number is the mean of the dimensions that could be measured.
// Momentum is excluded so a first scan and a sixth are directly comparable --
// include it and every business appears to improve merely by scanning twice.
function baseOverall(scores) {
  const vals = ['visibility', 'clarity', 'structure', 'authority']
    .map((d) => scores[d]).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// Findings become the action list, impact-first: the thing that moves the
// number most, not the thing that is easiest to describe.
function actionsFrom(findings, scanId) {
  const STAGE = { visibility: 'scan', clarity: 'clarify', structure: 'amplify', authority: 'leverage' };
  return findings.map((f) => ({
    scan_id: scanId,
    stage: STAGE[f.dimension] || 'scan',
    title: f.title,
    detail: f.detail,
    impact: Math.min(5, Math.max(1, Math.round(f.weight / 1.5))),
    effort: f.weight >= 5 ? 3 : 2,
    status: 'open',
  }));
}

module.exports = { score, scoreDimension, actionsFrom, CHECKS, DIMENSIONS };
