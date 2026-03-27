import { useMemo, useState } from 'react';
import {
  isConnectedCall, fmtTalkTime, fmtDuration,
  callbackHonorColor, dnpPersistenceColor,
  bucketAttemptCounts, detectUtilizationChannel,
  channelTrackColor, extractScheduledCallback, formatCallbackDue,
} from '../lib/helpers';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts';

const PASS_COLOR  = '#10b981';
const AMBER_COLOR = '#f59e0b';
const FAIL_COLOR  = '#ef4444';
const TEAL        = '#0d9488';
const BLUE        = '#3b82f6';
const PURPLE      = '#8b5cf6';

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function trafficLight(v, g, a) {
  if (v == null) return 'text-gray-400';
  if (v >= g) return 'text-emerald-600';
  if (v >= a) return 'text-amber-500';
  return 'text-red-500';
}
function avg(arr) {
  const clean = arr.filter(v => v != null);
  return clean.length > 0 ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

// ── KPI Strip ──
function KpiStrip({ records, prevRecords }) {
  const connected  = records.filter(isConnectedCall);
  const prevConn   = prevRecords.filter(isConnectedCall);
  const engaged    = connected.filter(r =>
    (r['Duration Seconds'] || 0) > 120 && (r['Sentiment End'] || 0) >= 3
  );
  const activated  = records.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated');
  const prevAct    = prevRecords.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated');
  const talkSec    = records.reduce((a, r) => a + (r['Duration Seconds'] || 0), 0);
  const sentDeltas = connected.map(r => r['Sentiment Delta']).filter(v => v != null);
  const avgDelta   = sentDeltas.length > 0 ? (avg(sentDeltas)).toFixed(1) : null;
  const engRate    = pct(engaged.length, connected.length);
  const actRate    = pct(activated.length, connected.length);
  const prevActRate = prevConn.length > 0 ? pct(prevAct.length, prevConn.length) : null;

  const items = [
    { label: 'Total Calls',        value: records.length,          fmt: v => v.toLocaleString(), color: 'text-gray-800' },
    { label: 'Health Engagement',  value: engRate,                 fmt: v => `${v}%`,            color: trafficLight(engRate, 40, 25) },
    { label: 'Service Activation', value: actRate,                 fmt: v => `${v}%`,            color: trafficLight(actRate, 20, 10), sub: prevActRate != null ? `prev: ${prevActRate}%` : null },
    { label: 'Avg Sentiment Δ',    value: avgDelta,                fmt: v => `${v > 0 ? '+' : ''}${v}`, color: avgDelta != null && parseFloat(avgDelta) >= 0.5 ? 'text-emerald-600' : 'text-amber-500' },
    { label: 'Connected',          value: pct(connected.length, records.length), fmt: v => `${v}%`, color: trafficLight(pct(connected.length, records.length), 35, 20) },
    { label: 'Talk Time',          value: fmtTalkTime(talkSec),   fmt: v => v,                   color: 'text-gray-700' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      {items.map(item => (
        <div key={item.label} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500">{item.label}</p>
          <p className={`text-xl font-bold mt-0.5 ${item.color}`}>{item.value != null ? item.fmt(item.value) : '--'}</p>
          {item.sub && <p className="text-xs text-gray-400">{item.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── 3-Channel Funnel ──
const CHANNEL_CONFIG = {
  pharmacy:    { label: 'Pharmacy',          color: PASS_COLOR,  icon: '💊', desc: 'Medicine orders through Ayushpay' },
  diagnostics: { label: 'Diagnostics',       color: BLUE,        icon: '🔬', desc: 'Lab tests & diagnostic bookings'  },
  healthcare:  { label: 'Healthcare Services', color: FAIL_COLOR, icon: '🏥', desc: 'OPD, surgery, hospitalization'   },
};

function ChannelFunnel({ records, channel }) {
  const cfg = CHANNEL_CONFIG[channel];
  const channelCalls = records.filter(r => detectUtilizationChannel(r) === channel);
  const connected    = channelCalls.filter(isConnectedCall);
  const engaged      = connected.filter(r =>
    (r['Duration Seconds'] || 0) > 120 && (r['Sentiment End'] || 0) >= 3
  );
  const intentSignal = connected.filter(r =>
    (r['Immediate Need Score'] || r['immediate_need_score'] || 0) > 5 ||
    (r['Pharmacy Frequency']  || r['pharmacy_frequency']   || '') !== ''
  );
  const activated    = channelCalls.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated');

  const steps = [
    { label: 'Eligible Subscribers', count: channelCalls.length },
    { label: 'Connected',            count: connected.length    },
    { label: 'Engaged (>2min)',       count: engaged.length      },
    { label: 'Intent Signaled',       count: intentSignal.length },
    { label: 'Service Activated',     count: activated.length    },
  ];

  if (channelCalls.length === 0) {
    return (
      <div className="flex-1 border border-gray-100 rounded-xl p-4 text-center text-gray-400">
        <p className="text-2xl mb-1">{cfg.icon}</p>
        <p className="text-sm font-medium">{cfg.label}</p>
        <p className="text-xs mt-1">No calls detected for this channel</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{cfg.icon}</span>
        <div>
          <p className="text-sm font-semibold text-gray-800">{cfg.label}</p>
          <p className="text-xs text-gray-400">{cfg.desc}</p>
        </div>
      </div>
      <div className="space-y-2">
        {steps.map((step, i) => {
          const width = steps[0].count > 0 ? (step.count / steps[0].count) * 100 : 0;
          const drop  = i > 0 ? steps[i - 1].count - step.count : 0;
          return (
            <div key={step.label}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-gray-600">{step.label}</span>
                <span className="font-semibold text-gray-800">
                  {step.count}
                  {i > 0 && steps[0].count > 0 && (
                    <span className="text-gray-400 font-normal ml-1">({pct(step.count, steps[0].count)}%)</span>
                  )}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div
                  className="h-3 rounded-full"
                  style={{
                    width: `${width}%`,
                    backgroundColor: i === steps.length - 1 ? cfg.color : cfg.color + '99',
                  }}
                />
              </div>
              {i > 0 && drop > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">↳ {drop} dropped</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThreeChannelFunnels({ records }) {
  return (
    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Ayushpay Service Channel Funnels</h2>
      <div className="flex flex-col md:flex-row gap-3">
        <ChannelFunnel records={records} channel="pharmacy"    />
        <ChannelFunnel records={records} channel="diagnostics" />
        <ChannelFunnel records={records} channel="healthcare"  />
      </div>
    </div>
  );
}

// ── Sentiment Trend ──
function SentimentTrend({ records }) {
  const byDate = useMemo(() => {
    const map = {};
    for (const r of records.filter(isConnectedCall)) {
      const d = r['Call Date'] || '';
      if (!d) continue;
      if (!map[d]) map[d] = { start: [], end: [], delta: [] };
      if (r['Sentiment Start'] != null) map[d].start.push(r['Sentiment Start']);
      if (r['Sentiment End']   != null) map[d].end.push(r['Sentiment End']);
      if (r['Sentiment Delta'] != null) map[d].delta.push(r['Sentiment Delta']);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date: new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        start: d.start.length > 0 ? parseFloat(avg(d.start).toFixed(1)) : null,
        end:   d.end.length   > 0 ? parseFloat(avg(d.end).toFixed(1))   : null,
        delta: d.delta.length > 0 ? parseFloat(avg(d.delta).toFixed(2)) : null,
      }));
  }, [records]);

  if (byDate.length < 2) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Sentiment Trends</h2>
        <p className="text-xs text-gray-400 text-center py-4">Need ≥2 days of data for trend view</p>
      </div>
    );
  }

  // Arc distribution
  const arcCounts = {};
  for (const r of records.filter(isConnectedCall)) {
    const arc = r['Sentiment Arc Type'] || r['sentiment_arc_type'] || '';
    if (arc && arc !== 'unknown') arcCounts[arc] = (arcCounts[arc] || 0) + 1;
  }
  const arcData = Object.entries(arcCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([arc, count]) => ({ arc, count }));

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Customer Sentiment Trends</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Trend chart */}
        <div className="md:col-span-2">
          <p className="text-xs text-gray-400 mb-1">Daily average (Sentiment 1–5 scale)</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={byDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis domain={[1, 5]} tick={{ fontSize: 9 }} />
              <Tooltip />
              <Line type="monotone" dataKey="start" stroke="#6b7280" strokeWidth={1.5} dot={false} name="Start" />
              <Line type="monotone" dataKey="end"   stroke={TEAL}     strokeWidth={2}   dot={false} name="End"   />
              <Line type="monotone" dataKey="delta" stroke={AMBER_COLOR} strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Delta" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs text-gray-400 mt-1">
            <span><span className="inline-block w-4 h-0.5 bg-gray-400 mr-1 align-middle" />Start</span>
            <span><span className="inline-block w-4 h-0.5 mr-1 align-middle" style={{ backgroundColor: TEAL }} />End</span>
            <span><span className="inline-block w-4 h-0.5 bg-amber-400 mr-1 align-middle" />Delta</span>
          </div>
        </div>

        {/* Arc distribution */}
        <div>
          <p className="text-xs text-gray-400 mb-2">Sentiment Arc Distribution</p>
          {arcData.length > 0 ? (
            <div className="space-y-1.5">
              {arcData.map(({ arc, count }) => {
                const isPositive = arc === 'Rising' || arc === 'V-Shape';
                return (
                  <div key={arc} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-20 truncate">{arc}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${(count / records.filter(isConnectedCall).length) * 100}%`,
                          backgroundColor: isPositive ? PASS_COLOR : AMBER_COLOR,
                        }}
                      />
                    </div>
                    <span className="text-xs w-6 text-right text-gray-500">{count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No arc data yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Channel Mix by Agent ──
function ChannelMixByAgent({ records }) {
  const agentData = useMemo(() => {
    const map = {};
    for (const r of records.filter(isConnectedCall)) {
      const name = r['Agent Name'] || 'Unknown';
      const ch   = detectUtilizationChannel(r);
      if (!map[name]) map[name] = { pharmacy: 0, diagnostics: 0, healthcare: 0, general: 0, total: 0 };
      map[name][ch]++;
      map[name].total++;
    }
    return Object.entries(map)
      .map(([name, d]) => ({ name, ...d, activationRate: pct(
        records.filter(r => r['Agent Name'] === name && (r['Call Label'] || r['Status'] || '') === 'Activated').length,
        d.total,
      )}))
      .sort((a, b) => b.activationRate - a.activationRate);
  }, [records]);

  if (agentData.length === 0) return null;

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Agent Channel Performance</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-gray-400">
              <th className="text-left py-1.5 font-medium">Agent</th>
              <th className="text-center py-1.5 font-medium">Calls</th>
              <th className="text-center py-1.5 font-medium">💊 Pharmacy</th>
              <th className="text-center py-1.5 font-medium">🔬 Diagnostics</th>
              <th className="text-center py-1.5 font-medium">🏥 Healthcare</th>
              <th className="text-center py-1.5 font-medium">Engagement %</th>
              <th className="text-center py-1.5 font-medium">Avg Sentiment Δ</th>
            </tr>
          </thead>
          <tbody>
            {agentData.map(a => {
              const agentCalls  = records.filter(r => r['Agent Name'] === a.name && isConnectedCall(r));
              const sentDeltas  = agentCalls.map(r => r['Sentiment Delta']).filter(v => v != null);
              const avgDelta    = sentDeltas.length > 0 ? avg(sentDeltas).toFixed(1) : null;
              const engaged     = agentCalls.filter(r =>
                (r['Duration Seconds'] || 0) > 120 && (r['Sentiment End'] || 0) >= 3
              ).length;
              const engRate = pct(engaged, agentCalls.length);
              return (
                <tr key={a.name} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1.5 font-medium text-gray-800">{a.name}</td>
                  <td className="text-center text-gray-600">{a.total}</td>
                  <td className="text-center">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{a.pharmacy}</span>
                  </td>
                  <td className="text-center">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{a.diagnostics}</span>
                  </td>
                  <td className="text-center">
                    <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700">{a.healthcare}</span>
                  </td>
                  <td className={`text-center font-semibold ${trafficLight(engRate, 40, 25)}`}>{engRate}%</td>
                  <td className={`text-center font-semibold ${avgDelta != null && parseFloat(avgDelta) >= 0.5 ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {avgDelta != null ? `${parseFloat(avgDelta) >= 0 ? '+' : ''}${avgDelta}` : '--'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── DNP Panel (Utilization version) ──
function UtilDNPPanel({ records, attemptMap, dnpRate }) {
  const buckets   = useMemo(() => bucketAttemptCounts(attemptMap), [attemptMap]);
  const total     = Object.values(buckets).reduce((a, b) => a + b, 0);

  // High-urgency subscribers (surgery/hospitalization) with low attempts
  const highUrgencyUnderWorked = useMemo(() => {
    return records.filter(r => {
      const phone = String(r['Phone Number'] || r['Mobile'] || '').replace(/\D/g, '');
      const attempts = attemptMap[phone] || 1;
      const summary  = (r['Summary'] || '').toLowerCase();
      const highUrgency = summary.includes('surgery') || summary.includes('hospitaliz') ||
        (r['Pharmacy Frequency'] || r['pharmacy_frequency'] || '').toLowerCase() === 'high';
      return highUrgency && attempts < 3;
    }).slice(0, 5);
  }, [records, attemptMap]);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">DNP Persistence</h2>
        <span className={`text-sm font-bold ${dnpPersistenceColor(dnpRate)}`}>
          {dnpRate != null ? `${dnpRate}%` : '--'} at 6+ attempts
        </span>
      </div>

      <div className="space-y-1.5 mb-3">
        {[
          { label: '1–2 attempts', count: buckets['1-2'], color: FAIL_COLOR  },
          { label: '3–5 attempts', count: buckets['3-5'], color: AMBER_COLOR },
          { label: '6–8 attempts', count: buckets['6-8'], color: PASS_COLOR  },
          { label: '8+ attempts',  count: buckets['8+'],  color: '#6b7280'   },
        ].map(b => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-24">{b.label}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-2">
              <div className="h-2 rounded-full" style={{ width: total > 0 ? `${(b.count / total) * 100}%` : '0%', backgroundColor: b.color }} />
            </div>
            <span className="text-xs font-medium w-6 text-right">{b.count}</span>
          </div>
        ))}
      </div>

      {highUrgencyUnderWorked.length > 0 && (
        <div className="bg-red-50 rounded-lg p-3 border border-red-100">
          <p className="text-xs font-semibold text-red-700 mb-1">⚠️ High-urgency subscribers with &lt;3 attempts</p>
          {highUrgencyUnderWorked.map((r, i) => (
            <div key={r.id || i} className="text-xs text-gray-600 py-0.5 border-b border-red-100 last:border-0">
              {r['Agent Name'] || 'Unknown'} · {r['Call Date'] || ''} ·{' '}
              <span className="text-red-600 font-medium">
                {(r['Summary'] || '').slice(0, 60)}...
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Callback Honor Panel (same as WC version) ──
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
      {overall.scheduled > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3 text-center">
          <div className="bg-emerald-50 rounded-lg p-2">
            <p className="text-lg font-bold text-emerald-600">{overall.onTime || 0}</p>
            <p className="text-xs text-gray-500">On Time</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-2">
            <p className="text-lg font-bold text-amber-500">{overall.late || 0}</p>
            <p className="text-xs text-gray-500">Late</p>
          </div>
          <div className="bg-red-50 rounded-lg p-2">
            <p className="text-lg font-bold text-red-500">{overall.missed || 0}</p>
            <p className="text-xs text-gray-500">Missed</p>
          </div>
        </div>
      )}
      {agentRows.length > 0 ? (
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
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4">No subscriber-scheduled callbacks in this period</p>
      )}
    </div>
  );
}

// ── Recommendations ──
function Recommendations({ records, callbackHonor, dnpRate }) {
  const connected  = records.filter(isConnectedCall);
  const engRate    = pct(
    connected.filter(r => (r['Duration Seconds'] || 0) > 120 && (r['Sentiment End'] || 0) >= 3).length,
    connected.length,
  );
  const honorRate  = callbackHonor?.overall?.honorRate;
  const missed     = callbackHonor?.overall?.missed || 0;

  const recs = [];

  if (dnpRate != null && dnpRate < 50) {
    recs.push({
      severity: 'high',
      title:    'Under-worked Subscriber Pool',
      points: [
        `${dnpRate}% of subscribers reached 6+ attempts — target is 70%.`,
        'For customers with Surgery Needed or high medicine spend, missing calls has direct health consequences.',
        'Sort Utilization Queue by health urgency score and assign the top-10 uncontacted to the shift immediately.',
      ],
    });
  }

  if (honorRate != null && honorRate < 70 && missed > 0) {
    recs.push({
      severity: 'high',
      title:    'Missed Callbacks Breaking Customer Trust',
      points: [
        `${missed} subscriber-scheduled callbacks were missed entirely.`,
        'For utilization customers, a missed call = a missed health service. This directly impacts retention.',
        'Use the Utilization Queue due-now filter at the start of every shift to clear scheduled callbacks first.',
      ],
    });
  }

  if (engRate < 30 && connected.length >= 10) {
    recs.push({
      severity: 'medium',
      title:    'Low Engagement on Connected Calls',
      points: [
        `Only ${engRate}% of connected calls result in substantive engagement (>2 min + positive sentiment).`,
        'Review the top 5 calls in Pitch Lab — agents achieving >50% engagement are using a "personal health story" opener.',
        'Brief the team: ask about the subscriber\'s specific health situation before mentioning Ayushpay services.',
      ],
    });
  }

  // Channel-specific
  const pharmacyCalls    = records.filter(r => detectUtilizationChannel(r) === 'pharmacy');
  const healthcareCalls  = records.filter(r => detectUtilizationChannel(r) === 'healthcare');
  if (healthcareCalls.length > 0) {
    const notActivated = healthcareCalls.filter(r => (r['Call Label'] || r['Status'] || '') !== 'Activated').length;
    if (pct(notActivated, healthcareCalls.length) > 60) {
      recs.push({
        severity: 'medium',
        title:    'Healthcare Track Subscribers Not Converting',
        points: [
          `${notActivated} of ${healthcareCalls.length} surgery/hospitalization-track subscribers haven't activated yet.`,
          'These are highest-urgency — they need a partner hospital connection, not just an awareness call.',
          'Escalate unactivated healthcare-track subscribers to Samir directly for follow-up with hospital referral.',
        ],
      });
    }
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

// ── Main component ──
export default function UtilizationDashboard({
  records, prevRecords,
  attemptMap, dnpRate, callbackHonor,
  period, agentFilter, setAgentFilter,
}) {
  const [showCallTable, setShowCallTable] = useState(false);
  const filtered = agentFilter ? records.filter(r => r['Agent Name'] === agentFilter) : records;
  const prev     = agentFilter ? prevRecords.filter(r => r['Agent Name'] === agentFilter) : prevRecords;

  if (records.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-2xl mb-2">💊</p>
        <p className="text-lg font-medium">No Utilization records for this period</p>
        <p className="text-sm mt-1 text-gray-400">Utilization records are existing Ayushpay subscriber calls (pharmacy, diagnostics, healthcare).</p>
        <p className="text-sm text-gray-400 mt-1">Currently {records.length === 0 ? 'building up this dataset' : `${records.length} calls`} — check back as the team grows.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Utilization Dashboard</h1>
          <p className="text-xs text-gray-500">
            {records.length} calls · Pharmacy · Diagnostics · Healthcare Services
          </p>
        </div>
        {agentFilter && (
          <button onClick={() => setAgentFilter(null)} className="text-xs text-teal-600 hover:underline">
            ← All agents
          </button>
        )}
      </div>

      {/* KPI Strip */}
      <KpiStrip records={filtered} prevRecords={prev} />

      {/* Recommendations */}
      <Recommendations records={filtered} callbackHonor={callbackHonor} dnpRate={dnpRate} />

      {/* 3-Channel Funnels */}
      <ThreeChannelFunnels records={filtered} />

      {/* Sentiment Trend */}
      <SentimentTrend records={filtered} />

      {/* Channel Mix by Agent */}
      <ChannelMixByAgent records={filtered} />

      {/* DNP + Callback Honor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UtilDNPPanel records={filtered} attemptMap={attemptMap} dnpRate={dnpRate} />
        <CallbackHonorPanel callbackHonor={callbackHonor} />
      </div>

      {/* Call table */}
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
                  {['Date', 'Agent', 'Duration', 'Status', 'Channel', 'Sentiment Δ', 'Attempts', 'Callback'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(r => {
                  const cb      = extractScheduledCallback(r);
                  const channel = detectUtilizationChannel(r);
                  const phone   = String(r['Phone Number'] || r['Mobile'] || '').replace(/\D/g, '');
                  const attempts = attemptMap[phone] || 1;
                  const status  = r['Call Label'] || r['Status'] || r['Call Outcome'] || '--';
                  const delta   = r['Sentiment Delta'];
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-gray-500">
                        {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                      </td>
                      <td className="px-3 py-1.5 font-medium text-gray-800">
                        <button className="hover:underline text-teal-600" onClick={() => setAgentFilter(r['Agent Name'])}>
                          {r['Agent Name'] || '--'}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">{fmtDuration(r['Duration Seconds'])}</td>
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          status === 'Activated' ? 'bg-emerald-100 text-emerald-700' :
                          status === 'Engaged'   ? 'bg-teal-100 text-teal-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{status}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${channelTrackColor(channel)}`}>
                          {channel === 'pharmacy' ? '💊' : channel === 'diagnostics' ? '🔬' : channel === 'healthcare' ? '🏥' : '—'}
                          {' '}{channel}
                        </span>
                      </td>
                      <td className={`px-3 py-1.5 font-semibold ${delta != null && delta >= 0.5 ? 'text-emerald-600' : delta != null && delta >= 0 ? 'text-amber-500' : 'text-red-400'}`}>
                        {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : '--'}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={`font-semibold ${attempts >= 6 ? 'text-emerald-600' : attempts >= 3 ? 'text-amber-500' : 'text-red-500'}`}>
                          {attempts}
                        </span>
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
