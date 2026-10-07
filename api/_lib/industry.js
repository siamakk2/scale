'use strict';
// What kind of business is this, and what does it actually offer?
//
// Generic advice is the fastest way to lose a customer's trust: telling a tree
// service to "Shop online", or filling a law firm's expertise with its
// tagline. So before any text is suggested, the page's own words are matched
// against a small vocabulary per industry. The result decides the schema type,
// the call to action, the FAQ questions, and the services we write in.

const INDUSTRIES = [
  { key: 'legal', label: 'Law firm', schema: 'LegalService',
    cta: 'Call for a confidential consultation.',
    verb: 'handles',
    terms: ['family law', 'divorce', 'child custody', 'custody', 'child support', 'spousal support', 'adoption',
      'estate planning', 'wills and trusts', 'probate', 'personal injury', 'criminal defense', 'dui',
      'immigration', 'bankruptcy', 'employment law', 'business law', 'real estate law', 'attorney', 'lawyer', 'law firm'],
    faq: (n, w) => [[`What kinds of cases does ${n} handle?`, `${w}`],
      [`Where is your office, and which areas do you serve?`, null],
      [`How do I schedule a consultation?`, '[How to book, and whether the first consultation is free.]']],
    note: 'Keep answers general and factual. Avoid promising outcomes or calling yourself a "specialist" unless certified: attorney advertising rules apply to your website (in California, Rules of Professional Conduct 7.1 to 7.5).' },
  { key: 'tree', label: 'Tree service', schema: 'HomeAndConstructionBusiness',
    cta: 'Call for a free estimate.', verb: 'provides',
    terms: ['tree removal', 'tree trimming', 'tree pruning', 'pruning', 'trimming', 'stump grinding', 'stump removal',
      'arborist', 'emergency tree', 'tree care', 'land clearing', 'hazard tree', 'crane'],
    faq: (n, w, where) => [[`What tree services does ${n} offer?`, w],
      [`What areas do you serve?`, where ? `We serve ${where} and nearby cities: [list them].` : null],
      [`Do you offer free estimates and emergency service?`, '[Yes/no, how fast you respond, and your phone number.]']] },
  { key: 'home', label: 'Home services', schema: 'HomeAndConstructionBusiness',
    cta: 'Call for a free estimate.', verb: 'provides',
    terms: ['plumbing', 'plumber', 'roofing', 'roofer', 'hvac', 'air conditioning', 'heating', 'electrician', 'electrical',
      'landscaping', 'remodeling', 'renovation', 'contractor', 'construction', 'painting', 'flooring', 'cleaning service',
      'pest control', 'pool service', 'solar installation', 'handyman', 'concrete', 'fencing'],
    faq: (n, w, where) => [[`What services does ${n} provide?`, w],
      [`What areas do you serve?`, where ? `We serve ${where} and nearby cities: [list them].` : null],
      [`Are you licensed and insured, and do you give free estimates?`, '[Your license number, insurance, and how to get an estimate.]']] },
  { key: 'medical', label: 'Health practice', schema: 'MedicalBusiness',
    cta: 'Call or book an appointment online.', verb: 'provides',
    terms: ['dentist', 'dental', 'orthodont', 'chiropract', 'physical therapy', 'clinic', 'medical', 'physician', 'doctor',
      'dermatolog', 'optometr', 'veterinar', 'therapy', 'wellness', 'med spa'],
    faq: (n, w) => [[`What services does ${n} offer?`, w], [`Do you accept my insurance?`, '[Plans you accept.]'],
      [`How do I book an appointment?`, '[Phone, online booking link, hours.]']] },
  { key: 'food', label: 'Restaurant', schema: 'Restaurant',
    cta: 'Reserve a table or order online.', verb: 'serves',
    terms: ['restaurant', 'menu', 'cafe', 'coffee', 'bakery', 'catering', 'pizza', 'sushi', 'brunch', 'dining', 'bar & grill', 'taqueria'],
    faq: (n, w) => [[`What kind of food does ${n} serve?`, w], [`What are your hours?`, '[Hours.]'],
      [`Do you take reservations or offer delivery?`, '[How to reserve or order.]']] },
  { key: 'realestate', label: 'Real estate', schema: 'RealEstateAgent',
    cta: 'Call to discuss your property.', verb: 'specializes in',
    terms: ['real estate', 'realtor', 'brokerage', 'commercial property', 'leasing', 'property management', 'homes for sale', 'listings', 'escrow'],
    faq: (n, w) => [[`What does ${n} specialize in?`, w], [`Which neighborhoods do you cover?`, null],
      [`How do I list or find a property with you?`, '[First step and contact.]']] },
  { key: 'retail', label: 'Store', schema: 'Store',
    cta: 'Shop online today.', verb: 'sells',
    terms: ['fabric', 'spandex', 'stretch', 'sequin', 'textile', 'shop', 'store', 'products', 'collection', 'boutique',
      'apparel', 'clothing', 'jewelry', 'furniture', 'supplies', 'wholesale', 'by the yard', 'free shipping', 'add to cart'],
    faq: (n, w) => [[`What does ${n} sell?`, w], [`Do you ship, and how long does it take?`, '[Shipping areas, cost and timing.]'],
      [`What is your return policy?`, '[Returns in one or two sentences.]']] },
  { key: 'professional', label: 'Professional service', schema: 'ProfessionalService',
    cta: 'Get in touch to talk about your project.', verb: 'provides',
    terms: ['consulting', 'consultant', 'marketing', 'agency', 'accounting', 'bookkeeping', 'cpa', 'insurance', 'financial',
      'design', 'web development', 'seo', 'coaching', 'training', 'staffing', 'photography'],
    faq: (n, w) => [[`What does ${n} do?`, w], [`Who do you work with?`, '[Your ideal clients.]'],
      [`How do we get started?`, '[First step and contact.]']] },
];

// Nicer wording for the services list (the vocabulary uses stems).
const PRETTY = { 'orthodont': 'orthodontics', 'chiropract': 'chiropractic care', 'dermatolog': 'dermatology',
  'optometr': 'eye care', 'veterinar': 'veterinary care', 'trimming': 'tree trimming', 'pruning': 'tree pruning',
  'custody': 'child custody', 'attorney': null, 'lawyer': null, 'law firm': null, 'shop': null, 'store': null,
  'products': null, 'collection': null, 'menu': null, 'add to cart': null, 'free shipping': null, 'listings': null,
  'stretch': 'stretch fabric', 'clinic': null, 'medical': null, 'doctor': null, 'construction': 'construction',
  'contractor': null, 'consultant': null, 'by the yard': null, 'crane': 'crane service' };

function count(text, term) {
  const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&'), 'gi');
  return (text.match(re) || []).length;
}

/**
 * @param {object} s  signals
 * @returns {{key,label,schema,cta,verb,services:string[],faq:Function,note?:string}}
 */
function classify(s) {
  const hay = [s.title, s.metaDescription, (s.org && s.org.description), (s.headings.h1 || []).join(' '),
    (s.headings.h2 || []).join(' '), (s.headings.h3 || []).join(' '), s.bodySample, s.siteName,
    String(s.__host || '').replace(/[.-]/g, ' ').replace(/(tree)(care)/i, '$1 $2')].join(' \n ').toLowerCase();
  let best = null;
  for (const ind of INDUSTRIES) {
    const hits = ind.terms.map((t) => [t, count(hay, t)]).filter(([, n]) => n > 0);
    // Headings and the title count double: that is what the business says it is.
    const strong = [s.title, (s.headings.h1 || []).join(' '), (s.headings.h2 || []).join(' '), s.siteName,
      String(s.__host || '')].join(' ').toLowerCase();
    const score = hits.reduce((a, [t, n]) => a + Math.min(n, 6) + (strong.includes(t) ? 3 : 0), 0);
    if (!best || score > best.score) best = { ind, hits, score };
  }
  if (!best || best.score < 2) {
    const ind = s.platform === 'shopify' ? INDUSTRIES.find((i) => i.key === 'retail') : null;
    return ind ? { ...ind, services: [] } : { key: 'general', label: 'Business', schema: null,
      cta: 'Contact us today.', verb: 'offers', services: [],
      faq: (n, w) => [[`What does ${n} do?`, w], [`Where are you located?`, null], [`How do I get started?`, '[First step and contact.]']] };
  }
  // A Shopify site is a store even when its words lean elsewhere.
  if (s.platform === 'shopify' && best.ind.key !== 'retail') {
    const r = INDUSTRIES.find((i) => i.key === 'retail');
    const rh = r.terms.map((t) => [t, count(hay, t)]).filter(([, n]) => n > 0);
    best = { ind: r, hits: rh.length ? rh : best.hits, score: best.score };
  }
  const services = best.hits.sort((a, b) => b[1] - a[1])
    .map(([t]) => (t in PRETTY ? PRETTY[t] : t)).filter(Boolean)
    .filter((t, i, arr) => arr.findIndex((x) => x.includes(t) || t.includes(x)) === i)
    .slice(0, 4);
  return { ...best.ind, services };
}

const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

module.exports = { classify, INDUSTRIES, list };
