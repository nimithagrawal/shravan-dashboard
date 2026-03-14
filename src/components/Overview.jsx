import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { qaScore, qaRating, fmtDuration, outcomeColor, ratingColor, kpiColor, sentimentDotColor, intentChipColor, sentimentScoreColor } from '../lib/helpers';
import PhoneNumber from './PhoneNumber';

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

  // Customer Sentiment stats
  const sentimentScores = today.map(r => r['Customer Sentiment Score']).filter(v => v != null && v > 0);
  const avgSentiment = sentimentScores.length > 0
    ? (sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length).toFixed(1)
    : '--';

  const intentBreakdown = useMemo(() => {
    const counts = { Interested: 0, Considering: 0, Rejected: 0, Unreachable: 0, Unclear: 0 };
    today.forEach(r => {
      const intent = r['Customer Intent Signal'];
      if (intent && counts[intent] !== undefined) counts[intent]++;
      else if (intent) counts['Unclear']++;
    });
    return counts;
  }, [today]);

  const callbackRequestedCount = today.filter(r => r['Callback Requested']).length;

  const languageBreakdown = useMemo(() => {
    const counts = {};
    today.forEach(r => {
      const lang = r['Language Comfort'] || r['Language Detected'] || 'Unknown';
      counts[lang] = (counts[lang] || 0) + 1;
    });
    const total = today.length || 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([lang, count]) => `${lang} ${Math.round((count / total) * 100)}%`);
  }, [today]);

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

      {/* Customer Sentiment Row */}
      <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Customer Sentiment</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 mb-1">Avg Sentiment Score</p>
            <p className={`text-xl font-bold ${avgSentiment !== '--' ? sentimentScoreColor(parseFloat(avgSentiment)) : 'text-gray-400'}`}>
              {avgSentiment}{avgSentiment !== '--' && <span className="text-sm font-normal text-gray-400"> / 5</span>}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Intent Breakdown</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(intentBreakdown).map(([k, v]) => v > 0 && (
                <Chip key={k} text={`${k} ${v}`} className={intentChipColor(k)} />
              ))}
              {Object.values(intentBreakdown).every(v => v === 0) && <span className="text-gray-400 text-xs">No data</span>}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Callback Requested</p>
            <p className="text-xl font-bold">
              {callbackRequestedCount > 0 ? (
                <span className="bg-amber text-white text-sm font-bold px-2 py-0.5 rounded-full">{callbackRequestedCount}</span>
              ) : (
                <span className="text-gray-400">0</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Language</p>
            <div className="text-xs text-gray-600 space-y-0.5">
              {languageBreakdown.length > 0 ? languageBreakdown.map(l => <p key={l}>{l}</p>) : <p className="text-gray-400">No data</p>}
            </div>
          </div>
        </div>
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
                <th className="px-4 py-2">Sentiment</th>
                <th className="px-4 py-2">Intent</th>
                <th className="px-4 py-2">Signals</th>
              </tr>
            </thead>
            <tbody>
              {recentScored.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">No calls yet</td></tr>
              )}
              {recentScored.map((r, i) => (
                <React.Fragment key={r.id || i}>
                  <tr
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-2 whitespace-nowrap">{r['Call Time'] || '--'}</td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2">{r['Subscriber Name'] || <PhoneNumber number={r['Mobile Number']} /> || '--'}</td>
                    <td className="px-4 py-2"><Chip text={r['Call Outcome'] || '--'} className={outcomeColor(r['Call Outcome'])} /></td>
                    <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                    <td className="px-4 py-2 font-mono">{r._qs}/6</td>
                    <td className="px-4 py-2"><Chip text={r._qr} className={ratingColor(r._qr)} /></td>
                    <td className="px-4 py-2">
                      {r['Customer Sentiment Score'] != null ? (
                        <span className="flex items-center gap-1">
                          <span className={`w-2.5 h-2.5 rounded-full ${sentimentDotColor(r['Customer Sentiment Score'])}`}></span>
                          <span className="font-mono text-xs">{r['Customer Sentiment Score']}</span>
                        </span>
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-2">
                      {r['Customer Intent Signal'] ? (
                        <Chip text={r['Customer Intent Signal']} className={intentChipColor(r['Customer Intent Signal'])} />
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-2 space-x-0.5 text-sm">
                      {r['Compliance Violation'] && <span title="Compliance">🚨</span>}
                      {r['Hot Lead'] && <span title="Hot Lead">🟢</span>}
                      {r['Loan Signal'] && <span title="Loan">💰</span>}
                      {r['Churn Signal'] && <span title="Churn">⚠️</span>}
                      {r['Callback Requested'] && <span title="Callback Requested">📞</span>}
                    </td>
                  </tr>
                  {expanded === i && (
                    <tr className="bg-gray-50">
                      <td colSpan={10} className="px-4 py-4">
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
                          {/* Customer Sentiment Details */}
                          {(r['Customer Sentiment Score'] || r['Customer Intent Signal'] || r['Customer Objection']) && (
                            <div>
                              <p className="font-semibold text-gray-600 mb-1">Customer Sentiment</p>
                              <div className="flex flex-wrap gap-3">
                                {r['Customer Sentiment Score'] != null && (
                                  <span>Score: <span className={`font-bold ${sentimentScoreColor(r['Customer Sentiment Score'])}`}>{r['Customer Sentiment Score']}/5</span></span>
                                )}
                                {r['Customer Engagement Level'] && <span>Engagement: <span className="font-medium">{r['Customer Engagement Level']}</span></span>}
                                {r['Customer Intent Signal'] && (
                                  <span>Intent: <Chip text={r['Customer Intent Signal']} className={intentChipColor(r['Customer Intent Signal'])} /></span>
                                )}
                                {r['Language Comfort'] && <span>Language: <span className="font-medium">{r['Language Comfort']}</span></span>}
                              </div>
                              {r['Customer Objection'] && (
                                <p className="mt-1 text-amber">Objection: {r['Customer Objection']}</p>
                              )}
                            </div>
                          )}
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
