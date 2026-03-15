import { useMemo } from 'react';
import { patchRecord } from '../lib/airtable';
import { qaScore, qaRating, fmtDuration, ratingColor, truncate, computeQAFailureReason, isHumanPickup, kpiColor } from '../lib/helpers';
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

export default function VikasQueue({ today, callbacks, callbacksRequested = [], onRemove, onRefresh }) {
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
  // Welcome-Call only, duration>45, real transcript, FAIL|AMBER
  const qaReview = useMemo(() => {
    return today
      .filter(r => {
        const cat = r.callCategory || r['Call Category'];
        const fw = r.evaluationFramework || r['Evaluation Framework'];
        const isWelcome = cat === 'Welcome-Call' || fw === 'Welcome-Call-QA';
        if (!isWelcome) return false;
        const dur = r['Duration Seconds'];
        if (dur == null || dur <= 45) return false;
        const transcript = r['Transcript'];
        if (!transcript || transcript === 'failed' || transcript.trim() === '') return false;
        return true;
      })
      .map(r => ({
        ...r,
        _qs: qaScore(r),
        _qr: qaRating(qaScore(r)),
        _failReason: computeQAFailureReason(r),
      }))
      .filter(r => r._qr === 'FAIL' || r._qr === 'AMBER')
      .sort((a, b) => a._qs - b._qs);
  }, [today]);

  const failCount = qaReview.filter(r => r._qr === 'FAIL').length;

  // Count welcome calls for context
  const welcomeCallCount = useMemo(() =>
    today.filter(r => {
      const cat = r.callCategory || r['Call Category'];
      const fw = r.evaluationFramework || r['Evaluation Framework'];
      return cat === 'Welcome-Call' || fw === 'Welcome-Call-QA';
    }).length,
    [today]
  );

  // Non-welcome counts for empty state context
  const nonWelcomeStats = useMemo(() => {
    const outbound = today.filter(r => {
      const cat = r.callCategory || r['Call Category'];
      return cat && cat !== 'Welcome-Call';
    }).length;
    const unreachable = today.filter(r => r['Conversion Signal'] === 'Unreachable').length;
    return { outbound, unreachable };
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
      // QA for welcome calls only
      const cat = r.callCategory || r['Call Category'];
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
      // Status logic
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
        <p className="text-sm text-gray-500">Callbacks + QA Review + Coaching</p>
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
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Outcome</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedCallbacksReq.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <PhoneNumber number={r['Mobile Number']} />
                    </td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                    <td className="px-4 py-2">{r['Call Outcome'] || '--'}</td>
                    <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      <ActionButton label="Done" onClick={() => handleCallbackReqDone(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Attempt</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Outcome</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedCallbacks.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
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
                    <td className="px-4 py-2">
                      <PhoneNumber number={r['Mobile Number']} />
                    </td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2">{r['Attempt Number'] || '--'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                    <td className="px-4 py-2">{r['Call Outcome'] || '--'}</td>
                    <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      <ActionButton label="Done" onClick={() => handleMarkCalled(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION B: QA Review — Welcome Calls Only */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">QA Review — Welcome Calls</h3>
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
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Attempt</th>
                  <th className="px-4 py-2">Q1-Q6</th>
                  <th className="px-4 py-2">Failure Reason</th>
                  <th className="px-4 py-2">Compliance</th>
                  <th className="px-4 py-2">Summary</th>
                  <th className="px-4 py-2">Listen</th>
                </tr>
              </thead>
              <tbody>
                {qaReview.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2"><Chip text={r._qr} className={ratingColor(r._qr)} /></td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                    <td className="px-4 py-2">{r['Attempt Number'] || '--'}</td>
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
                    <td className="px-4 py-2">
                      {r['Compliance Violation'] && <span className="text-fail text-xs">{r['Compliance Detail'] || 'Violation'}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      {r['Recording URL'] ? (
                        <a href={r['Recording URL']} target="_blank" rel="noopener" className="text-info text-xs underline">Listen</a>
                      ) : '--'}
                    </td>
                  </tr>
                ))}
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
