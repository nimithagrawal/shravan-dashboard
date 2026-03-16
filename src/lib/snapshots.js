const BASE            = import.meta.env.VITE_AIRTABLE_BASE_ID;
const SNAPSHOTS_TABLE = import.meta.env.VITE_AIRTABLE_SNAPSHOTS_TABLE;
const API_KEY         = import.meta.env.VITE_AIRTABLE_PAT;
const URL_BASE        = `https://api.airtable.com/v0/${BASE}/${SNAPSHOTS_TABLE}`;

export async function fetchTodaySnapshots(agentName) {
  const today = getTodayIST();
  const dateFilter = `IS_SAME({Snapshot Date}, DATETIME_PARSE('${today}','YYYY-MM-DD'), 'day')`;
  const formula = agentName
    ? `AND({Agent Name} = "${agentName}", ${dateFilter})`
    : dateFilter;

  const url = new URL(URL_BASE);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('sort[0][field]',     'Snapshot At');
  url.searchParams.set('sort[0][direction]', 'asc');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
  const data = await res.json();
  return (data.records || []).map(r => ({ id: r.id, ...r.fields }));
}

export async function markInterventionWindow(recordId) {
  await fetch(`${URL_BASE}/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization:  `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: { 'Intervention Window': true }
    })
  });
}

function getTodayIST() {
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + istOffset).toISOString().split('T')[0];
}
