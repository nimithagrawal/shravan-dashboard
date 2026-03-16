const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const BASE = import.meta.env.VITE_AIRTABLE_BASE_ID;
const TABLE = import.meta.env.VITE_AIRTABLE_MASTER_SUBSCRIBERS_TABLE;
const API = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
const HEADERS = { Authorization: `Bearer ${PAT}` };

// ── Cache with 5-min TTL ──
const CACHE_TTL = 5 * 60 * 1000;
const _cache = {};

function getCached(key) {
  const entry = _cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  _cache[key] = { data, ts: Date.now() };
}

export function invalidateSubscriberCache() {
  for (const k of Object.keys(_cache)) delete _cache[k];
}

function mapRecord(r) {
  return { id: r.id, _createdTime: r.createdTime, ...r.fields };
}

/**
 * fetchAgentCallbacks — Fetches subscribers from MASTER_SUBSCRIBERS where:
 *   - Last Call Agent = agentName
 *   - Next Call Briefing is not empty
 *   - Current Status != "Activated"
 *   - Do Not Call Flag != 1
 * Sorted by Last Call Date descending, max 20 records.
 */
export async function fetchAgentCallbacks(agentName) {
  if (!agentName) return [];

  const cacheKey = `callbacks_${agentName}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const formula = `AND(
    {Last Call Agent}="${agentName}",
    {Next Call Briefing}!="",
    {Current Status}!="Activated",
    {Do Not Call Flag}!=1
  )`.replace(/\n\s*/g, '');

  const params = new URLSearchParams();
  params.set('filterByFormula', formula);
  params.set('sort[0][field]', 'Last Call Date');
  params.set('sort[0][direction]', 'desc');
  params.set('maxRecords', '20');

  const res = await fetch(`${API}?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Airtable subscribers ${res.status}`);
  const data = await res.json();
  const records = (data.records || []).map(mapRecord);

  setCache(cacheKey, records);
  return records;
}

/**
 * fetchPostActivationWastes — Fetches subscribers where:
 *   - Current Status = "Activated"
 *   - Called Today = 1
 * These are post-activation waste alerts (calls made to already-activated subscribers).
 */
export async function fetchPostActivationWastes() {
  const cacheKey = 'postActivationWaste';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const formula = 'AND({Current Status}="Activated",{Called Today}=1)';

  const params = new URLSearchParams();
  params.set('filterByFormula', formula);
  params.set('pageSize', '100');

  const res = await fetch(`${API}?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Airtable subscribers ${res.status}`);
  const data = await res.json();
  const records = (data.records || []).map(mapRecord);

  setCache(cacheKey, records);
  return records;
}
