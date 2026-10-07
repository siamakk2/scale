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
// Bump when checks are added or re-weighted. Scores are only compared within a version.
const RUBRIC = 2;

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
    test: (s) => (s.headings.h1[0] ? s.headings.h1[0].split(/\s+/).length >= 3 : null) },

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
    test: (s) => s.schema.knowsAbout >= 3 || !!s.schema.knowsAboutOrg },

  { id: 'faq-schema', dim: 'structure', weight: 3,
    title: 'Publishes question-and-answer content',
    detail: 'Q&A is the shape assistants quote most readily, because it matches how people ask.',
    test: (s) => s.schema.hasFaq },

  { id: 'image-alt', dim: 'structure', weight: 2,
    title: 'Images carry alt text',
    detail: 'Alt text is content; without it an image is a hole in the page to a crawler.',
    test: (s) => (s.images.total === 0 ? null : s.images.missingAlt / s.images.total <= 0.2) },

  // ---- rubric v2 additions -------------------------------------------------
  { id: 'location-declared', dim: 'structure', weight: 2,
    title: 'Business data includes your address',
    detail: 'An address in your business data is what places you on the map for "near me" questions.',
    // Online-only stores have no address to give; not their failing.
    test: (s) => (s.org && s.platform !== 'shopify' ? !!s.org.address : null) },

  { id: 'ai-crawlers', dim: 'visibility', weight: 6,
    title: 'AI assistants are allowed to read your site',
    detail: 'If robots.txt blocks GPTBot, ClaudeBot or PerplexityBot, those assistants cannot read or recommend you.',
    test: (s) => (Array.isArray(s.aiBlocked) ? s.aiBlocked.length === 0 : null) },

  { id: 'sitemap', dim: 'visibility', weight: 3,
    title: 'Publishes a sitemap',
    detail: 'A sitemap is the list of pages you hand to crawlers so none of them get missed.',
    test: (s) => s.sitemap },

  { id: 'meta-description-length', dim: 'visibility', weight: 2,
    title: 'Summary is a usable length',
    detail: 'Past about 160 characters the summary is cut off mid-sentence wherever it is shown.',
    test: (s) => (s.metaDescription && s.metaDescription.length >= 50 ? s.metaDescription.length <= 165 : null) },

  { id: 'title-describes', dim: 'clarity', weight: 4,
    title: 'Page title says what you do, not just your name',
    detail: 'A title that is only a brand name tells a stranger, and an AI, nothing about what you sell.',
    test: (s) => {
      if (!s.title) return null;
      // Builder defaults nobody meant to publish.
      if (/just another wordpress site|^home$|^untitled|my (wix )?site|coming soon|^new page/i.test(s.title.trim())) return false;
      const brand = String(s.siteName || '').toLowerCase();
      const rest = s.title.toLowerCase().replace(brand, ' ')
        .replace(/\b(home|homepage|welcome|official site|official website)\b/g, ' ')
        .replace(/[|–—:\-]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
      return rest.length >= 2;
    } },

  { id: 'share-image', dim: 'clarity', weight: 2,
    title: 'Has a share image',
    detail: 'When your link is pasted into a chat, text or social post, this is the picture that shows.',
    test: (s) => !!s.ogImage },

  { id: 'llms-txt', dim: 'structure', weight: 1,
    title: 'Has an llms.txt file',
    detail: 'A short plain-text guide for AI systems: who you are and which pages matter. New, cheap, and rarely done.',
    test: (s) => s.llmsTxt },

  { id: 'contact-visible', dim: 'authority', weight: 3,
    title: 'Shows how to reach you',
    detail: 'A real phone number or email on the page is a trust signal for people and for AI systems alike.',
    test: (s) => (s.contact ? !!(s.contact.tel || s.contact.email || s.contact.phoneText) : null) },

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
      id: c.id, dimension: dim, weight: c.weight, check: c.id,
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
  const POSSIBLE = {};
  let findings = [];

  for (const dim of DIMENSIONS) {
    if (dim === 'momentum') continue;
    const r = scoreDimension(signals, dim);
    scores[dim] = r.score;
    POSSIBLE[dim] = r.possible;
    findings = findings.concat(r.findings);
  }

  // Momentum: direction and rate of change. Needs a prior scan by definition,
  // which is the honest reason the product asks you to come back.
  // Only compare like with like: a scan scored under an older rubric measured
  // different things, so its number is not a baseline for this one.
  const prior = history.find((h) => h && typeof h.overall_score === 'number' &&
    ((h.scores && h.scores.rubric) || 1) === RUBRIC);
  if (prior) {
    const current = baseOverall(scores);
    const delta = current - prior.overall_score;
    // +/-10 points maps onto the full 0-100 band, centred at 50 for "holding".
    scores.momentum = Math.max(0, Math.min(100, Math.round(50 + delta * 5)));
  } else {
    scores.momentum = null;
  }

  // How many overall points each fix is worth: its share of its dimension,
  // divided across the four dimensions that make up the headline number.
  const measured = ['visibility', 'clarity', 'structure', 'authority'].filter((d) => typeof scores[d] === 'number');
  for (const f of findings) {
    const possible = POSSIBLE[f.dimension] || 1;
    f.points = Math.max(1, Math.round((f.weight / possible) * 100 / (measured.length || 4)));
  }
  // A page that tells search engines not to list it is invisible, however
  // well built. Say so in the number: cap it, and credit the fix with the
  // points it really unlocks.
  let overall = baseOverall(scores);
  const hidden = findings.find((f) => f.id === 'indexable');
  if (hidden) {
    scores.blocked = 'noindex'; scores.visibility = 0;
    if (overall > 20) { hidden.points += overall - 20; overall = 20; }
  }
  // Rounded per-fix points must not promise more than 100.
  const room = 100 - (overall || 0);
  const total = findings.reduce((a, f) => a + f.points, 0);
  if (total > room && total > 0) {
    for (const f of findings) if (f !== hidden) f.points = Math.max(1, Math.floor(f.points * room / total));
  }
  findings.sort((a, b) => b.points - a.points || b.weight - a.weight);
  scores.rubric = RUBRIC;

  return {
    overall,
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
    impact: Math.min(5, Math.max(1, Math.round((f.points || f.weight) / 3))),
    effort: f.guide && f.guide.minutes ? Math.min(5, Math.max(1, Math.round(f.guide.minutes / 10))) : (f.weight >= 5 ? 3 : 2),
    status: 'open',
  }));
}

module.exports = { score, scoreDimension, actionsFrom, CHECKS, DIMENSIONS, RUBRIC };
