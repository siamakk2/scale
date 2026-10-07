'use strict';
// Temporary: one-off live test of the ChatGPT/Perplexity check. Removed after use.
const crypto = require('crypto');
const { runAnswers } = require('./_lib/answers');
module.exports = async function (req, res) {
  const h = crypto.createHash('sha256').update(String(req.query.key || '')).digest('hex');
  if (h !== '14022ebec35f193d6b87eb44abf7280ab4afbf28352088793bf277abadcca244') return res.status(404).end();
  const t = Date.now();
  const A = await runAnswers({ name: 'Oak Grove Tree II', industry: 'Tree service', services: ['tree removal', 'tree pruning'], where: 'Martinez, CA' }, 'oakgrovetreecare.com');
  res.status(200).json({ ms: Date.now() - t, summary: A.summary, results: A.results.map((r) => ({ q: r.q, e: r.engine, err: r.error, m: r.mentioned, k: r.known, rank: r.rank, named: r.named, src: (r.sources || []).length, text: (r.text || '').slice(0, 300) })) });
};
module.exports.config = { maxDuration: 60 };
