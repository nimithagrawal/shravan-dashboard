import { useState, useMemo, Fragment } from 'react';
import { patchRecord } from '../lib/airtable';
import { qaScore, qaRating, fmtDuration, ratingColor, computeQAFailureReason, isHumanPickup, kpiColor, computeGist, gistColor, subscriberType, subscriberTypeColor, callLabelColor } from '../lib/helpers';
import { ExpandableSummary, TranscriptViewer } from './SharedUI';
import PhoneNumber from './PhoneNumber';
import { useAuth } from '../context/AuthContext';

function Chip({ text, className }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>{text}</span>;
}

function ActionButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 text-xs font-medium rounded-lg bg-pass text-white hover:bg-green-700 active:scale-95 transition-all min-h-[44px] md:min-h-0"
    >
      {label}
    </button>
  );
}

function CallbackStatusBadge({ status, rollCount }) {
  if (status === 'Scheduled') return <Chip text="Scheduled" className="bg-gray-100 text-gray-600" />;
  if (status === 'Attempted') return <Chip text="Attempted" className="bg-yellow-100 text-amber" />;
  if (status === 'Overdue') return <Chip text={`Overdue ×${rollCount || 1}`} className="bg-orange-100 text-orange-700" />;
  if (status === 'Escalated') return <Chip text={`Escalated ×${rollCount || 3}`} className="bg-red-100 text-fail" />;
  if (status === 'Fulfilled') return <Chip text="Fulfilled ✓" className="bg-green-100 text-pass" />;
  return null;
}

function ExpandedRow({ r, colSpan }) {
  const QA_LABELS = ['Q1 User Agent Screened', 'Q2 Cashback Correct', 'Q3 WA Link Sent', 'Q4 Hi Attempt Made', 'Q5 Cashback Mechanic Explained', 'Q6 No Improvised Claims'];
  const label = r['Call Label'];
  return (
    <tr className="bg-gray-50">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="grid gap-3 text-xs max-w-4xl">
          {/* Call Label + meta at top */}
          <div className="flex flex-wrap items-center gap-2">
            {label && <Chip text={label} className={callLabelColor(label)} />}
            {r['Call Outcome'] && <span className="text-gray-500">Outcome: {r['Call Outcome']}</span>}
            {r['Conversion Signal'] && <span className="text-gray-500">Signal: {r['Conversion Signal']}</span>}
            {r['Customer Intent Signal'] && <span className="text-gray-500">Intent: {r['Customer Intent Signal']}</span>}
            {r['Attempt Number'] && <span className="text-gray-500">Attempt: {r['Attempt Number']}</span>}
          </div>
          {r['Summary'] && (
            <div>
              <p className="font-semibold text-gray-600">Summary</p>
              <p className="text-gray-700">{r['Summary']}</p>
            </div>
          )}
          {r['Transcript'] && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">Transcript</p>
              <TranscriptViewer transcript={r['Transcript']} agentName={r['Agent Name']} />
            </div>
          )}
          {r['Recording URL'] && (
            <div>
              <audio controls src={r['Recording URL']} className="h-8 w-full max-w-md" />
            </div>
          )}
          {/* QA for welcome calls */}
          {(r.callCategory === 'Welcome-Call' || r.evaluationFramework === 'Welcome-Call-QA') && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">QA ({qaScore(r)}/6 — {qaRating(qaScore(r))})</p>
              <div className="flex flex-wrap gap-2">
                {QA_LABELS.map(q => (
                  <span key={q} className="flex items-center gap-1">
                    {r[q] ? <span className="text-pass">✓</span> : <span className="text-fail">✗</span>}
                    <span className="text-gray-600">{q.replace(/^Q\d\s/, '')}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function VikasQueue({ today, openCallbacks = [], onRemove, onRefresh }) {
  const { canDo } = useAuth();
  const canAction = canDo('canCallbackActions');
  const [expanded, setExpanded] = useState(null);
  const [showFuture, setShowFuture] = useState(false);
  const [showRetry, setShowRetry] = useState(false);

  const toggle = (key) => setExpanded(expanded === key ? null : key);

  // Today's date string for comparison
  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }, []);

  // ESCALATED (Roll ≥ 3 — needs Vikas's decision)
  const escalatedCallbacks = useMemo(() =>
    openCallbacks.filter(r => r['Callback Status'] === 'Escalated')
      .sort((a, b) => (b['Roll Count'] || 0) - (a['Roll Count'] || 0)),
    [openCallbacks]
  );

  // OVERDUE (missed yesterday, Roll ≤ 2)
  const overdueCallbacks = useMemo(() =>
    openCallbacks.filter(r => {
      const status = r['Callback Status'];
      return status === 'Overdue' || status === 'Attempted';
    }).sort((a, b) => (b['Roll Count'] || 0) - (a['Roll Count'] || 0)),
    [openCallbacks]
  );

  // TIME-SPECIFIC TODAY (sorted by time slot)
  const timeSpecificToday = useMemo(() =>
    openCallbacks.filter(r =>
      r['Callback Type'] === 'Time-Specific' &&
      r['Callback Target Date'] === todayStr &&
      r['Callback Status'] !== 'Fulfilled' &&
      r['Callback Status'] !== 'Overdue' &&
      r['Callback Status'] !== 'Escalated'
    ).sort((a, b) => (a['Callback Time Slot'] || a['Callback Time Window'] || '').localeCompare(b['Callback Time Slot'] || b['Callback Time Window'] || '')),
    [openCallbacks, todayStr]
  );

  // SOFT REQUESTS TODAY
  const softRequestToday = useMemo(() =>
    openCallbacks.filter(r =>
      (r['Callback Type'] === 'Soft-Request' || r['Callback Type'] === 'Retry-Only') &&
      r['Callback Target Date'] === todayStr &&
      r['Callback Status'] !== 'Fulfilled' &&
      r['Callback Status'] !== 'Overdue' &&
      r['Callback Status'] !== 'Escalated'
    ).sort((a, b) => (a['Call Date'] || '').localeCompare(b['Call Date'] || '')),
    [openCallbacks, todayStr]
  );

  // FUTURE (Target Date > today) — collapsed
  const futureCallbacks = useMemo(() =>
    openCallbacks.filter(r => {
      const td = r['Callback Target Date'];
      return td && td > todayStr &&
        r['Callback Status'] !== 'Fulfilled' &&
        r['Callback Status'] !== 'Overdue' &&
        r['Callback Status'] !== 'Escalated';
    }).sort((a, b) => (a['Callback Target Date'] || '').localeCompare(b['Callback Target Date'] || '')),
    [openCallbacks, todayStr]
  );

  // Retry Queue — unreachable calls NOT in open callbacks
  const retryQueue = useMemo(() => {
    const cbIds = new Set(openCallbacks.map(r => r.id));
    return today.filter(r => r['Conversion Signal'] === 'Unreachable' && !cbIds.has(r.id));
  }, [today, openCallbacks]);

  const retryByAgent = useMemo(() => {
    const map = {};
    retryQueue.forEach(r => {
      const agent = r['Agent Name'] || 'Unknown';
      if (!map[agent]) map[agent] = 0;
      map[agent]++;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [retryQueue]);

  // Deduplicate retry queue by mobile number (FIX 8)
  const uniqueRetryMobiles = useMemo(() => {
    const mobiles = new Set();
    retryQueue.forEach(r => { if (r['Mobile Number']) mobiles.add(String(r['Mobile Number'])); });
    return mobiles.size;
  }, [retryQueue]);

  // Q2 Compliance stats (FIX 7)
  const q2Stats = useMemo(() => {
    const wcalls = today.filter(r => {
      const cat = r.callCategory || r['Call Disposition'];
      const fw = r.evaluationFramework || r['Evaluation Framework'];
      return (cat === 'Welcome-Call' || fw === 'Welcome-Call-QA') && (r['Duration Seconds'] || 0) > 45;
    });
    if (wcalls.length === 0) return null;
    const q2Fails = wcalls.filter(r => !r['Q2 Cashback Correct']).length;
    const failRate = Math.round((q2Fails / wcalls.length) * 100);
    return { total: wcalls.length, fails: q2Fails, failRate };
  }, [today]);

  const handleMarkCalled = async (r) => {
    try {
      const hasCall = today.some(t =>
        String(t['Mobile Number']) === String(r['Mobile Number']) && t.id !== r.id
      );
      if (hasCall) {
        await patchRecord(r.id, {
          'Callback Status': 'Fulfilled',
          'Needs Callback': false,
          'Callback Requested': false
        });
        onRemove('openCallbacks', r.id);
      } else {
        if (confirm('No call logged by system today. Confirm manual override?')) {
          const dateStr = new Date().toLocaleDateString('en-IN');
          await patchRecord(r.id, {
            'Callback Status': 'Fulfilled',
            'Needs Callback': false,
            'Callback Requested': false,
            'Notes': (r['Notes'] || '') + `\nManually marked called by Vikas on ${dateStr}`
          });
          onRemove('openCallbacks', r.id);
        }
      }
    } catch (e) {
      alert('Failed: ' + e.message);
    }
  };

  const handleWriteOff = async (r) => {
    try {
      if (!confirm(`Write off this escalated callback? (${r['Roll Count'] || 0} rolls)`)) return;
      await patchRecord(r.id, {
        'Callback Status': 'Cancelled',
        'Needs Callback': false,
        'Callback Requested': false,
        'Notes': (r['Notes'] || '') + `\nWritten off by Vikas on ${new Date().toLocaleDateString('en-IN')}`
      });
      onRemove('openCallbacks', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleTryOneMoreDay = async (r) => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      await patchRecord(r.id, {
        'Callback Status': 'Scheduled',
        'Callback Target Date': tomorrowStr,
        'Roll Count': 0,
        'Notes': (r['Notes'] || '') + `\nReset by Vikas — one more try on ${new Date().toLocaleDateString('en-IN')}`
      });
      onRemove('openCallbacks', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const exportRetryCSV = () => {
    if (retryQueue.length === 0) return;
    const headers = ['Mobile Number', 'Agent', 'Call Date', 'Call Time', 'Duration (s)', 'Attempts'];
    const rows = retryQueue.map(r => [
      r['Mobile Number'] || '', r['Agent Name'] || '', r['Call Date'] || '',
      r['Call Time'] || '', r['Duration Seconds'] || 0, r['Attempt Number'] || 1,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `retry-queue-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // SECTION B: QA Review — strict filter
  const STT_FAILED = ['[STT Failed]', '[STT Failed — audio could not be processed]', 'failed', ''];
  const qaReview = useMemo(() => {
    return today
      .filter(r => {
        const cat = r.callCategory || r['Call Disposition'];
        const fw = r.evaluationFramework || r['Evaluation Framework'];
        const isWelcome = cat === 'Welcome-Call' || fw === 'Welcome-Call-QA';
        if (!isWelcome) return false;
        const dur = r['Duration Seconds'];
        if (dur == null || dur <= 45) return false;
        const transcript = (r['Transcript'] || '').trim();
        if (!transcript || STT_FAILED.includes(transcript)) return false;
        return true;
      })
      .map(r => ({
        ...r,
        _qs: qaScore(r),
        _qr: qaRating(qaScore(r)),
        _failReason: computeQAFailureReason(r),
        _gist: computeGist(r),
      }))
      .filter(r => r._qr === 'FAIL' || r._qr === 'AMBER')
      .sort((a, b) => a._qs - b._qs);
  }, [today]);

  const failCount = qaReview.filter(r => r._qr === 'FAIL').length;

  // Welcome call count for context
  const welcomeCallCount = useMemo(() =>
    today.filter(r => {
      const cat = r.callCategory || r['Call Disposition'];
      const fw = r.evaluationFramework || r['Evaluation Framework'];
      return cat === 'Welcome-Call' || fw === 'Welcome-Call-QA';
    }).length,
    [today]
  );

  // Non-welcome counts for empty state context
  const nonWelcomeStats = useMemo(() => {
    const outbound = today.filter(r => {
      const cat = r.callCategory || r['Call Disposition'];
      return cat && cat !== 'Welcome-Call';
    }).length;
    const unreachable = today.filter(r => r['Conversion Signal'] === 'Unreachable').length;
    return { outbound, unreachable };
  }, [today]);

  // SECTION: Welcome/Onboarding Calls — all welcome calls for today
  const welcomeCalls = useMemo(() => {
    return today
      .filter(r => {
        const cat = r.callCategory || r['Call Disposition'];
        const fw = r.evaluationFramework || r['Evaluation Framework'];
        return cat === 'Welcome-Call' || fw === 'Welcome-Call-QA';
      })
      .map(r => ({
        ...r,
        _qs: qaScore(r),
        _qr: qaRating(qaScore(r)),
        _gist: computeGist(r),
      }))
      .sort((a, b) => (b['Call Time'] || '').localeCompare(a['Call Time'] || ''));
  }, [today]);

  // SECTION C: Agent Coaching Cards
  const coachingCards = useMemo(() => {
    const map = {};
    today.forEach(r => {
      const agent = r['Agent Name'] || 'Unknown';
      if (!map[agent]) map[agent] = {
        name: agent, calls: 0, connected: 0, totalSec: 0,
        qaScores: [], hot: 0, warm: 0, welcomeQa: [],
      };
      map[agent].calls++;
      if (isHumanPickup(r)) {
        map[agent].connected++;
        map[agent].totalSec += (r['Duration Seconds'] || 0);
      }
      const cat = r.callCategory || r['Call Disposition'];
      const fw = r.evaluationFramework || r['Evaluation Framework'];
      if (cat === 'Welcome-Call' || fw === 'Welcome-Call-QA') {
        const qs = qaScore(r);
        map[agent].welcomeQa.push(qs);
      }
      if (r['Hot Lead']) map[agent].hot++;
      if (r['Conversion Signal'] === 'warm') map[agent].warm++;
    });

    return Object.values(map).map(a => {
      const connectRate = a.calls > 0 ? Math.round((a.connected / a.calls) * 100) : 0;
      const avgTime = a.connected > 0 ? Math.round(a.totalSec / a.connected) : 0;
      const avgQa = a.welcomeQa.length > 0
        ? +(a.welcomeQa.reduce((s, v) => s + v, 0) / a.welcomeQa.length).toFixed(1)
        : null;
      let status = 'On Track';
      let statusColor = 'border-pass';
      if (avgQa !== null && avgQa < 3) {
        status = 'Needs Coaching';
        statusColor = 'border-fail';
      } else if (connectRate < 15 || (avgQa !== null && avgQa < 4)) {
        status = 'Watch';
        statusColor = 'border-amber';
      }
      return { ...a, connectRate, avgTime, avgQa, status, statusColor };
    }).sort((a, b) => {
      const order = { 'Needs Coaching': 0, 'Watch': 1, 'On Track': 2 };
      return (order[a.status] ?? 2) - (order[b.status] ?? 2);
    });
  }, [today]);

  const QA_LABELS = ['Q1 User Agent Screened', 'Q2 Cashback Correct', 'Q3 WA Link Sent', 'Q4 Hi Attempt Made', 'Q5 Cashback Mechanic Explained', 'Q6 No Improvised Claims'];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Vikas — Action Queue</h2>
        <p className="text-sm text-gray-500">Welcome Calls + Callbacks + QA Review + Coaching</p>
        <p className="text-[10px] text-gray-400 mt-0.5">Action queues always show today's data</p>
      </div>

      {/* Q2 Compliance Alert (FIX 7) */}
      {q2Stats && q2Stats.failRate > 50 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">&#x1F6A8;</span>
          <div>
            <p className="text-sm font-bold text-red-800">Q2 Cashback Compliance Alert</p>
            <p className="text-xs text-red-700 mt-0.5">
              {q2Stats.failRate}% of welcome calls ({q2Stats.fails}/{q2Stats.total}) gave incorrect cashback information.
              Agents must state the correct cashback percentage per the plan document.
            </p>
          </div>
        </div>
      )}

      {/* CALLBACK TRACKER */}

      {/* ESCALATED — Roll ≥ 3, needs Vikas's decision */}
      {escalatedCallbacks.length > 0 && (
        <div className="bg-card rounded-xl shadow-sm border-l-4 border-red-600 overflow-hidden">
          <div className="flex items-center gap-2 p-4 pb-2">
            <h3 className="text-sm font-semibold text-red-700">&#x1F6A8; Escalated — Needs Your Decision</h3>
            <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{escalatedCallbacks.length}</span>
            <span className="text-[10px] text-gray-400 ml-auto">Roll &#x2265; 3 — write off or try one more day</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Rolls</th>
                  <th className="px-4 py-2">Original Date</th>
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time Window</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {escalatedCallbacks.map(r => {
                  const key = `esc-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2 font-mono font-bold text-red-600">{r['Roll Count'] || 3}&#xD7;</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs">
                          {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                        </td>
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 text-xs">{r['Callback Time Slot'] || r['Callback Time Window'] || '--'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canAction ? (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => handleWriteOff(r)}
                                className="px-3 py-1 text-xs font-medium rounded-lg bg-gray-600 text-white hover:bg-gray-700 active:scale-95 transition-all min-h-[44px] md:min-h-0"
                              >
                                Write Off
                              </button>
                              <button
                                onClick={() => handleTryOneMoreDay(r)}
                                className="px-3 py-1 text-xs font-medium rounded-lg bg-amber text-white hover:bg-yellow-600 active:scale-95 transition-all min-h-[44px] md:min-h-0"
                              >
                                +1 Day
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={7} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* OVERDUE — missed yesterday, Roll ≤ 2 */}
      {overdueCallbacks.length > 0 && (
        <div className="bg-card rounded-xl shadow-sm border-l-4 border-orange-500 overflow-hidden">
          <div className="flex items-center gap-2 p-4 pb-2">
            <h3 className="text-sm font-semibold text-orange-700">&#x26A0;&#xFE0F; Overdue Callbacks</h3>
            <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{overdueCallbacks.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Rolls</th>
                  <th className="px-4 py-2">Original Date</th>
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time Window</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {overdueCallbacks.map(r => {
                  const key = `ov-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2"><CallbackStatusBadge status={r['Callback Status']} rollCount={r['Roll Count']} /></td>
                        <td className="px-4 py-2 font-mono font-bold text-orange-600">{r['Roll Count'] || 1}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs">
                          {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                        </td>
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 text-xs">{r['Callback Time Slot'] || r['Callback Time Window'] || '--'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canAction ? (
                            <ActionButton label="Mark Called" onClick={() => handleMarkCalled(r)} />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={8} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TIME-SPECIFIC TODAY (sorted by time slot) */}
      <div className="bg-card rounded-xl shadow-sm border-l-4 border-amber overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">&#x1F550; Time-Specific — Today</h3>
          <span className="bg-amber text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{timeSpecificToday.length}</span>
        </div>
        {timeSpecificToday.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400 text-xs">No time-specific callbacks due today</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Time Window</th>
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Original Date</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {timeSpecificToday.map(r => {
                  const key = `ts-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2 font-mono text-xs font-bold text-amber">{r['Callback Time Slot'] || r['Callback Time Window'] || '--'}</td>
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs">
                          {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                        </td>
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canAction ? (
                            <ActionButton label="Mark Called" onClick={() => handleMarkCalled(r)} />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={7} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SOFT REQUESTS TODAY */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">&#x1F4CB; Soft Requests — Today</h3>
          <span className="bg-gray-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{softRequestToday.length}</span>
        </div>
        {softRequestToday.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400 text-xs">No soft-request callbacks due today</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Priority</th>
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Original Date</th>
                  <th className="px-4 py-2">What they said</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {softRequestToday.map(r => {
                  const key = `sr-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2">{r['Callback Priority'] ? <Chip text={r['Callback Priority']} className={r['Callback Priority'] === 'Urgent' ? 'bg-red-100 text-fail' : r['Callback Priority'] === 'High' ? 'bg-amber-100 text-amber' : 'bg-gray-100 text-gray-600'} /> : '--'}</td>
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs">
                          {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                        </td>
                        <td className="px-4 py-2 text-xs">{r['Customer Objection'] || 'Callback requested'}</td>
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canAction ? (
                            <ActionButton label="Done" onClick={() => handleMarkCalled(r)} />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={8} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 4: FUTURE — Collapsed */}
      {futureCallbacks.length > 0 && (
        <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div
            className="flex items-center gap-2 p-4 cursor-pointer hover:bg-gray-50"
            onClick={() => setShowFuture(!showFuture)}
          >
            <span className="text-xs text-gray-500">{showFuture ? '▼' : '▶'}</span>
            <h3 className="text-sm font-semibold text-gray-700">Scheduled — Future</h3>
            <span className="bg-gray-400 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{futureCallbacks.length}</span>
            <span className="text-xs text-gray-400 ml-auto">{futureCallbacks.length} callbacks scheduled for future dates</span>
          </div>
          {showFuture && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="px-4 py-2">Target Date</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Mobile</th>
                    <th className="px-4 py-2">Agent</th>
                    <th className="px-4 py-2">Time Window</th>
                    <th className="px-4 py-2">Label</th>
                    <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {futureCallbacks.map(r => {
                    const key = `ft-${r.id}`;
                    return (
                      <Fragment key={r.id}>
                        <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                          <td className="px-4 py-2 whitespace-nowrap text-xs font-medium">
                            {r['Callback Target Date'] ? new Date(r['Callback Target Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' }) : '--'}
                          </td>
                          <td className="px-4 py-2"><Chip text={r['Callback Type'] || '--'} className={r['Callback Type'] === 'Time-Specific' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-amber'} /></td>
                          <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                          <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                          <td className="px-4 py-2 text-xs">{r['Callback Time Window'] || '--'}</td>
                          <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                          <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        </tr>
                        {expanded === key && <ExpandedRow r={r} colSpan={7} />}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* RETRY QUEUE — collapsible */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div
          className="flex items-center gap-2 p-4 cursor-pointer hover:bg-gray-50"
          onClick={() => setShowRetry(!showRetry)}
        >
          <span className="text-xs text-gray-500">{showRetry ? '&#x25BC;' : '&#x25B6;'}</span>
          <h3 className="text-sm font-semibold text-gray-700">&#x267B;&#xFE0F; Retry Queue</h3>
          {retryQueue.length > 0 && (
            <span className="bg-gray-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{uniqueRetryMobiles}</span>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {retryQueue.length === 0 ? 'No unreachable calls' : `${uniqueRetryMobiles} unique numbers`}
          </span>
          {retryQueue.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); exportRetryCSV(); }}
              className="px-3 py-1 text-xs font-medium rounded-lg bg-info text-white hover:bg-blue-700 active:scale-95 transition-all"
            >
              Export
            </button>
          )}
        </div>
        {showRetry && retryQueue.length > 0 && (
          <div className="px-4 pb-4">
            <p className="text-sm text-gray-700 mb-3">
              <span className="font-bold">{uniqueRetryMobiles}</span> unique numbers to retry tomorrow
              {uniqueRetryMobiles !== retryQueue.length && (
                <span className="text-gray-400 text-xs ml-1">({retryQueue.length} total attempts)</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {retryByAgent.map(([agent, count]) => (
                <div key={agent} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs">
                  <span className="font-semibold text-gray-700">{agent}</span>
                  <span className="text-gray-500 ml-1.5">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SECTION: Welcome/Onboarding Calls */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">Welcome / Onboarding Calls</h3>
          <span className="bg-blue-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{welcomeCalls.length}</span>
          <span className="text-xs text-gray-400 ml-auto">Today only — all welcome calls</span>
        </div>
        {welcomeCalls.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">
            No Welcome Calls today. Pipeline processed {nonWelcomeStats.outbound} outbound + {nonWelcomeStats.unreachable} unreachable
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">QA</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2">Q1-Q6</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                </tr>
              </thead>
              <tbody>
                {welcomeCalls.map(r => {
                  const key = `wc-${r.id}`;
                  const subType = subscriberType(r);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2"><Chip text={r._qr} className={ratingColor(r._qr)} /></td>
                        <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${subscriberTypeColor(subType)}`}>{subType}</span></td>
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className={`px-4 py-2 text-xs ${gistColor(r._gist)}`}>{r._gist}</td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                        <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                        <td className="px-4 py-2">
                          <div className="flex gap-0.5">
                            {QA_LABELS.map((q, i) => (
                              <span key={i} className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold ${r[q] ? 'bg-pass text-white' : 'bg-fail text-white'}`}>
                                {r[q] ? '✓' : '✗'}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={10} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION B: QA Review — Welcome Calls FAIL/AMBER Only */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">QA Review — Needs Attention</h3>
          {failCount > 0 && (
            <span className="bg-fail text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{failCount}</span>
          )}
          <span className="text-xs text-gray-400 ml-auto">{welcomeCallCount} welcome calls today</span>
        </div>
        {qaReview.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">
            {welcomeCallCount === 0
              ? `No Welcome Calls today. Pipeline processed ${nonWelcomeStats.outbound} outbound + ${nonWelcomeStats.unreachable} unreachable`
              : 'All Welcome Calls passed QA today'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Rating</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Q1-Q6</th>
                  <th className="px-4 py-2">Failure Reason</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2">Listen</th>
                </tr>
              </thead>
              <tbody>
                {qaReview.map(r => {
                  const key = `qa-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2"><Chip text={r._qr} className={ratingColor(r._qr)} /></td>
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className={`px-4 py-2 text-xs ${gistColor(r._gist)}`}>{r._gist}</td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            {QA_LABELS.map((q, i) => (
                              <span key={i} className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold ${r[q] ? 'bg-pass text-white' : 'bg-fail text-white'}`}>
                                {r[q] ? '✓' : '✗'}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs text-fail max-w-[200px]">{r._failReason || '--'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2">
                          {r['Recording URL'] ? (
                            <a href={r['Recording URL']} target="_blank" rel="noopener" className="text-info text-xs underline" onClick={e => e.stopPropagation()}>Listen</a>
                          ) : '--'}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={9} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION C: Agent Coaching Cards */}
      {coachingCards.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Agent Coaching — Today</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {coachingCards.map(a => (
              <div
                key={a.name}
                className={`bg-card rounded-xl p-4 shadow-sm border-l-4 ${a.statusColor}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-gray-800">{a.name}</p>
                  <Chip
                    text={a.status}
                    className={
                      a.status === 'Needs Coaching' ? 'bg-red-100 text-fail' :
                      a.status === 'Watch' ? 'bg-yellow-100 text-amber' :
                      'bg-green-100 text-pass'
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <p>{a.calls} calls</p>
                  <p className={kpiColor(a.connectRate, 25, 15)}>Connect: {a.connectRate}%</p>
                  <p>Avg talk: {fmtDuration(a.avgTime)}</p>
                  <p>
                    {a.avgQa !== null
                      ? <span className={a.avgQa >= 5 ? 'text-pass' : a.avgQa >= 3 ? 'text-amber' : 'text-fail'}>QA: {a.avgQa}/6</span>
                      : <span className="text-gray-400">No WC QA</span>}
                  </p>
                </div>
                {(a.hot > 0 || a.warm > 0) && (
                  <div className="flex gap-2 mt-2 text-xs">
                    {a.hot > 0 && <span className="text-red-600 font-bold">{a.hot} hot</span>}
                    {a.warm > 0 && <span className="text-amber font-bold">{a.warm} warm</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
