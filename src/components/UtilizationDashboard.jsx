import { useMemo, useState } from 'react';
import {
  isConnectedCall, fmtTalkTime,
  computeCallbackHonorStats, bucketAttemptCounts, detectUtilizationChannel,
  callbackHonorColor, dnpPersistenceColor,
} from '../lib/helpers';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const G = '#10b981', A = '#f59e0b', R = '#ef4444', GRAY = '#9ca3af';
const CHANNELS = [
  { key: 'pharmacy',    label: 'Pharmacy',    emoji: '💊', color: '#3b82f6', bg: '#eff6ff' },
  { key: 'diagnostics', label: 'Diagnostics', emoji: '🔬', color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'healthcare',  label: 'Healthcare',  emoji: '🏥', color: '#dc2626', bg: '#fef2f2' },
];
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function tl(v, g, a) { return v >= g ? G : v >= a ? A : R; }

export default function UtilizationDashboard({
  records = [], prevRecords = [],
  attemptMap = {}, dnpRate = {}, callbackHonor = {},
  coachingData = [], period, periodStart, periodEnd,
  agentFilter, setAgentFilter, teamConfig = [],
}) {
  const filtered = useMemo(() => agentFilter ? records.filter(r => r['Agent Name'] === agentFilter) : records, [records, agentFilter]);

  // ── Core stats ──
  const stats = useMemo(() => {
    const total = filtered.length;
    const connected = filtered.filter(isConnectedCall).length;
    const engaged = filtered.filter(r => isConnectedCall(r) && (r['Duration Seconds'] || 0) > 120).length;
    const talkSec = filtered.reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);
    const sentStart = filtered.reduce((s, r) => s + (r['Sentiment Score Start'] || 0), 0);
    const sentEnd = filtered.reduce((s, r) => s + (r['Sentiment Score End'] || 0), 0);
    const sentN = filtered.filter(r => r['Sentiment Score Start'] != null && r['Sentiment Score End'] != null).length;
    return { total, connected, engaged, talkSec, sentDelta: sentN > 0 ? ((sentEnd - sentStart) / sentN).toFixed(2) : '—', sentN };
  }, [filtered]);

  const prevEngRate = useMemo(() => {
    const t = prevRecords.length;
    const e = prevRecords.filter(r => isConnectedCall(r) && (r['Duration Seconds'] || 0) > 120).length;
    return t > 0 ? pct(e, t) : null;
  }, [prevRecords]);

  // ── 3-Channel Funnels ──
  const channelData = useMemo(() => {
    const ch = { pharmacy: { eligible: 0, connected: 0, engaged: 0, intent: 0, activated: 0 },
                 diagnostics: { eligible: 0, connected: 0, engaged: 0, intent: 0, activated: 0 },
                 healthcare: { eligible: 0, connected: 0, engaged: 0, intent: 0, activated: 0 } };
    filtered.forEach(r => {
      const track = detectUtilizationChannel(r);
      if (!ch[track]) return;
      ch[track].eligible++;
      if (isConnectedCall(r)) ch[track].connected++;
      if (isConnectedCall(r) && (r['Duration Seconds'] || 0) > 120) ch[track].engaged++;
      const summary = (r['Summary'] || '').toLowerCase();
      if (summary.includes('interest') || summary.includes('want') || summary.includes('need') || summary.includes('order')) ch[track].intent++;
      if (r['Call Outcome'] === 'Completed') ch[track].activated++;
    });
    return ch;
  }, [filtered]);

  // ── Agent breakdown ──
  const agentStats = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const name = r['Agent Name'] || 'Unknown';
      if (!map[name]) map[name] = { name, total: 0, connected: 0, engaged: 0, talkSec: 0, pharmacy: 0, diagnostics: 0, healthcare: 0, sentDeltaSum: 0, sentN: 0 };
      const a = map[name];
      a.total++;
      if (isConnectedCall(r)) a.connected++;
      if (isConnectedCall(r) && (r['Duration Seconds'] || 0) > 120) a.engaged++;
      a.talkSec += r['Duration Seconds'] || 0;
      const ch = detectUtilizationChannel(r);
      if (a[ch] !== undefined) a[ch]++;
      if (r['Sentiment Score Start'] != null && r['Sentiment Score End'] != null) {
        a.sentDeltaSum += (r['Sentiment Score End'] || 0) - (r['Sentiment Score Start'] || 0);
        a.sentN++;
      }
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filtered]);

  // ── Callback Honor ──
  const cbStats = useMemo(() => computeCallbackHonorStats(records), [records]);
  // ── DNP Buckets ──
  const attemptBuckets = useMemo(() => bucketAttemptCounts(attemptMap), [attemptMap]);

  // ── Recommendations ──
  const recs = useMemo(() => {
    const out = [];
    const engRate = pct(stats.engaged, stats.total);
    if (engRate < 25) out.push({ sev: 'red', text: `Engagement rate ${engRate}% below target (40%). ${stats.connected - stats.engaged} connected calls under 2 min — agents may not be reaching value conversation.` });
    if (cbStats.overall?.rate < 0.6) out.push({ sev: 'red', text: `Callback honor ${Math.round((cbStats.overall?.rate || 0) * 100)}% critically low. ${cbStats.overall?.missed || 0} missed.` });
    if (channelData.healthcare.eligible > 0 && channelData.healthcare.activated === 0) out.push({ sev: 'amber', text: `Healthcare track: ${channelData.healthcare.eligible} subscribers, 0 activated. Route surgery/hospitalization subscribers to top-performing agent.` });
    if (stats.sentDelta !== '—' && parseFloat(stats.sentDelta) < 0) out.push({ sev: 'amber', text: `Avg sentiment delta ${stats.sentDelta} — calls leaving subscribers worse off. Review call recordings for aggressive pitch patterns.` });
    if (!out.length) out.push({ sev: 'green', text: 'Utilization metrics on track.' });
    return out;
  }, [stats, cbStats, channelData]);

  const engRate = pct(stats.engaged, stats.total);
  const delta = prevEngRate != null ? engRate - prevEngRate : null;

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi label="Engagement Rate" value={`${engRate}%`} color={tl(engRate, 40, 25)} delta={delta} target="M2: 40%" />
        <Kpi label="Calls" value={stats.total} sub={`${stats.connected} connected`} />
        <Kpi label="Sentiment Δ" value={stats.sentDelta} color={stats.sentDelta !== '—' && parseFloat(stats.sentDelta) > 0 ? G : stats.sentDelta !== '—' ? R : GRAY} />
        <Kpi label="CB Honor" value={cbStats.overall ? `${Math.round(cbStats.overall.rate * 100)}%` : '—'} color={cbStats.overall ? tl(cbStats.overall.rate * 100, 85, 60) : GRAY} />
        <Kpi label="DNP ≥6" value={`${Math.round((dnpRate.rate || 0) * 100)}%`} color={tl((dnpRate.rate || 0) * 100, 70, 40)} />
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

      {/* 3-Channel Funnels */}
      <Panel title="Service Channel Funnels">
        <div className="grid md:grid-cols-3 gap-4">
          {CHANNELS.map(ch => {
            const d = channelData[ch.key] || {};
            const steps = [
              { label: 'Eligible', val: d.eligible },
              { label: 'Connected', val: d.connected },
              { label: 'Engaged >2m', val: d.engaged },
              { label: 'Intent', val: d.intent },
              { label: 'Activated', val: d.activated },
            ];
            const max = Math.max(...steps.map(s => s.val), 1);
            return (
              <div key={ch.key} className="rounded-lg border p-3" style={{ backgroundColor: ch.bg }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-lg">{ch.emoji}</span>
                  <span className="text-sm font-bold" style={{ color: ch.color }}>{ch.label}</span>
                </div>
                <div className="space-y-1">
                  {steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-600 w-16 text-right">{s.label}</span>
                      <div className="flex-1 bg-white rounded-full h-4 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max((s.val / max) * 100, 2)}%`, backgroundColor: ch.color, opacity: 0.3 + (i * 0.15) }} />
                      </div>
                      <span className="text-xs font-bold w-8" style={{ color: ch.color }}>{s.val}</span>
                    </div>
                  ))}
                </div>
                {d.eligible > 0 && <div className="mt-1 text-[10px] text-gray-500">Conv: {pct(d.activated, d.eligible)}%</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Agent Channel Mix */}
        <Panel title="Channel Performance by Agent">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b">
                <th className="text-left py-1">Agent</th><th className="text-center">Calls</th>
                <th className="text-center">💊</th><th className="text-center">🔬</th><th className="text-center">🏥</th>
                <th className="text-center">Eng %</th><th className="text-center">Sent Δ</th>
              </tr></thead>
              <tbody>{agentStats.map(a => (
                <tr key={a.name} className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${agentFilter === a.name ? 'bg-blue-50' : ''}`}
                    onClick={() => setAgentFilter?.(agentFilter === a.name ? null : a.name)}>
                  <td className="py-1 font-medium">{a.name}</td><td className="text-center">{a.total}</td>
                  <td className="text-center text-blue-600">{a.pharmacy}</td>
                  <td className="text-center text-purple-600">{a.diagnostics}</td>
                  <td className="text-center text-red-600">{a.healthcare}</td>
                  <td className="text-center font-bold" style={{ color: tl(pct(a.engaged, a.total), 40, 25) }}>{pct(a.engaged, a.total)}%</td>
                  <td className="text-center" style={{ color: a.sentN > 0 && a.sentDeltaSum / a.sentN > 0 ? G : R }}>{a.sentN > 0 ? (a.sentDeltaSum / a.sentN).toFixed(1) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>

        {/* DNP Persistence */}
        <Panel title={<>DNP Persistence <span className={`ml-2 font-mono ${dnpPersistenceColor(dnpRate.rate)}`}>{Math.round((dnpRate.rate || 0) * 100)}%</span></>}>
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
        </Panel>
      </div>

      {/* Callback Honor */}
      {cbStats.overall && cbStats.overall.total > 0 && (
        <Panel title="Callback Discipline">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center p-3 bg-green-50 rounded-lg"><div className="text-2xl font-bold text-green-700">{cbStats.overall.onTime}</div><div className="text-[10px] text-green-600">On Time</div></div>
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
