import { useState, useMemo, Fragment } from 'react';
import { patchRecord } from '../lib/airtable';
import { qaScore, qaRating, fmtDuration, ratingColor, truncate, computeQAFailureReason, isHumanPickup, kpiColor, computeGist, gistColor, extractScheduledCallback, formatCallbackDue, callbackDueColor, subscriberType, subscriberTypeColor } from '../lib/helpers';
import PhoneNumber from './PhoneNumber';

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

function ExpandedRow({ r, colSpan }) {
  const QA_LABELS = ['Q1 User Agent Screened', 'Q2 Cashback Correct', 'Q3 WA Link Sent', 'Q4 Hi Attempt Made', 'Q5 Cashback Mechanic Explained', 'Q6 No Improvised Claims'];
  return (
    <tr className="bg-gray-50">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="grid gap-3 text-xs max-w-4xl">
          {r['Summary'] && (
            <div>
              <p className="font-semibold text-gray-600">Summary</p>
              <p className="text-gray-700">{r['Summary']}</p>
            </div>
          )}
          {r['Transcript'] && (
            <div>
              <p className="font-semibold text-gray-600">Transcript</p>
              <div className="max-h-40 overflow-y-auto bg-white p-2 rounded border text-gray-700 whitespace-pre-wrap">{r['Transcript']}</div>
            </div>
          )}
          {r['Recording URL'] && (
            <div>
              <audio controls src={r['Recording URL']} className="h-8 w-full max-w-md" />
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            {r['Call Outcome'] && <span>Outcome: {r['Call Outcome']}</span>}
            {r['Conversion Signal'] && <span>Signal: {r['Conversion Signal']}</span>}
            {r['Customer Intent Signal'] && <span>Intent: {r['Customer Intent Signal']}</span>}
            {r['Attempt Number'] && <span>Attempt: {r['Attempt Number']}</span>}
          </div>
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

export default function VikasQueue({ today, callbacks, callbacksRequested = [], onRemove, onRefresh }) {
  const [expanded, setExpanded] = useState(null);
  const [filterScheduledDate, setFilterScheduledDate] = useState('');
  const [filterScheduledGroup, setFilterScheduledGroup] = useState('');

  const toggle = (key) => setExpanded(expanded === key ? null : key);

  // Callbacks Requested (from Gemini sentiment)
  const sortedCallbacksReq = useMemo(() =>
    [...callbacksRequested].sort((a, b) => (b['Call Date'] || '').localeCompare(a['Call Date'] || '')),
    [callbacksRequested]
  );

  // SECTION A: Callback Queue
  const sortedCallbacks = useMemo(() => {
    const prio = { Urgent: 0, High: 1, Normal: 2 };
    return [...callbacks].sort((a, b) => {
      const pa = prio[a['Callback Priority']] ?? 2;
      const pb = prio[b['Callback Priority']] ?? 2;
      if (pa !== pb) return pa - pb;
      return (b['Call Date'] || '').localeCompare(a['Call Date'] || '');
    });
  }, [callbacks]);

  const handleMarkCalled = async (r) => {
    try {
      await patchRecord(r.id, { 'Needs Callback': false });
      onRemove('callbacks', r.id);
    } catch (e) {
      alert('Failed: ' + e.message);
    }
  };

  const handleCallbackReqDone = async (r) => {
    try {
      await patchRecord(r.id, { 'Callback Requested': false });
      onRemove('callbacksRequested', r.id);
    } catch (e) {
      alert('Failed: ' + e.message);
    }
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

  // SECTION: Scheduled Callbacks — customers who asked to be called at specific time
  const scheduledCallbacks = useMemo(() => {
    return today
      .map(r => ({ ...r, _scheduled: extractScheduledCallback(r), _gist: computeGist(r) }))
      .filter(r => r._scheduled)
      .sort((a, b) => (a._scheduled.raw || '').localeCompare(b._scheduled.raw || ''));
  }, [today]);

  const filteredScheduled = useMemo(() => {
    let rows = scheduledCallbacks;
    if (filterScheduledGroup) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
      const tmrStr = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
      if (filterScheduledGroup === 'overdue') rows = rows.filter(r => r._scheduled.resolvedDate && r._scheduled.resolvedDate < todayStr);
      else if (filterScheduledGroup === 'today') rows = rows.filter(r => r._scheduled.resolvedDate === todayStr);
      else if (filterScheduledGroup === 'tomorrow') rows = rows.filter(r => r._scheduled.resolvedDate === tmrStr);
      else if (filterScheduledGroup === 'future') rows = rows.filter(r => r._scheduled.resolvedDate && r._scheduled.resolvedDate > tmrStr);
      else if (filterScheduledGroup === 'no_date') rows = rows.filter(r => !r._scheduled.resolvedDate);
    }
    if (filterScheduledDate) {
      const filter = filterScheduledDate.toLowerCase();
      rows = rows.filter(r => {
        const raw = (r._scheduled.raw || '').toLowerCase();
        return raw.includes(filter);
      });
    }
    return rows;
  }, [scheduledCallbacks, filterScheduledDate, filterScheduledGroup]);

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

      {/* Callbacks Requested (Gemini-detected) */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">Callbacks Requested (AI-detected)</h3>
          {sortedCallbacksReq.length > 0 && (
            <span className="bg-amber text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{sortedCallbacksReq.length}</span>
          )}
        </div>
        {sortedCallbacksReq.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">No AI-detected callback requests</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedCallbacksReq.map((r, i) => {
                  const key = `cbr-${r.id}`;
                  const gist = computeGist(r);
                  const subType = subscriberType(r);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${subscriberTypeColor(subType)}`}>{subType}</span></td>
                        <td className={`px-4 py-2 text-xs ${gistColor(gist)}`}>{gist}</td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                        <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          <ActionButton label="Done" onClick={() => handleCallbackReqDone(r)} />
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

      {/* Scheduled Callbacks — customer asked to call at specific date/time */}
      {scheduledCallbacks.length > 0 && (
        <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-2 p-4 pb-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-700">Scheduled Callbacks</h3>
            <span className="bg-info text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{scheduledCallbacks.length}</span>
            <div className="ml-auto flex items-center gap-2">
              <select
                value={filterScheduledGroup}
                onChange={(e) => setFilterScheduledGroup(e.target.value)}
                className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-info"
              >
                <option value="">All Dates</option>
                <option value="overdue">Overdue</option>
                <option value="today">Due Today</option>
                <option value="tomorrow">Due Tomorrow</option>
                <option value="future">Future</option>
                <option value="no_date">No Date</option>
              </select>
              <input
                type="text"
                value={filterScheduledDate}
                onChange={(e) => setFilterScheduledDate(e.target.value)}
                placeholder="Search..."
                className="px-2 py-1 text-xs border border-gray-200 rounded-lg w-28 focus:outline-none focus:border-info"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">CB Due</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Call Date</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                </tr>
              </thead>
              <tbody>
                {filteredScheduled.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-xs">No scheduled callbacks match your filter</td></tr>
                )}
                {filteredScheduled.map(r => {
                  const key = `sch-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className="px-4 py-2">
                          <Chip text={formatCallbackDue(r._scheduled)} className={callbackDueColor(r._scheduled)} />
                        </td>
                        <td className="px-4 py-2 text-xs font-mono">{r._scheduled.resolvedTime || '--'}</td>
                        <td className={`px-4 py-2 text-xs ${gistColor(r._gist)}`}>{r._gist}</td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs">
                          {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
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

      {/* SECTION A: Callbacks Pending */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">Callbacks Pending</h3>
          {sortedCallbacks.length > 0 && (
            <span className="bg-fail text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{sortedCallbacks.length}</span>
          )}
        </div>
        {sortedCallbacks.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">All callbacks done for today</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Priority</th>
                  <th className="px-4 py-2">Due</th>
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedCallbacks.map(r => {
                  const key = `cb-${r.id}`;
                  const gist = computeGist(r);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2">
                          {r['Callback Priority'] === 'Urgent'
                            ? <Chip text="Urgent" className="bg-red-600 text-white" />
                            : r['Callback Priority'] === 'High'
                            ? <Chip text="High" className="bg-orange-500 text-white" />
                            : <Chip text="Normal" className="bg-gray-200 text-gray-700" />}
                        </td>
                        <td className="px-4 py-2">
                          <Chip text={r['Callback Due'] || '--'} className="bg-gray-100 text-gray-700" />
                        </td>
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className={`px-4 py-2 text-xs ${gistColor(gist)}`}>{gist}</td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          <ActionButton label="Done" onClick={() => handleMarkCalled(r)} />
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
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
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
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                        <td className="px-4 py-2">
                          {r['Recording URL'] ? (
                            <a href={r['Recording URL']} target="_blank" rel="noopener" className="text-info text-xs underline" onClick={e => e.stopPropagation()}>Listen</a>
                          ) : '--'}
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
