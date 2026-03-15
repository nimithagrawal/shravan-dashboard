import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  qaScore, qaRating, fmtDuration, outcomeColor, ratingColor, kpiColor,
  sentimentDotColor, sentimentScoreColor, conversionSignalColor,
  callCategoryColor,
  computeCallTag, callTagColor, isHumanPickup, isConnectedCall,
  truncate, maskPhone, intentChipColor,
  fmtTalkTime, fmtAvgTalkTime,
} from '../lib/helpers';
import PhoneNumber from './PhoneNumber';

function KpiCard({ label, value, color, badge, comparison }) {
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100 relative">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
      {badge != null && badge > 0 && (
        <span className="absolute top-2 right-2 bg-fail text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span>
      )}
      {comparison != null && (
        <p className={`text-[10px] mt-0.5 ${comparison >= 0 ? 'text-pass' : 'text-fail'}`}>
          {comparison >= 0 ? '\u2191' : '\u2193'} {comparison >= 0 ? '+' : ''}{comparison}% vs prev
        </p>
      )}
    </div>
  );
}

function Chip({ text, className }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}>{text}</span>;
}

const QA_LABELS = ['Q1 User Agent Screened', 'Q2 Cashback Correct', 'Q3 WA Link Sent', 'Q4 Hi Attempt Made', 'Q5 Cashback Mechanic Explained', 'Q6 No Improvised Claims'];

function pctChange(curr, prev) {
  if (!prev || prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

export default function Overview({ records, prevRecords = [], period, periodStart, periodEnd, agentFilter, setAgentFilter }) {
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [sortField, setSortField] = useState('time');
  const [sortDir, setSortDir] = useState('desc');
  const [filterTimeRange, setFilterTimeRange] = useState('');

  const effectiveAgentFilter = agentFilter || filterAgent;
  const isToday = period === 'today';
  const isMultiDay = periodStart !== periodEnd;

  // Enrich all records
  const enriched = useMemo(() =>
    records.map(r => ({
      ...r,
      _tag: computeCallTag(r),
      _qs: qaScore(r),
      _qr: qaRating(qaScore(r)),
      _human: isHumanPickup(r),
      _connected: isConnectedCall(r),
    })),
    [records]
  );

  // Previous period enriched (for comparison)
  const prevEnriched = useMemo(() =>
    prevRecords.map(r => ({
      ...r,
      _human: isHumanPickup(r),
      _connected: isConnectedCall(r),
    })),
    [prevRecords]
  );

  // ── KPI computations ──
  const total = enriched.length;
  const humanPickups = enriched.filter(r => r._human).length;
  const humanPickupRate = total > 0 ? Math.round((humanPickups / total) * 100) : 0;
  const connectedCalls = enriched.filter(r => r._connected);
  const totalTalkTimeSec = connectedCalls.reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);
  const callbacksPending = enriched.filter(r => r['Needs Callback']).length;
  const urgentCallbacks = enriched.filter(r => r['Needs Callback'] && r['Callback Priority'] === 'Urgent').length;
  const activeSignals = enriched.filter(r => r['Hot Lead'] || r['Loan Signal'] || r['Churn Signal']).length;
  const violations = enriched.filter(r => r['Compliance Violation']).length;

  // Days in period for avg daily
  const daysInPeriod = isMultiDay
    ? Math.max(1, Math.round((new Date(periodEnd) - new Date(periodStart)) / 86400000) + 1)
    : 1;
  const avgDailyCalls = isMultiDay ? Math.round(total / daysInPeriod) : null;

  // Previous period comparisons
  const prevTotal = prevEnriched.length;
  const prevHumanPickups = prevEnriched.filter(r => r._human).length;
  const prevPickupRate = prevTotal > 0 ? Math.round((prevHumanPickups / prevTotal) * 100) : 0;
  const prevConnected = prevEnriched.filter(r => r._connected);
  const prevTalkTime = prevConnected.reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);

  const cmpTotal = pctChange(total, prevTotal);
  const cmpPickup = pctChange(humanPickupRate, prevPickupRate);
  const cmpTalkTime = pctChange(totalTalkTimeSec, prevTalkTime);

  // Hot + Warm
  const hotCount = enriched.filter(r => r._tag === 'HOT').length;
  const warmCount = enriched.filter(r => r._tag === 'WARM').length;
  const callbackRequestedCount = enriched.filter(r => r['Callback Requested']).length;

  // ── Summary Stats Row ──
  const summaryLine = `${total.toLocaleString()} calls | ${connectedCalls.length} connected (${total > 0 ? Math.round((connectedCalls.length / total) * 100) : 0}%) | ${fmtTalkTime(totalTalkTimeSec)} talk time | ${hotCount + warmCount} leads | ${callbacksPending} pending retry`;

  // ── Hourly/Daily Chart ──
  const chartData = useMemo(() => {
    if (!isMultiDay) {
      // Hourly view
      const hours = {};
      for (let h = 9; h <= 20; h++) hours[h] = { label: `${h}:00`, total: 0, connected: 0 };
      enriched.forEach(r => {
        const t = r['Call Time'];
        if (!t) return;
        const h = parseInt(t.split(':')[0], 10);
        if (hours[h]) {
          hours[h].total++;
          if (r._connected) hours[h].connected++;
        }
      });
      return Object.values(hours);
    }
    // Multi-day: by day of week for week periods, by date for MTD/month
    if (period === 'week' || period === 'lastweek') {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const map = {};
      days.forEach(d => { map[d] = { label: d, total: 0, connected: 0 }; });
      enriched.forEach(r => {
        const d = r['Call Date'];
        if (!d) return;
        const date = new Date(d + 'T00:00:00');
        const dow = date.getDay();
        const dayName = days[dow === 0 ? 6 : dow - 1];
        map[dayName].total++;
        if (r._connected) map[dayName].connected++;
      });
      return Object.values(map);
    }
    // By date
    const dateMap = {};
    enriched.forEach(r => {
      const d = r['Call Date'];
      if (!d) return;
      const day = d.slice(8, 10);
      if (!dateMap[d]) dateMap[d] = { label: day, total: 0, connected: 0 };
      dateMap[d].total++;
      if (r._connected) dateMap[d].connected++;
    });
    return Object.values(dateMap).sort((a, b) => a.label.localeCompare(b.label));
  }, [enriched, isMultiDay, period]);

  const chartTitle = useMemo(() => {
    if (!isMultiDay) return `Call Distribution \u2014 ${period === 'yesterday' ? 'Yesterday' : 'Today'} by Hour`;
    if (period === 'week') return 'Call Distribution \u2014 This Week by Day';
    if (period === 'lastweek') return 'Call Distribution \u2014 Last Week by Day';
    if (period === 'mtd') return `Call Distribution \u2014 ${new Date(periodStart + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long' })} by Date`;
    if (period === 'lastmonth') return `Call Distribution \u2014 ${new Date(periodStart + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long' })} by Date`;
    return 'Call Distribution';
  }, [isMultiDay, period, periodStart]);

  const peakItem = useMemo(() => {
    const peak = chartData.reduce((best, h) => h.total > best.total ? h : best, { total: 0 });
    return peak.total > 0 ? peak.label : null;
  }, [chartData]);

  // Best connect rate insight
  const connectRateInsight = useMemo(() => {
    const withRate = chartData.filter(h => h.total >= 3).map(h => ({
      ...h,
      rate: Math.round((h.connected / h.total) * 100),
    }));
    if (withRate.length === 0) return null;
    const best = withRate.reduce((a, b) => a.rate > b.rate ? a : b);
    return best.rate > 0 ? `Peak connect rate: ${best.label} (${best.rate}%). Best window for callbacks.` : null;
  }, [chartData]);

  // Category breakdown for QA context
  const categoryBreakdown = useMemo(() => {
    const cats = {};
    enriched.forEach(r => {
      const c = r.callCategory || 'Unknown';
      cats[c] = (cats[c] || 0) + 1;
    });
    return cats;
  }, [enriched]);
  const welcomeCallCount = categoryBreakdown['Welcome-Call'] || 0;

  // ── Agent Productivity ──
  const agentStats = useMemo(() => {
    const map = {};
    enriched.forEach(r => {
      const agent = r['Agent Name'] || 'Unknown';
      if (!map[agent]) map[agent] = { name: agent, calls: 0, connected: 0, totalSec: 0, hot: 0, warm: 0, bestCall: 0 };
      map[agent].calls++;
      if (r._connected) {
        map[agent].connected++;
        const dur = r['Duration Seconds'] || 0;
        map[agent].totalSec += dur;
        if (dur > map[agent].bestCall) map[agent].bestCall = dur;
      }
      if (r._tag === 'HOT') map[agent].hot++;
      if (r._tag === 'WARM') map[agent].warm++;
    });
    // Previous period per agent for comparison
    const prevMap = {};
    prevEnriched.forEach(r => {
      const agent = r['Agent Name'] || 'Unknown';
      if (!prevMap[agent]) prevMap[agent] = { totalSec: 0 };
      if (r._connected) prevMap[agent].totalSec += (r['Duration Seconds'] || 0);
    });
    return Object.values(map).map(a => ({
      ...a,
      rate: a.calls > 0 ? Math.round((a.connected / a.calls) * 100) : 0,
      avgTime: a.connected > 0 ? Math.round(a.totalSec / a.connected) : 0,
      vsPrev: prevMap[a.name] ? pctChange(a.totalSec, prevMap[a.name].totalSec) : null,
    })).sort((a, b) => b.totalSec - a.totalSec);
  }, [enriched, prevEnriched]);

  // ── Agent Talk Time Insights ──
  const talkTimeInsights = useMemo(() => {
    const insights = [];
    const shortAgent = agentStats.find(a => a.connected > 0 && a.avgTime < 45);
    if (shortAgent) {
      insights.push(`${shortAgent.name} avg call duration is only ${shortAgent.avgTime}s \u2014 calls are dropping very early. Check script opening.`);
    }
    if (agentStats.length >= 2) {
      const sorted = [...agentStats].filter(a => a.connected > 0).sort((a, b) => b.totalSec - a.totalSec);
      if (sorted.length >= 2 && sorted[0].totalSec >= sorted[sorted.length - 1].totalSec * 2) {
        const pct = Math.round(((sorted[0].totalSec - sorted[sorted.length - 1].totalSec) / sorted[sorted.length - 1].totalSec) * 100);
        insights.push(`${sorted[0].name} is spending ${pct}% more time on connected calls than ${sorted[sorted.length - 1].name}. Review approach difference.`);
      }
    }
    if (isToday && totalTalkTimeSec < 7200 && total > 10) {
      insights.push(`Total team talk time is ${fmtTalkTime(totalTalkTimeSec)} today. At ${total} calls, average engagement is very low.`);
    }
    return insights;
  }, [agentStats, totalTalkTimeSec, total, isToday]);

  // ── Conversion + Sentiment ──
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

  // ── Call Log (filtered) ──
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
    if (filterTimeRange) {
      rows = rows.filter(r => {
        const h = parseInt((r['Call Time'] || '').split(':')[0], 10);
        if (filterTimeRange === 'morning') return h >= 9 && h < 12;
        if (filterTimeRange === 'afternoon') return h >= 12 && h < 17;
        if (filterTimeRange === 'evening') return h >= 17 && h <= 20;
        return true;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r['Agent Name'] || '').toLowerCase().includes(q) ||
        (r['Summary'] || '').toLowerCase().includes(q) ||
        (r['Mobile Number'] || '').toString().includes(q)
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortField === 'duration') {
      return [...rows].sort((a, b) => dir * ((a['Duration Seconds'] || 0) - (b['Duration Seconds'] || 0)));
    }
    // Sort by date+time for multi-day, just time for single-day
    if (isMultiDay) {
      return [...rows].sort((a, b) => dir * ((a['Call Date'] || '') + (a['Call Time'] || '')).localeCompare((b['Call Date'] || '') + (b['Call Time'] || '')));
    }
    return [...rows].sort((a, b) => dir * (a['Call Time'] || '').localeCompare(b['Call Time'] || ''));
  }, [enriched, effectiveAgentFilter, filterOutcome, filterTag, filterCategory, filterTimeRange, search, sortField, sortDir, isMultiDay]);

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
    setFilterTimeRange('');
    setAgentFilter(null);
  };

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortArrow = (field) => sortField === field ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';

  const hasFilters = effectiveAgentFilter || filterOutcome || filterTag || filterCategory || filterTimeRange || search;

  return (
    <div className="space-y-6">
      {/* Summary Stats Row */}
      <div className="bg-white rounded-lg px-4 py-2 text-xs text-gray-600 border border-gray-100 shadow-sm">
        {summaryLine}
      </div>

      {/* A) KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Calls" value={total.toLocaleString()} comparison={cmpTotal} />
        <KpiCard label="Human Pickup Rate" value={`${humanPickupRate}%`} color={kpiColor(humanPickupRate, 25, 15)} comparison={cmpPickup} />
        {isMultiDay ? (
          <KpiCard label="Avg Daily Calls" value={avgDailyCalls} />
        ) : (
          <KpiCard label="Callbacks Pending" value={callbacksPending} badge={urgentCallbacks} />
        )}
        <KpiCard label="Total Talk Time" value={fmtTalkTime(totalTalkTimeSec)} comparison={cmpTalkTime} />
        <KpiCard label="Compliance" value={violations > 0 ? `${violations} issue${violations > 1 ? 's' : ''}` : 'Clean'} color={violations > 0 ? 'text-fail' : 'text-pass'} />
        <KpiCard label="Active Signals" value={activeSignals} color={activeSignals > 0 ? 'text-info' : 'text-gray-400'} />
      </div>

      {/* B) Call Distribution Chart */}
      <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">{chartTitle}</h2>
          {peakItem && <span className="text-xs text-gray-500">Peak: {peakItem}</span>}
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="total" name="Total" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="connected" name="Connected" fill="#16a34a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        {connectRateInsight && (
          <p className="text-xs text-pass mt-2 font-medium">{connectRateInsight}</p>
        )}
      </div>

      {/* QA Context Note */}
      <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Call Mix & QA</h2>
        {welcomeCallCount > 0 ? (
          <p className="text-xs text-gray-600">QA scores apply to Welcome Calls only. {isToday ? 'Today' : 'Period'}: {welcomeCallCount} Welcome Calls out of {total} total.</p>
        ) : (
          <div className="text-xs text-gray-500">
            <p>No Welcome Call QA data {isToday ? 'today' : 'for this period'}. Call mix:</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                <span key={cat} className="inline-flex items-center gap-1">
                  <Chip text={cat} className={callCategoryColor(cat)} />
                  <span className="font-mono">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
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
                className={`flex-shrink-0 w-48 bg-card rounded-xl p-3 shadow-sm border cursor-pointer transition-all hover:shadow-md ${
                  agentFilter === a.name ? 'border-info ring-2 ring-info/30' : 'border-gray-100'
                }`}
              >
                <p className="font-semibold text-gray-800 text-sm truncate">{a.name}</p>
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <p>{a.calls} calls <span className={`font-bold ${kpiColor(a.rate, 25, 15)}`}>{a.rate}%</span></p>
                  <p>{a.connected} connected, avg {fmtDuration(a.avgTime)}</p>
                  <p className="font-medium">Talk: {fmtTalkTime(a.totalSec)}</p>
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

      {/* Agent Talk Time Table */}
      {agentStats.some(a => a.connected > 0) && (
        <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 pb-2">
            <h2 className="text-sm font-semibold text-gray-700">Agent Talk Time</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Calls Made</th>
                  <th className="px-4 py-2">Connected</th>
                  <th className="px-4 py-2">Total Talk Time</th>
                  <th className="px-4 py-2">Avg Talk Time</th>
                  <th className="px-4 py-2">Best Call</th>
                  <th className="px-4 py-2">vs Prev</th>
                </tr>
              </thead>
              <tbody>
                {agentStats.filter(a => a.connected > 0).map(a => (
                  <tr key={a.name} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{a.name}</td>
                    <td className="px-4 py-2 font-mono">{a.calls}</td>
                    <td className="px-4 py-2 font-mono">{a.connected}</td>
                    <td className="px-4 py-2 font-mono font-bold">{fmtTalkTime(a.totalSec)}</td>
                    <td className="px-4 py-2 font-mono">{fmtAvgTalkTime(a.avgTime)}</td>
                    <td className="px-4 py-2 font-mono">{fmtDuration(a.bestCall)}</td>
                    <td className="px-4 py-2">
                      {a.vsPrev != null ? (
                        <span className={`text-xs font-bold ${a.vsPrev >= 0 ? 'text-pass' : 'text-fail'}`}>
                          {a.vsPrev >= 0 ? '\u2191' : '\u2193'} {a.vsPrev >= 0 ? '+' : ''}{a.vsPrev}%
                        </span>
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Insights */}
          {talkTimeInsights.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 space-y-1">
              {talkTimeInsights.map((insight, i) => (
                <p key={i} className="text-xs text-amber">{insight}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* D) Conversion + Sentiment Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <div className="mt-3 space-y-1 text-xs">
            <p className="text-pass font-medium">{conversionCounts.hot + conversionCounts.warm} probable transactors (hot + warm)</p>
            {conversionCounts.Unreachable > 0 && (
              <p className="text-info font-medium">{conversionCounts.Unreachable} eligible for retry (unreachable)</p>
            )}
          </div>
        </div>
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
              <p className={`text-xl font-bold ${(hotCount + warmCount) > 0 ? 'text-pass' : 'text-gray-400'}`}>
                {hotCount + warmCount}
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
              Call Log
              {hasFilters && <span className="text-xs text-gray-400 font-normal ml-1">({filtered.length} of {total})</span>}
              {!hasFilters && isMultiDay && <span className="text-xs text-gray-400 font-normal ml-1">({total.toLocaleString()} calls)</span>}
            </h2>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-info hover:underline">Clear filters</button>
            )}
          </div>
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
            <select value={filterTimeRange} onChange={(e) => setFilterTimeRange(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-info">
              <option value="">All Times</option>
              <option value="morning">Morning (9-12)</option>
              <option value="afternoon">Afternoon (12-17)</option>
              <option value="evening">Evening (17-20)</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-2">Tag</th>
                {isMultiDay && <th className="px-4 py-2">Date</th>}
                <th className="px-4 py-2 cursor-pointer select-none hover:text-gray-800" onClick={() => toggleSort('time')}>Time{sortArrow('time')}</th>
                <th className="px-4 py-2">Agent</th>
                <th className="px-4 py-2">Mobile</th>
                <th className="px-4 py-2 cursor-pointer select-none hover:text-gray-800" onClick={() => toggleSort('duration')}>Duration{sortArrow('duration')}</th>
                <th className="px-4 py-2">Outcome</th>
                <th className="px-4 py-2">Sent.</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={isMultiDay ? 10 : 9} className="px-4 py-8 text-center text-gray-400">No calls match your filters</td></tr>
              )}
              {visible.map((r, i) => (
                <React.Fragment key={r.id || i}>
                  <tr
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-2"><Chip text={r._tag} className={callTagColor(r._tag)} /></td>
                    {isMultiDay && (
                      <td className="px-4 py-2 whitespace-nowrap text-xs">
                        {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                      </td>
                    )}
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
                      <td colSpan={isMultiDay ? 10 : 9} className="px-4 py-4">
                        <div className="grid gap-3 text-xs max-w-4xl">
                          <div className="flex flex-wrap gap-4">
                            <span>Tag: <Chip text={r._tag} className={callTagColor(r._tag)} /></span>
                          </div>
                          <div className="flex flex-wrap gap-4">
                            {r.callCategory && <span>Category: <Chip text={r.callCategory} className={callCategoryColor(r.callCategory)} /></span>}
                            {r.evaluationFramework && <span>Framework: <span className="font-medium">{r.evaluationFramework}</span></span>}
                            {r['Conversion Signal'] && <span>Signal: <Chip text={r['Conversion Signal']} className={conversionSignalColor(r['Conversion Signal'])} /></span>}
                            {r['Customer Intent Signal'] && <span>Intent: <Chip text={r['Customer Intent Signal']} className={intentChipColor(r['Customer Intent Signal'])} /></span>}
                            {r['Attempt Number'] && <span>Attempt: {r['Attempt Number']}</span>}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-600 mb-1">QA ({r._qs}/6 \u2014 {r._qr})</p>
                            <div className="flex flex-wrap gap-2">
                              {QA_LABELS.map(q => (
                                <span key={q} className="flex items-center gap-1">
                                  {r[q] ? <span className="text-pass">{'\u2713'}</span> : <span className="text-fail">{'\u2717'}</span>}
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
        {visibleCount < filtered.length && (
          <div className="p-4 text-center">
            <button
              onClick={() => setVisibleCount(v => v + (isMultiDay ? 100 : 50))}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              Load {isMultiDay ? 100 : 50} more ({(filtered.length - visibleCount).toLocaleString()} remaining)
            </button>
          </div>
        )}
        {/* Showing X of Y for multi-day */}
        {isMultiDay && (
          <div className="px-4 pb-3 text-xs text-gray-400 text-center">
            Showing {Math.min(visibleCount, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} calls
          </div>
        )}
      </div>
    </div>
  );
}
