// ── Shravan Dashboard — Airtable access layer ────────────────────────────
// When VITE_SHRAVAN_PROXY_URL is set: all requests go through Modal proxy (production).
// When not set: falls back to direct Airtable PAT (local dev only).

const PROXY_URL = import.meta.env.VITE_SHRAVAN_PROXY_URL;
const USE_PROXY = !!PROXY_URL;

// Direct Airtable config (fallback for local dev)
const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const BASE = import.meta.env.VITE_AIRTABLE_BASE_ID;
const TABLE = import.meta.env.VITE_AIRTABLE_TABLE;
const DIRECT_API = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
const DIRECT_HEADERS = PAT ? { Authorization: `Bearer ${PAT}` } : {};

// Table alias → direct Airtable table ID (for fallback mode)
const TABLE_IDS = {
  calls:             import.meta.env.VITE_AIRTABLE_TABLE,
  coaching:          import.meta.env.VITE_AIRTABLE_COACHING_TABLE,
  pitch_versions:    import.meta.env.VITE_AIRTABLE_PITCH_VERSIONS_TABLE,
  pitch_suggestions: import.meta.env.VITE_AIRTABLE_PITCH_SUGGESTIONS_TABLE,
  users:             import.meta.env.VITE_AIRTABLE_USERS_TABLE,
  family_health:     import.meta.env.VITE_AIRTABLE_FAMILY_HEALTH_TABLE || 'tblsqr0zMaE4zSRlA',
  team_config:       import.meta.env.VITE_AIRTABLE_TEAM_CONFIG_TABLE   || '',
};

// Field ID → stable camelCase alias (resilient to renames)
const FIELD_ALIASES = {
  'Call Disposition': 'callCategory',
  'Call Category': 'callSubCategory',
  'Evaluation Framework': 'evaluationFramework',
};

const OUTCOME_MAP = {
  'cancel-Agent': 'Dropped',
  'cancel-Customer': 'Dropped',
};

function mapRecord(r) {
  const fields = r.fields || r;
  const rec = { id: r.id, _createdTime: r.createdTime, ...fields };
  for (const [name, alias] of Object.entries(FIELD_ALIASES)) {
    rec[alias] = rec[name] ?? null;
  }
  const raw = rec['Call Outcome'];
  if (raw && OUTCOME_MAP[raw]) {
    rec['Call Outcome'] = OUTCOME_MAP[raw];
  }
  return rec;
}

// ── Auth token ──
function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || sessionStorage.getItem('shravan_token') || '';
}

// ── Proxy fetch helper ──
async function proxyFetch(table, { formula = '', fields = null, action = 'read', records = null } = {}) {
  const body = { token: getToken(), table, action };
  if (formula) body.formula = formula;
  if (fields) body.fields = fields;
  if (records) body.records = records;

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Proxy ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Direct Airtable fetch (fallback) ──
async function directFetchAll(tableAlias, formula = '', onProgress = null) {
  const tableId = TABLE_IDS[tableAlias] || tableAlias;
  const url = `https://api.airtable.com/v0/${BASE}/${tableId}`;
  let all = [];
  let offset = null;
  do {
    const params = new URLSearchParams();
    if (formula) params.set('filterByFormula', formula);
    if (offset) params.set('offset', offset);
    params.set('pageSize', '100');
    const res = await fetch(`${url}?${params}`, { headers: DIRECT_HEADERS });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = await res.json();
    all = all.concat(data.records || []);
    offset = data.offset;
    if (onProgress) onProgress({ loaded: all.length });
  } while (offset);
  return all.map(mapRecord);
}

async function directPatch(tableAlias, records) {
  const tableId = TABLE_IDS[tableAlias] || tableAlias;
  const url = `https://api.airtable.com/v0/${BASE}/${tableId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...DIRECT_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error(`Patch failed ${res.status}`);
  return res.json();
}

async function directCreate(tableAlias, records) {
  const tableId = TABLE_IDS[tableAlias] || tableAlias;
  const url = `https://api.airtable.com/v0/${BASE}/${tableId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...DIRECT_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records, typecast: true }),
  });
  if (!res.ok) throw new Error(`Create failed ${res.status}`);
  return res.json();
}

// ── Cache ──
const CACHE_TTL_TODAY = 5 * 60 * 1000;
const CACHE_TTL_HISTORICAL = 10 * 60 * 1000;
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

// ── Unified fetch (proxy or direct) ──
async function fetchAll(tableAlias, formula = '', onProgress = null) {
  if (USE_PROXY) {
    const data = await proxyFetch(tableAlias, { formula });
    const records = (data.records || []).map(mapRecord);
    if (onProgress) onProgress({ loaded: records.length });
    return records;
  }
  return directFetchAll(tableAlias, formula, onProgress);
}

export async function fetchTodayWithProgress(onProgress) {
  const cached = getCached('today');
  if (cached) {
    if (onProgress) onProgress({ loaded: cached.length });
    return cached;
  }
  const data = await fetchAll('calls', "IS_SAME({Call Date}, TODAY(), 'day')", onProgress);
  setCache('today', data);
  return data;
}

export async function fetchToday() {
  return fetchTodayWithProgress(null);
}

async function fetchCached(key, formula) {
  const cached = getCached(key);
  if (cached) return cached;
  const data = await fetchAll('calls', formula);
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

export async function fetchRecordsForPeriod(startDate, endDate, onProgress = null) {
  const cacheKey = `period_${startDate}_${endDate}`;
  const isToday = startDate === endDate && startDate === new Date().toISOString().slice(0, 10);
  const ttl = isToday ? CACHE_TTL_TODAY : CACHE_TTL_HISTORICAL;
  const cached = getCached(cacheKey, ttl);
  if (cached) {
    if (onProgress) onProgress({ loaded: cached.length });
    return cached;
  }
  const formula = startDate === endDate
    ? `IS_SAME({Call Date}, DATETIME_PARSE('${startDate}', 'YYYY-MM-DD'), 'day')`
    : `AND(DATETIME_FORMAT({Call Date},'YYYY-MM-DD')>='${startDate}',DATETIME_FORMAT({Call Date},'YYYY-MM-DD')<='${endDate}')`;
  const data = await fetchAll('calls', formula, onProgress);
  setCache(cacheKey, data);
  return data;
}

export function getLastScrapedTime(records) {
  if (!records || records.length === 0) return null;
  let latest = null;
  for (const r of records) {
    let t = r['Processed At'];
    if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) {
      t = r._createdTime;
    }
    if (t && (!latest || t > latest)) latest = t;
  }
  return latest;
}

export async function patchRecord(recordId, fields) {
  if (USE_PROXY) {
    await proxyFetch('calls', {
      action: 'patch',
      records: [{ id: recordId, fields }],
    });
  } else {
    await directPatch('calls', [{ id: recordId, fields }]);
  }
}

// ── Agent Coaching Log ──

export async function fetchTodayCoaching() {
  const cached = getCached('coaching_today');
  if (cached) return cached;

  if (USE_PROXY) {
    const result = await proxyFetch('coaching', { formula: "IS_SAME({Coaching Date}, TODAY(), 'day')" });
    const data = (result.records || []).map(r => ({ id: r.id, ...r.fields }));
    setCache('coaching_today', data);
    return data;
  }

  // Direct fallback
  const tableId = TABLE_IDS.coaching;
  const url = `https://api.airtable.com/v0/${BASE}/${tableId}`;
  let all = [];
  let offset = null;
  do {
    const params = new URLSearchParams();
    params.set('filterByFormula', "IS_SAME({Coaching Date}, TODAY(), 'day')");
    if (offset) params.set('offset', offset);
    params.set('pageSize', '100');
    const res = await fetch(`${url}?${params}`, { headers: DIRECT_HEADERS });
    if (!res.ok) throw new Error(`Airtable coaching ${res.status}`);
    const data = await res.json();
    all = all.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  const data = all.map(r => ({ id: r.id, ...r.fields }));
  setCache('coaching_today', data);
  return data;
}

// ── Pitch Versions & Suggestions ──

export async function fetchAllPitchVersions() {
  if (USE_PROXY) {
    const result = await proxyFetch('pitch_versions', { formula: '' });
    const records = (result.records || []).map(r => ({ id: r.id, ...r.fields }));
    records.sort((a, b) => (a['Active From'] || '').localeCompare(b['Active From'] || ''));
    return records;
  }
  const tableId = TABLE_IDS.pitch_versions;
  const url = new URL(`https://api.airtable.com/v0/${BASE}/${tableId}`);
  url.searchParams.set('sort[0][field]', 'Active From');
  url.searchParams.set('sort[0][direction]', 'asc');
  const res = await fetch(url.toString(), { headers: DIRECT_HEADERS });
  const data = await res.json();
  return (data.records || []).map(r => ({ id: r.id, ...r.fields }));
}

export async function fetchLatestSuggestion() {
  if (USE_PROXY) {
    const result = await proxyFetch('pitch_suggestions', { formula: '' });
    const records = (result.records || []).map(r => ({ id: r.id, ...r.fields }));
    records.sort((a, b) => (b['Suggestion Date'] || '').localeCompare(a['Suggestion Date'] || ''));
    return records.slice(0, 3);
  }
  const tableId = TABLE_IDS.pitch_suggestions;
  const url = new URL(`https://api.airtable.com/v0/${BASE}/${tableId}`);
  url.searchParams.set('sort[0][field]', 'Suggestion Date');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('maxRecords', '3');
  const res = await fetch(url.toString(), { headers: DIRECT_HEADERS });
  const data = await res.json();
  return (data.records || []).map(r => ({ id: r.id, ...r.fields }));
}

export async function updateSuggestionStatus(recordId, status, nimithNotes) {
  if (USE_PROXY) {
    await proxyFetch('pitch_suggestions', {
      action: 'patch',
      records: [{ id: recordId, fields: { 'Status': status, 'Nimith Notes': nimithNotes || '' } }],
    });
    return;
  }
  const tableId = TABLE_IDS.pitch_suggestions;
  await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: { ...DIRECT_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { 'Status': status, 'Nimith Notes': nimithNotes || '' }, typecast: true })
  });
}

// ── Family Health Profiles ──

export async function fetchFamilyHealthProfiles() {
  const cached = getCached('family_health', CACHE_TTL_HISTORICAL);
  if (cached) return cached;
  let data;
  if (USE_PROXY) {
    const result = await proxyFetch('family_health', { formula: '' });
    data = (result.records || []).map(r => ({ id: r.id, ...r.fields }));
  } else {
    const records = await directFetchAll('family_health', '');
    data = records.map(r => ({ id: r.id, ...r }));
  }
  setCache('family_health', data);
  return data;
}

// ── Team Config (dynamic head → agents mapping) ──
// Falls back to a hard-coded default if no table is configured.

const DEFAULT_TEAM_CONFIG = [
  {
    headName:   'Vikas',
    department: 'Welcome Call',
    callTypes:  ['Welcome Call', 'Callback'],
    agents:     [], // populated dynamically from coaching data or Airtable
  },
  {
    headName:   'Samir',
    department: 'Utilization',
    callTypes:  ['Utilization', 'Callback'],
    agents:     [],
  },
];

export async function fetchTeamConfig() {
  const cached = getCached('team_config', CACHE_TTL_HISTORICAL);
  if (cached) return cached;

  // If no team config table is configured, return the default
  if (!TABLE_IDS.team_config) {
    setCache('team_config', DEFAULT_TEAM_CONFIG);
    return DEFAULT_TEAM_CONFIG;
  }

  let data;
  try {
    if (USE_PROXY) {
      const result = await proxyFetch('team_config', { formula: '' });
      data = (result.records || []).map(r => ({ id: r.id, ...r.fields }));
    } else {
      const records = await directFetchAll('team_config', '');
      data = records.map(r => ({ id: r.id, ...r }));
    }
    // Normalise to { headName, department, callTypes[], agents[] }
    const config = data.map(r => ({
      id:         r.id,
      headName:   r['Head Name']   || '',
      department: r['Department']  || '',
      callTypes:  (r['Call Types'] || '').split(',').map(s => s.trim()).filter(Boolean),
      agents:     (r['Agents']     || '').split(',').map(s => s.trim()).filter(Boolean),
      active:     r['Active'] !== false,
    })).filter(t => t.active && t.headName);
    setCache('team_config', config);
    return config;
  } catch (e) {
    console.warn('Team config fetch failed, using defaults:', e.message);
    setCache('team_config', DEFAULT_TEAM_CONFIG);
    return DEFAULT_TEAM_CONFIG;
  }
}

export async function patchTeamConfig(recordId, fields) {
  if (USE_PROXY) {
    await proxyFetch('team_config', { action: 'patch', records: [{ id: recordId, fields }] });
  } else {
    await directPatch('team_config', [{ id: recordId, fields }]);
  }
  delete _cache['team_config']; // invalidate cache after write
}

export async function approveAndCreateVersion(suggestionId, currentVersionId, suggestion) {
  // 1. Mark old version as Superseded
  const allVersions = await fetchAllPitchVersions();
  const active = allVersions.find(v => v['Status'] === 'Active');
  if (active) {
    if (USE_PROXY) {
      await proxyFetch('pitch_versions', {
        action: 'patch',
        records: [{ id: active.id, fields: { 'Status': 'Superseded', 'Active To': new Date().toISOString().split('T')[0] } }],
      });
    } else {
      const tableId = TABLE_IDS.pitch_versions;
      await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}/${active.id}`, {
        method: 'PATCH',
        headers: { ...DIRECT_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Status': 'Superseded', 'Active To': new Date().toISOString().split('T')[0] }, typecast: true })
      });
    }
  }

  // 2. Compute new version ID
  const lastVersion = allVersions[allVersions.length - 1];
  const lastNum = parseFloat(lastVersion?.['Version ID']?.replace('v','') || '1.0');
  const newVersionId = `v${(lastNum + 0.1).toFixed(1)}`;

  // 3. Create new Pitch Version
  const newFields = {
    'Version ID': newVersionId,
    'Active From': new Date(Date.now() + 86400000).toISOString().split('T')[0],
    'What Changed': suggestion['Recommended Change'],
    'Full Script': suggestion['New Script Section'],
    'Hypothesis': suggestion['Hypothesis'],
    'Status': 'Active',
    'Hypothesis Verdict': 'Pending',
  };
  if (USE_PROXY) {
    await proxyFetch('pitch_versions', { action: 'create', records: [{ fields: newFields }] });
  } else {
    const tableId = TABLE_IDS.pitch_versions;
    await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}`, {
      method: 'POST',
      headers: { ...DIRECT_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields: newFields }], typecast: true })
    });
  }

  // 4. Mark suggestion as Approved
  const approveFields = { 'Status': 'Approved', 'Implemented As Version': newVersionId };
  if (USE_PROXY) {
    await proxyFetch('pitch_suggestions', { action: 'patch', records: [{ id: suggestionId, fields: approveFields }] });
  } else {
    const tableId = TABLE_IDS.pitch_suggestions;
    await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}/${suggestionId}`, {
      method: 'PATCH',
      headers: { ...DIRECT_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: approveFields, typecast: true })
    });
  }

  return newVersionId;
}
