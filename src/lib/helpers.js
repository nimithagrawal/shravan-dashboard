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
