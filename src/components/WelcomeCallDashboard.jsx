import { useMemo, useState } from 'react';
import {
  isConnectedCall, fmtTalkTime, maskPhone,
  computeCallbackHonorStats, bucketAttemptCounts, computeLeadScore,
  callbackHonorColor, dnpPersistenceColor,
} from '../lib/helpers';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const G = '#10b981', A = '#f59e0b', R = '#ef4444', GRAY = '#9ca3af';
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function tl(v, g, a) { return v >= g ? G : v >= a ? A : R; }

export default function WelcomeCallDashboard({
  records = [], prevRecords = [], allRecords = [],
  attemptMap = {}, dnpRate = {}, callbackHonor = {},
  coachingData = [], period, periodStart, periodEnd,
  agentFilter, setAgentFilter, teamConfig = [],
}) {
  const [expandedAgent, setExpandedAgent] = useState(null);
  const filtered = useMemo(() => agentFilter ? records.filter(r => r['Agent Name'] === agentFilter) : records, [records, agentFilter]);

  // ── Core stats ──
  const stats = useMemo(() => {
    const total = filtered.length;
    const connected = filtered.filter(isConnectedCall).length;
    const pitchDone = filtered.filter(r => (r['Pitch Completion'] || 0) >= 80).length;
    const consentClear = filtered.filter(r => (r['Consent Score'] || 0) >= 7).length;
    const activated = filtered.filter(r => r['Call Outcome'] === 'Completed').length;
    const talkSec = filtered.reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);
    const qaEligible = filtered.filter(r => (r['Duration Seconds'] || 0) > 45);
    let qaPassed = 0;
    qaEligible.forEach(r => {
      let pass = 0;
      for (let i = 1; i <= 6; i++) if (r[`Q${i}`] === true || r[`Q${i}`] === 'Yes' || r[`Q${i}`] === 1) pass++;
      if (pass >= 4) qaPassed++;
    });
    return { total, connected, pitchDone, consentClear, activated, talkSec, qaEligible: qaEligible.length, qaPassed };
  }, [filtered]);

  const prevRate = useMemo(() => {
    const t = prevRecords.length;
    const a = prevRecords.filter(r => r['Call Outcome'] === 'Completed').length;
    return t > 0 ? pct(a, t) : null;
  }, [prevRecords]);

  // ── Funnel data ──
  const funnel = [
    { step: 'Dialed', count: stats.total, color: '#6366f1' },
    { step: 'Connected', count: stats.connected, color: '#3b82f6' },
    { step: 'Pitch ≥80%', count: stats.pitchDone, color: '#8b5cf6' },
    { step: 'Consent ≥7', count: stats.consentClear, color: '#f59e0b' },
    { step: 'Activated', count: stats.activated, color: '#10b981' },
  ];

  // ── Agent breakdown ──
  const agentStats = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const name = r['Agent Name'] || 'Unknown';
      if (!map[name]) map[name] = { name, total: 0, connected: 0, activated: 0, talkSec: 0, pitchDone: 0, qaPassed: 0, qaEligible: 0 };
      const a = map[name];
      a.total++;
      if (isConnectedCall(r)) a.connected++;
      if (r['Call Outcome'] === 'Completed') a.activated++;
      a.talkSec += r['Duration Seconds'] || 0;
      if ((r['Pitch Completion'] || 0) >= 80) a.pitchDone++;
      if ((r['Duration Seconds'] || 0) > 45) {
        a.qaEligible++;
        let pass = 0;
        for (let i = 1; i <= 6; i++) if (r[`Q${i}`] === true || r[`Q${i}`] === 'Yes' || r[`Q${i}`] === 1) pass++;
        if (pass >= 4) a.qaPassed++;
      }
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filtered]);

  // ── Q1-Q6 Compliance Grid ──
  const qGrid = useMemo(() => {
    const agents = {};
    filtered.filter(r => (r['Duration Seconds'] || 0) > 45).forEach(r => {
      const name = r['Agent Name'] || 'Unknown';
      if (!agents[name]) agents[name] = { name, counts: [0,0,0,0,0,0], total: 0 };
      agents[name].total++;
      for (let i = 0; i < 6; i++) {
        if (r[`Q${i+1}`] === true || r[`Q${i+1}`] === 'Yes' || r[`Q${i+1}`] === 1) agents[name].counts[i]++;
      }
    });
    return Object.values(agents).sort((a, b) => b.total - a.total);
  }, [filtered]);

  // ── Callback Honor ──
  const cbStats = useMemo(() => computeCallbackHonorStats(allRecords), [allRecords]);
  // ── DNP Buckets ──
  const attemptBuckets = useMemo(() => bucketAttemptCounts(attemptMap), [attemptMap]);

  // ── Recommendations ──
  const recs = useMemo(() => {
    const out = [];
    const actRate = pct(stats.activated, stats.total);
    if (actRate < 8) out.push({ sev: 'red', text: `Activation rate ${actRate}% below M2 target (8%). Focus on pitch completion — ${pct(stats.pitchDone, stats.connected)}% of connected calls complete pitch.` });
    if (cbStats.overall?.rate < 0.6) out.push({ sev: 'red', text: `Callback honor ${Math.round((cbStats.overall?.rate || 0) * 100)}% critically low. ${cbStats.overall?.missed || 0} missed callbacks — highest-intent subscribers lost.` });
    if ((dnpRate.rate || 0) < 0.4) out.push({ sev: 'amber', text: `Only ${Math.round((dnpRate.rate || 0) * 100)}% of DNP subscribers have 6+ attempts. Most conversions happen on attempts 4–7.` });
    const lowQA = agentStats.filter(a => a.qaEligible > 3 && pct(a.qaPassed, a.qaEligible) < 40);
    if (lowQA.length) out.push({ sev: 'amber', text: `${lowQA.map(a => a.name).join(', ')} — QA pass below 40%. Review recordings.` });
    if (!out.length) out.push({ sev: 'green', text: 'All metrics within targets.' });
    return out;
  }, [stats, cbStats, dnpRate, agentStats]);

  const actRate = pct(stats.activated, stats.total);
  const delta = prevRate != null ? actRate - prevRate : null;

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi label="Activation Rate" value={`${actRate}%`} color={tl(actRate, 8, 5)} delta={delta} target="M2: 8%" />
        <Kpi label="Calls" value={stats.total} sub={`${stats.connected} connected`} />
        <Kpi label="Pitch ≥80%" value={`${pct(stats.pitchDone, stats.connected)}%`} color={tl(pct(stats.pitchDone, stats.connected), 75, 55)} />
        <Kpi label="QA Pass" value={`${pct(stats.qaPassed, stats.qaEligible)}%`} color={tl(pct(stats.qaPassed, stats.qaEligible), 60, 30)} />
        <Kpi label="CB Honor" value={cbStats.overall ? `${Math.round(cbStats.overall.rate * 100)}%` : '—'} color={cbStats.overall ? tl(cbStats.overall.rate * 100, 85, 60) : GRAY} />
        <Kpi label="Talk Time" value={fmtTalkTime(stats.talkSec)} />
      </div>

      {/* Recommendations */}
      <Panel title="Recommendations">
        {recs.map((r, i) => (
          <div key={i} className={`flex items-start gap-2 text-sm mb-1.5 ${r.sev === 'red' ? 'text-red-700' : r.sev === 'amber' ? 'text-amber-700' : 'text-green-700'}`}>
            <span>{r.sev === 'red' ? '🔴' : r.sev === 'amber' ? '🟡' : '🟢'}</span>
            <span>{r.text}</span>
          </div>
        ))}
      </Panel>

      {/* Activation Funnel */}
      <Panel title="Activation Funnel">
        <div className="flex items-end gap-1 h-36">
          {funnel.map((f, i) => {
            const max = Math.max(...funnel.map(x => x.count), 1);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-bold">{f.count}</span>
                <div className="w-full rounded-t" style={{ height: `${Math.max((f.count / max) * 100, 4)}%`, backgroundColor: f.color }} />
                <span className="text-[10px] text-gray-500 text-center leading-tight">{f.step}</span>
              </div>
            );
          })}
        </div>
        {stats.total > 0 && (
          <div className="mt-2 flex gap-3 text-[10px] text-gray-500">
            <span>Connect: {pct(stats.connected, stats.total)}%</span>
            <span>→ Pitch: {pct(stats.pitchDone, stats.connected)}%</span>
            <span>→ Consent: {pct(stats.consentClear, stats.pitchDone)}%</span>
            <span>→ Activate: {pct(stats.activated, stats.consentClear)}%</span>
          </div>
        )}
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Q1-Q6 Compliance */}
        <Panel title="Pitch Compliance (Q1–Q6)">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b">
                <th className="text-left py-1 pr-2">Agent</th>
                {[1,2,3,4,5,6].map(q => <th key={q} className="text-center px-1">Q{q}</th>)}
                <th className="text-center">N</th>
              </tr></thead>
              <tbody>
                {qGrid.map(a => (
                  <tr key={a.name} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setAgentFilter?.(agentFilter === a.name ? null : a.name)}>
                    <td className={`py-1 pr-2 font-medium ${agentFilter === a.name ? 'text-blue-600' : ''}`}>{a.name}</td>
                    {a.counts.map((c, i) => {
                      const r = pct(c, a.total);
                      return <td key={i} className="text-center px-1"><span className="inline-block w-8 rounded text-white text-[10px] font-bold" style={{ backgroundColor: tl(r, 70, 40) }}>{r}%</span></td>;
                    })}
                    <td className="text-center text-gray-400">{a.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* DNP Persistence */}
        <Panel title={<>DNP Persistence <span className={`ml-2 font-mono ${dnpPersistenceColor(dnpRate.rate)}`}>{Math.round((dnpRate.rate || 0) * 100)}%</span> ≥6 attempts</>}>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={attemptBuckets}>
              <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={28} />
              <Tooltip />
              <Bar dataKey="count" radius={[4,4,0,0]}>
                {attemptBuckets.map((e, i) => <Cell key={i} fill={e.bucket === '6-8' || e.bucket === '8+' ? G : e.bucket === '3-5' ? A : GRAY} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-500 mt-1">{dnpRate.reached || 0} of {dnpRate.total || 0} unique DNP subscribers reached 6+ attempts</p>
        </Panel>
      </div>

      {/* Callback Honor */}
      {cbStats.overall && cbStats.overall.total > 0 && (
        <Panel title="Callback Discipline">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center p-3 bg-green-50 rounded-lg"><div className="text-2xl font-bold text-green-700">{cbStats.overall.onTime}</div><div className="text-[10px] text-green-600">On Time (±15m)</div></div>
            <div className="text-center p-3 bg-amber-50 rounded-lg"><div className="text-2xl font-bold text-amber-700">{cbStats.overall.late}</div><div className="text-[10px] text-amber-600">Late</div></div>
            <div className="text-center p-3 bg-red-50 rounded-lg"><div className="text-2xl font-bold text-red-700">{cbStats.overall.missed}</div><div className="text-[10px] text-red-600">Missed</div></div>
          </div>
          {cbStats.byAgent && Object.keys(cbStats.byAgent).length > 0 && (
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="text-left py-1">Agent</th><th className="text-center">Sched</th><th className="text-center">On Time</th><th className="text-center">Late</th><th className="text-center">Missed</th><th className="text-center">Honor %</th></tr></thead>
              <tbody>{Object.entries(cbStats.byAgent).map(([name, s]) => (
                <tr key={name} className="border-b border-gray-50">
                  <td className="py-1 font-medium">{name}</td><td className="text-center">{s.total}</td>
                  <td className="text-center text-green-600">{s.onTime}</td><td className="text-center text-amber-600">{s.late}</td>
                  <td className="text-center text-red-600">{s.missed}</td>
                  <td className={`text-center font-bold ${callbackHonorColor(s.rate)}`}>{Math.round(s.rate * 100)}%</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
      )}

      {/* Agent Performance Table */}
      <Panel title="Agent Performance">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b">
              <th className="text-left py-1">Agent</th><th className="text-center">Calls</th><th className="text-center">Connected</th>
              <th className="text-center">Activated</th><th className="text-center">Act %</th><th className="text-center">Pitch %</th>
              <th className="text-center">QA %</th><th className="text-center">Talk</th>
            </tr></thead>
            <tbody>{agentStats.map(a => (
              <tr key={a.name} className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${agentFilter === a.name ? 'bg-blue-50' : ''}`}
                  onClick={() => setAgentFilter?.(agentFilter === a.name ? null : a.name)}>
                <td className="py-1.5 font-medium">{a.name}</td><td className="text-center">{a.total}</td>
                <td className="text-center">{a.connected}</td>
                <td className="text-center font-bold" style={{ color: tl(pct(a.activated, a.total), 8, 5) }}>{a.activated}</td>
                <td className="text-center font-bold" style={{ color: tl(pct(a.activated, a.total), 8, 5) }}>{pct(a.activated, a.total)}%</td>
                <td className="text-center" style={{ color: tl(pct(a.pitchDone, a.connected), 75, 55) }}>{pct(a.pitchDone, a.connected)}%</td>
                <td className="text-center" style={{ color: tl(pct(a.qaPassed, a.qaEligible), 60, 30) }}>{pct(a.qaPassed, a.qaEligible)}%</td>
                <td className="text-center text-gray-500">{fmtTalkTime(a.talkSec)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>

      {agentFilter && <button onClick={() => setAgentFilter(null)} className="text-xs text-blue-600 hover:underline">Clear filter: {agentFilter}</button>}
    </div>
  );
}

function Kpi({ label, value, color, sub, delta, target }) {
  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color: color || '#111' }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
      {delta != null && <div className={`text-[10px] mt-0.5 ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>{delta >= 0 ? '↑' : '↓'}{Math.abs(delta)}% vs prev</div>}
      {target && <div className="text-[10px] text-gray-400">{target}</div>}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}
