import { useMemo } from 'react';
import {
  isConnectedCall, fmtTalkTime, kpiColor,
  callbackHonorColor, dnpPersistenceColor, computeHeadMetrics,
  bucketAttemptCounts, fmtDuration,
} from '../lib/helpers';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid } from 'recharts';

// ── Strategic targets (M2 milestone) ──
const TARGETS = {
  wc:   { activationRate: 10, pitchCompletion: 75, qaPassRate: 60, callbackHonor: 85, dnpPersistence: 70 },
  util: { engagementRate: 40, sentimentDelta: 0.5, callbackHonor: 85, dnpPersistence: 70 },
};

function trafficLight(value, green, amber) {
  if (value == null) return 'text-gray-400';
  if (value >= green) return 'text-emerald-600';
  if (value >= amber) return 'text-amber-500';
  return 'text-red-500';
}

function DeltaArrow({ curr, prev, format = v => `${v}%`, higherIsBetter = true }) {
  if (curr == null || prev == null) return null;
  const diff = curr - prev;
  if (Math.abs(diff) < 0.1) return <span className="text-gray-400 text-xs ml-1">→</span>;
  const good = higherIsBetter ? diff > 0 : diff < 0;
  return (
    <span className={`text-xs ml-1 ${good ? 'text-emerald-600' : 'text-red-500'}`}>
      {diff > 0 ? '↑' : '↓'} {format(Math.abs(diff))}
    </span>
  );
}

function KpiCard({ label, value, prev, format = v => `${v}%`, target, green, amber, higherIsBetter = true, sub }) {
  const num = value != null ? parseFloat(value) : null;
  const prevNum = prev != null ? parseFloat(prev) : null;
  const color = (green != null && amber != null) ? trafficLight(num, green, amber) : 'text-gray-800';
  return (
    <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex flex-col gap-1">
      <p className="text-xs text-gray-500 leading-tight">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-bold ${color}`}>{num != null ? format(num) : '--'}</span>
        <DeltaArrow curr={num} prev={prevNum} format={format} higherIsBetter={higherIsBetter} />
      </div>
      {target != null && num != null && (
        <div className="w-full bg-gray-100 rounded-full h-1">
          <div
            className={`h-1 rounded-full ${num >= target ? 'bg-emerald-500' : num >= target * 0.7 ? 'bg-amber-400' : 'bg-red-400'}`}
            style={{ width: `${Math.min(100, (num / target) * 100)}%` }}
          />
        </div>
      )}
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function AgentBarChart({ records, metric, label, color }) {
  const agentData = useMemo(() => {
    const map = {};
    for (const r of records) {
      const name = (r['Agent Name'] || 'Unknown').split(' ')[0];
      if (!map[name]) map[name] = { connected: 0, activated: 0, total: 0, qaSum: 0, qaCount: 0 };
      map[name].total++;
      if (isConnectedCall(r)) {
        map[name].connected++;
        if ((r['Call Label'] || r['Status'] || '') === 'Activated') map[name].activated++;
        if (r['QA Score'] != null) { map[name].qaSum += r['QA Score']; map[name].qaCount++; }
      }
    }
    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        value: metric === 'activation'
          ? (d.connected > 0 ? Math.round((d.activated / d.connected) * 100) : 0)
          : metric === 'qa'
          ? (d.qaCount > 0 ? Math.round(d.qaSum / d.qaCount) : 0)
          : d.connected,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [records, metric]);

  if (agentData.length === 0) return <p className="text-xs text-gray-400 py-4 text-center">No data</p>;

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={agentData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip formatter={v => metric === 'activation' ? `${v}%` : metric === 'qa' ? `${v}/100` : v} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {agentData.map((entry, i) => (
            <Cell key={i} fill={color} opacity={0.7 + (i === 0 ? 0.3 : 0)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function AttemptDistribution({ attemptMap }) {
  const buckets = useMemo(() => bucketAttemptCounts(attemptMap), [attemptMap]);
  const data = [
    { label: '1-2', count: buckets['1-2'], color: '#ef4444' },
    { label: '3-5', count: buckets['3-5'], color: '#f59e0b' },
    { label: '6-8', count: buckets['6-8'], color: '#10b981' },
    { label: '8+',  count: buckets['8+'],  color: '#6b7280' },
  ];
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="text-xs text-gray-400 py-2 text-center">No attempt data</p>;
  return (
    <div className="space-y-1.5">
      {data.map(({ label, count, color }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-8">{label}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2">
            <div className="h-2 rounded-full" style={{ width: `${(count / total) * 100}%`, backgroundColor: color }} />
          </div>
          <span className="text-xs font-medium w-8 text-right">{count}</span>
        </div>
      ))}
      <p className="text-xs text-red-500 mt-1">
        {buckets['1-2']} subscribers with ≤2 attempts — under-worked
      </p>
    </div>
  );
}

// ── Lane component (one per dept) ──
function DeptLane({ title, headName, dept, records, prevRecords, attemptMap, dnpRate, callbackHonor, targets, accentColor, metricConfig }) {
  const connected  = useMemo(() => records.filter(isConnectedCall), [records]);
  const prevConn   = useMemo(() => prevRecords.filter(isConnectedCall), [prevRecords]);
  const activated  = useMemo(() => connected.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated'), [connected]);
  const prevAct    = useMemo(() => prevConn.filter(r => (r['Call Label'] || r['Status'] || '') === 'Activated'), [prevConn]);

  const activationRate     = connected.length > 0 ? Math.round((activated.length / connected.length) * 100) : 0;
  const prevActivationRate = prevConn.length > 0  ? Math.round((prevAct.length / prevConn.length) * 100)    : null;

  const qaScores  = connected.map(r => r['QA Score']).filter(v => v != null);
  const avgQA     = qaScores.length > 0 ? Math.round(qaScores.reduce((a, b) => a + b, 0) / qaScores.length) : null;
  const qaPass    = connected.filter(r => (r['QA Score'] || 0) >= 60).length;
  const qaPassRate = connected.length > 0 ? Math.round((qaPass / connected.length) * 100) : null;

  const sentimentDeltas = connected.map(r => r['Sentiment Delta']).filter(v => v != null);
  const avgSentDelta    = sentimentDeltas.length > 0
    ? (sentimentDeltas.reduce((a, b) => a + b, 0) / sentimentDeltas.length).toFixed(1)
    : null;

  const pitchScores    = connected.map(r => r['Pitch Completion'] || r['pitch_completion']).filter(v => v != null);
  const avgPitch       = pitchScores.length > 0 ? Math.round(pitchScores.reduce((a, b) => a + b, 0) / pitchScores.length) : null;

  const violations     = connected.filter(r => r['Violation']).length;
  const violationRate  = connected.length > 0 ? Math.round((violations / connected.length) * 100) : 0;

  const totalTalkSec   = records.reduce((a, r) => a + (r['Duration Seconds'] || 0), 0);

  // Top / needs-attention agents
  const agentStats = useMemo(() => {
    const map = {};
    for (const r of connected) {
      const name = r['Agent Name'] || 'Unknown';
      if (!map[name]) map[name] = { activated: 0, total: 0 };
      map[name].total++;
      if ((r['Call Label'] || r['Status'] || '') === 'Activated') map[name].activated++;
    }
    return Object.entries(map)
      .map(([name, d]) => ({ name, rate: d.total > 0 ? Math.round((d.activated / d.total) * 100) : 0, calls: d.total }))
      .sort((a, b) => b.rate - a.rate);
  }, [connected]);

  const topAgent   = agentStats[0];
  const worstAgent = agentStats[agentStats.length - 1];

  return (
    <div className="flex-1 min-w-0 bg-gray-50 rounded-2xl p-4 border border-gray-200 space-y-4">
      {/* Lane header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <p className="text-xs text-gray-500">Head: {headName} · {records.length} calls · {fmtTalkTime(totalTalkSec)} talk time</p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: accentColor + '20', color: accentColor }}>
          {dept}
        </span>
      </div>

      {/* North Star */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard
          label={dept === 'Welcome Call' ? 'Subscriber Activation Rate' : 'Health Engagement Rate'}
          value={activationRate}
          prev={prevActivationRate}
          target={targets.primary}
          green={targets.primary} amber={targets.primary * 0.7}
        />
        <KpiCard
          label="Callback Honor Rate"
          value={callbackHonor?.overall?.honorRate}
          target={targets.callbackHonor}
          green={85} amber={60}
          sub={`${callbackHonor?.overall?.onTime || 0} on-time · ${callbackHonor?.overall?.missed || 0} missed`}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <KpiCard
          label="DNP Persistence"
          value={dnpRate}
          green={70} amber={40}
          sub="≥6 attempts"
        />
        {dept === 'Welcome Call' ? (
          <>
            <KpiCard label="Avg QA Score" value={avgQA} format={v => `${v}/100`} green={60} amber={40} />
            <KpiCard label="Pitch Completion" value={avgPitch} green={75} amber={55} />
          </>
        ) : (
          <>
            <KpiCard label="Avg Sentiment Δ" value={avgSentDelta} format={v => `+${v}`} green={0.5} amber={0} />
            <KpiCard label="QA Pass Rate" value={qaPassRate} green={60} amber={30} sub="where scored" />
          </>
        )}
      </div>

      {/* Agent activation bar */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Agent Performance</p>
        <AgentBarChart records={records} metric="activation" color={accentColor} />
      </div>

      {/* Attempt distribution */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Attempt Depth Distribution</p>
        <AttemptDistribution attemptMap={attemptMap} />
      </div>

      {/* Callouts */}
      {(topAgent || worstAgent) && (
        <div className="flex gap-2 text-xs">
          {topAgent && (
            <div className="flex-1 bg-emerald-50 rounded-lg p-2 border border-emerald-100">
              <p className="text-gray-500">Top</p>
              <p className="font-semibold text-emerald-700">{topAgent.name}</p>
              <p className="text-gray-500">{topAgent.rate}% activation</p>
            </div>
          )}
          {worstAgent && worstAgent.name !== topAgent?.name && (
            <div className="flex-1 bg-red-50 rounded-lg p-2 border border-red-100">
              <p className="text-gray-500">Needs attention</p>
              <p className="font-semibold text-red-700">{worstAgent.name}</p>
              <p className="text-gray-500">{worstAgent.rate}% activation</p>
            </div>
          )}
        </div>
      )}

      {/* Violation flag */}
      {violationRate > 10 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          ⚠️ Violation rate at {violationRate}% — above 10% threshold. Review flagged calls.
        </div>
      )}
    </div>
  );
}

// ── Cross-dept acoustic row ──
function AcousticHealthRow({ wcRecords, utilRecords }) {
  const allRecords = [...wcRecords, ...utilRecords];
  const connected  = allRecords.filter(isConnectedCall);

  const avg = (field) => {
    const vals = connected.map(r => r[field]).filter(v => v != null && v > 0);
    return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  };

  const speechRate  = avg('Speech Rate WPM');
  const deadAir     = avg('Dead Air %');
  const overtalk    = avg('Overtalk Estimate');
  const violations  = connected.filter(r => r['Violation']).length;
  const violRate    = connected.length > 0 ? Math.round((violations / connected.length) * 100) : 0;

  const stats = [
    { label: 'Avg Speech Rate', value: speechRate, unit: 'WPM', ideal: '120–160', color: (v) => v >= 120 && v <= 160 ? 'text-emerald-600' : 'text-amber-500' },
    { label: 'Avg Dead Air',    value: deadAir,    unit: '%',   ideal: '<10%',     color: (v) => v < 10 ? 'text-emerald-600' : v < 18 ? 'text-amber-500' : 'text-red-500' },
    { label: 'Avg Overtalk',    value: overtalk,   unit: '%',   ideal: '<15%',     color: (v) => v < 15 ? 'text-emerald-600' : 'text-amber-500' },
    { label: 'Violation Rate',  value: violRate,   unit: '%',   ideal: '<5%',      color: (v) => v < 5 ? 'text-emerald-600' : v < 10 ? 'text-amber-500' : 'text-red-500' },
  ];

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <p className="text-xs font-semibold text-gray-500 mb-3">Acoustic & Compliance Health — All Teams</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="text-center">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-xl font-bold ${s.value != null ? s.color(parseFloat(s.value)) : 'text-gray-300'}`}>
              {s.value != null ? `${s.value}${s.unit}` : '--'}
            </p>
            <p className="text-xs text-gray-400">ideal {s.ideal}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Head scorecards (Admin-only summary) ──
function HeadScorecards({ wcRecords, utilRecords, teamConfig }) {
  const metrics = useMemo(
    () => computeHeadMetrics([...wcRecords, ...utilRecords], teamConfig),
    [wcRecords, utilRecords, teamConfig]
  );

  if (metrics.length === 0) return null;

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <p className="text-xs font-semibold text-gray-500 mb-3">Head-Level Scorecards</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {metrics.map(h => (
          <div key={h.headName} className="border border-gray-100 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm text-gray-800">{h.headName}</p>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{h.department} · {h.agentCount} agents</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className={`text-lg font-bold ${trafficLight(h.activationRate, 10, 6)}`}>{h.activationRate}%</p>
                <p className="text-xs text-gray-400">Activation</p>
              </div>
              <div>
                <p className={`text-lg font-bold ${trafficLight(100 - h.violationRate, 95, 90)}`}>{h.violationRate}%</p>
                <p className="text-xs text-gray-400">Violation</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-700">{h.avgQAScore ?? '--'}</p>
                <p className="text-xs text-gray-400">Avg QA</p>
              </div>
            </div>
            <div className="text-xs text-gray-400">
              {h.totalCalls} calls · {h.connectedCalls} connected · {h.callbacksScheduled} callbacks scheduled
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main CommandCenter ──
export default function CommandCenter({
  wcRecords, wcPrev, utilRecords, utilPrev,
  wcAttemptMap, utilAttemptMap, wcDNPRate, utilDNPRate,
  wcCallbackHonor, utilCallbackHonor,
  coachingData, teamConfig,
  period,
}) {
  const noData = wcRecords.length === 0 && utilRecords.length === 0;

  if (noData) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-2xl mb-2">🏢</p>
        <p className="text-lg font-medium">No calls for this period</p>
        <p className="text-sm mt-1">Select a different date range above</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Head scorecards */}
      {teamConfig.length > 0 && (
        <HeadScorecards wcRecords={wcRecords} utilRecords={utilRecords} teamConfig={teamConfig} />
      )}

      {/* Two-lane layout */}
      <div className="flex flex-col md:flex-row gap-4">
        <DeptLane
          title="Welcome Call"
          headName={teamConfig.find(t => t.department === 'Welcome Call')?.headName || 'Vikas'}
          dept="Welcome Call"
          records={wcRecords}
          prevRecords={wcPrev}
          attemptMap={wcAttemptMap}
          dnpRate={wcDNPRate}
          callbackHonor={wcCallbackHonor}
          accentColor="#3b82f6"
          targets={{ primary: TARGETS.wc.activationRate, callbackHonor: 85 }}
        />
        <DeptLane
          title="Utilization"
          headName={teamConfig.find(t => t.department === 'Utilization')?.headName || 'Samir'}
          dept="Utilization"
          records={utilRecords}
          prevRecords={utilPrev}
          attemptMap={utilAttemptMap}
          dnpRate={utilDNPRate}
          callbackHonor={utilCallbackHonor}
          accentColor="#0d9488"
          targets={{ primary: TARGETS.util.engagementRate, callbackHonor: 85 }}
        />
      </div>

      {/* Cross-dept acoustic health */}
      <AcousticHealthRow wcRecords={wcRecords} utilRecords={utilRecords} />

      {/* North Star summary table */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
        <p className="text-xs font-semibold text-gray-500 mb-3">North Star Matrix</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-1.5 text-gray-400 font-medium">Metric</th>
                <th className="text-center py-1.5 text-gray-400 font-medium">Dept</th>
                <th className="text-center py-1.5 text-gray-400 font-medium">Target</th>
                <th className="text-center py-1.5 text-gray-400 font-medium">Current</th>
                <th className="text-center py-1.5 text-gray-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { metric: 'Subscriber Activation Rate', dept: 'WC',   target: '≥10%',  value: wcRecords.filter(isConnectedCall).length > 0 ? Math.round((wcRecords.filter(r => (r['Call Label']||r['Status']||'') === 'Activated').length / wcRecords.filter(isConnectedCall).length) * 100) : null, green: 10, amber: 6 },
                { metric: 'Callback Honor Rate',        dept: 'Both', target: '≥85%',  value: Math.round(((wcCallbackHonor?.overall?.honorRate || 0) + (utilCallbackHonor?.overall?.honorRate || 0)) / 2), green: 85, amber: 60 },
                { metric: 'DNP Persistence (WC)',       dept: 'WC',   target: '≥70%',  value: wcDNPRate,   green: 70, amber: 40 },
                { metric: 'DNP Persistence (Util)',     dept: 'Util', target: '≥70%',  value: utilDNPRate, green: 70, amber: 40 },
                { metric: 'Health Engagement Rate',     dept: 'Util', target: '≥40%',  value: utilRecords.filter(isConnectedCall).length > 0 ? Math.round((utilRecords.filter(r => (r['Call Label']||r['Status']||'') === 'Activated').length / utilRecords.filter(isConnectedCall).length) * 100) : null, green: 40, amber: 25 },
                { metric: 'Violation Rate',             dept: 'Both', target: '<5%',   value: [...wcRecords, ...utilRecords].filter(isConnectedCall).length > 0 ? Math.round(([...wcRecords, ...utilRecords].filter(r => r['Violation']).length / [...wcRecords, ...utilRecords].filter(isConnectedCall).length) * 100) : null, green: 5, amber: 10, higherIsBetter: false },
              ].map(row => {
                const status = row.value == null ? '—'
                  : row.higherIsBetter === false
                    ? row.value < row.green ? '✅' : row.value < row.amber ? '⚠️' : '🔴'
                    : row.value >= row.green ? '✅' : row.value >= row.amber ? '⚠️' : '🔴';
                const color  = row.value == null ? 'text-gray-400'
                  : row.higherIsBetter === false
                    ? row.value < row.green ? 'text-emerald-600' : row.value < row.amber ? 'text-amber-500' : 'text-red-500'
                    : trafficLight(row.value, row.green, row.amber);
                return (
                  <tr key={row.metric} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 text-gray-700">{row.metric}</td>
                    <td className="py-1.5 text-center">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{row.dept}</span>
                    </td>
                    <td className="py-1.5 text-center text-gray-500">{row.target}</td>
                    <td className={`py-1.5 text-center font-semibold ${color}`}>
                      {row.value != null ? `${row.value}%` : '--'}
                    </td>
                    <td className="py-1.5 text-center text-sm">{status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
