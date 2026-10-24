const config = require('../config');
const { fetchJson } = require('../utils/http');

const SOURCE = 'openFDA Drug Label API (FDA Structured Product Labeling)';
const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map();
const SECTIONS = ['boxed_warning', 'contraindications', 'drug_interactions'];

/**
 * Fetch the FDA label for an active ingredient. Returns { status: 'found'|'not_found', sections, setId, ... }.
 * Throws on network/service failure so callers can report "unavailable" rather than "no interactions".
 */
async function getLabel(ingredient) {
  const key = ingredient.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const search = `openfda.generic_name:"${ingredient.replace(/"/g, '')}"`;
  const keyParam = config.openFdaApiKey ? `&api_key=${encodeURIComponent(config.openFdaApiKey)}` : '';
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(search)}&limit=1${keyParam}`;
  const { notFound, data } = await fetchJson(url, { timeout: 12000 });

  let value;
  if (notFound || !data?.results?.length) {
    value = { status: 'not_found' };
  } else {
    const r = data.results[0];
    const sections = {};
    for (const s of SECTIONS) if (Array.isArray(r[s])) sections[s] = r[s].join(' ');
    value = {
      status: 'found',
      sections,
      setId: r.set_id || null,
      effectiveTime: r.effective_time || null,
      genericName: r.openfda?.generic_name?.[0] || ingredient,
      url: r.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${r.set_id}` : '',
    };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

function findMention(label, term) {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  for (const section of SECTIONS) {
    const text = label.sections?.[section];
    if (!text) continue;
    const m = re.exec(text);
    if (!m) continue;
    const start = Math.max(0, text.lastIndexOf('.', m.index - 1) + 1, m.index - 250);
    let end = text.indexOf('.', m.index + term.length);
    end = end === -1 ? Math.min(text.length, m.index + 350) : Math.min(end + 1, m.index + 400);
    return { section: section.replace('_', ' '), excerpt: text.slice(start, end).trim() };
  }
  return null;
}

module.exports = { getLabel, findMention, SOURCE };
