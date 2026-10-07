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

const BOT_LABEL = {
  'GPTBot': 'OpenAI model training', 'OAI-SearchBot': 'ChatGPT search', 'ChatGPT-User': 'ChatGPT browsing for a user',
  'ClaudeBot': 'Anthropic model training', 'Claude-SearchBot': 'Claude search', 'PerplexityBot': 'Perplexity answers',
  'Google-Extended': 'Google Gemini training', 'Bingbot': 'Bing and Microsoft Copilot',
};
const SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'PerplexityBot', 'Bingbot'];

const NAMES = {
  shopify: 'Shopify', wix: 'Wix', squarespace: 'Squarespace', wordpress: 'WordPress',
  webflow: 'Webflow', godaddy: 'GoDaddy', custom: 'your website',
};

// ------------------------------------------------------------- helpers ----
const { classify, list } = require('./industry');

const clip = (s, n) => {
  s = String(s || '').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return cut.slice(0, at > n * 0.6 ? at : n).replace(/[,.;:\s]+$/, '');
};
const FILLER = /^(welcome to [^,.!]+[,.!]?\s*|your one[- ]stop shop for\s*|we are\s+|we're\s+|the best\s+|home\s*[|–—-]\s*)/i;
const capFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const place = (s) => (s.org && s.org.city ? s.org.city + (s.org.region ? ', ' + s.org.region : '') : null);
const ind = (s) => s.__ind || (s.__ind = classify(s));

// A tagline ("Compassionate. Experienced. Local.") is not a description.
const isTagline = (t) => (t.match(/[.!]/g) || []).length >= 2 || /^[A-Z][a-z]+[.!]\s/.test(t);

// "What this business does", in plain words: its services and its town when
// we can find them, otherwise its own most descriptive heading.
function whatYouDo(s) {
  const I = ind(s);
  const brand = String(s.siteName || '').toLowerCase();
  // The business's own best line beats our category list, when it names what they offer.
  const own = [].concat(s.headings.h1, s.headings.h2.slice(0, 4))
    .map((t) => String(t || '').replace(FILLER, '').replace(/\s+/g, ' ').trim())
    .find((t) => t && t.toLowerCase() !== brand && !isTagline(t) && t.split(/\s+/).length >= 3 && t.split(/\s+/).length <= 9 &&
      (I.terms || []).some((term) => t.toLowerCase().includes(term)));
  if (own) return capFirst(own.replace(/[.!]+$/, ''));
  if (I.services.length) return capFirst(list(I.services.slice(0, 3))) + (place(s) ? ' in ' + place(s) : '');
  const cands = [].concat(s.headings.h1, s.headings.h2.slice(0, 3))
    .map((t) => String(t || '').replace(FILLER, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.toLowerCase() !== brand && !isTagline(t) && t.split(/\s+/).length >= 3 && t.split(/\s+/).length <= 12 &&
      !/^(featured|shop|new|best sellers?|sign up|subscribe|contact|about|menu|cart|search|follow|our )/i.test(t));
  return cands.length ? capFirst(cands[0].replace(/[.!]+$/, '')) : null;
}

function suggestTitle(s) {
  const brand = s.siteName || 'Your Business';
  const what = whatYouDo(s);
  if (!what) return `${brand} | [What you do] in [City]`;
  let t = `${what} | ${brand}`;
  const I = ind(s);
  // Too long? Drop services one at a time rather than cutting a word in half.
  for (let n = 2; t.length > 62 && n >= 1 && I.services.length > n; n--) {
    t = `${capFirst(list(I.services.slice(0, n)))}${place(s) ? ' in ' + place(s) : ''} | ${brand}`;
  }
  if (t.length > 62 && place(s)) t = t.replace(' in ' + place(s), ' in ' + s.org.city);
  if (t.length > 62) t = `${clip(what, 60 - brand.length - 3)} | ${brand}`;
  return t;
}

// One honest sentence from the business's own description, then the call to
// action that fits its industry. Never "Shop online" for a tree service.
function suggestDescription(s) {
  const I = ind(s);
  // Try each source's first sentence; keep the first one that reads like a description.
  const firsts = [s.metaDescription, s.org && s.org.description].filter(Boolean)
    .map((src) => (src.replace(/^welcome to\s+/i, '').replace(/\s+/g, ' ').trim().match(/^[^.!?]+[.!?]/) || [''])[0].trim());
  const first = firsts.find((f) => f.length >= 40 && f.length <= 125 && !isTagline(f) &&
    !/^(with|whether|if|from)\b/i.test(f) && !/shop now|buy now|click here|:\s*shop/i.test(f)) || '';
  const usable = !!first;
  if (usable) {
    const out = capFirst(first.replace(/!$/, '.')) + ' ' + I.cta;
    return out.length <= 160 ? out : capFirst(first);
  }
  const what = whatYouDo(s);
  if (what) {
    const svc = I.services.length ? list(I.services.slice(0, 3)) : what.charAt(0).toLowerCase() + what.slice(1);
    return clip(`${s.siteName || 'We'} ${I.verb} ${svc}${I.key === 'legal' ? ' cases' : ''}${place(s) && I.services.length ? ' in ' + place(s) : ''}. ${I.cta}`, 160);
  }
  return `${s.siteName || 'We'} [does what] for [whom] in [city]. ${I.cta}`;
}

function originOf(ctx) { try { return new URL(ctx.url).origin; } catch (e) { return 'https://' + (ctx.host || 'yourwebsite.com'); } }

function topics(s) {
  const I = ind(s);
  const t = I.services.map(capFirst);
  while (t.length < 3) t.push(t.length ? '[Another service you are known for]' : '[Your main service]');
  return t.slice(0, 5);
}

function orgJson(s, ctx, { forWix } = {}) {
  const I = ind(s);
  const sameAs = Object.values(s.social || {});
  const node = {
    '@context': 'https://schema.org',
    '@type': (s.org && s.org.type && !/^(Organization|LocalBusiness)$/.test(s.org.type)) ? s.org.type : (I.schema || 'LocalBusiness'),
    name: s.siteName || '[Business name]',
    url: originOf(ctx) + '/',
    description: suggestDescription(s),
  };
  node.logo = (s.org && s.org.logoUrl) || originOf(ctx) + '/[your-logo-file].png';
  node.telephone = (s.org && s.org.telephone) || '[Your phone number]';
  if (s.org && s.org.email) node.email = s.org.email;
  node.address = {
    '@type': 'PostalAddress',
    streetAddress: (s.org && s.org.street) || '[Street address]',
    addressLocality: (s.org && s.org.city) || '[City]',
    addressRegion: (s.org && s.org.region) || '[State]',
    postalCode: (s.org && s.org.postal) || '[ZIP code]',
    addressCountry: 'US',
  };
  node.knowsAbout = topics(s);
  node.sameAs = sameAs.length ? sameAs.concat(sameAs.length < 3 && !(s.social || {}).google ? ['[Your Google Business Profile link]'] : [])
    : ['[Your Google Business Profile link]', '[Your Facebook page]', '[Your Yelp or LinkedIn page]'];
  const json = JSON.stringify(node, null, 2);
  return forWix ? json : `<script type="application/ld+json">\n${json}\n</script>`;
}

function faqPairs(s) {
  const I = ind(s);
  const n = s.siteName || 'your business';
  const where = place(s);
  return I.faq(n, suggestDescription(s), where).map(([q, a]) => [q,
    a || (where ? `We are based in ${where}. [Add the cities or areas you serve.]` : '[Your city and the areas you serve.]')]);
}
function faqJson(s, forWix) {
  const node = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqPairs(s).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
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
  shopify: (s) => s.h1Count === 0
    ? ['Your theme does not mark any headline as the main heading.',
       'Most Shopify themes don\'t let you choose heading levels in Customize, so this is a one-line theme change: the heading of your top banner becomes the main heading (H1), using the sentence below.',
       'If you\'re comfortable with code: Online Store → Themes → ⋯ → Edit code, open the section file for your top banner, and change its heading tag to h1. Otherwise, have it done for you.']
    : s.h1Logo
    ? ['Your theme wraps the logo in a main heading, so the main heading says your name instead of what you sell.',
       'Online Store → Themes → ⋯ → Edit code → sections/header.liquid. Search for "<h1" around the logo and change h1 to div on both the opening and closing tags. Save.',
       (() => { const other = (s.headings.h1 || []).find((h) => h && h.toLowerCase() !== String(s.siteName || '').toLowerCase());
         return other ? `Your banner headline "${other}" is good. Once the logo stops being a heading, it becomes your one main heading. Not comfortable editing code? This is a good one to have done for you.`
           : 'Then in Customize, make your first banner headline the sentence below. Not comfortable editing code? This is a good one to have done for you.'; })()]
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
  shopify: ['Shopify does not let you upload your own file to the root of your store, so this needs a developer or an app. It is worth only 1 point: skip it for now unless the rest is done.'],
  wix: ['Wix does not let you upload files to your site root yet, so skip this one for now. It is worth only 1 point.'],
  squarespace: ['Squarespace does not let you upload files to your site root, so skip this one for now. It is worth only 1 point.'],
  wordpress: ['Install the free "Website LLMs.txt" plugin, or upload the file below as llms.txt to your site root using your host\'s File Manager.'],
  webflow: ['Webflow cannot host your own root files directly; skip this one for now (1 point).'],
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
    found: `Your home page carries a hidden "do not list me" instruction for search engines (it says "${s.robots}"). Google and Bing obey it.`,
    why: 'While this switch is on, your site is invisible in Google, Bing and the AI assistants that read them, no matter how good it is. This usually happens when a site is built with the switch on and nobody turns it off at launch.',
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
    found: s.metaDescription ? `Your summary (the two lines under your name in Google) is only ${s.metaDescription.length} characters: "${s.metaDescription}".` : 'Your home page has no summary (the two lines under your name in Google, called the "meta description").',
    why: 'Without one, Google and AI tools grab random text from your page, often a menu or a cookie notice, as the description of your business.',
    steps: TITLE_EDIT[p], paste: { label: 'Suggested description', code: suggestDescription(s) }, minutes: 5 }),

  'meta-description-length': (s, p) => ({
    found: `Your summary is ${s.metaDescription.length} characters. Everything after about 160 is cut off: "…${s.metaDescription.slice(150, 200)}…".`,
    why: 'The last part of a long description never gets shown, and an opening like "Welcome to" spends your best words on nothing.',
    steps: TITLE_EDIT[p], paste: { label: `Tighter version (${suggestDescription(s).length} characters)`, code: suggestDescription(s) }, minutes: 5 }),

  'canonical': (s, p) => ({
    found: 'Your home page does not state its one official web address.',
    why: 'Your site opens at several addresses (with and without "www", with tracking codes added). Without this tag, Google splits the credit for your page between them.',
    steps: ['shopify', 'wix', 'squarespace', 'wordpress'].includes(p)
      ? [`${NAMES[p]} normally adds this automatically, so your theme or an app has removed it.`, 'Easiest fix: have it done for you (it is a two-minute job for a developer).']
      : HEAD[p],
    paste: { label: 'Code', code: `<link rel="canonical" href="${originOf({ url: s.__url })}/">` }, minutes: 10 }),

  'content-in-html': (s, p) => ({
    found: `We could read only ${s.wordCount} words of plain text on your home page. A few hundred words is a sensible minimum for describing a business.`,
    why: 'AI assistants recommend businesses they can describe. A page that is mostly pictures, sliders and buttons gives them nothing to quote.',
    steps: ['Add a section of real text to your home page using the outline below.', 'Write the way you would explain your business to a new customer on the phone.',
      `On ${NAMES[p]}, add a Text section/block and paste the outline in, then replace the brackets.`],
    paste: { label: 'Outline to fill in', code: `About ${s.siteName || 'us'}\n${suggestDescription(s)}\n\nWhat we offer\n${ind(s).services.length ? capFirst(list(ind(s).services)) + ': [a sentence on each]' : '[3–5 sentences on your main products or services]'}\n\nWho we work with\n[The customers you serve best]\n\nWhy choose ${s.siteName || 'us'}\n[Years in business, guarantees, what makes you different]\n\nWhere we work\n[${ind(s).key === 'retail' ? 'Where you ship, and your showroom if you have one' : 'Your city and the areas you serve'}]` },
    minutes: 30 }),

  'content-density': (s, p) => ({
    found: `Only ${(s.textToHtmlRatio * 100).toFixed(1)}% of your home page is readable text; the rest is code.`,
    why: 'When text is buried under heavy code or built by scripts after the page loads, many AI crawlers see a nearly empty page.',
    steps: ['Add plain text sections (not text inside images or sliders).', 'Remove apps or widgets you no longer use; each one adds code.',
      p === 'custom' ? 'Ask your developer whether the page content is rendered on the server.' : `On ${NAMES[p]}, prefer the standard Text block over image-with-text designs.`],
    minutes: 30 }),

  'single-h1': (s, p) => ({
    found: s.h1Count === 0 ? 'Your home page has no main heading (the big headline search engines treat as the page\'s topic, called the "H1").'
      : `Your home page has ${s.h1Count} main headings: ${s.headings.h1.slice(0, 3).map((h) => `"${clip(h, 60)}"`).join(', ')}.`,
    why: s.h1Count === 0 ? 'Search engines and AI read the main heading to decide what a page is about. Without one, they have to guess.'
      : 'Search engines and AI read the main heading to decide what a page is about. With two, they are told two different things, and one of them is just your logo.',
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

  'stated-role': (s, p) => schemaGuide(s, p, `Your site never tells AI, in its own code language, what kind of business you are. We read you as a ${ind(s).label.toLowerCase()}.`),
  'schema-present': (s, p) => schemaGuide(s, p, 'Your home page has no hidden business card for AI (code called "structured data" that states your name, type, location and phone).'),
  'entity-declared': (s, p) => schemaGuide(s, p, s.schema.blocks ? 'Your page has some hidden code for search engines, but none of it describes your business itself.' : 'Your page has no hidden code describing your business.'),
  'schema-valid': (s, p) => ({
    found: `${s.schema.invalid} of the ${s.schema.blocks} hidden business-info blocks on your page ("structured data") are broken, so AI tools ignore them.`,
    why: 'A broken block is worse than none: you think it is working, and every crawler silently throws it away.',
    steps: ['Paste your home page address into validator.schema.org to see the exact error.', 'Usually it is a missing comma or quote in code an app or developer added. Remove or fix that block.',
      'Then use the clean block below in its place.'].concat(p === 'wix' ? SCHEMA_WIX : HEAD[p]),
    paste: { label: 'Clean replacement', code: orgJson(s, { url: s.__url }, { forWix: p === 'wix' }) }, minutes: 20 }),

  'knows-about': (s, p) => schemaGuide(s, p, 'Your hidden business card for AI does not list your specialties.',
    'Listing your specialties in this hidden business card is how AI connects you with what you do, not only with your name.'),

  'same-as': (s, p) => schemaGuide(s, p,
    Object.keys(s.social || {}).length
      ? `Your page links to your ${Object.keys(s.social).join(', ')} page${Object.keys(s.social).length > 1 ? 's' : ''}, but your hidden business card for AI doesn't claim ${Object.keys(s.social).length > 1 ? 'them' : 'it'} as yours.`
      : 'Your hidden business card for AI does not link to any of your profiles (Google, Facebook, Yelp, LinkedIn…).',
    'AI trusts a business more when it can confirm the website, the Google listing and the social pages all belong to the same company. This is that confirmation.'),

  'faq-schema': (s, p) => {
    const I = ind(s);
    const pairs = faqPairs(s);
    return {
      found: 'Your home page has no questions-and-answers section.',
      why: 'People ask AI assistants questions in plain words. A page that already contains the question and a clear answer is the easiest thing for them to quote. (Google no longer shows FAQ drop-downs in results for most sites, but AI assistants still read them.)',
      steps: ['Step 1: add a "Questions" section near the bottom of your home page with the three questions below. Edit the answers so they are true for you.' + (I.note ? ' ' + I.note : ''),
        p === 'wix' ? 'On Wix: Add (+) → Interactive → FAQ, or a simple text section.' : `On ${NAMES[p]}: add a text or FAQ/accordion section.`,
        'Step 2 (optional, a little technical): add the code version so AI tools recognise it as Q&A. Use the same wording as on the page.'].concat(p === 'wix' ? SCHEMA_WIX : HEAD[p]),
      paste: [{ label: 'Questions and answers to put on your page', code: pairs.map(([q, a]) => `${q}\n${a}`).join('\n\n') },
        { label: 'Code version (optional, same wording)', code: faqJson(s, p === 'wix') }],
      minutes: 25 };
  },

  'image-alt': (s, p) => ({
    found: `${s.images.missingAlt} of ${s.images.total} images on your home page have no description (alt text).`,
    why: 'AI and Google cannot see pictures; they read a short description attached to each one. Without it, your photos are blank spaces to them.',
    steps: ALT[p], paste: { label: 'How to write a good one', code: 'Say what is in the picture and why it matters, in under 125 characters.\nGood: "Black 4-way stretch spandex fabric, 60 inches wide"\nPoor: "IMG_0412" or "fabric"' }, minutes: 20 }),

  'cites-out': (s, p) => ({
    found: `Your home page links to ${s.links.external} outside website${s.links.external === 1 ? '' : 's'}.`,
    why: 'Linking to the associations you belong to, reviews about you and the places you are listed connects you to them in the eyes of AI.',
    steps: ['Add a "Find us on" or "As featured in" line to your footer.', 'Link your Google Business Profile, Yelp, industry associations, and press mentions.'], minutes: 15 }),

  'citations-followable': (s, p) => ({
    found: 'Every link to another website on your page is marked "nofollow" (a tag that says "we don\'t vouch for this").',
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

  'ai-crawlers': (s, p) => {
    const search = s.aiBlocked.filter((b) => SEARCH_BOTS.includes(b));
    const training = s.aiBlocked.filter((b) => !SEARCH_BOTS.includes(b));
    const keep = search.length ? search : s.aiBlocked;
    return {
      found: `Your robots.txt file (the rules page for crawlers) blocks: ${s.aiBlocked.map((b) => `${b} (${BOT_LABEL[b] || 'AI crawler'})`).join('; ')}.`,
      why: search.length
        ? 'These are the bots that fetch pages when someone asks an AI assistant a question. Blocked, those assistants cannot read your site, so they cannot recommend you or link to you.'
        : 'These bots collect pages to train AI models. Some owners block them on purpose, and that is a fair choice. But it also means those AI models learn less about you. If nobody chose this deliberately, we suggest allowing them.',
      steps: (search.length ? [] : ['First decide: was this blocked on purpose? If yes, you can skip this mission.']).concat(ROBOTS[p]),
      paste: { label: search.length ? 'Allow at least these (answer bots)' : 'Lines to allow them', code: keep.map((b) => `User-agent: ${b}\nAllow: /`).join('\n\n') },
      minutes: 10 };
  },

  'sitemap': (s, p) => ({
    found: 'We could not find a sitemap at /sitemap.xml or listed in your robots.txt.',
    why: 'A sitemap is the list of your pages you hand to search engines. Without it, pages deep in your site can go unnoticed for months.',
    steps: (SITEMAP[p] || SITEMAP.custom).concat([SUBMIT]), minutes: 10 }),

  'llms-txt': (s, p) => ({
    found: 'Your site has no /llms.txt file.',
    why: 'llms.txt is a new, plain-text introduction written for AI systems. It is optional, but few businesses have one yet, which makes it an easy edge.',
    steps: LLMS_HOST[p], paste: ['wix', 'squarespace', 'godaddy'].includes(p) ? null : { label: 'Your llms.txt (fill in the brackets)', code: llmsTxt(s, { url: s.__url }) }, minutes: 15 }),

  'location-declared': (s, p) => schemaGuide(s, p, 'Your hidden business card for AI has no address, so AI cannot place you on the map for "near me" questions.'),

  'contact-visible': (s, p) => ({
    found: 'We could not find a phone number or email address on your home page.',
    why: 'A business you cannot reach looks like a business that may not exist. Visible contact details are a basic trust signal for people and AI alike.',
    steps: [`Add your phone number and email to the header or footer on ${NAMES[p]}.`, 'Make the phone number a tap-to-call link and the email a tap-to-email link.'],
    paste: p === 'custom' ? { label: 'Code for your developer (put in your real number and email)', code: '<a href="tel:+1XXXXXXXXXX">(XXX) XXX-XXXX</a> · <a href="mailto:you@yourbusiness.com">you@yourbusiness.com</a>' } : null, minutes: 10 }),
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
  const I = ind(s);
  const lines = {};
  if (!(s.schema.knowsAbout >= 3 || s.schema.knowsAboutOrg)) lines.knowsAbout = topics(s);
  if (s.schema.sameAs < 3) {
    const prof = Object.values(s.social || {});
    lines.sameAs = prof.length ? prof.concat(prof.length < 3 && !(s.social || {}).google ? ['[Your Google Business Profile link]'] : [])
      : ['[Your Google Business Profile link]', '[Your Facebook page]', '[Your Yelp or LinkedIn page]'];
  }
  if (s.org && !s.org.address && s.platform !== 'shopify') lines.address = { '@type': 'PostalAddress', streetAddress: '[Street address]',
    addressLocality: '[City]', addressRegion: '[State]', postalCode: '[ZIP code]', addressCountry: 'US' };
  const code = JSON.stringify(lines, null, 2).replace(/^\{\n|\n\}$/g, '') + ',';
  return {
    found,
    why: why || 'This is how AI connects your business to what you do and to the profiles that prove who you are.',
    steps: ['Good news: your site already has a hidden business card for AI. Add the lines below inside it rather than creating a second one.',
      EXISTING_WHERE[p], 'Paste the lines on a new line right after the line that starts with "name", keep the comma at the end, and save.',
      'Check it: paste your home page address into validator.schema.org (free). Never edited code? This is a good one to have done for you.'],
    paste: { label: 'Lines to add to your existing business card', code },
    minutes: 15,
    technical: true,
  };
}

function schemaGuide(s, p, found, why) {
  const fullMissing = !s.schema.hasOrg && !s.schema.hasPerson;
  if (!fullMissing && s.schema.invalid === 0) return addLines(s, p, found, why);
  return {
    found,
    why: why || 'Think of it as a business card written for machines. It tells ChatGPT, Google and other AI your name, what you do, where you are and which profiles are yours, so they don\'t have to guess.',
    steps: ['We wrote the code below from your site. Replace anything in [square brackets] with your real details (and delete any line you can\'t fill).'].concat(p === 'wix' ? SCHEMA_WIX : HEAD[p]).concat([
      'Check it: paste your home page address into validator.schema.org.']),
    paste: { label: 'Your business card for AI, pre-filled from your site', code: orgJson(s, { url: s.__url }, { forWix: p === 'wix' }) },
    minutes: 15,
    technical: p !== 'wix',
  };
}

// Related checks are fixed in the same place, so they become one mission
// ("rewrite your Google listing") instead of five notes that repeat each other.
const MISSIONS = [
  { key: 'indexable', title: 'Let search engines list your site', checks: ['indexable'] },
  { key: 'ai-access', title: (ids, sig) => ((sig.aiBlocked || []).some((b) => SEARCH_BOTS.includes(b)) ? 'Let AI assistants read your site' : 'Decide whether AI models may learn from your site'), checks: ['ai-crawlers'] },
  { key: 'listing', title: 'Rewrite how you appear in Google and AI answers',
    checks: ['title-describes', 'title-present', 'title-length', 'meta-description', 'meta-description-length', 'og-title-agrees'] },
  { key: 'business-data', title: 'Tell AI exactly who you are (business data)',
    checks: ['schema-present', 'entity-declared', 'stated-role', 'same-as', 'knows-about', 'location-declared', 'schema-valid'] },
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
  const s = { ...signals, __url: ctx.url, __host: ctx.host };
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
  const out = [];
  for (const m of MISSIONS) {
    const hits = m.checks.map((id) => byId[id]).filter(Boolean);
    if (!hits.length) continue;
    hits.sort((a, b) => b.points - a.points);
    const guides = hits.map((f) => { try { return G[f.id] ? G[f.id](s, p) : null; } catch (e) { return null; } });
    // When there is no business card at all, the sub-findings ("no type",
    // "no specialties") are the same news four times. Say it once.
    if (hits.some((f) => f.id === 'schema-present')) {
      for (let i = 0; i < hits.length; i++) if (['entity-declared', 'stated-role', 'knows-about', 'location-declared'].includes(hits[i].id) && guides[i]) guides[i] = { ...guides[i], found: null };
    }
    const lead = guides.find(Boolean);
    const pastes = [];
    for (const g of guides) {
      for (const one of [].concat((g && g.paste) || [])) if (one && !pastes.some((x) => x.code === one.code)) pastes.push(one);
    }
    const points = hits.reduce((a, f) => a + (f.points || 0), 0);
    out.push({
      id: m.key, mission: m.key, title: typeof m.title === 'function' ? m.title(hits.map((h) => h.id), signals) : m.title,
      detail: lead ? lead.why : hits[0].detail,
      dimension: DIM_OF[hits[0].dimension] || hits[0].dimension,
      severity: points >= 6 ? 'high' : points >= 3 ? 'medium' : 'low',
      weight: hits.reduce((a, f) => a + f.weight, 0),
      points,
      checks: hits.map((f) => f.title),
      guide: lead ? {
        found: guides.filter((g) => g && g.found).map((g) => g.found),
        why: lead.why,
        steps: lead.steps,
        pastes,
        minutes: Math.max(...guides.filter(Boolean).map((g) => g.minutes || 10)),
        technical: guides.some((g) => g && g.technical) || (m.key === 'heading' && p === 'shopify' && (s.h1Logo || s.h1Count === 0)),
        platform: p, platformName: NAMES[p],
      } : null,
    });
  }
  // Blockers first: while search engines or AI are shut out, nothing else
  // on the list can help.
  const searchBlocked = (signals.aiBlocked || []).some((b) => SEARCH_BOTS.includes(b));
  const BLOCKER = { indexable: 2, 'ai-access': searchBlocked ? 1 : 0 };
  return out.map((m) => (BLOCKER[m.id] ? { ...m, blocker: true, severity: 'high' } : m))
    .sort((a, b) => (BLOCKER[b.id] || 0) - (BLOCKER[a.id] || 0) || b.points - a.points);
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
function aiProfile(s, ctx) {
  s = { ...s, __host: ctx && ctx.host };
  return {
    name: s.siteName || null,
    platform: s.platform, platformName: NAMES[s.platform] || 'your website',
    what: whatYouDo(s),
    kind: (s.org && s.org.type) || null,
    title: s.title || null,
    titleDescribes: (() => { try { const c = require('./score').CHECKS.find((x) => x.id === 'title-describes'); return c.test(s); } catch (e) { return null; } })(),
    description: s.metaDescription || null,
    where: place({ org: s.org }),
    phone: !!(s.contact && (s.contact.tel || s.contact.phoneText)),
    profiles: Array.from(new Set(Object.keys(s.social || {}))),
    profilesClaimed: s.schema.sameAs || 0,
    aiBlocked: s.aiBlocked,
    words: s.wordCount,
    faq: s.schema.hasFaq,
    industry: ind(s).label,
    services: ind(s).services,
    hidden: !!(s.robots && /noindex/i.test(s.robots)),
  };
}

module.exports = { buildMissions, attachGuides, aiProfile, MISSIONS, suggestTitle, suggestDescription, whatYouDo, NAMES };
