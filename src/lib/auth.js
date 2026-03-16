const BASE = import.meta.env.VITE_AIRTABLE_BASE_ID;
const USERS_TABLE = import.meta.env.VITE_AIRTABLE_USERS_TABLE;
const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const AIRTABLE_USERS_URL = `https://api.airtable.com/v0/${BASE}/${USERS_TABLE}`;

// Tab permissions per role
export const TAB_PERMISSIONS = {
  ADMIN:   ['Overview', 'Vikas Queue', 'Samir Queue', 'Agent Review', 'Pitch Performance'],
  MANAGER: ['Overview', 'Vikas Queue', 'Samir Queue', 'Agent Review', 'Pitch Performance'],
  CX:      ['Samir Queue'],
  AGENT:   ['Agent Review'],
};

// Action permissions per role
export const ACTION_PERMISSIONS = {
  ADMIN:   { canWrite: false, canInitiateOutreach: false, canCallbackActions: false },
  MANAGER: { canWrite: true,  canInitiateOutreach: true,  canCallbackActions: true  },
  CX:      { canWrite: false, canInitiateOutreach: true,  canCallbackActions: false },
  AGENT:   { canWrite: false, canInitiateOutreach: false, canCallbackActions: false },
};

export async function resolveUser(token) {
  if (!token) return null;

  try {
    const params = new URLSearchParams();
    params.set('filterByFormula', `{Token} = "${token}"`);
    params.set('maxRecords', '1');

    const res = await fetch(`${AIRTABLE_USERS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${PAT}` }
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.records?.length) return null;

    const rec = data.records[0].fields;

    // Inactive token — treat as no user
    if (!rec['Active']) return null;

    return {
      name:           rec['Name']             || '',
      role:           rec['Role']             || 'AGENT',
      agentNameMatch: rec['Agent Name Match'] || '',
      vikasAlert:     rec['Vikas Alert']      || false,
    };
  } catch (e) {
    console.error('Auth error:', e);
    return null;
  }
}
