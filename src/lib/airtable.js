const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const BASE = import.meta.env.VITE_AIRTABLE_BASE_ID;
const TABLE = import.meta.env.VITE_AIRTABLE_TABLE;
const API = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
const HEADERS = { Authorization: `Bearer ${PAT}` };
const USERS_TABLE = import.meta.env.VITE_AIRTABLE_USERS_TABLE;
const USERS_API = `https://api.airtable.com/v0/${BASE}/${USERS_TABLE}`;

// Field ID → stable camelCase alias (resilient to renames)
// NOTE: Airtable field names are SWAPPED from their contents:
//   "Call Disposition" (fldujucuK2u2W85gw) actually contains CATEGORY values (Welcome-Call, etc.)
//   "Call Category" (fld68ebmlqwuEs86M) actually contains SUB-CATEGORY values
const FIELD_ALIASES = {
  'Call Disposition': 'callCategory',        // fldujucuK2u2W85gw — contains Welcome-Call, Outbound-Service-Followup, etc.
  'Call Category': 'callSubCategory',        // fld68ebmlqwuEs86M — contains sub-category/activation values
  'Evaluation Framework': 'evaluationFramework', // fldXas5cpym8NThbe
};

// Outcome normalization
const OUTCOME_MAP = {
  'cancel-Agent': 'Dropped',
  'cancel-Customer': 'Dropped',
};

function mapRecord(r) {
  const rec = { id: r.id, _createdTime: r.createdTime, ...r.fields };
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

// ── Cache with variable TTL ──
const CACHE_TTL_TODAY = 5 * 60 * 1000;    // 5 min for today
const CACHE_TTL_HISTORICAL = 10 * 60 * 1000; // 10 min for historical
const _cache = {};

function getCached(key, ttl) {
  const entry = _cache[key];
  if (entry && Date.now() - entry.ts < (ttl || CACHE_TTL_TODAY)) return entry.data;
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

export async function fetchTransactionIntents() {
  return fetchCached('transactionIntents', '{Transaction Intent}=1');
}

export async function fetchOpenCallbacks() {
  return fetchCached('openCallbacks', "AND(OR({Callback Status}='Scheduled',{Callback Status}='Overdue',{Callback Status}='Attempted',{Callback Status}='Escalated'),OR({Needs Callback}=1,{Callback Requested}=1))");
}

// ── Fetch records for arbitrary date range ──
export async function fetchRecordsForPeriod(startDate, endDate, onProgress = null) {
  const cacheKey = `period_${startDate}_${endDate}`;
  const isToday = startDate === endDate && startDate === new Date().toISOString().slice(0, 10);
  const ttl = isToday ? CACHE_TTL_TODAY : CACHE_TTL_HISTORICAL;
  const cached = getCached(cacheKey, ttl);
  if (cached) {
    if (onProgress) onProgress({ loaded: cached.length });
    return cached;
  }
  // Use DATETIME_FORMAT to extract date string — raw string comparisons don't work on Date fields
  const formula = startDate === endDate
    ? `IS_SAME({Call Date}, DATETIME_PARSE('${startDate}', 'YYYY-MM-DD'), 'day')`
    : `AND(DATETIME_FORMAT({Call Date},'YYYY-MM-DD')>='${startDate}',DATETIME_FORMAT({Call Date},'YYYY-MM-DD')<='${endDate}')`;
  const data = await fetchAll(formula, onProgress);
  setCache(cacheKey, data);
  return data;
}

export function getLastScrapedTime(records) {
  if (!records || records.length === 0) return null;
  let latest = null;
  for (const r of records) {
    // Prefer Processed At (written by scraper), fall back to Airtable createdTime
    let t = r['Processed At'];
    if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) {
      t = r._createdTime;
    }
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

// ── Agent Coaching Log ──
const COACHING_TABLE = import.meta.env.VITE_AIRTABLE_COACHING_TABLE;
const COACHING_API = `https://api.airtable.com/v0/${BASE}/${COACHING_TABLE}`;

async function fetchAllCoaching(formula = '') {
  let all = [];
  let offset = null;
  do {
    const params = new URLSearchParams();
    if (formula) params.set('filterByFormula', formula);
    if (offset) params.set('offset', offset);
    params.set('pageSize', '100');
    const res = await fetch(`${COACHING_API}?${params}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Airtable coaching ${res.status}`);
    const data = await res.json();
    all = all.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return all.map(r => ({ id: r.id, ...r.fields }));
}

export async function fetchTodayCoaching() {
  const cached = getCached('coaching_today');
  if (cached) return cached;
  const data = await fetchAllCoaching("IS_SAME({Coaching Date}, TODAY(), 'day')");
  setCache('coaching_today', data);
  return data;
}

// ── Pitch Versions & Suggestions ──
const PV_TABLE = import.meta.env.VITE_AIRTABLE_PITCH_VERSIONS_TABLE;
const PS_TABLE = import.meta.env.VITE_AIRTABLE_PITCH_SUGGESTIONS_TABLE;
const PV_API = `https://api.airtable.com/v0/${BASE}/${PV_TABLE}`;
const PS_API = `https://api.airtable.com/v0/${BASE}/${PS_TABLE}`;

export async function fetchAllPitchVersions() {
  const url = new URL(PV_API);
  url.searchParams.set('sort[0][field]',     'Active From');
  url.searchParams.set('sort[0][direction]', 'asc');
  const res = await fetch(url.toString(), { headers: HEADERS });
  const data = await res.json();
  return (data.records || []).map(r => ({ id: r.id, ...r.fields }));
}

export async function fetchLatestSuggestion() {
  const url = new URL(PS_API);
  url.searchParams.set('sort[0][field]',     'Suggestion Date');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('maxRecords',         '3');
  const res = await fetch(url.toString(), { headers: HEADERS });
  const data = await res.json();
  return (data.records || []).map(r => ({ id: r.id, ...r.fields }));
}

export async function updateSuggestionStatus(recordId, status, nimithNotes) {
  await fetch(`${PS_API}/${recordId}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      'Status':       status,
      'Nimith Notes': nimithNotes || '',
    }, typecast: true })
  });
}

export async function approveAndCreateVersion(suggestionId, currentVersionId, suggestion) {
  // 1. Mark old version as Superseded
  const allVersions = await fetchAllPitchVersions();
  const active = allVersions.find(v => v['Status'] === 'Active');
  if (active) {
    await fetch(`${PV_API}/${active.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        'Status':    'Superseded',
        'Active To': new Date().toISOString().split('T')[0],
      }, typecast: true })
    });
  }

  // 2. Compute new version ID
  const lastVersion = allVersions[allVersions.length - 1];
  const lastNum = parseFloat(lastVersion?.['Version ID']?.replace('v','') || '1.0');
  const newVersionId = `v${(lastNum + 0.1).toFixed(1)}`;

  // 3. Create new Pitch Version
  await fetch(PV_API, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields: {
      'Version ID':        newVersionId,
      'Active From':       new Date(Date.now() + 86400000).toISOString().split('T')[0],
      'What Changed':      suggestion['Recommended Change'],
      'Full Script':       suggestion['New Script Section'],
      'Hypothesis':        suggestion['Hypothesis'],
      'Status':            'Active',
      'Hypothesis Verdict': 'Pending',
    }}], typecast: true })
  });

  // 4. Mark suggestion as Approved and link version
  await fetch(`${PS_API}/${suggestionId}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      'Status':                 'Approved',
      'Implemented As Version': newVersionId,
    }, typecast: true })
  });

  return newVersionId;
}

// ── Team Config ──

/**
 * Fetches all active user records from the Users table to build team config.
 * Returns array of { name, role, agentNameMatch, department } for each agent.
 */
export async function fetchTeamConfig() {
  const cached = getCached('team_config', 60 * 60 * 1000); // 1 hour cache
  if (cached) return cached;
  try {
    const params = new URLSearchParams();
    params.set('filterByFormula', '{Active} = TRUE()');
    params.set('maxRecords', '100');
    const res = await fetch(`${USERS_API}?${params}`, { headers: HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    const config = (data.records || []).map(r => ({
      id: r.id,
      name: r.fields['Name'] || '',
      role: r.fields['Role'] || 'AGENT',
      agentNameMatch: r.fields['Agent Name Match'] || '',
      department: r.fields['Department'] || '',
    }));
    setCache('team_config', config);
    return config;
  } catch (e) {
    console.error('fetchTeamConfig error:', e);
    return [];
  }
}
