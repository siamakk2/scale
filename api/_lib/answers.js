'use strict';
// "What do ChatGPT and Perplexity actually say?"
//
// The scan measures whether a site is READABLE by AI. This measures the
// outcome: we ask the assistants the questions a customer would ask, and
// record whether the business is named, who is named instead, and which
// websites the answers were built from. That last list is the most useful
// part: it is where the business needs to be listed.
//
// What leaves our server: the questions below, which contain the business's
// public name, website address, town and type of work. Nothing else.
//
// Model output is not deterministic, so this is reported as evidence, never
// folded into the score (which must stay reproducible -- see signals.js).

const TIMEOUT_MS = 45000;

// ------------------------------------------------------------- questions --
const NOUN = {
  legal: (svc) => (/family|divorce|custody|support|adoption/i.test(svc) ? 'family law attorneys' : `${svc} lawyers`),
  tree: () => 'tree service companies',
  home: (svc) => `${svc} companies`,
  medical: (svc) => `${svc} providers`,
  food: (svc) => (/restaurant|dining|menu/i.test(svc) ? 'restaurants' : `${svc} places`),
  realestate: (svc) => `${svc} brokers`,
  professional: (svc) => `${svc} firms`,
};

function questions(profile, host) {
  const name = profile.name || host;
  const svc = (profile.services || []).filter(Boolean);
  const key = industryKey(profile.industry);
  const city = profile.where ? profile.where.split(',')[0].trim() : null;
  const where = profile.where || null;
  const qs = [];
  if (key === 'retail') {
    const a = svc[0] || (profile.what || 'products like mine').toLowerCase();
    qs.push(`Where is the best place to buy ${a} online? Name specific stores.`);
    if (svc[1]) qs.push(`Which stores would you recommend for ${svc[1]}${where ? ' in or near ' + city : ''}? Name specific businesses.`);
    else if (where) qs.push(`What are the best ${a} stores in ${where}? Name specific businesses.`);
  } else if (svc.length) {
    const noun = (NOUN[key] || ((s) => `${s} businesses`))(svc[0]);
    qs.push(`Who are the best ${noun}${where ? ' in ' + where : ''}? Name specific businesses.`);
    const s2 = svc[1] || svc[0];
    qs.push(`I'm looking for help with ${s2}${city ? ' near ' + city : ''}. Which ${key === 'legal' ? 'firms' : 'companies'} would you recommend?`);
  } else if (profile.what) {
    qs.push(`Can you recommend businesses for ${profile.what.toLowerCase()}? Name specific businesses.`);
  }
  qs.push(`What can you tell me about ${name} (${host})? What do they do, and are they well regarded?`);
  return qs.slice(0, 3);
}
const aOrAn = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
function industryKey(label) {
  const l = String(label || '').toLowerCase();
  if (l.includes('law')) return 'legal';
  if (l.includes('tree')) return 'tree';
  if (l.includes('home')) return 'home';
  if (l.includes('health')) return 'medical';
  if (l.includes('restaurant')) return 'food';
  if (l.includes('real estate')) return 'realestate';
  if (l.includes('store')) return 'retail';
  if (l.includes('professional')) return 'professional';
  return 'general';
}

// ------------------------------------------------------------- engines ----
async function withTimeout(fn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}

// ChatGPT: OpenAI Responses API with the web_search tool, the same search
// ChatGPT uses, located where the business is.
async function askChatGPT(q, profile) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return withTimeout(async (signal) => {
    const tool = { type: 'web_search', search_context_size: 'low' };
    if (profile.where) {
      const [city, region] = profile.where.split(',').map((x) => x.trim());
      tool.user_location = { type: 'approximate', country: 'US', city, ...(region ? { region } : {}) };
    }
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.5', input: q, tools: [tool], tool_choice: 'auto',
        reasoning: { effort: 'low' }, max_output_tokens: 1500 }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 160));
    let text = j.output_text || '';
    const sources = [];
    for (const item of j.output || []) {
      if (item.type !== 'message') continue;
      for (const c of item.content || []) {
        if (c.type === 'output_text') {
          if (!j.output_text) text += c.text;
          for (const a of c.annotations || []) if (a.type === 'url_citation' && a.url) sources.push({ url: a.url, title: a.title || '' });
        }
      }
    }
    return { text, sources };
  });
}

// Perplexity: the Agent API (successor to Sonar, which was retired in 2026),
// with its web_search tool. Responses-style output: the answer text in
// output_text / message items, the pages it read in a search_results item.
function collectUrls(node, out, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) { for (const x of node) collectUrls(x, out, depth + 1); return; }
  if (typeof node === 'object') {
    if (typeof node.url === 'string' && /^https?:/i.test(node.url)) out.push({ url: node.url, title: node.title || '' });
    for (const k of Object.keys(node)) if (k !== 'text') collectUrls(node[k], out, depth + 1);
  }
}
async function askPerplexity(q) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  return withTimeout(async (signal) => {
    const r = await fetch('https://api.perplexity.ai/v1/responses', {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.PERPLEXITY_MODEL || 'perplexity/sonar', input: q,
        tools: [{ type: 'web_search' }], max_output_tokens: 1200 }),
    });
    const j = await r.json();
    if (!r.ok || j.status === 'failed') throw new Error('Perplexity ' + r.status + ': ' + JSON.stringify(j.error || j).slice(0, 200));
    let text = j.output_text || '';
    const sources = [];
    for (const item of j.output || []) {
      if (item.type === 'message') {
        for (const c of item.content || []) if (c.type === 'output_text') { if (!j.output_text) text += c.text; collectUrls(c.annotations, sources); }
      } else if (/search/.test(item.type || '')) collectUrls(item, sources);
    }
    if (!sources.length) collectUrls(j.search_results || j.citations, sources);
    return { text, sources };
  });
}

// ------------------------------------------------------------- analysis ---
// Listings and review sites: being on these is how small businesses get named.
const DIRECTORY = /(^|\.)(yelp|google|maps\.google|angi|angieslist|homeadvisor|thumbtack|bbb|nextdoor|houzz|porch|expertise|threebestrated|bestprosintown|tripadvisor|opentable|doordash|ubereats|grubhub|zocdoc|healthgrades|vitals|webmd|avvo|justia|findlaw|martindale|lawyers|nolo|superlawyers|lawinfo|legalmatch|realtor|zillow|redfin|loopnet|crexi|etsy|amazon|ebay|reddit|facebook|instagram|linkedin|youtube|wikipedia|mapquest|yellowpages|manta|chamberofcommerce|alignable|clutch|upcity|trustpilot|birdeye)\.[a-z.]+$/i;

const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return null; } };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|ltd|co|corp|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

// Business names an answer puts forward. Assistants list recommendations as
// numbered or bulleted items or headings that START with the name, usually in
// bold. Bold text elsewhere ("A+ rating", "2-3 bids") is emphasis, not a name.
const NOT_NAME = /\b(rating|license|licen[cs]ed|bids?|why|pick|picks|shortlist|area|areas|snapshot|step|steps|tips?|summary|overview|note|cost|price|pricing|reviews?|insured|certified|best for|consider|option|options|questions?|call first|what to|how to|top)\b/i;
function cleanName(n) {
  n = String(n).replace(/[*_`#]/g, '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
  n = n.split(/\s[—–-]\s|:\s|\s\(/)[0].trim().replace(/,?\s+(Inc|LLC|L\.L\.C|Ltd|Corp|Co)\.?$/i, (x) => x.replace(',', '')).replace(/[.,;:]+$/, '');
  return n;
}
function isName(n) {
  if (n.length < 3 || n.length > 50) return false;
  if (!/^[A-Z0-9]/.test(n) || /,/.test(n) || NOT_NAME.test(n)) return false;
  const words = n.split(' ');
  if (words.length > 7) return false;
  if ((n.match(/\d/g) || []).length > 3) return false;
  return words.filter((w) => /^[A-Z0-9&]/.test(w)).length >= Math.ceil(words.length / 2);
}
function namesIn(text) {
  const out = [];
  const push = (raw) => { const n = cleanName(raw); if (isName(n) && !out.some((x) => norm(x) === norm(n))) out.push(n); };
  let m;
  // "1. **Name**", "- **Name**", "### Name", "**Name** —" at the start of a line
  const lineStart = /^\s*(?:\d+[.)]\s+|[-•*]\s+|#{2,4}\s+)?(?:\d+[.)]\s+)?\*\*([^*\n]{3,80})\*\*/gm;
  while ((m = lineStart.exec(text))) push(m[1]);
  const heading = /^\s*#{2,4}\s+(?:\d+[.)]\s+)?([^\n*]{3,60})$/gm;
  while ((m = heading.exec(text))) push(m[1]);
  const plainItem = /^\s*(?:\d+[.)]|[-•])\s+([A-Z][^:\n–—(*]{2,60})(?=\s[—–-]\s|:|\s\()/gm;
  while ((m = plainItem.exec(text))) push(m[1]);
  return out.slice(0, 10);
}

function analyse(res, profile, host) {
  const base = host.replace(/^www\./, '').toLowerCase();
  const stem = base.split('.')[0];
  const nm = norm(profile.name);
  const t = norm(res.text);
  const mentioned = (nm.length > 3 && t.includes(nm)) || t.includes(stem) || res.text.toLowerCase().includes(base);
  const sources = [];
  for (const s of res.sources) {
    const d = domainOf(s.url);
    if (d && !sources.some((x) => x.url === s.url)) sources.push({ url: s.url, title: (s.title || '').slice(0, 120), domain: d });
  }
  const cited = sources.some((s) => s.domain === base || s.domain.endsWith('.' + base));
  const names = namesIn(res.text);
  const idx = names.findIndex((n) => norm(n).includes(nm) || nm.includes(norm(n)) || norm(n).includes(stem));
  return {
    mentioned: mentioned || cited, cited, rank: idx >= 0 ? idx + 1 : null,
    named: names.filter((n, i) => i !== idx).slice(0, 8),
    sources: sources.slice(0, 12),
    text: res.text.slice(0, 4000),
  };
}

// ------------------------------------------------------------- run --------
function configured() { return !!(process.env.OPENAI_API_KEY || process.env.PERPLEXITY_API_KEY); }

async function runAnswers(profile, host) {
  const qs = questions(profile, host);
  const engines = [['chatgpt', 'ChatGPT', (q) => askChatGPT(q, profile)], ['perplexity', 'Perplexity', (q) => askPerplexity(q)]];
  const jobs = [];
  qs.forEach((q, qi) => engines.forEach(([id, label, ask]) => jobs.push((async () => {
    try {
      const r = await ask(q);
      if (!r) return null;
      return { q: qi, engine: id, label, ...analyse(r, profile, host) };
    } catch (e) {
      console.error(JSON.stringify({ source: 'answers', engine: id, error: e.message }));
      return { q: qi, engine: id, label, error: e.name === 'AbortError' ? 'timed out' : 'unavailable' };
    }
  })())));
  const results = (await Promise.all(jobs)).filter(Boolean);

  // Summary: how often named where it counts (the recommendation questions),
  // whether the assistants know the business by name, who is named instead,
  // and which websites the answers lean on.
  const brandQ = qs.length - 1;
  const disc = results.filter((r) => r.q !== brandQ && !r.error);
  // Asked about the business by name, an assistant repeats the name even when
  // it knows nothing. "Known" means it cited the site or said something real.
  const NEG = /(couldn'?t|could not|unable to|wasn'?t able to|was not able to|not able to|did not|didn'?t) find|no (specific |detailed |reliable |publicly available )?information|limited (public )?information|not (widely )?(known|documented)|no (reviews|results)|i don'?t have (any |specific )?(information|details)/i;
  for (const r of results) if (r.q === brandQ && !r.error) r.known = r.cited || (r.mentioned && !NEG.test(r.text));
  const brand = results.filter((r) => r.q === brandQ && !r.error);
  const tally = (arr) => { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const rivals = tally(disc.flatMap((r) => r.named.map((n) => n.replace(/\s+/g, ' ')))).slice(0, 8).map(([n, c]) => ({ name: n, count: c }));
  const own = host.replace(/^www\./, '');
  const doms = tally(results.filter((r) => !r.error).flatMap((r) => Array.from(new Set(r.sources.map((s) => s.domain)))))
    .filter(([d]) => d !== own && !d.endsWith('.' + own)).slice(0, 12)
    .map(([d, c]) => ({ domain: d, count: c, listing: DIRECTORY.test(d) }));
  return {
    at: new Date().toISOString(),
    questions: qs,
    results,
    summary: {
      named: disc.filter((r) => r.mentioned).length, asked: disc.length,
      known: brand.filter((r) => r.known).length, brandAsked: brand.length,
      rivals, sources: doms,
      engines: Array.from(new Set(results.filter((r) => !r.error).map((r) => r.label))),
    },
  };
}

module.exports = { runAnswers, questions, configured, analyse, namesIn };
