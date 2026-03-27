import { useMemo, useState } from 'react';
import {
  isConnectedCall, fmtTalkTime, fmtDuration,
  computeCallbackHonorStats, bucketAttemptCounts,
  callbackHonorColor, dnpPersistenceColor,
  computeLeadScore, maskPhone, extractScheduledCallback, formatCallbackDue,
} from '../lib/helpers';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend,
} from 'recharts';

// ── Colours ──
const PASS_COLOR  = '#10b981';
const AMBER_COLOR = '#f59e0b';
const FAIL_COLOR  = '#ef4444';
const BLUE        = '#3b82f6';

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function trafficLight(v, g, a) {
  if (v == null) return 'text-gray-400';
  if (v >= g) return 'text-emerald-600';
  if (v >= a) return 'text-amber-500';
  return 'text-red-500';
}

// ── Activation Funnel ──
function ActivationFunnel({ records }) {
  const total     = records.length;
  const connected = records.filter(isConnectedCall);
  const pitched   = connected.filter(r => (r['Pitch Completion'] || r['pitch_completion'] || 0) >= 80);
  const consented = connected.filter(r => (r['Consent Clarity Score'] || r['consent_clarity_score'] || 0) >= 7);
  const activated = records.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated');

  const steps = [
    { label: 'Dialed',           count: total,             pctOfPrev: 100 },
    { label: 'Connected',        count: connected.length,  pctOfPrev: pct(connected.length, total) },
    { label: 'Pitch Completed',  count: pitched.length,    pctOfPrev: pct(pitched.length, connected.length) },
    { label: 'Consent Clear',    count: consented.length,  pctOfPrev: pct(consented.length, connected.length) },
    { label: 'Activated',        count: activated.length,  pctOfPrev: pct(activated.length, connected.length) },
  ];

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Subscriber Activation Funnel</h2>
      <div className="space-y-2">
        {steps.map((step, i) => {
          const width = steps[0].count > 0 ? (step.count / steps[0].count) * 100 : 0;
          const color = i === 0 ? '#6b7280' : i === steps.length - 1 ? PASS_COLOR : BLUE;
          const dropoff = i > 0 ? steps[i - 1].count - step.count : 0;
          return (
            <div key={step.label}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-gray-600 font-medium">{step.label}</span>
                <span className="font-semibold text-gray-800">
                  {step.count.toLocaleString()}
                  {i > 0 && <span className="text-gray-400 font-normal ml-1">({step.pctOfPrev}%)</span>}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-4 relative overflow-hidden">
                <div className="h-4 rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: color }} />
              </div>
              {i > 0 && dropoff > 0 && (
                <p className="text-xs text-red-400 mt-0.5">↳ {dropoff} dropped off here</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Pitch Compliance Grid (Agent × Q1-Q6) ──
const Q_FLAGS = [
  { key: 'Q1 User Agent Screened',       short: 'Q1: Screened' },
  { key: 'Q2 Cashback Correct',          short: 'Q2: Cashback' },
  { key: 'Q3 WA Link Sent',              short: 'Q3: WA Link' },
  { key: 'Q4 Hi Attempt Made',           short: 'Q4: Hi Attempt' },
  { key: 'Q5 Cashback Mechanic Explained', short: 'Q5: Mechanic' },
  { key: 'Q6 No Improvised Claims',      short: 'Q6: No Claims' },
];

function cellColor(rate) {
  if (rate >= 80) return 'bg-emerald-100 text-emerald-800';
  if (rate >= 50) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-700';
}

function PitchComplianceGrid({ records }) {
  const scored = records.filter(isConnectedCall);
  const byAgent = useMemo(() => {
    const map = {};
    for (const r of scored) {
      const name = r['Agent Name'] || 'Unknown';
      if (!map[name]) map[name] = { total: 0, flags: {} };
      map[name].total++;
      for (const { key } of Q_FLAGS) {
        map[name].flags[key] = (map[name].flags[key] || 0) + (r[key] ? 1 : 0);
      }
    }
    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        total: d.total,
        rates: Q_FLAGS.map(q => ({ key: q.key, rate: pct(d.flags[q.key] || 0, d.total) })),
        violCount: scored.filter(r => r['Agent Name'] === name && r['Violation']).length,
      }))
      .sort((a, b) => {
        const avgA = a.rates.reduce((s, r) => s + r.rate, 0) / a.rates.length;
        const avgB = b.rates.reduce((s, r) => s + r.rate, 0) / b.rates.length;
        return avgB - avgA;
      });
  }, [scored]);

  // Org-wide averages
  const orgAvg = Q_FLAGS.map(q => {
    const pass = scored.filter(r => r[q.key]).length;
    return { key: q.key, rate: pct(pass, scored.length) };
  });

  if (byAgent.length === 0) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Pitch Compliance Grid</h2>
        <p className="text-xs text-gray-400 py-4 text-center">No scored calls in this period</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Pitch Compliance Grid</h2>
        <span className="text-xs text-gray-400">{scored.length} scored calls</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-1.5 text-gray-400 font-medium pr-3">Agent</th>
              <th className="text-center text-gray-400 font-medium">Calls</th>
              {Q_FLAGS.map(q => (
                <th key={q.key} className="text-center text-gray-400 font-medium px-1" title={q.key}>{q.short}</th>
              ))}
              <th className="text-center text-gray-400 font-medium">Violations</th>
            </tr>
          </thead>
          <tbody>
            {byAgent.map(agent => (
              <tr key={agent.name} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-1.5 pr-3 font-medium text-gray-800">{agent.name}</td>
                <td className="text-center text-gray-500">{agent.total}</td>
                {agent.rates.map(r => (
                  <td key={r.key} className="px-1 py-1.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${cellColor(r.rate)}`}>{r.rate}%</span>
                  </td>
                ))}
                <td className="text-center">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${agent.violCount > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                    {agent.violCount}
                  </span>
                </td>
              </tr>
            ))}
            {/* Org average row */}
            <tr className="border-t-2 border-gray-200 bg-gray-50">
              <td className="py-1.5 pr-3 font-semibold text-gray-600">Team Avg</td>
              <td className="text-center text-gray-500">{scored.length}</td>
              {orgAvg.map(r => (
                <td key={r.key} className="px-1 py-1.5 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${cellColor(r.rate)}`}>{r.rate}%</span>
                </td>
              ))}
              <td className="text-center text-gray-500">
                {scored.filter(r => r['Violation']).length}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── DNP Persistence Panel ──
function DNPPanel({ records, attemptMap, dnpRate }) {
  const buckets   = useMemo(() => bucketAttemptCounts(attemptMap), [attemptMap]);
  const total     = Object.values(buckets).reduce((a, b) => a + b, 0);
  const underWorked = buckets['1-2'];
  const wellWorked  = buckets['6-8'] + buckets['8+'];

  const byAgent = useMemo(() => {
    const map = {};
    for (const r of records) {
      const name = r['Agent Name'] || 'Unknown';
      const phone = String(r['Phone Number'] || r['Mobile'] || '').replace(/\D/g, '');
      if (!name || !phone) continue;
      if (!map[name]) map[name] = new Set();
      map[name].add(phone);
    }
    return Object.entries(map).map(([name, phones]) => {
      const counts   = [...phones].map(p => attemptMap[p] || 1);
      const avg      = counts.reduce((a, b) => a + b, 0) / counts.length;
      const under    = counts.filter(c => c <= 2).length;
      const over6    = counts.filter(c => c >= 6).length;
      return { name, subscribers: phones.size, avgAttempts: avg.toFixed(1), under, over6 };
    }).sort((a, b) => parseFloat(a.avgAttempts) - parseFloat(b.avgAttempts));
  }, [records, attemptMap]);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">DNP Persistence</h2>
        <span className={`text-sm font-bold ${dnpPersistenceColor(dnpRate)}`}>
          {dnpRate != null ? `${dnpRate}%` : '--'} reaching 6+ attempts
        </span>
      </div>

      {/* Distribution bars */}
      <div className="space-y-1.5 mb-3">
        {[
          { label: '1–2 attempts', count: buckets['1-2'], color: FAIL_COLOR,  note: '⚠️ Under-worked' },
          { label: '3–5 attempts', count: buckets['3-5'], color: AMBER_COLOR, note: 'Building up' },
          { label: '6–8 attempts', count: buckets['6-8'], color: PASS_COLOR,  note: '✅ On target' },
          { label: '8+ attempts',  count: buckets['8+'],  color: '#6b7280',   note: 'Exhausted pool' },
        ].map(b => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-24">{b.label}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-2">
              <div className="h-2 rounded-full" style={{ width: total > 0 ? `${(b.count / total) * 100}%` : '0%', backgroundColor: b.color }} />
            </div>
            <span className="text-xs font-medium w-6 text-right">{b.count}</span>
            <span className="text-xs text-gray-400 w-28">{b.note}</span>
          </div>
        ))}
      </div>

      {/* Agent attempt table */}
      {byAgent.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400">
                <th className="text-left py-1">Agent</th>
                <th className="text-center py-1">Subscribers</th>
                <th className="text-center py-1">Avg Attempts</th>
                <th className="text-center py-1">≤2 Attempts</th>
                <th className="text-center py-1">≥6 Attempts</th>
              </tr>
            </thead>
            <tbody>
              {byAgent.map(a => (
                <tr key={a.name} className="border-b border-gray-50">
                  <td className="py-1 font-medium text-gray-800">{a.name}</td>
                  <td className="text-center text-gray-600">{a.subscribers}</td>
                  <td className={`text-center font-semibold ${trafficLight(parseFloat(a.avgAttempts), 6, 3)}`}>
                    {a.avgAttempts}
                  </td>
                  <td className="text-center">
                    <span className={`px-1.5 py-0.5 rounded ${a.under > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'}`}>
                      {a.under}
                    </span>
                  </td>
                  <td className="text-center">
                    <span className={`px-1.5 py-0.5 rounded ${a.over6 > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                      {a.over6}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Callback Honor Panel ──
function CallbackHonorPanel({ callbackHonor }) {
  const { overall = {}, byAgent = {} } = callbackHonor || {};
  const agentRows = Object.entries(byAgent)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => (b.honorRate ?? 0) - (a.honorRate ?? 0));

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Callback Honor Rate</h2>
        <span className={`text-sm font-bold ${callbackHonorColor(overall.honorRate)}`}>
          {overall.honorRate != null ? `${overall.honorRate}%` : '--'} on time
        </span>
      </div>

      {/* Overall breakdown */}
      {overall.scheduled > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3 text-center">
          <div className="bg-emerald-50 rounded-lg p-2">
            <p className="text-lg font-bold text-emerald-600">{overall.onTime || 0}</p>
            <p className="text-xs text-gray-500">On Time</p>
            <p className="text-xs text-gray-400">±15 min</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-2">
            <p className="text-lg font-bold text-amber-500">{overall.late || 0}</p>
            <p className="text-xs text-gray-500">Late</p>
            <p className="text-xs text-gray-400">&gt;15 min delay</p>
          </div>
          <div className="bg-red-50 rounded-lg p-2">
            <p className="text-lg font-bold text-red-500">{overall.missed || 0}</p>
            <p className="text-xs text-gray-500">Missed</p>
            <p className="text-xs text-gray-400">No attempt</p>
          </div>
        </div>
      )}

      {/* Agent breakdown */}
      {agentRows.length > 0 && (
        <div className="space-y-1.5">
          {agentRows.map(a => (
            <div key={a.name} className="flex items-center gap-2">
              <span className="text-xs text-gray-600 w-28 truncate">{a.name}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${a.honorRate ?? 0}%`,
                    backgroundColor: (a.honorRate ?? 0) >= 85 ? PASS_COLOR : (a.honorRate ?? 0) >= 60 ? AMBER_COLOR : FAIL_COLOR,
                  }}
                />
              </div>
              <span className={`text-xs font-semibold w-10 text-right ${callbackHonorColor(a.honorRate)}`}>
                {a.honorRate != null ? `${a.honorRate}%` : '--'}
              </span>
              {a.avgDelayMin > 0 && (
                <span className="text-xs text-gray-400 w-16">avg +{a.avgDelayMin}m late</span>
              )}
            </div>
          ))}
        </div>
      )}

      {!overall.scheduled && (
        <p className="text-xs text-gray-400 text-center py-4">No subscriber-scheduled callbacks in this period</p>
      )}
    </div>
  );
}

// ── Intelligence Panel (prospect signals) ──
function IntelPanel({ records }) {
  const connected = records.filter(isConnectedCall);

  const literacyDist = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0, unknown: 0 };
    for (const r of connected) {
      const l = (r['Insurance Literacy Level'] || r['insurance_literacy_level'] || 'unknown').toLowerCase();
      counts[l in counts ? l : 'unknown']++;
    }
    return [
      { name: 'High',    value: counts.high,    fill: PASS_COLOR  },
      { name: 'Medium',  value: counts.medium,  fill: AMBER_COLOR },
      { name: 'Low',     value: counts.low,     fill: FAIL_COLOR  },
      { name: 'Unknown', value: counts.unknown, fill: '#d1d5db'   },
    ].filter(d => d.value > 0);
  }, [connected]);

  const competitorMentions = useMemo(() => {
    const counts = {};
    for (const r of connected) {
      const c = r['Competitor Mentioned'] || r['competitor_mentioned'] || '';
      if (c && c.toLowerCase() !== 'none' && c !== '') {
        counts[c] = (counts[c] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }, [connected]);

  const lifeEvents = useMemo(() => {
    const counts = {};
    for (const r of connected) {
      const e = r['Life Event Detected'] || r['life_event_detected'] || '';
      if (e && e.toLowerCase() !== 'none' && e.toLowerCase() !== 'unknown' && e !== '') {
        counts[e] = (counts[e] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }, [connected]);

  const avgNeedScore = useMemo(() => {
    const vals = connected.map(r => r['Immediate Need Score'] || r['immediate_need_score']).filter(v => v != null);
    return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  }, [connected]);

  const priceObjDist = useMemo(() => {
    const counts = { none: 0, mild: 0, strong: 0 };
    for (const r of connected) {
      const p = (r['Price Objection Type'] || r['price_objection_type'] || 'none').toLowerCase();
      if (p in counts) counts[p]++;
      else counts.none++;
    }
    return [
      { name: 'None',   value: counts.none,   fill: PASS_COLOR  },
      { name: 'Mild',   value: counts.mild,   fill: AMBER_COLOR },
      { name: 'Strong', value: counts.strong, fill: FAIL_COLOR  },
    ].filter(d => d.value > 0);
  }, [connected]);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Prospect Intelligence Signals</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">

        {/* Immediate Need Score */}
        <div className="text-center">
          <p className="text-xs text-gray-500 mb-1">Avg Immediate Need</p>
          <p className={`text-3xl font-bold ${avgNeedScore != null && avgNeedScore >= 7 ? 'text-emerald-600' : avgNeedScore >= 4 ? 'text-amber-500' : 'text-red-400'}`}>
            {avgNeedScore ?? '--'}
          </p>
          <p className="text-xs text-gray-400">out of 10</p>
        </div>

        {/* Awareness Level pie */}
        <div>
          <p className="text-xs text-gray-500 mb-1 text-center">Awareness Level</p>
          <ResponsiveContainer width="100%" height={80}>
            <PieChart>
              <Pie data={literacyDist} cx="50%" cy="50%" outerRadius={35} dataKey="value">
                {literacyDist.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip formatter={(v, n) => [`${v} calls`, n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-2 flex-wrap mt-1">
            {literacyDist.map(d => (
              <span key={d.name} className="text-xs flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.fill }} />
                {d.name}
              </span>
            ))}
          </div>
        </div>

        {/* Price Objection pie */}
        <div>
          <p className="text-xs text-gray-500 mb-1 text-center">Price Objection</p>
          <ResponsiveContainer width="100%" height={80}>
            <PieChart>
              <Pie data={priceObjDist} cx="50%" cy="50%" outerRadius={35} dataKey="value">
                {priceObjDist.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip formatter={(v, n) => [`${v} calls`, n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-2 flex-wrap mt-1">
            {priceObjDist.map(d => (
              <span key={d.name} className="text-xs flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.fill }} />
                {d.name}
              </span>
            ))}
          </div>
        </div>

        {/* Competitor mentions */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Competitor Mentions</p>
          {competitorMentions.length > 0 ? (
            <div className="space-y-1">
              {competitorMentions.map(c => (
                <div key={c.name} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 flex-1 truncate">{c.name}</span>
                  <div className="w-16 bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-red-400" style={{ width: `${(c.count / connected.length) * 100}%` }} />
                  </div>
                  <span className="text-xs font-medium w-6 text-right">{c.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No mentions</p>}
        </div>

        {/* Life events */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Life Events Detected</p>
          {lifeEvents.length > 0 ? (
            <div className="space-y-1">
              {lifeEvents.map(e => (
                <div key={e.name} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 flex-1 truncate">{e.name}</span>
                  <span className="text-xs font-medium bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{e.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">None detected</p>}
        </div>

        {/* Coverage context */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Healthcare Coverage Context</p>
          {(() => {
            const counts = {};
            for (const r of connected) {
              const c = (r['Healthcare Coverage Context'] || r['existing_insurance_status'] || 'unknown').toLowerCase();
              counts[c] = (counts[c] || 0) + 1;
            }
            return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => (
              <div key={label} className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-gray-600 capitalize">{label}</span>
                <span className="font-medium text-gray-700">{count}</span>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Recommendations ──
function Recommendations({ records, callbackHonor, dnpRate }) {
  const connected = records.filter(isConnectedCall);
  const activated = records.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated');
  const activationRate = pct(activated.length, connected.length);
  const honorRate = callbackHonor?.overall?.honorRate;
  const missed    = callbackHonor?.overall?.missed || 0;

  const recs = [];

  if (dnpRate != null && dnpRate < 50) {
    recs.push({
      severity: 'high',
      title: 'Increase DNP Attempt Depth',
      points: [
        `Only ${dnpRate}% of subscribers have been called 6+ times. Target is 70%.`,
        'Assign 30-min focus blocks today for agents to work under-attempted subscribers.',
        'Sort the Welcome Queue by "Attempts: Low to High" to find the gap.',
      ],
    });
  }

  if (honorRate != null && honorRate < 70) {
    recs.push({
      severity: 'high',
      title: 'Callback Promise Breakdown',
      points: [
        `${missed} scheduled callbacks were missed entirely this period.`,
        'Subscribers who request a callback are 3× more likely to activate — these are highest priority.',
        'Brief agents: set a phone alarm for every subscriber-scheduled callback before ending the call.',
      ],
    });
  }

  if (activationRate < 8 && connected.length >= 10) {
    const pitchScores = connected.map(r => r['Pitch Completion'] || r['pitch_completion'] || 0);
    const avgPitch = pitchScores.reduce((a, b) => a + b, 0) / pitchScores.length;
    if (avgPitch < 70) {
      recs.push({
        severity: 'medium',
        title: 'Pitch Completion Driving Low Activation',
        points: [
          `Avg pitch completion is ${Math.round(avgPitch)}% — calls ending before the full pitch rarely activate.`,
          'Review the drop-off curve in Pitch Lab to identify exactly which section loses subscribers.',
          'Consider the "value anchor before pricing" script adjustment to reduce step-3 dropout.',
        ],
      });
    }
  }

  const strongObjCount = records.filter(r => (r['Price Objection Type'] || r['price_objection_type'] || '').toLowerCase() === 'strong').length;
  if (connected.length > 0 && pct(strongObjCount, connected.length) > 20) {
    recs.push({
      severity: 'medium',
      title: 'High Price Objection Rate',
      points: [
        `${pct(strongObjCount, connected.length)}% of connected calls have strong price objections.`,
        'Check if agents are presenting price before establishing value — use "benefits first" framing.',
        'Brief team on the competitor comparison script (especially if competitor mentions are rising).',
      ],
    });
  }

  if (recs.length === 0) return null;

  const severityStyle = { high: 'border-red-200 bg-red-50', medium: 'border-amber-200 bg-amber-50' };
  const severityIcon  = { high: '🔴', medium: '🟡' };

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Recommendations</h2>
      <div className="space-y-3">
        {recs.map((r, i) => (
          <div key={i} className={`rounded-xl p-3 border ${severityStyle[r.severity]}`}>
            <p className="text-sm font-semibold text-gray-800 mb-1.5">{severityIcon[r.severity]} {r.title}</p>
            <ul className="space-y-1">
              {r.points.map((p, j) => (
                <li key={j} className="text-xs text-gray-700 flex items-start gap-1.5">
                  <span className="mt-0.5 text-gray-400">→</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── KPI Strip ──
function KpiStrip({ records, prevRecords }) {
  const connected = records.filter(isConnectedCall);
  const prevConn  = prevRecords.filter(isConnectedCall);
  const activated = records.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated');
  const prevAct   = prevRecords.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated');
  const talkSec   = records.reduce((a, r) => a + (r['Duration Seconds'] || 0), 0);

  const actRate     = pct(activated.length, connected.length);
  const prevActRate = prevConn.length > 0 ? pct(prevAct.length, prevConn.length) : null;
  const connRate    = pct(connected.length, records.length);

  const violations  = connected.filter(r => r['Violation']).length;
  const violRate    = pct(violations, connected.length);

  const pitchVals   = connected.map(r => r['Pitch Completion'] || r['pitch_completion'] || 0).filter(v => v > 0);
  const avgPitch    = pitchVals.length > 0 ? Math.round(pitchVals.reduce((a, b) => a + b, 0) / pitchVals.length) : null;

  const items = [
    { label: 'Total Calls',       value: records.length,    format: v => v.toLocaleString(), color: 'text-gray-800' },
    { label: 'Activation Rate',   value: actRate,           format: v => `${v}%`, color: trafficLight(actRate, 10, 6),      sub: prevActRate != null ? `prev: ${prevActRate}%` : null },
    { label: 'Connection Rate',   value: connRate,          format: v => `${v}%`, color: trafficLight(connRate, 35, 20)     },
    { label: 'Avg Pitch Complete', value: avgPitch,         format: v => `${v}%`, color: trafficLight(avgPitch, 75, 55)     },
    { label: 'Violation Rate',    value: violRate,          format: v => `${v}%`, color: trafficLight(100 - violRate, 95, 90) },
    { label: 'Talk Time',         value: fmtTalkTime(talkSec), format: v => v,   color: 'text-gray-700'                    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      {items.map(item => (
        <div key={item.label} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500">{item.label}</p>
          <p className={`text-xl font-bold mt-0.5 ${item.color}`}>{item.format(item.value)}</p>
          {item.sub && <p className="text-xs text-gray-400">{item.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Main component ──
export default function WelcomeCallDashboard({
  records, prevRecords, allRecords,
  attemptMap, dnpRate, callbackHonor,
  coachingData, period, agentFilter, setAgentFilter,
}) {
  const [showCallTable, setShowCallTable] = useState(false);
  const filtered = agentFilter ? records.filter(r => r['Agent Name'] === agentFilter) : records;
  const prev     = agentFilter ? prevRecords.filter(r => r['Agent Name'] === agentFilter) : prevRecords;

  if (records.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-2xl mb-2">📞</p>
        <p className="text-lg font-medium">No Welcome Call records for this period</p>
        <p className="text-sm mt-1 text-gray-400">Welcome Call records are Agent/CSP subscriber outreach calls.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Welcome Call Dashboard</h1>
          <p className="text-xs text-gray-500">{records.length} calls · Subscriber activation & onboarding</p>
        </div>
        {agentFilter && (
          <button onClick={() => setAgentFilter(null)} className="text-xs text-blue-600 hover:underline">
            ← All agents
          </button>
        )}
      </div>

      {/* KPI Strip */}
      <KpiStrip records={filtered} prevRecords={prev} />

      {/* Recommendations */}
      <Recommendations records={filtered} callbackHonor={callbackHonor} dnpRate={dnpRate} />

      {/* Activation Funnel */}
      <ActivationFunnel records={filtered} />

      {/* Compliance Grid */}
      <PitchComplianceGrid records={filtered} />

      {/* DNP + Callback Honor (side by side on desktop) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DNPPanel records={filtered} attemptMap={attemptMap} dnpRate={dnpRate} />
        <CallbackHonorPanel callbackHonor={callbackHonor} />
      </div>

      {/* Intelligence panel */}
      <IntelPanel records={filtered} />

      {/* Call table toggle */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <button
          onClick={() => setShowCallTable(v => !v)}
          className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span>Call Log ({filtered.length} calls)</span>
          <span>{showCallTable ? '▲' : '▼'}</span>
        </button>
        {showCallTable && (
          <div className="overflow-x-auto border-t border-gray-100">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {['Time', 'Agent', 'Duration', 'Status', 'QA', 'Pitch%', 'Lead Score', 'Life Event', 'Callback'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(r => {
                  const cb  = extractScheduledCallback(r);
                  const status = r['Call Label'] || r['Status'] || r['Call Outcome'] || '--';
                  const statusColor = status === 'Activated' ? 'bg-emerald-100 text-emerald-700'
                    : status === 'Engaged' ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600';
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-gray-500">
                        {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                      </td>
                      <td className="px-3 py-1.5 font-medium text-gray-800">
                        <button className="hover:underline text-blue-600" onClick={() => setAgentFilter(r['Agent Name'])}>
                          {r['Agent Name'] || '--'}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">{fmtDuration(r['Duration Seconds'])}</td>
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${statusColor}`}>{status}</span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">{r['QA Score'] ?? '--'}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r['Pitch Completion'] != null ? `${r['Pitch Completion']}%` : '--'}</td>
                      <td className="px-3 py-1.5">
                        {(() => {
                          const score = computeLeadScore(r);
                          const color = score >= 60 ? 'text-emerald-600' : score >= 30 ? 'text-amber-500' : 'text-gray-400';
                          return <span className={`font-semibold ${color}`}>{score}</span>;
                        })()}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">
                        {(() => {
                          const e = r['Life Event Detected'] || r['life_event_detected'] || '';
                          return e && e.toLowerCase() !== 'none' ? (
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">{e}</span>
                          ) : <span className="text-gray-300">—</span>;
                        })()}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">
                        {cb ? <span className="text-amber-600">{formatCallbackDue(cb)}</span> : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 100 && (
              <p className="text-xs text-gray-400 text-center py-2">Showing first 100 of {filtered.length} calls</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
