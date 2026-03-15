import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  qaScore, qaRating, fmtDuration, outcomeColor, ratingColor, kpiColor,
  sentimentDotColor, sentimentScoreColor, conversionSignalColor,
  callCategoryColor, callDispositionColor,
  computeCallTag, callTagColor, isHumanPickup, truncate, maskPhone,
  intentChipColor,
} from '../lib/helpers';
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
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}>{text}</span>;
}

const QA_LABELS = ['Q1 User Agent Screened', 'Q2 Cashback Correct', 'Q3 WA Link Sent', 'Q4 Hi Attempt Made', 'Q5 Cashback Mechanic Explained', 'Q6 No Improvised Claims'];

export default function Overview({ today, agentFilter, setAgentFilter }) {
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);

  // Apply agent filter from card click
  const effectiveAgentFilter = agentFilter || filterAgent;

  // Enrich all records
  const enriched = useMemo(() =>
    today.map(r => ({
      ...r,
      _tag: computeCallTag(r),
      _qs: qaScore(r),
      _qr: qaRating(qaScore(r)),
      _human: isHumanPickup(r),
    })),
    [today]
  );

  // ── SECTION A: KPI Strip ──
  const total = enriched.length;
  const humanPickups = enriched.filter(r => r._human).length;
  const humanPickupRate = total > 0 ? Math.round((humanPickups / total) * 100) : 0;
  const callbacksPending = enriched.filter(r => r['Needs Callback']).length;
  const urgentCallbacks = enriched.filter(r => r['Needs Callback'] && r['Callback Priority'] === 'Urgent').length;
  const activeSignals = enriched.filter(r => r['Hot Lead'] || r['Loan Signal'] || r['Churn Signal']).length;
  const violations = enriched.filter(r => r['Compliance Violation']).length;

  // ── SECTION B: Hourly Chart ──
  const hourlyData = useMemo(() => {
    const hours = {};
    for (let h = 9; h <= 20; h++) hours[h] = { hour: `${h}:00`, total: 0, connected: 0 };
    enriched.forEach(r => {
      const t = r['Call Time'];
      if (!t) return;
      const h = parseInt(t.split(':')[0], 10);
      if (hours[h]) {
        hours[h].total++;
        if (r._human) hours[h].connected++;
      }
    });
    return Object.values(hours);
  }, [enriched]);

  const peakHour = useMemo(() => {
    const peak = hourlyData.reduce((best, h) => h.total > best.total ? h : best, { total: 0 });
    return peak.total > 0 ? peak.hour : null;
  }, [hourlyData]);

  // ── SECTION C: Agent Productivity ──
  const agentStats = useMemo(() => {
    const map = {};
    enriched.forEach(r => {
      const agent = r['Agent Name'] || 'Unknown';
      if (!map[agent]) map[agent] = { name: agent, calls: 0, connected: 0, totalSec: 0, hot: 0, warm: 0 };
      map[agent].calls++;
      if (r._human) {
        map[agent].connected++;
        map[agent].totalSec += (r['Duration Seconds'] || 0);
      }
      if (r._tag === 'HOT') map[agent].hot++;
      if (r._tag === 'WARM') map[agent].warm++;
    });
    return Object.values(map).map(a => ({
      ...a,
      rate: a.calls > 0 ? Math.round((a.connected / a.calls) * 100) : 0,
      avgTime: a.connected > 0 ? Math.round(a.totalSec / a.connected) : 0,
    })).sort((a, b) => b.calls - a.calls);
  }, [enriched]);

  // ── SECTION D: Conversion + Sentiment ──
  const conversionCounts = useMemo(() => {
    const c = { hot: 0, warm: 0, cold: 0, dead: 0, Unreachable: 0 };
    enriched.forEach(r => {
      const sig = r['Conversion Signal'];
      if (sig && c[sig] !== undefined) c[sig]++;
    });
    return c;
  }, [enriched]);

  const conversionBars = useMemo(() => [
    { label: 'Hot', count: conversionCounts.hot, color: '#dc2626' },
    { label: 'Warm', count: conversionCounts.warm, color: '#d97706' },
    { label: 'Cold', count: conversionCounts.cold, color: '#9ca3af' },
    { label: 'Dead', count: conversionCounts.dead, color: '#374151' },
    { label: 'Unreachable', count: conversionCounts.Unreachable, color: '#2563eb' },
  ], [conversionCounts]);

  const sentimentScores = enriched.map(r => r['Customer Sentiment Score']).filter(v => v != null && v > 0);
  const avgSentiment = sentimentScores.length > 0
    ? (sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length).toFixed(1)
    : '--';
  const positiveSent = sentimentScores.filter(s => s >= 4).length;
  const neutralSent = sentimentScores.filter(s => s === 3).length;
  const negativeSent = sentimentScores.filter(s => s < 3).length;
  const callbackRequestedCount = enriched.filter(r => r['Callback Requested']).length;

  // ── SECTION E: Call Log (filtered) ──
  const agents = useMemo(() => [...new Set(enriched.map(r => r['Agent Name']).filter(Boolean))].sort(), [enriched]);
  const outcomes = useMemo(() => [...new Set(enriched.map(r => r['Call Outcome']).filter(Boolean))].sort(), [enriched]);
  const tags = useMemo(() => [...new Set(enriched.map(r => r._tag))].sort(), [enriched]);
  const categories = useMemo(() => [...new Set(enriched.map(r => r.callCategory).filter(Boolean))].sort(), [enriched]);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (effectiveAgentFilter) rows = rows.filter(r => r['Agent Name'] === effectiveAgentFilter);
    if (filterOutcome) rows = rows.filter(r => r['Call Outcome'] === filterOutcome);
    if (filterTag) rows = rows.filter(r => r._tag === filterTag);
    if (filterCategory) rows = rows.filter(r => r.callCategory === filterCategory);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r['Agent Name'] || '').toLowerCase().includes(q) ||
        (r['Summary'] || '').toLowerCase().includes(q) ||
        (r['Mobile Number'] || '').toString().includes(q)
      );
    }
    return rows.sort((a, b) => (b['Call Time'] || '').localeCompare(a['Call Time'] || ''));
  }, [enriched, effectiveAgentFilter, filterOutcome, filterTag, filterCategory, search]);

  const visible = filtered.slice(0, visibleCount);

  const handleAgentCardClick = (agentName) => {
    setAgentFilter(agentName === agentFilter ? null : agentName);
    setFilterAgent('');
  };

  const clearFilters = () => {
    setSearch('');
    setFilterAgent('');
    setFilterOutcome('');
    setFilterTag('');
    setFilterCategory('');
    setAgentFilter(null);
  };

  const hasFilters = effectiveAgentFilter || filterOutcome || filterTag || filterCategory || search;

  return (
    <div className="space-y-6">
      {/* A) KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Calls" value={total} />
        <KpiCard label="Human Pickup Rate" value={`${humanPickupRate}%`} color={kpiColor(humanPickupRate, 25, 15)} />
        <KpiCard label="Callbacks Pending" value={callbacksPending} badge={urgentCallbacks} />
        <KpiCard label="Active Signals" value={activeSignals} color={activeSignals > 0 ? 'text-info' : 'text-gray-400'} />
        <KpiCard label="Compliance" value={violations > 0 ? `${violations} issue${violations > 1 ? 's' : ''}` : 'Clean'} color={violations > 0 ? 'text-fail' : 'text-pass'} />
        <KpiCard label="Human Pickups" value={humanPickups} />
      </div>

      {/* B) Hourly Call Distribution */}
      <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Hourly Call Distribution</h2>
          {peakHour && <span className="text-xs text-gray-500">Peak: {peakHour}</span>}
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hourlyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="total" name="Total" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="connected" name="Connected" fill="#16a34a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* C) Agent Productivity Strip */}
      {agentStats.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Agent Productivity</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {agentStats.map(a => (
              <div
                key={a.name}
                onClick={() => handleAgentCardClick(a.name)}
                className={`flex-shrink-0 w-44 bg-card rounded-xl p-3 shadow-sm border cursor-pointer transition-all hover:shadow-md ${
                  agentFilter === a.name ? 'border-info ring-2 ring-info/30' : 'border-gray-100'
                }`}
              >
                <p className="font-semibold text-gray-800 text-sm truncate">{a.name}</p>
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <p>{a.calls} calls <span className={`font-bold ${kpiColor(a.rate, 25, 15)}`}>{a.rate}%</span></p>
                  <p>{a.connected} connected, avg {fmtDuration(a.avgTime)}</p>
                  <div className="flex gap-2 mt-1">
                    {a.hot > 0 && <span className="text-red-600 font-bold">{a.hot} hot</span>}
                    {a.warm > 0 && <span className="text-amber font-bold">{a.warm} warm</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* D) Conversion + Sentiment Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Conversion Funnel */}
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Conversion Funnel</h2>
          <div className="space-y-2">
            {conversionBars.map(b => {
              const max = Math.max(...conversionBars.map(x => x.count), 1);
              return (
                <div key={b.label} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-gray-600">{b.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 relative">
                    <div
                      className="h-5 rounded-full transition-all"
                      style={{ width: `${Math.max((b.count / max) * 100, b.count > 0 ? 8 : 0)}%`, background: b.color }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono font-bold">{b.count}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* Sentiment Summary */}
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Customer Sentiment</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-1">Avg Score</p>
              <p className={`text-2xl font-bold ${avgSentiment !== '--' ? sentimentScoreColor(parseFloat(avgSentiment)) : 'text-gray-400'}`}>
                {avgSentiment}{avgSentiment !== '--' && <span className="text-sm font-normal text-gray-400"> / 5</span>}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Breakdown</p>
              <div className="space-y-0.5 text-xs">
                <p className="text-pass">Positive: {positiveSent}</p>
                <p className="text-gray-500">Neutral: {neutralSent}</p>
                <p className="text-fail">Negative: {negativeSent}</p>
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
              <p className="text-xs text-gray-500 mb-1">Probable Transactors</p>
              <p className={`text-xl font-bold ${(conversionCounts.hot + conversionCounts.warm) > 0 ? 'text-pass' : 'text-gray-400'}`}>
                {conversionCounts.hot + conversionCounts.warm}
              </p>
              <p className="text-[10px] text-gray-400">Hot + Warm</p>
            </div>
          </div>
        </div>
      </div>

      {/* E) Full Call Log */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 pb-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Call Log {hasFilters && <span className="text-xs text-gray-400 font-normal">({filtered.length} of {total})</span>}
            </h2>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-info hover:underline">Clear filters</button>
            )}
          </div>
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agent, phone, summary..."
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg w-48 focus:outline-none focus:border-info"
            />
            <select value={effectiveAgentFilter} onChange={(e) => { setAgentFilter(null); setFilterAgent(e.target.value); }} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-info">
              <option value="">All Agents</option>
              {agents.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={filterOutcome} onChange={(e) => setFilterOutcome(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-info">
              <option value="">All Outcomes</option>
              {outcomes.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-info">
              <option value="">All Tags</option>
              {tags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-info">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-2">Tag</th>
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Agent</th>
                <th className="px-4 py-2">Mobile</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">Outcome</th>
                <th className="px-4 py-2">Sent.</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No calls match your filters</td></tr>
              )}
              {visible.map((r, i) => (
                <React.Fragment key={r.id || i}>
                  <tr
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-2"><Chip text={r._tag} className={callTagColor(r._tag)} /></td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Time'] || '--'}</td>
                    <td className="px-4 py-2 text-xs">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                    <td className="px-4 py-2 font-mono text-xs">{fmtDuration(r['Duration Seconds'])}</td>
                    <td className="px-4 py-2"><Chip text={r['Call Outcome'] || '--'} className={outcomeColor(r['Call Outcome'])} /></td>
                    <td className="px-4 py-2">
                      {r['Customer Sentiment Score'] != null ? (
                        <span className="flex items-center gap-1">
                          <span className={`w-2.5 h-2.5 rounded-full ${sentimentDotColor(r['Customer Sentiment Score'])}`}></span>
                          <span className="font-mono text-xs">{r['Customer Sentiment Score']}</span>
                        </span>
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-2">
                      {r.callCategory ? (
                        <Chip text={r.callCategory} className={callCategoryColor(r.callCategory)} />
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'], 60)}</td>
                  </tr>
                  {expanded === i && (
                    <tr className="bg-gray-50">
                      <td colSpan={9} className="px-4 py-4">
                        <div className="grid gap-3 text-xs max-w-4xl">
                          {/* Call details row */}
                          <div className="flex flex-wrap gap-4">
                            <span>Disposition: <Chip text={r.callDisposition || '--'} className={callDispositionColor(r.callDisposition)} /></span>
                            {r.evaluationFramework && <span>Framework: <span className="font-medium">{r.evaluationFramework}</span></span>}
                            {r['Conversion Signal'] && <span>Signal: <Chip text={r['Conversion Signal']} className={conversionSignalColor(r['Conversion Signal'])} /></span>}
                            {r['Customer Intent Signal'] && <span>Intent: <Chip text={r['Customer Intent Signal']} className={intentChipColor(r['Customer Intent Signal'])} /></span>}
                            {r['Attempt Number'] && <span>Attempt: {r['Attempt Number']}</span>}
                          </div>
                          {/* QA Checklist */}
                          <div>
                            <p className="font-semibold text-gray-600 mb-1">QA ({r._qs}/6 — {r._qr})</p>
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
                            <p className="text-fail font-semibold">Compliance: {r['Compliance Detail']}</p>
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
                            <div>
                              <audio controls src={r['Recording URL']} className="h-8 w-full max-w-md" />
                            </div>
                          )}
                          {/* Signals row */}
                          <div className="flex flex-wrap gap-2">
                            {r['Hot Lead'] && <Chip text="Hot Lead" className="bg-red-100 text-red-700" />}
                            {r['Loan Signal'] && <Chip text="Loan Signal" className="bg-purple-100 text-purple-700" />}
                            {r['Churn Signal'] && <Chip text="Churn Risk" className="bg-orange-100 text-orange-700" />}
                            {r['Callback Requested'] && <Chip text="Callback Requested" className="bg-amber/20 text-amber" />}
                            {r['Needs Callback'] && <Chip text="Needs Callback" className="bg-red-100 text-red-700" />}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {/* Load more */}
        {visibleCount < filtered.length && (
          <div className="p-4 text-center">
            <button
              onClick={() => setVisibleCount(v => v + 50)}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              Load 50 more ({filtered.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
