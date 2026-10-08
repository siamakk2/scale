#!/usr/bin/env python3
"""Builds /privacy and /terms for S.C.A.L.E.

Written from what the app actually does (checked against db/001_init.sql and
api/*.js on 2026-10-06), not from a template. If the app starts collecting
something new, change the facts here first, then rebuild:

    python3 scripts/build-legal.py
"""
import os, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPDATED = "October 7, 2026"  # AI answer check (OpenAI, Perplexity) added

def page(slug, title, desc, h1, intro, sections):
    toc = "".join(f'<li><a href="#{sid}">{html.escape(h)}</a></li>' for sid, h, _ in sections)
    body = "".join(f'<section id="{sid}"><h2>{html.escape(h)}</h2>{b}</section>' for sid, h, b in sections)
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc, quote=True)}">
<link rel="canonical" href="https://scale.siamakconsulting.com/{slug}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="S.C.A.L.E. by Siamak Kalhor">
<meta property="og:url" content="https://scale.siamakconsulting.com/{slug}">
<meta property="og:title" content="{html.escape(title, quote=True)}">
<meta property="og:description" content="{html.escape(desc, quote=True)}">
<meta property="og:image" content="https://scale.siamakconsulting.com/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="S.C.A.L.E. — See your business the way AI sees it">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(title, quote=True)}">
<meta name="twitter:description" content="{html.escape(desc, quote=True)}">
<meta name="twitter:image" content="https://scale.siamakconsulting.com/assets/og.png">
<meta name="theme-color" content="#000000">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/app.css">
<link rel="stylesheet" href="/assets/landing.css?v=5">
<style>
.legal{{max-width:760px;margin:0 auto;padding:56px 24px 40px}}
.legal .kicker{{font-family:var(--mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin-bottom:14px}}
.legal h1{{font-family:var(--display);font-size:clamp(32px,6vw,46px);line-height:1.1;margin-bottom:14px}}
.legal .upd{{font-family:var(--mono);font-size:12.5px;color:var(--muted);margin-bottom:22px}}
.legal .intro{{font-size:17px;line-height:1.75;color:var(--text);margin-bottom:26px}}
.legal .toc{{border:1px solid var(--line);border-radius:14px;padding:18px 22px;margin-bottom:34px;background:rgba(17,24,38,.6)}}
.legal .toc b{{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}}
.legal .toc ol{{margin:0;padding-left:20px;columns:2;column-gap:28px}}
.legal .toc li{{font-size:14.5px;line-height:1.9}}
.legal .toc a,.legal section a{{color:var(--amber);text-decoration:none}}
.legal .toc a:hover,.legal section a:hover{{text-decoration:underline}}
.legal section{{padding:26px 0;border-top:1px solid var(--line);scroll-margin-top:80px}}
.legal h2{{font-family:var(--display);font-size:22px;margin-bottom:12px}}
.legal h3{{font-family:var(--display);font-size:16.5px;margin:16px 0 6px;color:var(--text)}}
.legal p,.legal li{{font-size:15.5px;line-height:1.75;color:#c9d4e2}}
.legal p+p{{margin-top:10px}}
.legal ul{{padding-left:20px;margin:8px 0}}
.legal li+li{{margin-top:6px}}
.legal strong{{color:var(--text)}}
.legal .box{{border:1px solid rgba(255,180,84,.35);background:rgba(255,180,84,.06);border-radius:12px;padding:16px 18px;margin-top:12px}}
.legal table{{width:100%;border-collapse:collapse;margin-top:10px;font-size:14.5px}}
.legal th,.legal td{{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top;color:#c9d4e2}}
.legal th{{font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}}
.legal .tw{{overflow-x:auto}}
@media(max-width:600px){{.legal .toc ol{{columns:1}}.legal{{padding-top:36px}}}}
</style>
</head>
<body>
<header class="lp-top">
  <div class="in">
    <a class="logo" href="/" aria-label="S.C.A.L.E. home">S<b>.</b>C<b>.</b>A<b>.</b>L<b>.</b>E<b>.</b></a>
    <nav class="lp-nav"><a href="/app/" class="btn btn-ghost">Sign in</a></nav>
  </div>
</header>
<main class="legal">
  <div class="kicker">S.C.A.L.E. · Legal</div>
  <h1>{h1}</h1>
  <div class="upd">Last updated: {UPDATED}</div>
  <p class="intro">{intro}</p>
  <nav class="toc" aria-label="Contents"><b>Contents</b><ol>{toc}</ol></nav>
  {body}
</main>
<footer class="lp-foot">
  <div class="in">
    <span>&copy; 2026 Siamak Kalhor Consulting &middot; Los Angeles</span>
    <span><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot;
      <a href="https://siamakconsulting.com/">siamakconsulting.com</a></span>
  </div>
</footer>
</body>
</html>
'''

CONTACT = ('Siamak Kalhor Consulting, 530 E 8th St, Los Angeles, CA 90014 · '
           '<a href="mailto:siamakk2@gmail.com">siamakk2@gmail.com</a> · (323) 657-7752')

privacy = [
("who", "Who we are",
 "<p>S.C.A.L.E. (scale.siamakconsulting.com) is operated by Siamak Kalhor, doing business as Siamak Kalhor Consulting "
 "(“we”, “us”). This policy covers the S.C.A.L.E. app only. The consulting website at siamakconsulting.com has "
 "<a href=\"https://siamakconsulting.com/privacy\">its own privacy policy</a>.</p>"
 f"<p>Contact for anything in this policy: {CONTACT}.</p>"),
("free-scan", "The free scan (no account)",
 "<p>When you run a scan without an account, you give us one thing: <strong>a website address</strong>. Our server "
 "fetches that public page once, checks it, and sends the result back to your browser.</p>"
 "<ul><li>We <strong>do not save</strong> the address or the result to our database.</li>"
 "<li>Like every website, the request passes through our hosting provider (Vercel), whose logs record your IP address "
 "and request details for operation and security.</li>"
 "<li>Your browser may remember the last address you typed (in its local storage) so the form is pre-filled next time. "
 "It stays on your device.</li></ul>"),
("account", "If you create an account",
 "<p>An account lets the app remember your scans so it can measure change month to month. We store:</p>"
 "<div class=\"tw\"><table><thead><tr><th>What</th><th>Why</th></tr></thead><tbody>"
 "<tr><td>Your email address</td><td>To send your sign-in links and identify your account</td></tr>"
 "<tr><td>Business name, website address and, if you give it, your industry</td><td>To know which site to scan</td></tr>"
 "<tr><td>Scan history: scores, findings, the date, and the signals read from your <em>public</em> web page "
 "(title, headings, structured data, links)</td><td>So the next scan can show what changed</td></tr>"
 "<tr><td>The questions we asked ChatGPT and Perplexity about your business, and their answers</td><td>So you can see whether AI names you, and how that changes</td></tr>"
 "<tr><td>Your action list, what you mark done or dismissed, and your stage progress</td><td>So your plan carries over between visits</td></tr>"
 "<tr><td>Positioning statements you write in the app, if any</td><td>So you can refine them over time</td></tr>"
 "</tbody></table></div>"
 "<p>We don't ask for a password, your phone number or your address.</p>"
 "<h3>If you buy a plan</h3><p>Payment is handled entirely by Stripe. We receive and store your Stripe "
 "customer and subscription IDs, your plan, its status and renewal date. <strong>We never see or store your card "
 "number.</strong> Stripe processes your payment details under "
 "<a href=\"https://stripe.com/privacy\">its own privacy policy</a>.</p>"),
("signin", "Sign-in, cookies and tracking",
 "<p>Sign-in is passwordless: we email you a single-use link. When you use it, a session token is saved in your "
 "browser's local storage so you stay signed in. That's the only thing the app stores on your device besides the "
 "pre-filled website address.</p>"
 "<div class=\"box\"><p><strong>No advertising cookies, no analytics trackers, no ad pixels</strong> run in the S.C.A.L.E. app.</p></div>"),
("ai", "AI and your data",
 "<p><strong>Your score</strong> is produced by our own rules-based engine: thirty named checks. No AI model is involved "
 "in scoring, so the same page always gets the same score.</p>"
 "<h3>The ChatGPT and Perplexity check</h3>"
 "<p>To show you whether AI assistants actually recommend you, the app asks <strong>OpenAI (ChatGPT)</strong> and "
 "<strong>Perplexity</strong> a few questions a customer might ask, through their business APIs. For example: "
 "<em>“Who are the best tree service companies in Martinez, CA?”</em> and <em>“What can you tell me about "
 "[your business] ([your website])?”</em></p>"
 "<ul><li><strong>What we send:</strong> only those questions. They contain your business's public name, website "
 "address, town and type of work, as read from your public home page.</li>"
 "<li><strong>What we don't send:</strong> your email address, your account details, payment details, or anything "
 "else about you as a person.</li>"
 "<li><strong>What we keep:</strong> the questions, the answers, the businesses and websites the answers named, and "
 "the date, stored with that scan so you can see how answers change over time.</li>"
 "<li>OpenAI and Perplexity process the questions under their own API terms and privacy policies "
 "(<a href=\"https://openai.com/policies/privacy-policy\">OpenAI</a>, "
 "<a href=\"https://www.perplexity.ai/hub/legal/privacy-policy\">Perplexity</a>). We don't ask them to remember "
 "anything about you.</li></ul>"
 "<p>The free scan without an account does not use this check. We do not use your data to train AI models.</p>"),
("use", "How we use information",
 "<ul><li>To run scans, show your results and keep your history.</li>"
 "<li>To send sign-in emails. We'll only send anything else, such as product news, if you opt in.</li>"
 "<li>To keep the service secure and prevent abuse.</li>"
 "<li>To answer you when you contact us.</li>"
 "<li>To improve the checks using aggregated, de-identified statistics (for example, how often a check fails across "
 "all sites), never in a way that identifies you or your business.</li></ul>"
 "<p><strong>We do not sell or share your personal information</strong>, as those terms are defined in California law, "
 "and we don't use it for cross-site advertising.</p>"),
("providers", "Service providers",
 "<p>These companies process data on our behalf, only to run the service:</p>"
 "<div class=\"tw\"><table><thead><tr><th>Provider</th><th>Role</th><th>Location</th></tr></thead><tbody>"
 "<tr><td>Supabase</td><td>Database and sign-in</td><td>United States (Ohio)</td></tr>"
 "<tr><td>Vercel</td><td>Hosting the app</td><td>United States and global edge network</td></tr>"
 "<tr><td>Resend</td><td>Sending sign-in emails</td><td>United States</td></tr>"
 "<tr><td>Stripe</td><td>Payments and subscriptions, for paid plans</td><td>United States</td></tr>"
 "<tr><td>OpenAI</td><td>Answers the ChatGPT check's questions (business name, website, town and type of work only)</td><td>United States</td></tr>"
 "<tr><td>Perplexity</td><td>Answers the Perplexity check's questions (same information)</td><td>United States</td></tr>"
 "</tbody></table></div>"
 ),
("retention", "How long we keep it",
 "<ul><li>Account data, including scan history, is kept while your account is open. The history <em>is</em> the product, "
 "so we don't delete it on our own.</li>"
 "<li>When you ask us to delete your account, we delete it and everything attached to it within 30 days. Copies in "
 "routine backups expire on the backup schedule after that.</li>"
 "<li>Hosting logs are kept for the period set by our hosting provider.</li></ul>"),
("rights", "Your choices and rights",
 "<p>You can ask us to <strong>show you</strong>, <strong>correct</strong>, <strong>export</strong> or "
 "<strong>delete</strong> the information we hold about you. Email "
 "<a href=\"mailto:siamakk2@gmail.com\">siamakk2@gmail.com</a> from the address on your account; we confirm it's you by "
 "replying to that address.</p>"
 "<p><strong>California residents</strong> have these rights under the California Consumer Privacy Act, including the "
 "right to know what we collect, to delete and correct it, and to opt out of its sale or sharing (we don't sell or "
 "share it). We won't treat you differently for using any of these rights.</p>"),
("security", "Security",
 "<p>All traffic is encrypted (HTTPS). In the database, each account can read only its own records; this is enforced "
 "by the database itself, not just the app. Scores can only be written by our server, so no one can alter a score. "
 "No system is perfectly secure, and if we ever learn of a breach affecting you, we'll tell you.</p>"),
("children", "Children",
 "<p>S.C.A.L.E. is a business tool for adults. It isn't directed to anyone under 18, and we don't knowingly collect "
 "information from children. If you think a child has given us information, contact us and we'll delete it.</p>"),
("site-owners", "If your website was scanned",
 "<p>The scanner reads only public pages, the way a browser or search engine would: the home page, plus the "
 "site's <code>robots.txt</code>, <code>sitemap.xml</code> and <code>llms.txt</code> files. It "
 "identifies itself as <code>ScaleScan/1.0</code>. If you own a site and want it excluded, email us and we'll block it.</p>"),
("changes", "Changes to this policy",
 "<p>If we change what we collect or how we use it, we'll update this page and the date at the top. If the change is "
 "significant, we'll email account holders before it takes effect.</p>"),
]

terms = [
("agreement", "Agreement",
 "<p>These terms govern your use of S.C.A.L.E. at scale.siamakconsulting.com (the “Service”), operated by Siamak "
 "Kalhor, doing business as Siamak Kalhor Consulting (“we”, “us”). By using the Service you agree to these terms and "
 "to our <a href=\"/privacy\">Privacy Policy</a>. If you don't agree, please don't use the Service.</p>"
 "<p>You must be at least 18 and, if you use the Service for a business, have authority to accept these terms for it.</p>"),
("service", "What the Service is",
 "<p>S.C.A.L.E. reads a public web page, runs it through a fixed set of named checks, and gives you scores across five "
 "dimensions and a ranked list of suggested fixes with step-by-step lessons. With an account it also asks ChatGPT and "
 "Perplexity questions about your type of business and shows their answers. A free account keeps your history so later "
 "scans can show change.</p>"
 "<p>The Service is new and still evolving. We may add, change or remove features, and we may limit or pause access "
 "when needed, for example to prevent abuse.</p>"),
("account", "Your account",
 "<ul><li>Give a real email address you control. Anyone with access to your inbox can sign in, so keep it secure.</li>"
 "<li>One account per person; don't share sign-in links.</li>"
 "<li>You're responsible for activity in your account. Tell us promptly if you suspect misuse.</li></ul>"),
("acceptable-use", "Acceptable use",
 "<p>Scan websites you own or manage, or public pages you have a legitimate reason to evaluate, such as a "
 "competitor's homepage for comparison. Don't:</p>"
 "<ul><li>use the Service to overload, probe, attack or test the security of any website;</li>"
 "<li>scan in bulk, automate requests, or get around rate limits;</li>"
 "<li>try to access other people's accounts or data, or interfere with the Service;</li>"
 "<li>copy, resell or repackage the Service, its scores or its checks as your own product;</li>"
 "<li>use it for anything unlawful.</li></ul>"
 "<p>We may suspend or close accounts that break these rules.</p>"),
("scores", "What the scores are, and aren't",
 "<div class=\"box\"><p>Scores are an <strong>informational assessment of public signals</strong> on a web page. They "
 "are <strong>not a guarantee</strong> of search rankings, of being mentioned or recommended by any AI system, or of "
 "any business result.</p></div>"
 "<p>The ChatGPT and Perplexity answers we show are produced by those companies, not by us. They vary from day to day "
 "and person to person, may be wrong or out of date, and are shown as a snapshot, not a ranking. "
 "AI assistants and search engines are run by other companies, use signals we can't see, and change without notice. "
 "Suggested fixes are general guidance, not legal, financial or other professional advice, and you decide whether and "
 "how to act on them.</p>"),
("content", "Your data and our rights",
 "<p>You own the information you enter and the results about your business. You give us permission to store and "
 "process it only as needed to run and improve the Service, as described in the Privacy Policy.</p>"
 "<p>The S.C.A.L.E. name, the S.C.A.L.E. Framework, the checks and scoring method, and the software belong to Siamak "
 "Kalhor Consulting. You may share your own results freely; please don't present the Service or its methodology as "
 "your own.</p>"),
("plans", "Plans, billing and cancellation",
 "<p>S.C.A.L.E. has a free plan and two paid plans, <strong>Growth ($29 a month)</strong> and <strong>Scale ($99 a "
 "month)</strong>, as described on the <a href=\"/#pricing\">pricing section</a>. Prices are in US dollars and "
 "exclude any taxes that apply.</p>"
 "<ul><li><strong>Automatic renewal.</strong> Paid plans are billed monthly in advance and <strong>renew automatically "
 "each month until you cancel</strong>. Your card is charged on the same day each month through Stripe.</li>"
 "<li><strong>Cancel any time, online.</strong> Open your dashboard and choose <em>Manage billing</em>, then cancel. "
 "Cancellation stops the next renewal; you keep your paid plan until the end of the period you already paid for, "
 "then your account moves to Free. Your scan history is kept.</li>"
 "<li><strong>Changing plans.</strong> You can switch between Growth and Scale in <em>Manage billing</em>; Stripe "
 "adjusts the charge for the rest of the month.</li>"
 "<li><strong>Refunds.</strong> Monthly charges are not refunded for partly used months, except where the law "
 "requires it. If something went wrong, such as a duplicate charge, email us and we'll put it right.</li>"
 "<li><strong>Failed payments.</strong> If a renewal fails, Stripe retries it and your plan stays on for a short grace "
 "period. If payment still fails, the account moves to Free.</li>"
 "<li><strong>Price changes.</strong> We'll email you at least 30 days before any price change takes effect for your "
 "plan, so you can cancel first if you prefer.</li></ul>"
 "<p>Consulting services bought from siamakconsulting.com, such as a strategy session or the AI Authority Audit, "
 "are separate purchases covered by the terms on that site.</p>"),
("ending", "Ending your use",
 "<p>You can stop using the Service at any time and ask us to delete your account (see the Privacy Policy). We may "
 "suspend or end access for misuse or if we discontinue the Service; if we discontinue it, we'll give account holders "
 "reasonable notice and a way to export their history.</p>"),
("disclaimer", "Disclaimer",
 "<p>The Service is provided “as is” and “as available”. To the fullest extent the law allows, we disclaim all "
 "warranties, express or implied, including merchantability, fitness for a particular purpose, accuracy and "
 "non-infringement. We don't promise the Service will be uninterrupted or error-free.</p>"),
("liability", "Limitation of liability",
 "<p>To the fullest extent the law allows, we aren't liable for indirect, incidental, special, consequential or "
 "punitive damages, or for lost profits, revenue, data or goodwill, arising from your use of the Service. Our total "
 "liability for any claim relating to the Service is limited to the greater of the amount you paid us for the Service "
 "in the 12 months before the claim, or US $100.</p>"
 "<p>Some jurisdictions don't allow some of these limits, so they may not all apply to you.</p>"),
("indemnity", "Indemnity",
 "<p>If you use the Service in breach of these terms or the law, and that leads to a claim against us, you agree to "
 "cover the reasonable costs of that claim.</p>"),
("law", "Governing law and disputes",
 "<p>These terms are governed by the laws of the State of California, without regard to conflict-of-laws rules. Any "
 "dispute will be resolved in the state or federal courts in Los Angeles County, California. Before filing a claim, "
 "you agree to contact us first so we can try to resolve it informally.</p>"),
("general", "Changes and general terms",
 "<p>We may update these terms. We'll change the date at the top and, for significant changes, email account holders "
 "before they take effect. Continuing to use the Service after that means you accept the updated terms.</p>"
 "<p>If any part of these terms can't be enforced, the rest still applies. Not enforcing a right isn't a waiver of it. "
 "These terms and the Privacy Policy are the whole agreement between us about the Service.</p>"
 f"<p>Questions: {CONTACT}.</p>"),
]

for slug, title, desc, h1, intro, secs in [
    ("privacy", "Privacy Policy — S.C.A.L.E.",
     "What S.C.A.L.E. collects, why, who processes it, and your rights. Written from what the app actually does.",
     "Privacy Policy",
     "Written from what the app actually does, in plain English. The short version: the free scan saves nothing, an "
     "account stores your email and your scan history, there are no ad trackers, and we never sell your data.",
     privacy),
    ("terms", "Terms of Service — S.C.A.L.E.",
     "The terms for using S.C.A.L.E.: acceptable use, what the scores mean, your data, and liability.",
     "Terms of Service",
     "The rules for using S.C.A.L.E., in plain English. The key points: scan sites you have a reason to scan, the "
     "scores are guidance rather than a guarantee, and your data stays yours.",
     terms)]:
    os.makedirs(os.path.join(ROOT, slug), exist_ok=True)
    open(os.path.join(ROOT, slug, "index.html"), "w", encoding="utf-8").write(page(slug, title, desc, h1, intro, secs))
    print("built", slug)
