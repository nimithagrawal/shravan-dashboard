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

export function callDispositionColor(disp) {
  if (disp === 'Connected-Full') return 'bg-green-100 text-green-700';
  if (disp === 'Connected-Short') return 'bg-yellow-100 text-amber';
  if (disp === 'Voicemail' || disp === 'Busy' || disp === 'Not-Reachable' || disp === 'Switched-Off') return 'bg-blue-100 text-blue-700';
  if (disp === 'Wrong-Number' || disp === 'Hung-Up-Immediately') return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

export function maskPhone(num) {
  if (!num) return '--';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 5) return s;
  return s.slice(0, 5) + 'X'.repeat(s.length - 5);
}

// ── New v6 helpers ──

/**
 * Priority-based call tag: HOT → CHURN → LOAN → CALL BACK → WARM → REJECTED
 * → VOICEMAIL → BUSY → SWITCHED OFF → FORWARDED → CANCELLED → NO CONNECT → COLD
 */
export function computeCallTag(r) {
  if (r['Hot Lead']) return 'HOT';
  if (r['Churn Signal']) return 'CHURN';
  if (r['Loan Signal']) return 'LOAN';
  if (r['Needs Callback'] || r['Callback Requested']) return 'CALL BACK';
  const signal = r['Conversion Signal'];
  if (signal === 'warm') return 'WARM';
  const intent = r['Customer Intent Signal'];
  if (intent === 'Rejected' || signal === 'dead') return 'REJECTED';
  const disp = r.callDisposition || r['Call Disposition'];
  if (disp === 'Voicemail') return 'VOICEMAIL';
  if (disp === 'Busy') return 'BUSY';
  if (disp === 'Switched-Off') return 'SWITCHED OFF';
  if (disp === 'Not-Reachable') return 'NO CONNECT';
  if (disp === 'Forwarded') return 'FORWARDED';
  const outcome = r['Call Outcome'];
  if (outcome === 'Dropped') return 'CANCELLED';
  if (outcome === 'No-Answer') return 'NO CONNECT';
  if (signal === 'cold') return 'COLD';
  // Connected but no signal
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
    'VOICEMAIL': 'bg-blue-400 text-white',
    'BUSY': 'bg-blue-300 text-white',
    'SWITCHED OFF': 'bg-blue-200 text-blue-800',
    'FORWARDED': 'bg-blue-100 text-blue-700',
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
  const transcript = r['Transcript'];
  if (!transcript || transcript === 'failed' || transcript.trim() === '') return false;
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
