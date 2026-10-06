# S.C.A.L.E.

Siamak Kalhor's consulting method, turned into self-serve software.

**scale.siamakconsulting.com** · self-serve SMB product · Supabase + Vercel + Stripe + Resend

---

## The thesis

> A one-off audit does not justify a subscription. A tracked trajectory does.

Every AI-visibility tool on the market sells a report. A report is read once and
filed. The thing a business owner will actually pay for month after month is
evidence that the line is going up — and the only way to show that is to measure
the same thing, the same way, every month.

That is not a bolt-on. It is literally the fifth stage of the framework:

> **Evaluate** — Monthly measurement of inquiry sources, conversion, and AI
> mention frequency. Refine, repeat, compound.

So **Evaluate is the business model**, not the closing chapter.

## The five dimensions are the five stages

The scoreboard *is* the framework, rather than a generic SEO report wearing its
name. Each dimension maps 1:1 onto a stage:

| Stage | Dimension | Asks |
|---|---|---|
| **S**can | `visibility` | Can AI systems find, read and cite this business? |
| **C**larify | `clarity` | Is the positioning unambiguous and repeatable? |
| **A**mplify | `structure` | Schema, content architecture, retrievability |
| **L**everage | `authority` | Third-party citation and trust transfer |
| **E**valuate | `momentum` | Direction and rate of change over time |

`momentum` is **null on a first scan**, deliberately. There is nothing to measure
against yet. That is the honest reason to come back next month, and inventing a
number there would be the first lie the product tells.

## Why the score is deterministic

`api/_lib/signals.js` extracts facts. `api/_lib/score.js` runs them through a
weighted rubric of named checks. No model is asked to produce the number.

This is the central engineering constraint, and it follows directly from the
thesis. Ask a model to "rate this site out of 100" and it returns a different
answer each run. Six of those in a row is not a trajectory — it is sampling
noise with a subscription attached. If the chart is the product, the
measurement has to be stable.

It also means every point lost names the check that lost it, so the app can
always answer *"why is my score 61?"* with a list. That question is the one
that kills trust in audit tools.

The model still has a job — reading positioning, drafting the Clarify artefact,
writing Amplify content. It just does not get to move the number.

## Status

| | |
|---|---|
| Schema | written — `db/001_init.sql`, RLS on every table |
| Signal extraction | working, tested against 127 real pages |
| Rubric scoring | working — 22 checks across 4 measurable dimensions |
| Scan orchestrator | written — `api/scan.js` |
| Supabase project | **awaiting provisioning** |
| Auth, UI, Stripe | not started |

## Validation run

Scored all 127 pages of siamakconsulting.com. Site average **65**:

```
visibility 93   clarity 69   structure 65   authority 30
```

**107 of 127 pages carry no Person or Organization entity.** The deepest
content on the site — a 4,118-word FAQ, the Long View essays — does not tell a
model who wrote it. That is the finding that made the engine worth building.

## Layout

```
db/001_init.sql        schema, RLS, stage seeding
api/scan.js            orchestrator: fetch -> signals -> score -> persist
api/_lib/signals.js    deterministic extraction (pure, no network, no model)
api/_lib/score.js      weighted rubric -> five dimensions + findings + actions
```

## Known limits

- JSON-LD is found by regex, so a `<script type="application/ld+json">` string
  appearing *inside* JavaScript is counted as a block. Fixing it properly needs
  a real HTML parser.
- Scans the homepage only. Site-wide crawling is the obvious next increment,
  and the validation run above shows exactly why it matters: the homepage
  scored 98 while the site averaged 65.
