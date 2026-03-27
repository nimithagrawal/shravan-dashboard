const PROXY_URL = import.meta.env.VITE_SHRAVAN_PROXY_URL;
const USE_PROXY = !!PROXY_URL;

// Direct Airtable fallback (local dev)
const BASE = import.meta.env.VITE_AIRTABLE_BASE_ID;
const USERS_TABLE = import.meta.env.VITE_AIRTABLE_USERS_TABLE;
const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const AIRTABLE_USERS_URL = `https://api.airtable.com/v0/${BASE}/${USERS_TABLE}`;

// ── Tab names (canonical) ──
export const TAB_NAMES = {
  COMMAND_CENTER: 'Command Center',
  WELCOME_CALL:   'Welcome Call',
  UTILIZATION:    'Utilization',
  WELCOME_QUEUE:  'Welcome Queue',
  UTIL_QUEUE:     'Util Queue',
  AGENT_360:      'Agent 360',
  PITCH_LAB:      'Pitch Lab',
  CALL_LOG:       'Call Log',
  EXECUTIVE:      'Executive',
};

// Tab permissions per role
// MANAGER_WELCOME = Vikas's head (Welcome Call dept)
// MANAGER_UTIL    = Samir's head (Utilization dept)
// MANAGER         = legacy alias → same as ADMIN access (both depts)
export const TAB_PERMISSIONS = {
  ADMIN:           [TAB_NAMES.EXECUTIVE, TAB_NAMES.COMMAND_CENTER, TAB_NAMES.WELCOME_CALL, TAB_NAMES.UTILIZATION, TAB_NAMES.WELCOME_QUEUE, TAB_NAMES.UTIL_QUEUE, TAB_NAMES.AGENT_360, TAB_NAMES.PITCH_LAB, TAB_NAMES.CALL_LOG],
  MANAGER:         [TAB_NAMES.EXECUTIVE, TAB_NAMES.COMMAND_CENTER, TAB_NAMES.WELCOME_CALL, TAB_NAMES.UTILIZATION, TAB_NAMES.WELCOME_QUEUE, TAB_NAMES.UTIL_QUEUE, TAB_NAMES.AGENT_360, TAB_NAMES.PITCH_LAB, TAB_NAMES.CALL_LOG],
  MANAGER_WELCOME: [TAB_NAMES.COMMAND_CENTER, TAB_NAMES.WELCOME_CALL, TAB_NAMES.WELCOME_QUEUE, TAB_NAMES.AGENT_360, TAB_NAMES.PITCH_LAB, TAB_NAMES.CALL_LOG],
  MANAGER_UTIL:    [TAB_NAMES.COMMAND_CENTER, TAB_NAMES.UTILIZATION,  TAB_NAMES.UTIL_QUEUE,    TAB_NAMES.AGENT_360, TAB_NAMES.PITCH_LAB, TAB_NAMES.CALL_LOG],
  CX:              [TAB_NAMES.UTILIZATION, TAB_NAMES.UTIL_QUEUE],
  AGENT:           [TAB_NAMES.AGENT_360],
};

// Action permissions per role
export const ACTION_PERMISSIONS = {
  ADMIN:           { canWrite: false, canInitiateOutreach: false, canCallbackActions: false, canApprovePitch: false },
  MANAGER:         { canWrite: true,  canInitiateOutreach: true,  canCallbackActions: true,  canApprovePitch: true  },
  MANAGER_WELCOME: { canWrite: true,  canInitiateOutreach: true,  canCallbackActions: true,  canApprovePitch: true  },
  MANAGER_UTIL:    { canWrite: true,  canInitiateOutreach: true,  canCallbackActions: true,  canApprovePitch: false },
  CX:              { canWrite: false, canInitiateOutreach: true,  canCallbackActions: true,  canApprovePitch: false },
  AGENT:           { canWrite: false, canInitiateOutreach: false, canCallbackActions: false, canApprovePitch: false },
};

// Direct role bypass: token = "role:ADMIN", "role:MANAGER_WELCOME", etc.
const ROLE_NAMES = {
  ADMIN:           'Admin',
  MANAGER:         'Manager',
  MANAGER_WELCOME: 'Vikas',
  MANAGER_UTIL:    'Samir',
  CX:              'CX',
  AGENT:           'Agent',
};

export async function resolveUser(token) {
  if (!token) return null;

  // Direct role bypass — e.g. ?token=role:ADMIN
  if (token.startsWith('role:')) {
    const role = token.slice(5).toUpperCase();
    if (TAB_PERMISSIONS[role]) {
      return {
        name:           ROLE_NAMES[role] || role,
        role,
        department:     role === 'MANAGER_WELCOME' ? 'Welcome Call' : role === 'MANAGER_UTIL' ? 'Utilization' : 'Both',
        agentNameMatch: '',
        vikasAlert:     role === 'ADMIN' || role === 'MANAGER',
        headName:       '',
      };
    }
  }

  try {
    let records;

    if (USE_PROXY) {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          table: 'users',
          formula: `{Token} = "${token}"`,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.error) return null;
      records = data.records || [];
    } else {
      // Direct Airtable fallback
      const params = new URLSearchParams();
      params.set('filterByFormula', `{Token} = "${token}"`);
      params.set('maxRecords', '1');
      const res = await fetch(`${AIRTABLE_USERS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${PAT}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      records = data.records || [];
    }

    if (!records.length) return null;

    const rec = records[0].fields || records[0];

    if (!rec['Active']) return null;

    const role = rec['Role'] || 'AGENT';
    return {
      name:           rec['Name']             || '',
      role,
      department:     rec['Department']       || (role === 'MANAGER_WELCOME' ? 'Welcome Call' : role === 'MANAGER_UTIL' ? 'Utilization' : 'Both'),
      agentNameMatch: rec['Agent Name Match'] || '',
      vikasAlert:     rec['Vikas Alert']      || false,
      headName:       rec['Reports To']       || '',
    };
  } catch (e) {
    console.error('Auth error:', e);
    return null;
  }
}
