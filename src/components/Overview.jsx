import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { qaScore, qaRating, fmtDuration, outcomeColor, ratingColor, kpiColor } from '../lib/helpers';

function KpiCard({ label, value, color, badge }) {
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100 relative">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
      {badge != null && badge > 0 && (
        <span className="absolute top-2 right-2 bg-fail text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span>
      )}
    </div>
  );
}

function Chip({ text, className }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>{text}</span>;
}

export default function Overview({ today, recent }) {
  const [expanded, setExpanded] = useState(null);

  const total = today.length;
  const picked = today.filter(r => r['Call Outcome'] !== 'No-Answer').length;
  const pickupRate = total > 0 ? Math.round((picked / total) * 100) : 0;

  const scored = today.map(r => ({ ...r, _qs: qaScore(r) }));
  const scoredCalls = scored.filter(r => r._qs > 0 || r['Q1 User Agent Screened'] != null);
  const passCount = scoredCalls.filter(r => qaRating(r._qs) === 'PASS').length;
  const qaPassRate = scoredCalls.length > 0 ? Math.round((passCount / scoredCalls.length) * 100) : 0;

  const violations = today.filter(r => r['Compliance Violation']).length;
  const callbacksPending = today.filter(r => r['Needs Callback']).length;
  const urgentCallbacks = today.filter(r => r['Needs Callback'] && r['Callback Priority'] === 'Urgent').length;
  const activeSignals = today.filter(r => r['Samir Action Required']).length;

  // Agent QA chart
  const agentData = useMemo(() => {
    const map = {};
    scored.forEach(r => {
      const agent = r['Agent Name'] || 'Unknown';
      if (!map[agent]) map[agent] = { scores: [], name: agent };
      map[agent].scores.push(r._qs);
    });
    return Object.values(map)
      .map(a => ({ name: a.name, avg: +(a.scores.reduce((s, v) => s + v, 0) / a.scores.length).toFixed(1) }))
      .sort((a, b) => a.avg - b.avg);
  }, [scored]);

  const barColor = (avg) => avg >= 5 ? '#16a34a' : avg >= 3 ? '#d97706' : '#dc2626';

  const recentScored = recent.map(r => ({ ...r, _qs: qaScore(r), _qr: qaRating(qaScore(r)) }));

  const QA_LABELS = ['Q1 User Agent Screened', 'Q2 Cashback Correct', 'Q3 WA Link Sent', 'Q4 Hi Attempt Made', 'Q5 Cashback Mechanic Explained', 'Q6 No Improvised Claims'];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Calls Today" value={total} />
        <KpiCard label="Pickup Rate" value={`${pickupRate}%`} color={kpiColor(pickupRate, 50, 40)} />
        <KpiCard label="QA Pass Rate" value={`${qaPassRate}%`} color={kpiColor(qaPassRate, 60, 40)} />
        <KpiCard label="Compliance Violations" value={violations} color={violations > 0 ? 'text-fail' : 'text-pass'} />
        <KpiCard label="Callbacks Pending" value={callbacksPending} badge={urgentCallbacks} />
        <KpiCard label="Active Signals" value={activeSignals} color={activeSignals > 0 ? 'text-fail' : 'text-pass'} />
      </div>

      {/* Agent QA Chart */}
      {agentData.length > 0 && (
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Agent QA Scores (avg out of 6)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agentData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis domain={[0, 6]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [v, 'Avg QA']} />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                {agentData.map((e, i) => <Cell key={i} fill={barColor(e.avg)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Call Log Table */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <h2 className="text-sm font-semibold text-gray-700 p-4 pb-2">Recent Calls</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Agent</th>
                <th className="px-4 py-2">Subscriber</th>
                <th className="px-4 py-2">Outcome</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">QA</th>
                <th className="px-4 py-2">Rating</th>
                <th className="px-4 py-2">Signals</th>
              </tr>
            </thead>
            <tbody>
              {recentScored.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No calls yet</td></tr>
              )}
              {recentScored.map((r, i) => (
                <React.Fragment key={r.id || i}>
                  <tr
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2">{r['Subscriber Name'] || r['Mobile Number'] || '--'}</td>
                    <td className="px-4 py-2"><Chip text={r['Call Outcome'] || '--'} className={outcomeColor(r['Call Outcome'])} /></td>
                    <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                    <td className="px-4 py-2 font-mono">{r._qs}/6</td>
                    <td className="px-4 py-2"><Chip text={r._qr} className={ratingColor(r._qr)} /></td>
                    <td className="px-4 py-2 space-x-0.5 text-sm">
                      {r['Compliance Violation'] && <span title="Compliance">🚨</span>}
                      {r['Hot Lead'] && <span title="Hot Lead">🟢</span>}
                      {r['Loan Signal'] && <span title="Loan">💰</span>}
                      {r['Churn Signal'] && <span title="Churn">⚠️</span>}
                    </td>
                  </tr>
                  {expanded === i && (
                    <tr className="bg-gray-50">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid gap-3 text-xs max-w-3xl">
                          <div>
                            <p className="font-semibold text-gray-600 mb-1">QA Checklist</p>
                            <div className="flex flex-wrap gap-2">
                              {QA_LABELS.map(q => (
                                <span key={q} className="flex items-center gap-1">
                                  {r[q] ? <span className="text-pass">✓</span> : <span className="text-fail">✗</span>}
                                  <span className="text-gray-600">{q.replace(/^Q\d\s/, '')}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                          {r['Compliance Detail'] && (
                            <div>
                              <p className="font-semibold text-fail">Compliance: {r['Compliance Detail']}</p>
                            </div>
                          )}
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
                            <a href={r['Recording URL']} target="_blank" rel="noopener" className="text-info underline">▶ Listen to Recording</a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
