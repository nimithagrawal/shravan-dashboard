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

export function callLabelColor(label) {
  const map = {
    'Activated': 'bg-green-600 text-white',
    'Webinar Confirmed': 'bg-indigo-100 text-indigo-700',
    'Complaint': 'bg-red-100 text-red-700',
    'Medicine Lead': 'bg-emerald-100 text-emerald-700',
    'Lab Lead': 'bg-purple-100 text-purple-700',
    'Callback Set': 'bg-amber-100 text-amber-700',
    'Not Interested': 'bg-gray-700 text-white',
    'No Connect': 'bg-gray-200 text-gray-500',
    'Wrong Number': 'bg-orange-100 text-orange-700',
    'Busy / Later': 'bg-yellow-100 text-yellow-700',
    'Engaged': 'bg-blue-100 text-blue-700',
  };
  return map[label] || 'bg-gray-100 text-gray-500';
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
 * Extract 1-2 word gist from a call record for quick scanning.
 * Uses structured fields first, falls back to summary keyword extraction.
 */
export function computeGist(r) {
  // Structured signals first
  if (r['Hot Lead']) return 'Hot Lead';
  if (r['Churn Signal']) return r['Churn Reason'] ? truncate(r['Churn Reason'], 20) : 'Churn Risk';
  if (r['Loan Signal']) return 'Loan Interest';
  const intent = r['Customer Intent Signal'];
  if (intent === 'Rejected') return 'Rejected';
  if (intent === 'Interested') return 'Interested';
  if (intent === 'Considering') return 'Considering';
  // Summary-based extraction
  const s = (r['Summary'] || '').toLowerCase();
  if (s.includes('wrong number')) return 'Wrong Number';
  if (s.includes('not interested') || s.includes('rejected')) return 'Not Interested';
  if (s.includes('already') && s.includes('activated')) return 'Already Active';
  if (s.includes('call back') || s.includes('callback') || s.includes('call later')) return 'Call Later';
  if (s.includes('busy')) return 'Busy';
  if (s.includes('cashback')) return 'Cashback Query';
  if (s.includes('complaint') || s.includes('issue')) return 'Complaint';
  if (s.includes('interested') || s.includes('agreed')) return 'Interested';
  if (s.includes('loan') || s.includes('emi')) return 'Loan Query';
  if (s.includes('not reachable') || s.includes('unreachable') || s.includes('switched off')) return 'Unreachable';
  if (s.includes('voicemail') || s.includes('ivr')) return 'Voicemail';
  if (s.includes('whatsapp') || s.includes('wa link')) return 'WA Sent';
  if (s.includes('explained') || s.includes('informed')) return 'Info Given';
  if (s.includes('no answer') || s.includes('did not answer')) return 'No Answer';
  // Outcome fallback
  const outcome = r['Call Outcome'];
  if (outcome === 'No-Answer') return 'No Answer';
  if (outcome === 'Dropped') return 'Dropped';
  if (outcome === 'Completed') return 'Completed';
  return '--';
}

export function gistColor(gist) {
  if (gist === 'Hot Lead' || gist === 'Interested') return 'text-pass font-bold';
  if (gist === 'Loan Interest' || gist === 'Loan Query') return 'text-purple-600 font-bold';
  if (gist === 'Rejected' || gist === 'Not Interested' || gist === 'Churn Risk') return 'text-fail';
  if (gist === 'Call Later' || gist === 'Considering') return 'text-amber';
  if (gist === 'Complaint') return 'text-fail';
  return 'text-gray-600';
}

/**
 * Extract scheduled callback date/time from summary or Callback Due field.
 * Returns { raw, resolvedDate (YYYY-MM-DD), resolvedTime } or null.
 *
 * IMPORTANT: Ignores system-generated retry flags like "Next-Day", "Same-Day".
 * Only returns a result when a customer explicitly requested a callback.
 *
 * resolvedDate is computed from the Call Date + relative references (tomorrow, Monday, etc.)
 */
export function extractScheduledCallback(r) {
  const callDate = r['Call Date']; // YYYY-MM-DD

  // 1. Check Callback Due field — only if it's a real date, not a system retry tag
  if (r['Callback Due']) {
    const due = r['Callback Due'];
    // Skip system-generated values
    const systemTags = ['next-day', 'same-day', 'next day', 'same day', 'retry', 'auto'];
    if (!systemTags.includes(due.toLowerCase().trim())) {
      const d = new Date(due);
      const resolved = !isNaN(d.getTime()) ? fmtDate(d) : null;
      return { raw: due, resolvedDate: resolved, resolvedTime: null };
    }
  }

  const s = (r['Summary'] || '');

  // 2. Time patterns: "call back after 5 PM", "requested callback at 3pm"
  //    IMPORTANT: Require "back" or "callback" to avoid matching "cancelled the call after 27 seconds"
  //    Also require AM/PM or time > 0 to avoid matching durations
  const timePatterns = [
    /(?:call\s+back\s+(?:at|after|around|by)\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i,
    /(?:callback\s+(?:at|after|around|by)\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i,
    /(?:request(?:ed|s)?\s+(?:a\s+)?call\s*back?\s+(?:at|after|around|by)\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i,
    /(?:(?:asked|wants?|preferred?|suggested?)\s+(?:to\s+)?(?:call(?:\s+back)?|callback)\s+(?:at|after|around|by)\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i,
    /(?:(?:call|ring)\s+(?:me\s+)?back\s+(?:post|after)\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i,
    // Without AM/PM but with "back" required and hours in reasonable range
    /(?:call\s+back\s+(?:at|after|around)\s+)(\d{1,2})(?:\s|,|\.)/i,
    /(?:callback\s+(?:at|after|around)\s+)(\d{1,2})(?:\s|,|\.)/i,
  ];
  for (const re of timePatterns) {
    const m = s.match(re);
    if (m) {
      const timeVal = m[1].trim();
      // Validate: skip if it looks like a duration (seconds/minutes)
      const afterMatch = s.slice(m.index).toLowerCase();
      if (afterMatch.includes('second') || afterMatch.includes('minute')) continue;
      return { raw: timeVal, resolvedDate: callDate || null, resolvedTime: timeVal };
    }
  }

  // 3. Day patterns: "call back tomorrow", "callback on Monday"
  const dayPatterns = [
    /(?:call\s+back\s+(?:on\s+)?)(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /(?:callback\s+(?:on\s+)?)(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /(?:request(?:ed|s)?\s+(?:a\s+)?call\s*back?\s+(?:on\s+)?)(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /(?:(?:asked|wants?|preferred?)\s+(?:to\s+)?(?:call(?:\s+back)|callback)\s+(?:on\s+)?)(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
  ];
  for (const re of dayPatterns) {
    const m = s.match(re);
    if (m) {
      const resolved = resolveRelativeDay(m[1].toLowerCase(), callDate);
      return { raw: m[1], resolvedDate: resolved, resolvedTime: null };
    }
  }

  // 4. Date patterns: "call back on 15th Jan", "callback on March 20"
  const dateMatch = s.match(/(?:call(?:\s+back)|callback)\s+(?:on\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)/i);
  if (dateMatch) {
    const resolved = resolveAbsoluteDate(dateMatch[1]);
    return { raw: dateMatch[1], resolvedDate: resolved, resolvedTime: null };
  }

  // 5. AI-detected callback (Callback Requested flag) + summary mentions busy/callback
  //    Only if Callback Requested is true (AI-detected, not system retry)
  if (r['Callback Requested']) {
    // Try to extract a time from the summary even without strict "call back" prefix
    const looseTime = s.match(/(?:after|around|by|post)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i);
    if (looseTime) {
      return { raw: looseTime[1].trim(), resolvedDate: callDate || null, resolvedTime: looseTime[1].trim() };
    }
    // Fallback: callback requested but no specific time
    return { raw: 'Callback requested', resolvedDate: callDate || null, resolvedTime: null };
  }

  return null;
}

/** Resolve 'tomorrow', 'monday', etc. relative to a call date (YYYY-MM-DD) */
function resolveRelativeDay(day, callDate) {
  if (!callDate) return null;
  const base = new Date(callDate + 'T00:00:00');
  if (day === 'tomorrow') return fmtDate(addDays(base, 1));
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDow = dayNames.indexOf(day);
  if (targetDow === -1) return null;
  const currentDow = base.getDay();
  let diff = targetDow - currentDow;
  if (diff <= 0) diff += 7; // next occurrence
  return fmtDate(addDays(base, diff));
}

/** Resolve "15th Jan", "March 20" to YYYY-MM-DD (using current year) */
function resolveAbsoluteDate(raw) {
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const m = raw.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = months[m[2].toLowerCase().slice(0, 3)];
  if (month == null || day < 1 || day > 31) return null;
  const year = new Date().getFullYear();
  return fmtDate(new Date(year, month, day));
}

/**
 * Format callback display text: "Today 5 PM", "17 Mar", "Tomorrow" etc.
 */
export function formatCallbackDue(cb) {
  if (!cb) return null;
  const parts = [];
  if (cb.resolvedDate) {
    const today = fmtDate(todayIST());
    const tomorrow = fmtDate(addDays(todayIST(), 1));
    if (cb.resolvedDate === today) parts.push('Today');
    else if (cb.resolvedDate === tomorrow) parts.push('Tomorrow');
    else {
      const d = new Date(cb.resolvedDate + 'T00:00:00');
      parts.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
    }
  }
  if (cb.resolvedTime) parts.push(cb.resolvedTime);
  if (parts.length === 0) return cb.raw || 'Callback';
  return parts.join(' ');
}

/**
 * Check if a callback is due on a specific date (YYYY-MM-DD) or date range
 */
export function isCallbackDueOn(cb, dateStr) {
  if (!cb || !cb.resolvedDate) return false;
  return cb.resolvedDate === dateStr;
}

export function callbackDueColor(cb) {
  if (!cb || !cb.resolvedDate) return 'bg-gray-100 text-gray-600';
  const today = fmtDate(todayIST());
  const tomorrow = fmtDate(addDays(todayIST(), 1));
  if (cb.resolvedDate < today) return 'bg-red-100 text-red-700'; // Overdue
  if (cb.resolvedDate === today) return 'bg-amber/20 text-amber'; // Due today
  if (cb.resolvedDate === tomorrow) return 'bg-blue-100 text-blue-700'; // Tomorrow
  return 'bg-gray-100 text-gray-600'; // Future
}

/**
 * Identify subscriber type from call summary:
 * - 'Agent/CSP' = subscriber identifies as ROINET/RNFI/VIDCOM/PAYWORLD agent or CSP
 * - 'Disputed' = subscriber denies purchasing / says they're not the actual user
 * - 'Customer' = actual end user (default)
 */
export function subscriberType(r) {
  const s = (r['Summary'] || '').toLowerCase();
  // Agent/CSP: subscriber explicitly identifies as an agent from known networks
  if (s.includes('rnfi') || s.includes('roinet') || s.includes('vidcom') || s.includes('payworld') ||
      s.includes('retailer') || s.includes('csp') || s.includes('distributor') || s.includes('reseller')) {
    return 'Agent/CSP';
  }
  // Disputed: subscriber denies purchasing or is not the actual user
  if ((s.includes('denied') && (s.includes('purchas') || s.includes('buying') || s.includes('plan'))) ||
      s.includes('not the actual') || s.includes('not the end user') ||
      s.includes('not the subscriber') || s.includes('wrong person') ||
      s.includes('did not purchase') || s.includes('did not buy') ||
      s.includes("didn't purchase") || s.includes("didn't buy") ||
      s.includes('no such plan') || s.includes('unaware of') ||
      (s.includes('denied') && s.includes('having')) ||
      s.includes('wrong number')) {
    return 'Disputed';
  }
  return 'Customer';
}

export function subscriberTypeColor(type) {
  if (type === 'Agent/CSP') return 'bg-purple-100 text-purple-700';
  if (type === 'Disputed') return 'bg-orange-100 text-orange-700';
  return 'bg-blue-100 text-blue-700';
}

/**
 * Pitch quality classification for completed calls tagged as rejected/cold/dead.
 * Returns { issue, detail, hasCapturedCallback } for diagnostic purposes.
 */
export function pitchQualityIssue(r) {
  const s = (r['Summary'] || '').toLowerCase();
  const intent = r['Customer Intent Signal'];
  const signal = r['Conversion Signal'];
  const scriptDrop = r['Script Section at Drop'] || '';
  const hasCallback = !!(r['Needs Callback'] || r['Callback Requested'] || r['Callback Due']);

  // Classify the issue
  let issue = 'Unknown';
  if (s.includes('denied') && (s.includes('purchas') || s.includes('plan') || s.includes('buying'))) {
    issue = 'Denied Purchase';
  } else if (s.includes('wrong number') || s.includes('wrong person')) {
    issue = 'Wrong Number';
  } else if (s.includes('frustrated') || s.includes('angry') || s.includes('upset') || s.includes('hostile')) {
    issue = 'Customer Frustrated';
  } else if (s.includes('busy') || s.includes('not available') || s.includes('call later') || s.includes('callback')) {
    issue = 'Busy / Call Later';
  } else if (s.includes('not interested') || s.includes('refused') || s.includes('declined')) {
    issue = 'Not Interested';
  } else if (s.includes('confused') || s.includes("didn't understand") || s.includes('not aware')) {
    issue = 'Customer Confused';
  } else if (s.includes('network') || s.includes('disconnected') || s.includes('dropped')) {
    issue = 'Call Dropped';
  } else if (scriptDrop === 'Opening' || scriptDrop === 'Screening') {
    issue = 'Early Drop (' + scriptDrop + ')';
  } else if (intent === 'Rejected') {
    issue = 'Rejected (Unclear Why)';
  } else if (signal === 'cold') {
    issue = 'Low Engagement';
  } else if (signal === 'dead') {
    issue = 'No Recovery Possible';
  }

  return { issue, hasCapturedCallback: hasCallback, scriptDrop };
}

/**
 * Scrape freshness: green <35m, amber 35-65m, red >65m
 */
export function scrapeAgeStatus(dateStr) {
  if (!dateStr) return { label: 'Unknown', color: 'text-gray-400' };
  const parsed = new Date(dateStr);
  // If it's a date-only string (e.g. "2026-03-15"), we can't compute real age
  const isDateOnly = typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  if (isDateOnly) {
    const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    if (dateStr === todayStr) return { label: 'Today', color: 'text-pass' };
    return { label: dateStr, color: 'text-amber' };
  }
  // Full datetime — show "Xm ago @ HH:MM"
  const timeStr = parsed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const diff = (Date.now() - parsed.getTime()) / 60000;
  if (diff < 35) return { label: `${Math.round(diff)}m ago · ${timeStr}`, color: 'text-pass' };
  if (diff < 65) return { label: `${Math.round(diff)}m ago · ${timeStr}`, color: 'text-amber' };
  if (diff < 120) return { label: `${Math.round(diff)}m ago · ${timeStr}`, color: 'text-fail' };
  const hrs = Math.round(diff / 60);
  return { label: `${hrs}h ago · ${timeStr}`, color: 'text-fail' };
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
