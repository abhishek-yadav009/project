const { fetchJson } = require('../utils/http');

const SOURCE = '© OpenStreetMap contributors (Nominatim geocoding, Overpass API)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const cache = new Map();
const TTL = 10 * 60 * 1000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

async function geocode(query) {
  return cached(`geo:${query.toLowerCase()}`, async () => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const { data } = await fetchJson(url, { timeout: 10000 });
    if (!data?.length) return null;
    return { lat: Number(data[0].lat), lon: Number(data[0].lon), displayName: data[0].display_name };
  });
}

function address(tags) {
  const line1 = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [line1, tags['addr:city'] || tags['addr:town'] || tags['addr:village'], tags['addr:postcode']].filter(Boolean).join(', ') || tags['addr:full'] || '';
}

function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function nearby({ lat, lon, types, radius }) {
  const key = `near:${lat.toFixed(3)}:${lon.toFixed(3)}:${types.join(',')}:${radius}`;
  return cached(key, async () => {
    const filters = types.map((t) => `nwr["amenity"="${t}"](around:${radius},${lat},${lon});`).join('');
    const query = `[out:json][timeout:20];(${filters});out center tags 60;`;
    let lastErr;
    for (const endpoint of OVERPASS) {
      try {
        const { data } = await fetchJson(endpoint, {
          method: 'POST',
          timeout: 25000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
        });
        const origin = { lat, lon };
        return (data?.elements || [])
          .map((el) => {
            const pos = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
            if (!pos) return null;
            const t = el.tags || {};
            return {
              id: `${el.type}/${el.id}`,
              type: t.amenity,
              name: t.name || (t.amenity === 'pharmacy' ? 'Unnamed pharmacy' : 'Unnamed hospital'),
              address: address(t),
              phone: t.phone || t['contact:phone'] || '',
              website: t.website || t['contact:website'] || '',
              openingHours: t.opening_hours || '',
              emergency: t.emergency || '',
              lat: pos.lat,
              lon: pos.lon,
              distanceKm: Math.round(distanceKm(origin, pos) * 100) / 100,
              directionsUrl: `https://www.openstreetmap.org/directions?route=${lat},${lon};${pos.lat},${pos.lon}`,
              osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.distanceKm - b.distanceKm);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  });
}

module.exports = { geocode, nearby, SOURCE };
