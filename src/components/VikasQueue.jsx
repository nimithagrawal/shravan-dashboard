import { useMemo } from 'react';
import { patchRecord } from '../lib/airtable';
import { qaScore, qaRating, fmtDuration, ratingColor, truncate } from '../lib/helpers';
import PhoneNumber from './PhoneNumber';

function Chip({ text, className }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>{text}</span>;
}

function ActionButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 text-xs font-medium rounded-lg bg-pass text-white hover:bg-green-700 active:scale-95 transition-all"
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

  // SECTION B: QA Review
  const qaReview = useMemo(() =>
    today
      .map(r => ({ ...r, _qs: qaScore(r), _qr: qaRating(qaScore(r)) }))
      .filter(r => r._qr === 'FAIL' || r._qr === 'AMBER')
      .sort((a, b) => a._qs - b._qs),
    [today]
  );

  const failCount = qaReview.filter(r => r._qr === 'FAIL').length;

  // Agent summary cards (this week)
  const agentSummary = useMemo(() => {
    const map = {};
    today.forEach(r => {
      const agent = r['Agent Name'] || 'Unknown';
      if (!map[agent]) map[agent] = { name: agent, scores: [], pass: 0, amber: 0, fail: 0 };
      const qs = qaScore(r);
      const qr = qaRating(qs);
      map[agent].scores.push(qs);
      if (qr === 'PASS') map[agent].pass++;
      else if (qr === 'AMBER') map[agent].amber++;
      else map[agent].fail++;
    });
    return Object.values(map).map(a => ({
      ...a,
      avg: +(a.scores.reduce((s, v) => s + v, 0) / a.scores.length).toFixed(1),
    }));
  }, [today]);

  const QA_LABELS = ['Q1 User Agent Screened', 'Q2 Cashback Correct', 'Q3 WA Link Sent', 'Q4 Hi Attempt Made', 'Q5 Cashback Mechanic Explained', 'Q6 No Improvised Claims'];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Vikas — Action Queue</h2>
        <p className="text-sm text-gray-500">Callbacks + QA Review</p>
      </div>

      {/* Callbacks Requested (Gemini-detected) */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">📞 Callbacks Requested (AI-detected)</h3>
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
                  <th className="px-4 py-2">Subscriber</th>
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
                    <td className="px-4 py-2">{r['Subscriber Name'] || '--'}</td>
                    <td className="px-4 py-2">
                      <PhoneNumber number={r['Mobile Number']} />
                    </td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                    <td className="px-4 py-2">{r['Call Outcome'] || '--'}</td>
                    <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      <ActionButton label="✓ Called Back" onClick={() => handleCallbackReqDone(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION A: Callbacks */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">Callbacks Pending</h3>
          {sortedCallbacks.length > 0 && (
            <span className="bg-fail text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{sortedCallbacks.length}</span>
          )}
        </div>
        {sortedCallbacks.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">✅ No callbacks pending</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Priority</th>
                  <th className="px-4 py-2">Due</th>
                  <th className="px-4 py-2">Subscriber</th>
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
                        ? <Chip text="🔴 Urgent" className="bg-red-600 text-white" />
                        : r['Callback Priority'] === 'High'
                        ? <Chip text="🟠 High" className="bg-orange-500 text-white" />
                        : <Chip text="⚪ Normal" className="bg-gray-200 text-gray-700" />}
                    </td>
                    <td className="px-4 py-2">
                      <Chip text={r['Callback Due'] || '--'} className="bg-gray-100 text-gray-700" />
                    </td>
                    <td className="px-4 py-2">{r['Subscriber Name'] || r['Mobile Number'] || '--'}</td>
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
                      <ActionButton label="✓ Mark Called" onClick={() => handleMarkCalled(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION B: QA Review */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">QA Review — Today</h3>
          {failCount > 0 && (
            <span className="bg-fail text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{failCount}</span>
          )}
        </div>
        {qaReview.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">✅ All calls passed QA today</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Rating</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Attempt</th>
                  <th className="px-4 py-2">Subscriber</th>
                  <th className="px-4 py-2">Q1-Q6</th>
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
                    <td className="px-4 py-2">{r['Subscriber Name'] || '--'}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {QA_LABELS.map((q, i) => (
                          <span key={i} className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold ${r[q] ? 'bg-pass text-white' : 'bg-fail text-white'}`}>
                            {r[q] ? '✓' : '✗'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {r['Compliance Violation'] && <span className="text-fail text-xs">🚨 {r['Compliance Detail'] || 'Violation'}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      {r['Recording URL'] ? (
                        <a href={r['Recording URL']} target="_blank" rel="noopener" className="text-info text-xs underline">▶ Listen</a>
                      ) : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Agent Summary Cards */}
      {agentSummary.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Agent Summary — Today</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {agentSummary.map(a => (
              <div
                key={a.name}
                className={`bg-card rounded-xl p-4 shadow-sm border-l-4 ${
                  a.avg >= 5 ? 'border-pass' : a.avg >= 3 ? 'border-amber' : 'border-fail'
                }`}
              >
                <p className="font-semibold text-gray-800">{a.name}</p>
                <p className="text-sm text-gray-500 mt-1">Avg QA: <span className="font-mono font-bold">{a.avg}/6</span></p>
                <div className="flex gap-3 mt-2 text-xs">
                  <span className="text-pass font-medium">PASS: {a.pass}</span>
                  <span className="text-amber font-medium">AMBER: {a.amber}</span>
                  <span className="text-fail font-medium">FAIL: {a.fail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
