const BASE = import.meta.env.VITE_AIRTABLE_BASE_ID;
const USERS_TABLE = import.meta.env.VITE_AIRTABLE_USERS_TABLE;
const PAT = import.meta.env.VITE_AIRTABLE_PAT;
const AIRTABLE_USERS_URL = `https://api.airtable.com/v0/${BASE}/${USERS_TABLE}`;

// Tab name constants (single source of truth)
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
export const TAB_PERMISSIONS = {
  ADMIN:           ['Command Center', 'Welcome Call', 'Utilization', 'Welcome Queue', 'Util Queue', 'Agent 360', 'Pitch Lab', 'Call Log', 'Executive'],
  MANAGER:         ['Command Center', 'Welcome Call', 'Utilization', 'Welcome Queue', 'Util Queue', 'Agent 360', 'Pitch Lab', 'Call Log', 'Executive'],
  MANAGER_WELCOME: ['Command Center', 'Welcome Call', 'Welcome Queue', 'Agent 360'],
  MANAGER_UTIL:    ['Command Center', 'Utilization', 'Util Queue', 'Agent 360'],
  CX:              ['Util Queue'],
  AGENT:           ['Agent 360'],
};

// Action permissions per role
export const ACTION_PERMISSIONS = {
  ADMIN:   { canWrite: false, canInitiateOutreach: false, canCallbackActions: false },
  MANAGER: { canWrite: true,  canInitiateOutreach: true,  canCallbackActions: true  },
  CX:      { canWrite: false, canInitiateOutreach: true,  canCallbackActions: false },
  AGENT:   { canWrite: false, canInitiateOutreach: false, canCallbackActions: false },
};

// Role display names for bypass mode
const ROLE_NAMES = { ADMIN: 'Admin', MANAGER: 'Manager', CX: 'CX Agent', AGENT: 'Agent' };

export async function resolveUser(token) {
  if (!token) return null;

  // Dev bypass: ?token=role:ADMIN skips Airtable lookup
  if (token.startsWith('role:')) {
    const role = token.slice(5).toUpperCase();
    if (TAB_PERMISSIONS[role]) {
      return { name: ROLE_NAMES[role] || role, role, agentNameMatch: '', vikasAlert: false };
    }
    return null;
  }

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
