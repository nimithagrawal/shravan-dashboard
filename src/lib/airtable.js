const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const BASE = import.meta.env.VITE_AIRTABLE_BASE_ID;
const TABLE = import.meta.env.VITE_AIRTABLE_TABLE;
const API = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
const HEADERS = { Authorization: `Bearer ${PAT}` };

async function fetchAll(formula = '') {
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
  } while (offset);
  return all.map(r => ({ id: r.id, ...r.fields }));
}

export async function fetchToday() {
  return fetchAll("IS_SAME({Call Date}, TODAY(), 'day')");
}

export async function fetchCallbacks() {
  return fetchAll('{Needs Callback}=1');
}

export async function fetchHotLeads() {
  return fetchAll('{Hot Lead}=1');
}

export async function fetchLoanSignals() {
  return fetchAll('{Loan Signal}=1');
}

export async function fetchChurnSignals() {
  return fetchAll('{Churn Signal}=1');
}

export async function fetchCallbacksRequested() {
  return fetchAll('{Callback Requested}=1');
}

export async function fetchRecent(limit = 50) {
  const params = new URLSearchParams();
  params.set('pageSize', String(limit));
  params.set('sort[0][field]', 'Processed At');
  params.set('sort[0][direction]', 'desc');
  const res = await fetch(`${API}?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Airtable ${res.status}`);
  const data = await res.json();
  return (data.records || []).map(r => ({ id: r.id, ...r.fields }));
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
