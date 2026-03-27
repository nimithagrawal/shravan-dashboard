import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { fetchRecordsForPeriod } from '../lib/airtable';
import { isWelcomeCallRecord, isUtilizationRecord, getPeriodDates, getPreviousPeriodDates } from '../lib/helpers';

// ── Strategic milestone targets from shareholder briefing ──
const MILESTONES = {
  m2:  { activation: 27.5, utilization: 8,  renewal: 63, label: 'M2 Target'  },
  m4:  { activation: 37.5, utilization: 13.5, renewal: 68, label: 'M4 Target' },
  m6:  { activation: 45,   utilization: 18, renewal: 72, label: 'M6 Target'  },
  m12: { activation: 52.5, utilization: 23.5, renewal: 76.5, label: 'M12 Target' },
};
const BASELINE = { activation: 20, utilization: 5, renewal: 60 };

// ── Period definitions ──
const PERIODS = [
  { key: 'week',    label: 'This Week',     sub: 'Mon → today' },
  { key: 'month',   label: 'This Month',    sub: 'MTD' },
  { key: 'quarter', label: 'This Quarter',  sub: 'Last 90 days' },
];

function getQuarterDates() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today); start.setDate(start.getDate() - 89);
  const fmt = d => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(today) };
}

function getPeriod(key) {
  if (key === 'quarter') return getQuarterDates();
  return getPeriodDates(key === 'month' ? 'mtd' : 'week');
}

// ── Colour system ──
const C = {
  green:  { bg: 'bg-green-50  border-green-200',  text: 'text-green-700',  dot: 'bg-green-500'  },
  amber:  { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  red:    { bg: 'bg-red-50    border-red-200',    text: 'text-red-700',    dot: 'bg-red-500'    },
  blue:   { bg: 'bg-blue-50   border-blue-200',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  purple: { bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700', dot: 'bg-purple-500' },
};

function light(val, green, amber) {
  if (val >= green) return 'green';
  if (val >= amber) return 'amber';
  return 'red';
}

function trendArrow(curr, prev) {
  if (prev == null || prev === curr) return null;
  const pct = prev === 0 ? 100 : Math.abs(((curr - prev) / prev) * 100);
  const up = curr > prev;
  return {
    icon: up ? '▲' : '▼',
    color: up ? 'text-green-600' : 'text-red-500',
    label: `${up ? '+' : '-'}${pct.toFixed(0)}% vs prev`,
  };
}

// ── Milestone pace: which M target does our current rate put us on track for? ──
function milestoneStatus(rate, metric) {
  const keys = ['m2', 'm4', 'm6', 'm12'];
  for (const k of keys) {
    if (rate >= MILESTONES[k][metric] * 0.95) return { label: `On track for ${MILESTONES[k].label}`, color: 'text-green-700', key: k };
  }
  return { label: `Below ${MILESTONES.m2.label} pace`, color: 'text-red-600', key: null };
}

// ── micro components ──
function KpiCard({ label, value, sub, c, trend, milestone, wide }) {
  const col = C[c] || C.blue;
  return (
    <div className={`rounded-xl border p-4 ${col.bg} ${wide ? 'col-span-2' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">{label}</p>
        <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
      </div>
      <p className={`${wide ? 'text-4xl' : 'text-2xl'} font-black ${col.text}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
      {trend && (
        <p className={`text-[11px] font-semibold mt-0.5 ${trend.color}`}>{trend.icon} {trend.label}</p>
      )}
      {milestone && (
        <p className={`text-[10px] mt-1 font-medium ${milestone.color}`}>{milestone.label}</p>
      )}
    </div>
  );
}

function SectionHeader({ icon, label, tag }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-2">
      <span className="text-base">{icon}</span>
      <h3 className="text-xs font-bold text-gray-700 uppercase tracking-widest">{label}</h3>
      {tag && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{tag}</span>}
    </div>
  );
}

function FunnelBar({ label, value, max, color, pct }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600 font-medium">{label}</span>
        <span className="font-mono text-gray-700">{value.toLocaleString()} {pct != null ? `(${pct}%)` : ''}</span>
      </div>
      <div className="bg-gray-100 rounded-full h-3">
        <div className={`${color} h-3 rounded-full`} style={{ width: `${Math.min(w, 100)}%` }} />
      </div>
    </div>
  );
}

function PaceMeter({ label, current, baseline, targets }) {
  const max = Math.max(targets.m12 * 1.1, current * 1.1);
  const keys = ['m2', 'm4', 'm6', 'm12'];
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600 font-medium">{label}</span>
        <span className="font-bold text-gray-800">{current.toFixed(1)}%</span>
      </div>
      <div className="relative bg-gray-100 rounded-full h-4">
        {/* milestone markers */}
        {keys.map(k => {
          const x = Math.min((targets[k] / max) * 100, 100);
          return (
            <div key={k} className="absolute top-0 h-4 w-px bg-gray-400 opacity-50" style={{ left: `${x}%` }} />
          );
        })}
        {/* baseline */}
        <div className="absolute top-0 h-4 w-px bg-gray-600 opacity-70"
          style={{ left: `${Math.min((baseline / max) * 100, 100)}%` }} />
        {/* current */}
        <div className="bg-blue-500 h-4 rounded-full transition-all"
          style={{ width: `${Math.min((current / max) * 100, 100)}%` }} />
      </div>
      <div className="flex justify-between text-[9px] text-gray-400 mt-1">
        <span>Baseline {baseline}%</span>
        {keys.map(k => <span key={k}>{MILESTONES[k].label}: {targets[k]}%</span>)}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse p-4">
      <div className="h-14 bg-gray-200 rounded-xl" />
      <div className="grid grid-cols-4 gap-3">
        {[...Array(8)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
      </div>
      <div className="h-40 bg-gray-200 rounded-xl" />
    </div>
  );
}

// ── Compute all stats from raw call records ──
function computeStats(records) {
  if (!records || records.length === 0) return null;

  const wc   = records.filter(isWelcomeCallRecord);
  const util = records.filter(isUtilizationRecord);

  // L0 — Business outcomes

  // Activations (Welcome Call dept)
  const wcConnected = wc.filter(r => {
    const o = (r['Call Outcome'] || '').toLowerCase();
    return !o.includes('dnp') && !o.includes('no answer') && !o.includes('did not');
  });
  const activated = wc.filter(r =>
    (r['Activation Status'] || '').toLowerCase().includes('activated')
  );
  const activationRate = wcConnected.length > 0 ? activated.length / wcConnected.length * 100 : 0;

  // Utilization engagement (>2 min talk time = genuine engagement)
  const utilConnected = util.filter(r => {
    const o = (r['Call Outcome'] || '').toLowerCase();
    return !o.includes('dnp') && !o.includes('no answer') && !o.includes('did not');
  });
  const utilEngaged = util.filter(r => (r['Talk Time'] || 0) > 120);
  const utilizationRate = utilConnected.length > 0 ? utilEngaged.length / utilConnected.length * 100 : 0;

  // Churn signals
  const churnSignals = records.filter(r => r['Churn Signal']).length;
  const churnRiskPct = records.length > 0 ? churnSignals / records.length * 100 : 0;

  // Loan pipeline
  const loanSignals = records.filter(r => r['Loan Signal']).length;

  // Sentiment uplift (util dept — measures care effectiveness)
  const sentimentPairs = util.filter(r =>
    r['Sentiment Score Start'] != null && r['Sentiment Score End'] != null
  );
  const avgSentimentDelta = sentimentPairs.length > 0
    ? sentimentPairs.reduce((s, r) =>
        s + ((r['Sentiment Score End'] || 0) - (r['Sentiment Score Start'] || 0)), 0
      ) / sentimentPairs.length
    : null;

  // L1 — Process health

  const allConnected = records.filter(r => {
    const o = (r['Call Outcome'] || '').toLowerCase();
    return !o.includes('dnp') && !o.includes('no answer') && !o.includes('did not');
  });
  const connectionRate = records.length > 0 ? allConnected.length / records.length * 100 : 0;

  // Pitch quality — WC only
  const pitchScored = wc.filter(r => r['Pitch Completion Score'] != null);
  const pitchComplete = pitchScored.filter(r => (r['Pitch Completion Score'] || 0) >= 80).length;
  const pitchRate = pitchScored.length > 0 ? pitchComplete / pitchScored.length * 100 : null;

  // QA
  const qaRecs = records.filter(r => r['QA Score'] != null);
  const avgQA = qaRecs.length > 0
    ? qaRecs.reduce((s, r) => s + (r['QA Score'] || 0), 0) / qaRecs.length
    : null;

  // Compliance
  const violations = records.filter(r => r['Compliance Violation']).length;
  const complianceRate = records.length > 0 ? (records.length - violations) / records.length * 100 : 100;

  // Talk time
  const durations = allConnected.map(r => r['Talk Time'] || r['Duration Seconds'] || 0).filter(Boolean);
  const avgTalkTime = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Callbacks honored
  const callbacksNeeded = records.filter(r => r['Needs Callback'] || r['Callback Requested']).length;
  const callbacksDone   = records.filter(r =>
    (r['Needs Callback'] || r['Callback Requested']) && r['Callback Status'] === 'Completed'
  ).length;
  const callbackHonorRate = callbacksNeeded > 0 ? callbacksDone / callbacksNeeded * 100 : null;

  // Hot signals
  const hotLeads = records.filter(r => r['Hot Lead']).length;

  // Unique subscribers reached
  const phones = new Set(records.map(r => r['Phone Number'] || r['Mobile Number']).filter(Boolean));

  return {
    total: records.length, wcTotal: wc.length, utilTotal: util.length,
    // L0
    activated: activated.length, wcConnected: wcConnected.length, activationRate,
    utilEngaged: utilEngaged.length, utilConnected: utilConnected.length, utilizationRate,
    churnSignals, churnRiskPct, loanSignals, hotLeads, avgSentimentDelta,
    // L1
    allConnected: allConnected.length, connectionRate,
    pitchComplete, pitchScored: pitchScored.length, pitchRate,
    avgQA, qaRecs: qaRecs.length, complianceRate, violations,
    avgTalkTime, callbackHonorRate, callbacksNeeded, callbacksDone,
    uniqueSubscribers: phones.size,
  };
}

// ── Main export ──
export default function ExecutiveDashboard() {
  const [activePeriod, setActivePeriod] = useState('month');
  const [curr, setCurr] = useState([]);
  const [prev, setPrev] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const { start, end } = getPeriod(activePeriod);
    const { start: ps, end: pe } = getPreviousPeriodDates(start, end);
    Promise.all([
      fetchRecordsForPeriod(start, end),
      fetchRecordsForPeriod(ps, pe).catch(() => []),
    ]).then(([c, p]) => {
      setCurr(c);
      setPrev(p);
    }).catch(() => {
      setCurr([]);
      setPrev([]);
    }).finally(() => setLoading(false));
  }, [activePeriod]);

  const stats = useMemo(() => computeStats(curr), [curr]);
  const prevStats = useMemo(() => computeStats(prev), [prev]);

  const { start, end } = getPeriod(activePeriod);

  if (loading) return <Skeleton />;
  if (!stats) return (
    <div className="p-8 text-center text-gray-400">
      <p className="text-lg font-medium mb-1">No call records found for this period.</p>
      <p className="text-sm">{start} → {end}</p>
    </div>
  );

  // Verdict
  const verdictInputs = [
    stats.activationRate >= MILESTONES.m2.activation * 0.9,
    stats.utilizationRate >= MILESTONES.m2.utilization * 0.9,
    stats.churnRiskPct < 10,
    stats.complianceRate >= 95,
    stats.connectionRate >= 40,
  ];
  const greenCount = verdictInputs.filter(Boolean).length;
  const verdict = greenCount >= 4 ? 'green' : greenCount >= 2 ? 'amber' : 'red';
  const verdictText = verdict === 'green' ? 'On Track' : verdict === 'amber' ? 'Watch' : 'Action Needed';

  const mActivation = milestoneStatus(stats.activationRate, 'activation');
  const mUtil = milestoneStatus(stats.utilizationRate, 'utilization');

  return (
    <div className="p-4 space-y-4 max-w-6xl">

      {/* ── Period selector ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setActivePeriod(p.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              activePeriod === p.key
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}>
            {p.label}
          </button>
        ))}
        <span className="text-xs text-gray-400">{start} → {end} · {stats.total.toLocaleString()} calls</span>
      </div>

      {/* ── Verdict banner ── */}
      <div className={`rounded-xl px-5 py-3 flex items-center justify-between ${
        verdict === 'green' ? 'bg-green-600' : verdict === 'amber' ? 'bg-yellow-500' : 'bg-red-600'
      } text-white`}>
        <div>
          <p className="text-2xl font-black">{verdictText}</p>
          <p className="text-xs opacity-75">
            {stats.uniqueSubscribers.toLocaleString()} subscribers reached · {stats.wcTotal} welcome · {stats.utilTotal} utilization
          </p>
        </div>
        <div className="flex gap-2">
          {verdictInputs.map((v, i) => (
            <span key={i} className={`w-3 h-3 rounded-full ${v ? 'bg-white opacity-90' : 'bg-white opacity-30'}`} />
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          L0 — BUSINESS OUTCOMES
      ══════════════════════════════════════════ */}
      <SectionHeader icon="📊" label="L0 — Business Outcomes" tag="What moves revenue" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Activation — dominant metric */}
        <KpiCard
          label="Activation Rate"
          value={`${stats.activationRate.toFixed(1)}%`}
          sub={`${stats.activated} activated / ${stats.wcConnected} connected`}
          c={light(stats.activationRate, MILESTONES.m2.activation, MILESTONES.m2.activation * 0.75)}
          trend={trendArrow(stats.activationRate, prevStats?.activationRate)}
          milestone={mActivation}
          wide
        />

        {/* Utilization engagement */}
        <KpiCard
          label="Utilization Engagement"
          value={`${stats.utilizationRate.toFixed(1)}%`}
          sub={`${stats.utilEngaged} engaged / ${stats.utilConnected} connected`}
          c={light(stats.utilizationRate, MILESTONES.m2.utilization, MILESTONES.m2.utilization * 0.75)}
          trend={trendArrow(stats.utilizationRate, prevStats?.utilizationRate)}
          milestone={mUtil}
          wide
        />

        {/* Churn exposure */}
        <KpiCard
          label="Churn Exposure"
          value={stats.churnSignals}
          sub={`${stats.churnRiskPct.toFixed(1)}% of calls flagged`}
          c={stats.churnRiskPct < 5 ? 'green' : stats.churnRiskPct < 15 ? 'amber' : 'red'}
          trend={trendArrow(-stats.churnRiskPct, prevStats ? -prevStats.churnRiskPct : null)}
        />

        {/* Loan pipeline */}
        <KpiCard
          label="Loan Signals"
          value={stats.loanSignals}
          sub={`${stats.hotLeads} hot leads`}
          c={stats.loanSignals > 0 ? 'purple' : 'amber'}
          trend={trendArrow(stats.loanSignals, prevStats?.loanSignals)}
        />
      </div>

      {/* Strategic pace meter */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Progress vs Roadmap Targets</p>
        <PaceMeter
          label="Welcome Call Activation Rate"
          current={stats.activationRate}
          baseline={BASELINE.activation}
          targets={{ m2: 27.5, m4: 37.5, m6: 45, m12: 52.5 }}
        />
        <PaceMeter
          label="Utilization Engagement Rate"
          current={stats.utilizationRate}
          baseline={BASELINE.utilization}
          targets={{ m2: 8, m4: 13.5, m6: 18, m12: 23.5 }}
        />
      </div>

      {/* ══════════════════════════════════════════
          L1 — PROCESS HEALTH
      ══════════════════════════════════════════ */}
      <SectionHeader icon="⚙️" label="L1 — Process Health" tag="Leading indicators" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Connection Rate"
          value={`${stats.connectionRate.toFixed(0)}%`}
          sub={`${stats.allConnected} / ${stats.total} calls`}
          c={light(stats.connectionRate, 50, 35)}
          trend={trendArrow(stats.connectionRate, prevStats?.connectionRate)}
        />
        {stats.pitchRate != null && (
          <KpiCard
            label="Pitch Completion"
            value={`${stats.pitchRate.toFixed(0)}%`}
            sub={`${stats.pitchComplete} / ${stats.pitchScored} scored`}
            c={light(stats.pitchRate, 60, 40)}
            trend={trendArrow(stats.pitchRate, prevStats?.pitchRate)}
          />
        )}
        {stats.avgQA != null && (
          <KpiCard
            label="Avg QA Score"
            value={`${stats.avgQA.toFixed(1)}/6`}
            sub={`${stats.qaRecs} scored calls`}
            c={light(stats.avgQA, 4.5, 3.5)}
            trend={trendArrow(stats.avgQA, prevStats?.avgQA)}
          />
        )}
        <KpiCard
          label="Compliance"
          value={`${stats.complianceRate.toFixed(0)}%`}
          sub={stats.violations > 0 ? `${stats.violations} violations` : 'Clean period'}
          c={light(stats.complianceRate, 97, 90)}
          trend={trendArrow(stats.complianceRate, prevStats?.complianceRate)}
        />
        {stats.callbackHonorRate != null && (
          <KpiCard
            label="Callback Honor"
            value={`${stats.callbackHonorRate.toFixed(0)}%`}
            sub={`${stats.callbacksDone} / ${stats.callbacksNeeded}`}
            c={light(stats.callbackHonorRate, 80, 60)}
            trend={trendArrow(stats.callbackHonorRate, prevStats?.callbackHonorRate)}
          />
        )}
        {stats.avgSentimentDelta != null && (
          <KpiCard
            label="Sentiment Uplift"
            value={stats.avgSentimentDelta > 0 ? `+${stats.avgSentimentDelta.toFixed(2)}` : stats.avgSentimentDelta.toFixed(2)}
            sub="avg score delta per util call"
            c={stats.avgSentimentDelta > 0 ? 'green' : stats.avgSentimentDelta > -0.2 ? 'amber' : 'red'}
            trend={trendArrow(stats.avgSentimentDelta, prevStats?.avgSentimentDelta)}
          />
        )}
        <KpiCard
          label="Avg Talk Time"
          value={`${Math.floor(stats.avgTalkTime / 60)}m ${Math.round(stats.avgTalkTime % 60)}s`}
          sub="connected calls only"
          c={light(stats.avgTalkTime, 150, 90)}
          trend={trendArrow(stats.avgTalkTime, prevStats?.avgTalkTime)}
        />
        <KpiCard
          label="Subscribers Reached"
          value={stats.uniqueSubscribers.toLocaleString()}
          sub="unique phone numbers"
          c="blue"
          trend={trendArrow(stats.uniqueSubscribers, prevStats?.uniqueSubscribers)}
        />
      </div>

      {/* ══════════════════════════════════════════
          ACTIVATION FUNNEL
      ══════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <SectionHeader icon="🏆" label="Activation Funnel" tag="Welcome Call" />
        <FunnelBar label="Total WC Calls"   value={stats.wcTotal}      max={stats.wcTotal} color="bg-gray-400"   />
        <FunnelBar label="Connected"         value={stats.wcConnected}   max={stats.wcTotal} color="bg-blue-400"
          pct={stats.wcTotal > 0 ? Math.round(stats.wcConnected / stats.wcTotal * 100) : 0} />
        <FunnelBar label="Pitch Scored"      value={stats.pitchScored}   max={stats.wcTotal} color="bg-purple-400"
          pct={stats.wcTotal > 0 ? Math.round(stats.pitchScored / stats.wcTotal * 100) : 0} />
        <FunnelBar label="Pitch Complete"    value={stats.pitchComplete} max={stats.wcTotal} color="bg-indigo-400"
          pct={stats.wcTotal > 0 ? Math.round(stats.pitchComplete / stats.wcTotal * 100) : 0} />
        <FunnelBar label="Activated"         value={stats.activated}     max={stats.wcTotal} color="bg-green-500"
          pct={stats.wcTotal > 0 ? Math.round(stats.activated / stats.wcTotal * 100) : 0} />
      </div>

      {/* ══════════════════════════════════════════
          UTILIZATION FUNNEL
      ══════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <SectionHeader icon="💊" label="Utilization Funnel" tag="Existing Subscribers" />
        <FunnelBar label="Total Util Calls"  value={stats.utilTotal}     max={stats.utilTotal} color="bg-gray-400"   />
        <FunnelBar label="Connected"         value={stats.utilConnected} max={stats.utilTotal} color="bg-blue-400"
          pct={stats.utilTotal > 0 ? Math.round(stats.utilConnected / stats.utilTotal * 100) : 0} />
        <FunnelBar label="Engaged (>2 min)"  value={stats.utilEngaged}   max={stats.utilTotal} color="bg-teal-500"
          pct={stats.utilTotal > 0 ? Math.round(stats.utilEngaged / stats.utilTotal * 100) : 0} />
        <FunnelBar label="Loan Signals"      value={stats.loanSignals}   max={stats.utilTotal} color="bg-purple-500"
          pct={stats.utilTotal > 0 ? Math.round(stats.loanSignals / stats.utilTotal * 100) : 0} />
        <FunnelBar label="Churn Signals"     value={stats.churnSignals}  max={stats.utilTotal} color="bg-red-400"
          pct={stats.utilTotal > 0 ? Math.round(stats.churnSignals / stats.utilTotal * 100) : 0} />
      </div>

      {/* ══════════════════════════════════════════
          STRATEGIC RISKS
      ══════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <SectionHeader icon="⚠️" label="Strategic Risk Signals" />
        <div className="space-y-2">
          {stats.activationRate < MILESTONES.m2.activation * 0.75 && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-red-500 font-bold text-sm">●</span>
              <div>
                <p className="text-sm font-semibold text-red-700">Activation Rate Below M2 Minimum</p>
                <p className="text-xs text-red-600">Current {stats.activationRate.toFixed(1)}% vs M2 target {MILESTONES.m2.activation}%. Requires script/training intervention.</p>
              </div>
            </div>
          )}
          {stats.utilizationRate < MILESTONES.m2.utilization * 0.75 && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-red-500 font-bold text-sm">●</span>
              <div>
                <p className="text-sm font-semibold text-red-700">Utilization Engagement Below M2 Pace</p>
                <p className="text-xs text-red-600">Current {stats.utilizationRate.toFixed(1)}% vs M2 target {MILESTONES.m2.utilization}%. Review subscriber outreach frequency.</p>
              </div>
            </div>
          )}
          {stats.complianceRate < 95 && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <span className="text-yellow-500 font-bold text-sm">●</span>
              <div>
                <p className="text-sm font-semibold text-yellow-700">Compliance Below 95% Target</p>
                <p className="text-xs text-yellow-600">{stats.violations} violations in period. Compliance must be 100% by M4.</p>
              </div>
            </div>
          )}
          {stats.churnRiskPct > 10 && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <span className="text-yellow-500 font-bold text-sm">●</span>
              <div>
                <p className="text-sm font-semibold text-yellow-700">High Churn Signal Density</p>
                <p className="text-xs text-yellow-600">{stats.churnSignals} signals ({stats.churnRiskPct.toFixed(1)}% of calls). Review retention script.</p>
              </div>
            </div>
          )}
          {stats.activationRate >= MILESTONES.m2.activation && stats.utilizationRate >= MILESTONES.m2.utilization && stats.complianceRate >= 95 && stats.churnRiskPct <= 10 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <span className="text-green-500 font-bold">✓</span>
              <p className="text-sm font-semibold text-green-700">No critical risks detected for this period.</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
