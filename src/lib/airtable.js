const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const BASE = import.meta.env.VITE_AIRTABLE_BASE_ID;
const TABLE = import.meta.env.VITE_AIRTABLE_TABLE;
const API = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
const HEADERS = { Authorization: `Bearer ${PAT}` };

// Field ID → stable camelCase alias (resilient to renames)
const FIELD_ALIASES = {
  'Call Disposition': 'callDisposition',   // fldujucuK2u2W85gw
  'Call Category': 'callCategory',         // fld68ebmlqwuEs86M
  'Evaluation Framework': 'evaluationFramework', // fldXas5cpym8NThbe
};

// Outcome normalization
const OUTCOME_MAP = {
  'cancel-Agent': 'Dropped',
  'cancel-Customer': 'Dropped',
};

function mapRecord(r) {
  const rec = { id: r.id, ...r.fields };
  for (const [name, alias] of Object.entries(FIELD_ALIASES)) {
    rec[alias] = rec[name] ?? null;
  }
  // Normalize outcomes
  const raw = rec['Call Outcome'];
  if (raw && OUTCOME_MAP[raw]) {
    rec['Call Outcome'] = OUTCOME_MAP[raw];
  }
  return rec;
}

// ── 5-minute cache ──
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

export function invalidateCache() {
  for (const k of Object.keys(_cache)) delete _cache[k];
}

// ── Fetch with pagination + progress ──
async function fetchAll(formula = '', onProgress = null) {
  let all = [];
  let offset = null;
  do {
    const params = new URLSearchParams();
    if (formula) params.set('filterByFormula', formula);
    if (offset) params.set('offset', offset);
    params.set('pageSize', '100');
    const res = await fetch(`${API}?${params}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = await res.json();
    all = all.concat(data.records || []);
    offset = data.offset;
    if (onProgress) onProgress({ loaded: all.length });
  } while (offset);
  return all.map(mapRecord);
}

export async function fetchTodayWithProgress(onProgress) {
  const cached = getCached('today');
  if (cached) {
    if (onProgress) onProgress({ loaded: cached.length });
    return cached;
  }
  const data = await fetchAll("IS_SAME({Call Date}, TODAY(), 'day')", onProgress);
  setCache('today', data);
  return data;
}

export async function fetchToday() {
  return fetchTodayWithProgress(null);
}

async function fetchCached(key, formula) {
  const cached = getCached(key);
  if (cached) return cached;
  const data = await fetchAll(formula);
  setCache(key, data);
  return data;
}

export async function fetchCallbacks() {
  return fetchCached('callbacks', '{Needs Callback}=1');
}

export async function fetchHotLeads() {
  return fetchCached('hotLeads', '{Hot Lead}=1');
}

export async function fetchLoanSignals() {
  return fetchCached('loans', '{Loan Signal}=1');
}

export async function fetchChurnSignals() {
  return fetchCached('churn', '{Churn Signal}=1');
}

export async function fetchCallbacksRequested() {
  return fetchCached('callbacksRequested', '{Callback Requested}=1');
}

export function getLastScrapedTime(records) {
  if (!records || records.length === 0) return null;
  let latest = null;
  for (const r of records) {
    const t = r['Processed At'];
    if (t && (!latest || t > latest)) latest = t;
  }
  return latest;
}

export async function patchRecord(recordId, fields) {
  const res = await fetch(`${API}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ id: recordId, fields }] }),
  });
  if (!res.ok) throw new Error(`Patch failed ${res.status}`);
  return res.json();
}
