export function qaScore(r) {
  return [
    r['Q1 User Agent Screened'],
    r['Q2 Cashback Correct'],
    r['Q3 WA Link Sent'],
    r['Q4 Hi Attempt Made'],
    r['Q5 Cashback Mechanic Explained'],
    r['Q6 No Improvised Claims'],
  ].filter(Boolean).length;
}

export function qaRating(score) {
  if (score >= 5) return 'PASS';
  if (score >= 3) return 'AMBER';
  return 'FAIL';
}

export function fmtDuration(sec) {
  if (sec == null) return '--';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function outcomeColor(o) {
  if (o === 'Completed') return 'bg-pass text-white';
  if (o === 'Dropped') return 'bg-amber text-white';
  if (o === 'No-Answer') return 'bg-fail text-white';
  return 'bg-gray-400 text-white';
}

export function ratingColor(r) {
  if (r === 'PASS') return 'bg-pass text-white';
  if (r === 'AMBER') return 'bg-amber text-white';
  if (r === 'FAIL') return 'bg-fail text-white';
  return 'bg-gray-300 text-gray-600';
}

export function kpiColor(value, greenMin, amberMin) {
  if (value >= greenMin) return 'text-pass';
  if (value >= amberMin) return 'text-amber';
  return 'text-fail';
}

export function truncate(s, n = 80) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

export function sentimentScoreColor(score) {
  if (score == null) return 'text-gray-400';
  if (score >= 4) return 'text-pass';
  if (score >= 3) return 'text-amber';
  return 'text-fail';
}

export function sentimentDotColor(score) {
  if (score == null) return 'bg-gray-300';
  if (score >= 4) return 'bg-pass';
  if (score >= 3) return 'bg-amber';
  return 'bg-fail';
}

export function intentChipColor(intent) {
  if (intent === 'Interested') return 'bg-green-100 text-pass';
  if (intent === 'Considering') return 'bg-yellow-100 text-amber';
  if (intent === 'Rejected') return 'bg-red-100 text-fail';
  return 'bg-gray-100 text-gray-600';
}

export function conversionSignalColor(signal) {
  if (signal === 'hot') return 'bg-red-100 text-red-700';
  if (signal === 'warm') return 'bg-yellow-100 text-amber';
  if (signal === 'cold') return 'bg-gray-100 text-gray-600';
  if (signal === 'dead') return 'bg-gray-800 text-white';
  if (signal === 'Unreachable') return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-500';
}

export function callCategoryColor(cat) {
  if (cat === 'Welcome-Call') return 'bg-blue-800 text-white';
  if (cat === 'Outbound-Service-Followup') return 'bg-amber-600 text-white';
  if (cat === 'Outbound-Agent-Reachout') return 'bg-teal-600 text-white';
  if (cat === 'Inbound-Subscriber') return 'bg-green-600 text-white';
  if (cat === 'Unknown') return 'bg-gray-400 text-white';
  return 'bg-gray-200 text-gray-600';
}

export function maskPhone(num) {
  if (!num) return '--';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 5) return s;
  return s.slice(0, 5) + 'X'.repeat(s.length - 5);
}

// ── New v6 helpers ──

// STT failure values (must be above functions that use it)
const STT_FAILED = ['[STT Failed]', '[STT Failed — audio could not be processed]', 'failed', ''];

/**
 * Priority-based call tag with transcript detection:
 * HOT → CHURN → LOAN → CALL BACK → WARM(dur>45) → REJECTED
 * → VOICEMAIL → BUSY → SWITCHED OFF → FORWARDED → CANCELLED → NO CONNECT → COLD
 */
export function computeCallTag(r) {
  if (r['Hot Lead']) return 'HOT';
  if (r['Churn Signal']) return 'CHURN';
  if (r['Loan Signal']) return 'LOAN';
  if (r['Needs Callback'] || r['Callback Requested']) return 'CALL BACK';
  const signal = r['Conversion Signal'];
  const dur = r['Duration Seconds'] || 0;
  if (signal === 'warm' && dur > 45) return 'WARM';
  const intent = r['Customer Intent Signal'];
  if (intent === 'Rejected' || signal === 'dead') return 'REJECTED';
  // Transcript-based detection
  const tx = (r['Transcript'] || '').toLowerCase();
  if (tx.includes('voicemail') || tx.includes('voice mail')) return 'VOICEMAIL';
  if (tx.includes('busy') || tx.includes('व्यस्त')) return 'BUSY';
  if (tx.includes('switched off') || tx.includes('band hai')) return 'SWITCHED OFF';
  if (tx.includes('forwarded') || tx.includes('forward')) return 'FORWARDED';
  const outcome = r['Call Outcome'];
  if (outcome === 'Dropped') return 'CANCELLED';
  if (outcome === 'No-Answer') return 'NO CONNECT';
  if (signal === 'cold') return 'COLD';
  if (signal === 'warm') return 'WARM'; // warm but short call
  if (outcome === 'Completed') return 'COLD';
  return 'COLD';
}

export function callTagColor(tag) {
  const map = {
    'HOT': 'bg-red-600 text-white',
    'CHURN': 'bg-orange-600 text-white',
    'LOAN': 'bg-purple-600 text-white',
    'CALL BACK': 'bg-amber text-white',
    'WARM': 'bg-yellow-500 text-white',
    'REJECTED': 'bg-gray-700 text-white',
    'VOICEMAIL': 'bg-gray-500 text-white',
    'BUSY': 'bg-gray-500 text-white',
    'SWITCHED OFF': 'bg-red-800 text-white',
    'FORWARDED': 'bg-purple-500 text-white',
    'CANCELLED': 'bg-gray-400 text-white',
    'NO CONNECT': 'bg-gray-300 text-gray-700',
    'COLD': 'bg-gray-200 text-gray-600',
  };
  return map[tag] || 'bg-gray-200 text-gray-600';
}

/**
 * Human pickup = real transcript AND duration >20s AND outcome=Completed
 */
export function isHumanPickup(r) {
  const transcript = (r['Transcript'] || '').trim();
  if (!transcript || STT_FAILED.includes(transcript)) return false;
  const dur = r['Duration Seconds'];
  if (dur == null || dur <= 20) return false;
  return r['Call Outcome'] === 'Completed';
}

/**
 * Auto-generate QA failure reason from Q1-Q6 scores
 */
const QA_LABELS_SHORT = {
  'Q1 User Agent Screened': 'No agent screening',
  'Q2 Cashback Correct': 'Wrong cashback info',
  'Q3 WA Link Sent': 'WhatsApp link missing',
  'Q4 Hi Attempt Made': 'No Hi attempt',
  'Q5 Cashback Mechanic Explained': 'Mechanic not explained',
  'Q6 No Improvised Claims': 'Improvised claims made',
};

export function computeQAFailureReason(r) {
  const failures = Object.entries(QA_LABELS_SHORT)
    .filter(([key]) => !r[key])
    .map(([, label]) => label);
  return failures.length > 0 ? failures.join(', ') : '';
}

/**
 * Scrape freshness: green <35m, amber 35-65m, red >65m
 */
export function scrapeAgeStatus(dateStr) {
  if (!dateStr) return { label: 'Unknown', color: 'text-gray-400' };
  const diff = (Date.now() - new Date(dateStr).getTime()) / 60000;
  if (diff < 35) return { label: `${Math.round(diff)}m ago`, color: 'text-pass' };
  if (diff < 65) return { label: `${Math.round(diff)}m ago`, color: 'text-amber' };
  return { label: `${Math.round(diff)}m ago`, color: 'text-fail' };
}

// ── Period / Talk Time helpers ──

/**
 * Connected call = real conversation happened.
 * duration > 20s AND transcript not STT-failed AND (outcome=Completed OR duration>60)
 */
export function isConnectedCall(r) {
  const transcript = (r['Transcript'] || '').trim();
  const dur = r['Duration Seconds'] || 0;
  const outcome = r['Call Outcome'] || '';
  return dur > 20 && !STT_FAILED.includes(transcript) && (outcome === 'Completed' || dur > 60);
}

/** Format seconds as "Xh Ym" for talk time display */
export function fmtTalkTime(sec) {
  if (sec == null || sec <= 0) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format seconds as "Xm Ys" for avg talk time */
export function fmtAvgTalkTime(sec) {
  if (sec == null || sec <= 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// ── Period date computation (IST = UTC+5:30) ──

function todayIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function getPeriodDates(period, customStart, customEnd) {
  const now = todayIST();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return { start: fmtDate(today), end: fmtDate(today) };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { start: fmtDate(y), end: fmtDate(y) };
    }
    case 'week': {
      const dow = today.getDay();
      const mon = addDays(today, -(dow === 0 ? 6 : dow - 1));
      return { start: fmtDate(mon), end: fmtDate(today) };
    }
    case 'lastweek': {
      const dow = today.getDay();
      const thisMon = addDays(today, -(dow === 0 ? 6 : dow - 1));
      const lastMon = addDays(thisMon, -7);
      const lastSun = addDays(thisMon, -1);
      return { start: fmtDate(lastMon), end: fmtDate(lastSun) };
    }
    case 'mtd': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmtDate(first), end: fmtDate(today) };
    }
    case 'lastmonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: fmtDate(first), end: fmtDate(last) };
    }
    case 'custom':
      return { start: customStart || fmtDate(today), end: customEnd || fmtDate(today) };
    default:
      return { start: fmtDate(today), end: fmtDate(today) };
  }
}

/** Get the "previous period" dates for comparison (same duration, immediately before) */
export function getPreviousPeriodDates(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const days = Math.round((e - s) / 86400000) + 1;
  const prevEnd = addDays(s, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { start: fmtDate(prevStart), end: fmtDate(prevEnd) };
}

/** Format a period date range for display: "1 Mar – 15 Mar 2026" */
export function formatPeriodLabel(start, end) {
  const fmt = (d) => {
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  if (start === end) return fmt(start);
  const endDate = new Date(end + 'T00:00:00');
  const endFmt = endDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(start)} – ${endFmt}`;
}
