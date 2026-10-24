const { Medication } = require('../models');
const { fetchJson } = require('../utils/http');

const BASE = 'https://rxnav.nlm.nih.gov/REST';
const SOURCE = 'RxNorm (U.S. National Library of Medicine)';
const CACHE_MS = 30 * 24 * 60 * 60 * 1000;

async function ingredientsFor(rxcui) {
  const props = await fetchJson(`${BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`);
  const p = props.data?.properties;
  if (p?.tty === 'IN') return { tty: p.tty, matchedName: p.name, ingredients: [{ name: p.name.toLowerCase(), rxcui }] };
  const rel = await fetchJson(`${BASE}/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=IN`);
  const groups = rel.data?.relatedGroup?.conceptGroup || [];
  const ingredients = groups
    .flatMap((g) => g.conceptProperties || [])
    .map((c) => ({ name: c.name.toLowerCase(), rxcui: c.rxcui }));
  return { tty: p?.tty || null, matchedName: p?.name || null, ingredients };
}

/**
 * Resolve a free-text medicine name to an RxNorm concept and its active ingredients.
 * Returns lookupStatus: found | not_found | unavailable (network/service failure, never cached).
 */
async function resolveMedicine(name) {
  const queryName = String(name || '').trim();
  const nameKey = queryName.toLowerCase();
  if (!nameKey) return { queryName, lookupStatus: 'not_found', ingredients: [], source: SOURCE };

  const cached = await Medication.findOne({ nameKey });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_MS) return cached.toObject();

  try {
    const exact = await fetchJson(`${BASE}/rxcui.json?name=${encodeURIComponent(queryName)}&search=2`);
    let rxcui = exact.data?.idGroup?.rxnormId?.[0] || null;
    if (!rxcui) {
      const approx = await fetchJson(`${BASE}/approximateTerm.json?term=${encodeURIComponent(queryName)}&maxEntries=1`);
      rxcui = approx.data?.approximateGroup?.candidate?.find((c) => c.rxcui)?.rxcui || null;
    }
    const doc = { nameKey, queryName, fetchedAt: new Date(), source: SOURCE };
    if (!rxcui) {
      Object.assign(doc, { lookupStatus: 'not_found', rxcui: null, matchedName: null, tty: null, ingredients: [] });
    } else {
      const info = await ingredientsFor(rxcui);
      Object.assign(doc, { lookupStatus: 'found', rxcui, ...info });
    }
    const saved = await Medication.findOneAndUpdate({ nameKey }, doc, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
    return saved.toObject();
  } catch (err) {
    console.warn(`[rxnorm] Lookup failed for "${queryName}": ${err.message}`);
    return { queryName, lookupStatus: 'unavailable', rxcui: null, matchedName: null, ingredients: [], source: SOURCE, error: err.message };
  }
}

async function searchMedicines(q) {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const r = await fetchJson(`${BASE}/drugs.json?name=${encodeURIComponent(term)}`);
  const groups = r.data?.drugGroup?.conceptGroup || [];
  let results = groups
    .flatMap((g) => (g.conceptProperties || []).map((c) => ({ rxcui: c.rxcui, name: c.name, tty: c.tty })))
    .slice(0, 25);
  if (!results.length) {
    const approx = await fetchJson(`${BASE}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=10`);
    const seen = new Set();
    results = (approx.data?.approximateGroup?.candidate || [])
      .filter((c) => c.rxcui && c.name && c.source === 'RXNORM' && !seen.has(c.rxcui) && seen.add(c.rxcui))
      .map((c) => ({ rxcui: c.rxcui, name: c.name, tty: null }));
  }
  return results;
}

module.exports = { resolveMedicine, searchMedicines, SOURCE };
