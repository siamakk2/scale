'use strict';
// The playbook: turns a failed check into a lesson the owner can act on.
//
// A finding on its own ("Has a meta description") is a note. What a business
// owner needs is: what exactly did you find on MY site, why should I care,
// where do I click on MY platform, and what do I type. Every guide here
// answers those four, using the evidence the scan collected, and writes the
// text or code for them wherever it can be written without guessing.
//
// Deterministic like the rest of the engine: same page in, same lesson out.

const NAMES = {
  shopify: 'Shopify', wix: 'Wix', squarespace: 'Squarespace', wordpress: 'WordPress',
  webflow: 'Webflow', godaddy: 'GoDaddy', custom: 'your website',
};

// ------------------------------------------------------------- helpers ----
const clip = (s, n) => {
  s = String(s || '').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return cut.slice(0, at > n * 0.6 ? at : n).replace(/[,.;:\s]+$/, '') + (at > n * 0.6 && cut[at] === '.' ? '.' : '');
};
const FILLER = /^(welcome to [^,.!]+[,.!]?\s*|your one[- ]stop shop for\s*|we are\s+|we're\s+|the best\s+|home\s*[|–—-]\s*)/i;

// Best guess at "what this business does", in its own words.
function whatYouDo(s) {
  const brand = String(s.siteName || '').toLowerCase();
  const cands = []
    .concat(s.headings.h1, s.headings.h2.slice(0, 3))
    .map((t) => String(t || '').replace(FILLER, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.toLowerCase() !== brand && t.split(/\s+/).length >= 3 && t.split(/\s+/).length <= 12 &&
      !/^(featured|shop|new|best sellers?|sign up|subscribe|contact|about|menu|cart|search|follow)/i.test(t));
  if (cands.length) return cands[0].replace(/[.!]+$/, '');
  const d = (s.org && s.org.description) || s.metaDescription;
  if (d) return clip(d.replace(FILLER, '').split(/(?<=[.!?])\s/)[0], 60).replace(/[.!]+$/, '');
  return null;
}
const place = (s) => (s.org && s.org.city ? s.org.city + (s.org.region ? ', ' + s.org.region : '') : null);

function suggestTitle(s) {
  const what = whatYouDo(s);
  const brand = s.siteName || 'Your Business';
  if (!what) return `${brand} | [What you sell] in [City]`;
  const loc = place(s);
  let t = `${what}${loc && !what.includes(s.org.city) ? ' in ' + loc : ''} | ${brand}`;
  if (t.length > 62) t = `${clip(what, 60 - brand.length - 3)} | ${brand}`;
  return t;
}

const TAIL = /[\s,;:–—-]+(and|or|the|of|for|with|to|a|an|in|on|our|your)?[\s,;:–—-]*$/i;
function capFirst(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
function suggestDescription(s) {
  const src = ((s.org && s.org.description) || s.metaDescription || '').replace(/^welcome to\s+/i, '').replace(/\s+/g, ' ').trim();
  if (src.length >= 70) {
    const sents = src.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [src];
    let out = '';
    for (const x of sents) { if ((out + x).trim().length <= 158) out = (out + x); else break; }
    out = out.trim();
    if (out.length < 90 && sents.length > out.split(/[.!?]/).length - 1) {
      const next = sents[(out.match(/[.!?]/g) || []).length] || '';
      const room = 155 - out.length - 1;
      if (room > 40 && next) out = (out + ' ' + clip(next.trim(), room).replace(TAIL, '') + '.').trim();
    }
    if (!out) out = clip(src, 155).replace(TAIL, '') + '.';
    return capFirst(out.replace(/\.\.$/, '.'));
  }
  const what = whatYouDo(s) || '[what you sell or do]';
  return clip(`${s.siteName || 'We'} offers ${what.charAt(0).toLowerCase() + what.slice(1)}` +
    `${place(s) ? ' in ' + place(s) : ''}. [One line on why customers choose you]. [Call to action, e.g. Shop online or Call for a quote].`, 160);
}

function originOf(ctx) { try { return new URL(ctx.url).origin; } catch (e) { return 'https://' + (ctx.host || 'yourwebsite.com'); } }

function orgJson(s, ctx, { forWix } = {}) {
  const local = !!(s.contact && (s.contact.tel || s.contact.phoneText)) || !!(s.org && s.org.address);
  const sameAs = Object.values(s.social || {});
  const node = {
    '@context': 'https://schema.org',
    '@type': (s.org && s.org.type && s.org.type !== 'Organization') ? s.org.type : (local ? 'LocalBusiness' : 'Organization'),
    name: s.siteName || '[Business name]',
    url: originOf(ctx) + '/',
    description: suggestDescription(s),
  };
  if (s.org && s.org.logoUrl) node.logo = s.org.logoUrl; else node.logo = originOf(ctx) + '/[path-to-your-logo].png';
  node.telephone = (s.org && s.org.telephone) || '[+1-555-555-5555]';
  if (s.org && s.org.email) node.email = s.org.email;
  node.address = {
    '@type': 'PostalAddress',
    streetAddress: (s.org && s.org.street) || '[Street address]',
    addressLocality: (s.org && s.org.city) || '[City]',
    addressRegion: (s.org && s.org.region) || '[State]',
    postalCode: (s.org && s.org.postal) || '[ZIP]',
    addressCountry: 'US',
  };
  const what = whatYouDo(s);
  node.knowsAbout = what ? [what, '[Second topic you are known for]', '[Third topic]'] : ['[Topic 1]', '[Topic 2]', '[Topic 3]'];
  node.sameAs = sameAs.length ? sameAs.concat(sameAs.length < 3 ? ['[Your Google Business Profile link]'] : [])
    : ['[Your Facebook page]', '[Your Instagram or LinkedIn]', '[Your Google Business Profile link]'];
  const json = JSON.stringify(node, null, 2);
  return forWix ? json : `<script type="application/ld+json">\n${json}\n</script>`;
}

function faqJson(s, forWix) {
  const name = s.siteName || 'we';
  const what = whatYouDo(s);
  const qa = [
    [`What does ${name} do?`, suggestDescription(s)],
    [`Where is ${name} located, and what areas do you serve?`, place(s) ? `We are based in ${place(s)}. [Add the areas you serve or say if you ship nationwide.]` : '[Your city, and the areas you serve or ship to.]'],
    [`How do I ${what && /shop|store|fabric|product|buy|sell/i.test(what + s.platform) ? 'place an order' : 'get started or get a quote'}?`, '[Explain the first step in one or two sentences, with your phone number or a link.]'],
  ];
  const node = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
  const json = JSON.stringify(node, null, 2);
  return forWix ? json : `<script type="application/ld+json">\n${json}\n</script>`;
}

// Where code that belongs in the page <head> goes, on each platform.
const HEAD = {
  shopify: ['In Shopify admin open Online Store → Themes.', 'On your live theme click the ⋯ button → Edit code.',
    'Open layout/theme.liquid and paste the code on the line just above </head>.', 'Click Save.'],
  wix: ['Open your Wix dashboard → Settings → Custom Code (under Advanced).', 'Click + Add Custom Code and paste the code.',
    'Choose "All pages", set "Place code in" to Head, and click Apply.'],
  squarespace: ['Open Settings → Developer Tools → Code Injection.', 'Paste the code into the Header box and click Save.',
    '(Code Injection needs a Core, Plus or Business plan.)'],
  wordpress: ['Go to Plugins → Add New, search for "WPCode" and install it (free).', 'Open Code Snippets → Header & Footer.',
    'Paste the code into the Header box and click Save Changes.'],
  webflow: ['Open Site settings → Custom code.', 'Paste the code into "Head code" and click Save.', 'Publish the site.'],
  godaddy: ['In Website Builder open Settings → Site-wide code (available on most plans).', 'Paste the code and publish.',
    'No such setting on your plan? Send this card to us and we will add it.'],
  custom: ['Send this card to whoever manages your website.', 'They paste the code inside the <head> of the home page and publish.'],
};
const SCHEMA_WIX = ['In the Wix Editor open Pages & Menu, hover Home → ⋯ → SEO basics.', 'Go to the Advanced SEO tab → Structured data markup → + Add New Markup.',
  'Paste the code (it is already in the format Wix wants) and click Apply. Publish.'];

const TITLE_EDIT = {
  shopify: ['In Shopify admin open Online Store → Preferences.', 'Edit "Homepage title" and "Homepage meta description".', 'Click Save.'],
  wix: ['In the Wix Editor open Pages & Menu, hover Home → ⋯ → SEO basics.', 'Edit "Title tag" and "Meta description".', 'Publish.'],
  squarespace: ['Open Pages, hover your home page and click the ⚙ gear.', 'Open the SEO tab and edit "SEO Title" and "SEO Description".', 'Click Save.'],
  wordpress: ['Edit your home page (Pages → Home).', 'Scroll to the Yoast SEO or Rank Math box under the editor and edit "SEO title" and "Meta description".',
    'No SEO box? Install the free Yoast SEO plugin first (Plugins → Add New).', 'Click Update.'],
  webflow: ['In the Pages panel hover Home → ⚙ Page settings.', 'Under SEO Settings edit Title Tag and Meta Description.', 'Save, then Publish.'],
  godaddy: ['In Website Builder open Settings → SEO (or your home page settings → SEO).', 'Edit the title and description.', 'Publish.'],
  custom: ['Send this card to whoever manages your website.', 'They update the <title> and <meta name="description"> tags in the home page head.'],
};

const ALT = {
  shopify: ['Products: open a product, click each image → "Add alt text", describe it, Save.',
    'Banners and theme images: Online Store → Themes → Customize, click the image → Edit, fill in the alt text.'],
  wix: ['In the Editor click an image → ⚙ Settings.', 'Fill "What\'s in the image? Tell Google", e.g. "Red stretch sequin fabric on a dress form".', 'Repeat for each image, then Publish.'],
  squarespace: ['Click the image block → ✎ Edit.', 'Fill in the Image alt text (or description) field.', 'Save.'],
  wordpress: ['Go to Media → Library and click an image.', 'Fill in "Alternative Text" and close.', 'Do this for the images on your home page first.'],
  webflow: ['Open the Assets panel, click ⚙ on an image, fill in Alt text.', 'Publish.'],
  godaddy: ['Click the image in the editor → image settings → Alt text.', 'Publish.'],
  custom: ['Every <img> tag needs an alt="…" description of what the picture shows.'],
};

const ROBOTS = {
  shopify: ['Shopify allows AI crawlers by default, so something was added.', 'Check Online Store → Themes → ⋯ → Edit code → Templates → robots.txt.liquid and delete the lines that block these bots.',
    'Using Cloudflare? Open Security → Bots and turn OFF "Block AI Scrapers and Crawlers".'],
  wix: ['Open Marketing & SEO → SEO → SEO Settings → Robots.txt Editor.', 'Delete the lines that block these bots and Save.'],
  squarespace: ['Open Settings → Crawlers.', 'Turn OFF "Block known artificial intelligence crawlers". Save.'],
  wordpress: ['Open Yoast SEO → Tools → File editor (or Rank Math → General Settings → Edit robots.txt).', 'Delete the lines that block these bots and Save.',
    'Still blocked? A security plugin or Cloudflare ("Block AI bots") may be adding them.'],
  webflow: ['Open Site settings → SEO → robots.txt.', 'Delete the lines that block these bots. Save and Publish.'],
  godaddy: ['GoDaddy manages robots.txt for you. Ask their support to allow these bots, or send this card to us.'],
  custom: ['Edit the robots.txt file at the root of your site and remove the Disallow lines for these bots.'],
};

const SITEMAP = {
  shopify: ['Shopify creates /sitemap.xml automatically. If it is missing, your store may still be password-protected: Online Store → Preferences → Password protection.'],
  wix: ['Wix creates a sitemap automatically once the site is published on your own domain.', 'Open Marketing & SEO → SEO and run the "Get found on Google" setup checklist.'],
  squarespace: ['Squarespace creates /sitemap.xml automatically for published sites. Make sure the site is not set to private (Settings → Site availability).'],
  wordpress: ['Yoast SEO: SEO → Settings → Site features → turn on XML sitemaps.', 'Rank Math: Dashboard → Modules → turn on Sitemap.'],
  webflow: ['Site settings → SEO → turn on "Auto-generate Sitemap". Publish.'],
  godaddy: ['GoDaddy Website Builder publishes a sitemap automatically. Check that the site is published.'],
  custom: ['Generate a sitemap.xml listing every page and place it at the root of your site.'],
};
const SUBMIT = 'Then submit the sitemap address in Google Search Console and Bing Webmaster Tools (both free), so they re-read your site sooner.';

const H1 = {
  shopify: (s) => s.h1Logo
    ? ['Your theme wraps the logo in a main heading, so the main heading says your name instead of what you sell.',
       'Online Store → Themes → ⋯ → Edit code → sections/header.liquid. Search for "<h1" around the logo and change h1 to div on both the opening and closing tags. Save.',
       'Then in Customize, make your first banner headline the one sentence below. Not comfortable editing code? Tap "Have Siamak do it".']
    : ['Online Store → Themes → Customize. Click the main banner or text section at the top.', 'Use the sentence below as its heading, and make other section headings smaller.'],
  wix: () => ['In the Editor click your main headline → Edit Text.', 'Set the style to "Heading 1". Make every other heading Heading 2 or smaller.', 'Publish.'],
  squarespace: () => ['Edit the top text block and select the headline.', 'Choose "Heading 1" from the format menu; change any other Heading 1 on the page to Heading 2.', 'Save.'],
  wordpress: () => ['Edit the home page and click the main headline (Heading block) → set the level to H1.', 'Change other H1 headings to H2.', 'Some themes also show the site name as H1: check Appearance → Customize → Site identity.'],
  webflow: () => ['Select the main headline and set its tag to H1 in the Settings panel.', 'Set other headings to H2. Publish.'],
  godaddy: () => ['Click the main headline, open text style and choose "Heading 1". Make other headings smaller.', 'Publish.'],
  custom: () => ['The page should have exactly one <h1> containing a sentence about what you do. Send this card to your developer.'],
};

const SHARE = {
  shopify: ['Online Store → Preferences → Social sharing image: upload a 1200×630 image.', 'Save.'],
  wix: ['Pages & Menu → Home → ⋯ → Social share. Upload an image and check the title.', 'Publish.'],
  squarespace: ['Pages → home page ⚙ → Social Image: upload one. Also set a site-wide one in Marketing → SEO → Social sharing.'],
  wordpress: ['Edit the home page → Yoast SEO box → Social tab: set the title and upload a 1200×630 image.', 'Update.'],
  webflow: ['Page settings → Open Graph Settings: title and image. Publish.'],
  godaddy: ['Settings → Social media share image. Publish.'],
  custom: ['Add <meta property="og:title"> and <meta property="og:image"> to the home page head.'],
};

const NOINDEX = {
  shopify: ['Online Store → Preferences → Password protection: turn it off when you are ready to be found.', 'Check for SEO apps that set "noindex" on the home page.'],
  wix: ['Pages & Menu → Home → ⋯ → SEO basics → turn ON "Let search engines index this page". Publish.'],
  squarespace: ['Home page ⚙ → SEO → turn OFF "Hide page from search results". Also check Settings → Site availability.'],
  wordpress: ['Settings → Reading: UNtick "Discourage search engines from indexing this site". Save.', 'In the Yoast/Rank Math box on the home page, set "Allow search engines" to Yes.'],
  webflow: ['Site settings → SEO: turn off "Disable Webflow subdomain indexing" only affects the .webflow.io address; check page settings for a noindex tag.'],
  godaddy: ['Settings → SEO: make sure the site is visible to search engines.'],
  custom: ['Remove <meta name="robots" content="noindex"> from the home page.'],
};

const LLMS_HOST = {
  shopify: ['Shopify publishes an llms.txt for some stores automatically; yours is missing, so this is optional.', 'Easiest: ask us to add it as a page redirect, or skip this one. It is worth only 1 point.'],
  wix: ['Wix does not let you upload files to your site root yet, so skip this one for now. It is worth only 1 point.'],
  squarespace: ['Squarespace does not let you upload files to your site root, so skip this one for now. It is worth only 1 point.'],
  wordpress: ['Install the free "Website LLMs.txt" plugin, or upload the file below as llms.txt to your site root using your host\'s File Manager.'],
  webflow: ['Webflow cannot host root files directly; skip for now (1 point) or ask us to set up a redirect.'],
  godaddy: ['Not supported on Website Builder; skip this one. It is worth only 1 point.'],
  custom: ['Save the text below as llms.txt at the root of your site, so it opens at /llms.txt.'],
};

function llmsTxt(s, ctx) {
  const o = originOf(ctx);
  return `# ${s.siteName || '[Business name]'}\n\n> ${suggestDescription(s)}\n\n` +
    `## Key pages\n- [Home](${o}/): ${whatYouDo(s) || '[what you do]'}\n- [About](${o}/about): [who you are]\n` +
    `- [Contact](${o}/contact): [how to reach you]\n\n## Contact\n- Phone: ${(s.org && s.org.telephone) || '[phone]'}\n- Website: ${o}\n`;
}

// ------------------------------------------------------------- guides -----
// Each returns { found, why, steps, paste, minutes }.
const G = {
  'indexable': (s, p) => ({
    found: `Your home page tells search engines not to list it (robots: "${s.robots}").`,
    why: 'This one switch hides you from Google, Bing and the AI assistants that read them. Nothing else on this list matters until it is off.',
    steps: NOINDEX[p], minutes: 5 }),

  'title-present': (s, p) => ({
    found: s.title ? `Your page title is only "${s.title}".` : 'Your home page has no title at all.',
    why: 'The title is the first line people see in Google and the first fact an AI reads about you.',
    steps: TITLE_EDIT[p], paste: { label: 'Suggested title', code: suggestTitle(s) }, minutes: 5 }),

  'title-length': (s, p) => ({
    found: `Your title is ${s.title.length} characters: "${s.title}". Google cuts it off around 60.`,
    why: 'The end of a long title is replaced by "…", so the part that says what you do is often the part nobody sees.',
    steps: TITLE_EDIT[p], paste: { label: 'Shorter title', code: suggestTitle(s) }, minutes: 5 }),

  'title-describes': (s, p) => ({
    found: `Your page title is "${s.title}". It names you but never says what you sell or do.`,
    why: 'People search for what they need, not for your name. When someone asks an AI for a business like yours, it looks for pages whose title matches the need.',
    steps: TITLE_EDIT[p], paste: { label: 'Suggested title (edit freely)', code: suggestTitle(s) }, minutes: 5 }),

  'meta-description': (s, p) => ({
    found: s.metaDescription ? `Your summary is only ${s.metaDescription.length} characters: "${s.metaDescription}".` : 'Your home page has no meta description (the summary under your name in search results).',
    why: 'Without one, Google and AI tools grab random text from your page, often a menu or a cookie notice, as the description of your business.',
    steps: TITLE_EDIT[p], paste: { label: 'Suggested description', code: suggestDescription(s) }, minutes: 5 }),

  'meta-description-length': (s, p) => ({
    found: `Your summary is ${s.metaDescription.length} characters. Everything after about 160 is cut off: "…${s.metaDescription.slice(150, 200)}…".`,
    why: 'The last part of a long description never gets shown, and an opening like "Welcome to" spends your best words on nothing.',
    steps: TITLE_EDIT[p], paste: { label: `Tighter version (${suggestDescription(s).length} characters)`, code: suggestDescription(s) }, minutes: 5 }),

  'canonical': (s, p) => ({
    found: 'Your home page does not declare its one official address.',
    why: 'Your site is reachable at several addresses (with and without www, with tracking codes). Without a canonical tag, credit for the page is split between them.',
    steps: ['shopify', 'wix', 'squarespace', 'wordpress'].includes(p)
      ? [`${NAMES[p]} normally adds this automatically, so your theme or an app has removed it.`, 'Easiest fix: tap "Have Siamak do it" and we will restore it.']
      : HEAD[p],
    paste: { label: 'Code', code: `<link rel="canonical" href="${originOf({ url: s.__url })}/">` }, minutes: 10 }),

  'content-in-html': (s, p) => ({
    found: `We could read only ${s.wordCount} words of text on your home page. AI tools need around 300 to understand a business.`,
    why: 'AI assistants recommend businesses they can describe. A page that is mostly pictures, sliders and buttons gives them nothing to quote.',
    steps: ['Add a section of real text to your home page using the outline below.', 'Write the way you would explain your business to a new customer on the phone.',
      `On ${NAMES[p]}, add a Text section/block and paste the outline in, then replace the brackets.`],
    paste: { label: 'Outline to fill in', code: `About ${s.siteName || 'us'}\n${suggestDescription(s)}\n\nWhat we offer\n[3–5 sentences on your main products or services]\n\nWho we work with\n[The customers you serve best]\n\nWhy choose ${s.siteName || 'us'}\n[Years in business, guarantees, what makes you different]\n\nWhere we are\n[City, service area, or "we ship nationwide"]` },
    minutes: 30 }),

  'content-density': (s, p) => ({
    found: `Only ${(s.textToHtmlRatio * 100).toFixed(1)}% of your home page is readable text; the rest is code.`,
    why: 'When text is buried under heavy code or built by scripts after the page loads, many AI crawlers see a nearly empty page.',
    steps: ['Add plain text sections (not text inside images or sliders).', 'Remove apps or widgets you no longer use; each one adds code.',
      p === 'custom' ? 'Ask your developer whether the page content is rendered on the server.' : `On ${NAMES[p]}, prefer the standard Text block over image-with-text designs.`],
    minutes: 30 }),

  'single-h1': (s, p) => ({
    found: s.h1Count === 0 ? 'Your home page has no main heading (H1).'
      : `Your home page has ${s.h1Count} main headings: ${s.headings.h1.slice(0, 3).map((h) => `"${clip(h, 60)}"`).join(', ')}.`,
    why: 'The main heading is how search engines and AI decide what a page is about. Two of them split that signal; none leaves it blank.',
    steps: (H1[p] || H1.custom)(s), paste: { label: 'Use this as your one main heading', code: whatYouDo(s) || `[What you do] in [City]` }, minutes: 15 }),

  'h1-substantive': (s, p) => ({
    found: `Your main heading is "${s.headings.h1[0] || ''}", which doesn't say what you do.`,
    why: 'A slogan is lovely for people who already know you. Strangers, and AI, need the heading to state the business plainly.',
    steps: (H1[p] || H1.custom)(s), paste: { label: 'Suggested main heading', code: whatYouDo(s) || '[What you do] in [City]' }, minutes: 10 }),

  'heading-structure': (s, p) => ({
    found: `Your home page has ${s.headings.h2.length} section heading${s.headings.h2.length === 1 ? '' : 's'}.`,
    why: 'AI answers quote sections, not whole pages. Clear section headings are what make a paragraph quotable.',
    steps: [`Add section headings (Heading 2) to your home page on ${NAMES[p]}, one per topic.`, 'Use the headings below as a starting point, each followed by a short paragraph.'],
    paste: { label: 'Section headings to add', code: `What we do\nWho we help\nWhy customers choose ${s.siteName || 'us'}\nWhere we work\nQuestions customers ask` }, minutes: 20 }),

  'stated-role': (s, p) => schemaGuide(s, p, 'Nothing on your site tells AI systems, in their own language, what kind of business you are.'),
  'schema-present': (s, p) => schemaGuide(s, p, 'Your home page has no structured data (the code AI systems read to identify a business).'),
  'entity-declared': (s, p) => schemaGuide(s, p, `Your structured data describes ${s.schema.types.slice(0, 3).join(', ') || 'the page'}, but never the business itself.`),
  'schema-valid': (s, p) => ({
    found: `${s.schema.invalid} of your ${s.schema.blocks} structured-data blocks are broken and get ignored.`,
    why: 'A broken block is worse than none: you think it is working, and every crawler silently throws it away.',
    steps: ['Paste your home page address into validator.schema.org to see the exact error.', 'Usually it is a missing comma or quote in code an app or developer added. Remove or fix that block.',
      'Then use the clean block below in its place.'].concat(p === 'wix' ? SCHEMA_WIX : HEAD[p]),
    paste: { label: 'Clean replacement', code: orgJson(s, { url: s.__url }, { forWix: p === 'wix' }) }, minutes: 20 }),

  'knows-about': (s, p) => schemaGuide(s, p, 'Your business data does not list the topics you are expert in.',
    'knowsAbout is how an AI connects you with a subject ("stretch fabric", "commercial leasing") rather than only with your name.'),

  'same-as': (s, p) => schemaGuide(s, p,
    Object.keys(s.social || {}).length
      ? `Your page links to ${Object.keys(s.social).join(', ')}, but your business data does not claim those profiles as yours.`
      : 'Your business data does not link to any of your profiles (Google, Facebook, LinkedIn, Yelp…).',
    'AI systems trust a business more when they can confirm it is the same one listed on Google, Yelp and social media. "sameAs" is that confirmation.'),

  'faq-schema': (s, p) => ({
    found: 'Your home page has no question-and-answer section.',
    why: 'People ask AI questions. Pages that already contain the question and a clear answer are the ones that get quoted.',
    steps: ['Add an FAQ section to your home page with the three questions below, written for your customers.',
      p === 'wix' ? 'Wix: add an FAQ element (Add → Interactive → FAQ) or a text section.' : `${NAMES[p]}: add a text or FAQ/accordion section.`,
      'Then add the code below so AI tools read it as Q&A:'].concat(p === 'wix' ? SCHEMA_WIX : HEAD[p]),
    paste: { label: 'FAQ code (edit the answers to match what your page says)', code: faqJson(s, p === 'wix') }, minutes: 25 }),

  'image-alt': (s, p) => ({
    found: `${s.images.missingAlt} of ${s.images.total} images on your home page have no description (alt text).`,
    why: 'AI and Google cannot see pictures; they read the description. Without one, your product photos are blank spaces to them.',
    steps: ALT[p], paste: { label: 'How to write a good one', code: 'Say what is in the picture and why it matters, in under 125 characters.\nGood: "Black 4-way stretch spandex fabric, 60 inches wide"\nPoor: "IMG_0412" or "fabric"' }, minutes: 20 }),

  'cites-out': (s, p) => ({
    found: `Your home page links to ${s.links.external} outside website${s.links.external === 1 ? '' : 's'}.`,
    why: 'Linking to the associations you belong to, reviews about you and the places you are listed connects you to them in the eyes of AI.',
    steps: ['Add a "Find us on" or "As featured in" line to your footer.', 'Link your Google Business Profile, Yelp, industry associations, and press mentions.'], minutes: 15 }),

  'citations-followable': (s, p) => ({
    found: 'Every outside link on your page is marked "nofollow".',
    why: 'Nofollow tells crawlers you do not stand behind the link, which cuts the very connection you are trying to make.',
    steps: ['Remove rel="nofollow" from links to your own profiles and partners (keep it for ads and sponsored links).', 'Often an SEO app adds it to every link: check its settings.'], minutes: 15 }),

  'internal-linking': (s, p) => ({
    found: `Your home page links to only ${s.links.internal} of your own pages.`,
    why: 'Links between your pages are how crawlers find everything you offer. Pages nothing links to are often never read.',
    steps: ['Link your main products/services, About, and Contact pages from the home page text, not just the menu.', 'Add a footer with links to your key pages.'], minutes: 15 }),

  'og-title-agrees': (s, p) => ({
    found: `Your share title says "${s.ogTitle}" but your page title says "${s.title}".`,
    why: 'Two different names for the same page is a contradiction you are publishing about yourself.',
    steps: SHARE[p], paste: { label: 'Use the same title in both places', code: suggestTitle(s) }, minutes: 5 }),

  'share-image': (s, p) => ({
    found: 'Your home page has no share image.',
    why: 'When someone texts or posts your link, a blank grey box gets far fewer clicks than a picture of your business.',
    steps: SHARE[p], minutes: 10 }),

  'ai-crawlers': (s, p) => ({
    found: `Your robots.txt file blocks ${s.aiBlocked.join(', ')}.`,
    why: 'These are the crawlers behind ChatGPT, Claude, Perplexity and Google\'s AI answers. Blocked, they cannot read your site, so they cannot recommend you.',
    steps: ROBOTS[p], paste: { label: 'Lines to have in robots.txt', code: s.aiBlocked.map((b) => `User-agent: ${b}\nAllow: /`).join('\n\n') }, minutes: 10 }),

  'sitemap': (s, p) => ({
    found: 'We could not find a sitemap at /sitemap.xml or listed in your robots.txt.',
    why: 'A sitemap is the list of your pages you hand to search engines. Without it, pages deep in your site can go unnoticed for months.',
    steps: (SITEMAP[p] || SITEMAP.custom).concat([SUBMIT]), minutes: 10 }),

  'llms-txt': (s, p) => ({
    found: 'Your site has no /llms.txt file.',
    why: 'llms.txt is a new, plain-text introduction written for AI systems. It is optional, but few businesses have one yet, which makes it an easy edge.',
    steps: LLMS_HOST[p], paste: ['wix', 'squarespace', 'godaddy'].includes(p) ? null : { label: 'Your llms.txt (fill in the brackets)', code: llmsTxt(s, { url: s.__url }) }, minutes: 15 }),

  'contact-visible': (s, p) => ({
    found: 'We could not find a phone number or email address on your home page.',
    why: 'A business you cannot reach looks like a business that may not exist. Visible contact details are a basic trust signal for people and AI alike.',
    steps: [`Add your phone number and email to the header or footer on ${NAMES[p]}.`, 'Make the phone number a tap-to-call link and the email a tap-to-email link.'],
    paste: { label: 'Code (for custom sites)', code: '<a href="tel:+15555555555">(555) 555-5555</a> · <a href="mailto:hello@yourbusiness.com">hello@yourbusiness.com</a>' }, minutes: 10 }),
};

const EXISTING_WHERE = {
  shopify: 'On Shopify this usually lives in your theme (Online Store → Themes → ⋯ → Edit code, search for "ld+json") or in an SEO app\'s settings.',
  wix: 'On Wix: Pages & Menu → Home → ⋯ → SEO basics → Advanced SEO → Structured data markup → edit the existing markup.',
  squarespace: 'On Squarespace: Settings → Developer Tools → Code Injection → Header, if it was added there.',
  wordpress: 'On WordPress it usually comes from Yoast or Rank Math (their Schema settings) or a header plugin like WPCode.',
  webflow: 'On Webflow: Site settings → Custom code → Head code, or the page\'s custom code.',
  godaddy: 'On GoDaddy: Settings → Site-wide code.',
  custom: 'Ask your developer where the existing "application/ld+json" block lives.',
};
function addLines(s, p, found, why) {
  const lines = {};
  const what = whatYouDo(s);
  if (!(s.schema.knowsAbout >= 3 || s.schema.knowsAboutOrg))
    lines.knowsAbout = what ? [what, '[Second topic you are known for]', '[Third topic]'] : ['[Topic 1]', '[Topic 2]', '[Topic 3]'];
  if (s.schema.sameAs < 3) {
    const prof = Object.values(s.social || {});
    lines.sameAs = prof.length ? prof : ['[Your Google Business Profile link]', '[Your Facebook page]', '[Your LinkedIn or Instagram]'];
  }
  const code = JSON.stringify(lines, null, 2).replace(/^\{\n|\n\}$/g, '') + ',';
  return {
    found,
    why: why || 'This is how AI systems connect your business to the topics and profiles that prove who you are.',
    steps: ['Your site already has business data. Add the lines below to it instead of creating a second copy.',
      EXISTING_WHERE[p], 'Paste the lines just after the "name" line, keep the comma at the end, and save.', 'Check it: paste your home page address into validator.schema.org.'],
    paste: { label: 'Lines to add to your existing business data', code },
    minutes: 15,
  };
}

function schemaGuide(s, p, found, why) {
  const fullMissing = !s.schema.hasOrg && !s.schema.hasPerson;
  if (!fullMissing && s.schema.invalid === 0) return addLines(s, p, found, why);
  return {
    found,
    why: why || 'This code is how ChatGPT, Google and other AI systems are told, not left to guess, your name, what you do, where you are, and which profiles are yours.',
    steps: ['Fill in the [brackets] in the code below (everything else is already taken from your site).'].concat(p === 'wix' ? SCHEMA_WIX : HEAD[p]).concat([
      'Check it: paste your home page address into validator.schema.org.']),
    paste: { label: 'Your business data, pre-filled', code: orgJson(s, { url: s.__url }, { forWix: p === 'wix' }) },
    minutes: 15,
  };
}

// Related checks are fixed in the same place, so they become one mission
// ("rewrite your Google listing") instead of five notes that repeat each other.
const MISSIONS = [
  { key: 'indexable', title: 'Let search engines list your site', checks: ['indexable'] },
  { key: 'ai-access', title: 'Let AI assistants read your site', checks: ['ai-crawlers'] },
  { key: 'listing', title: 'Rewrite how you appear in Google and AI answers',
    checks: ['title-describes', 'title-present', 'title-length', 'meta-description', 'meta-description-length', 'og-title-agrees'] },
  { key: 'business-data', title: 'Tell AI exactly who you are (business data)',
    checks: ['schema-present', 'entity-declared', 'stated-role', 'same-as', 'knows-about', 'schema-valid'] },
  { key: 'heading', title: 'Make your main heading say what you do', checks: ['single-h1', 'h1-substantive'] },
  { key: 'words', title: (ids) => ids.includes('content-in-html') ? 'Write 300+ words about your business' : 'Lighten the code around your text',
    checks: ['content-in-html', 'content-density'] },
  { key: 'sections', title: 'Break your home page into clear sections', checks: ['heading-structure'] },
  { key: 'faq', title: 'Add a Q&A section customers (and AI) can quote', checks: ['faq-schema'] },
  { key: 'contact', title: 'Show your phone number and email', checks: ['contact-visible'] },
  { key: 'images', title: 'Describe your images', checks: ['image-alt'] },
  { key: 'sitemap', title: 'Publish a sitemap', checks: ['sitemap'] },
  { key: 'links-in', title: 'Link to your key pages from the home page', checks: ['internal-linking'] },
  { key: 'links-out', title: 'Link to where you are listed and featured', checks: ['cites-out', 'citations-followable'] },
  { key: 'canonical', title: 'Declare your official web address', checks: ['canonical'] },
  { key: 'share', title: 'Add a share image for your links', checks: ['share-image'] },
  { key: 'llms', title: 'Add an llms.txt introduction for AI', checks: ['llms-txt'] },
];
const DIM_OF = { visibility: 'visibility', clarity: 'clarity', structure: 'structure', authority: 'authority' };

/**
 * Turn failed checks into missions: one card per job, with the evidence of
 * every check it fixes, the steps for this platform, and text to paste.
 * @param {object[]} findings  from score()
 * @param {object} signals     from extract()
 * @param {{url:string, host:string}} ctx
 * @returns {object[]} missions, biggest gain first
 */
function buildMissions(findings, signals, ctx) {
  const p = NAMES[signals.platform] ? signals.platform : 'custom';
  const s = { ...signals, __url: ctx.url };
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
  const out = [];
  for (const m of MISSIONS) {
    const hits = m.checks.map((id) => byId[id]).filter(Boolean);
    if (!hits.length) continue;
    hits.sort((a, b) => b.points - a.points);
    const guides = hits.map((f) => { try { return G[f.id] ? G[f.id](s, p) : null; } catch (e) { return null; } });
    const lead = guides.find(Boolean);
    const pastes = [];
    for (const g of guides) {
      if (g && g.paste && !pastes.some((x) => x.code === g.paste.code)) pastes.push(g.paste);
    }
    const points = hits.reduce((a, f) => a + (f.points || 0), 0);
    out.push({
      id: m.key, mission: m.key, title: typeof m.title === 'function' ? m.title(hits.map((h) => h.id)) : m.title,
      detail: lead ? lead.why : hits[0].detail,
      dimension: DIM_OF[hits[0].dimension] || hits[0].dimension,
      severity: points >= 6 ? 'high' : points >= 3 ? 'medium' : 'low',
      weight: hits.reduce((a, f) => a + f.weight, 0),
      points,
      checks: hits.map((f) => f.title),
      guide: lead ? {
        found: guides.filter(Boolean).map((g) => g.found),
        why: lead.why,
        steps: lead.steps,
        pastes,
        minutes: Math.max(...guides.filter(Boolean).map((g) => g.minutes || 10)),
        platform: p, platformName: NAMES[p],
      } : null,
    });
  }
  return out.sort((a, b) => b.points - a.points);
}

// Kept for callers that want per-check lessons.
function attachGuides(findings, signals, ctx) {
  const p = NAMES[signals.platform] ? signals.platform : 'custom';
  const s = { ...signals, __url: ctx.url };
  return findings.map((f) => {
    let g = null;
    try { g = G[f.id] ? G[f.id](s, p) : null; } catch (e) { g = null; }
    return g ? { ...f, guide: { ...g, platform: p, platformName: NAMES[p] } } : f;
  });
}

// What an AI can currently say about the business, read from the same signals.
function aiProfile(s) {
  return {
    name: s.siteName || null,
    platform: s.platform, platformName: NAMES[s.platform] || 'your website',
    what: whatYouDo(s),
    kind: (s.org && s.org.type) || null,
    title: s.title || null,
    description: s.metaDescription || null,
    where: place({ org: s.org }),
    phone: !!(s.contact && (s.contact.tel || s.contact.phoneText)),
    profiles: Array.from(new Set(Object.keys(s.social || {}))),
    profilesClaimed: s.schema.sameAs || 0,
    aiBlocked: s.aiBlocked,
    words: s.wordCount,
    faq: s.schema.hasFaq,
  };
}

module.exports = { buildMissions, attachGuides, aiProfile, MISSIONS, suggestTitle, suggestDescription, whatYouDo, NAMES };
