import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchTodaySnapshots } from '../lib/snapshots';
import { fetchRecordsForPeriod } from '../lib/airtable';
import {
  computeCallbackHonorStats, isConnectedCall, fmtTalkTime,
  isWelcomeCallRecord, isUtilizationRecord, getPeriodDates,
  dnpPersistenceColor, callbackHonorColor,
} from '../lib/helpers';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, Tooltip as ReTooltip,
} from 'recharts';

const G = '#10b981', A = '#f59e0b', R = '#ef4444', B = '#3b82f6', TEAL = '#0d9488', GRAY = '#9ca3af';
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function tl(v, g, a) { return v >= g ? G : v >= a ? A : R; }

const PERIOD_OPTS = { today: 'Today', week: 'Week-on-Week', month: 'Month-on-Month' };
const Q_LABELS = { Q1: 'Screened', Q2: 'Cashback', Q3: 'WA Link', Q4: 'Hi Attempt', Q5: 'Mechanic', Q6: 'No Claims' };

function detectDept(name, wcRecs, utilRecs) {
  const wc = wcRecs.filter(r => r['Agent Name'] === name).length;
  const ut = utilRecs.filter(r => r['Agent Name'] === name).length;
  return wc >= ut ? 'wc' : 'util';
}

function computeAgentStats(name, recs, wcRecs, utilRecs) {
  const agentRecs = recs.filter(r => r['Agent Name'] === name);
  const total = agentRecs.length;
  const connected = agentRecs.filter(isConnectedCall).length;
  const activated = agentRecs.filter(r => r['Call Outcome'] === 'Completed').length;
  const talkSec = agentRecs.reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);
  const qaEligible = agentRecs.filter(r => (r['Duration Seconds'] || 0) > 45);
  let qaPassed = 0, qCounts = [0,0,0,0,0,0];
  qaEligible.forEach(r => {
    let pass = 0;
    for (let i = 0; i < 6; i++) { if (r[`Q${i+1}`] === true || r[`Q${i+1}`] === 'Yes' || r[`Q${i+1}`] === 1) { qCounts[i]++; pass++; } }
    if (pass >= 4) qaPassed++;
  });
  const pitchDone = agentRecs.filter(r => (r['Pitch Completion'] || 0) >= 80).length;
  const engaged = agentRecs.filter(r => isConnectedCall(r) && (r['Duration Seconds'] || 0) > 120).length;
  const phones = new Set(agentRecs.filter(r => r['Call Outcome'] === 'Did Not Pick').map(r => r['Phone Number'] || r['Mobile Number'] || '')).size;
  const phones6 = new Set(agentRecs.filter(r => r['Call Outcome'] === 'Did Not Pick').map(r => r['Phone Number'] || r['Mobile Number'] || '')); // simplified
  const dept = detectDept(name, wcRecs, utilRecs);
  return { name, dept, total, connected, activated, talkSec, qaEligible: qaEligible.length, qaPassed, qCounts, pitchDone, engaged, dnpPhones: phones };
}

export default function AgentReview({
  data = [], periodRecords = [], wcRecords = [], utilRecords = [],
  attemptMap = {}, teamConfig = [],
  userRole, userAgentName, userDepartment,
  period, periodStart, periodEnd,
}) {
  const { role, agentName: authAgentName } = useAuth() || {};
  const effectiveRole = userRole || role;
  const effectiveAgent = userAgentName || authAgentName;
  const isAgentOnly = effectiveRole === 'AGENT';

  const [activePeriod, setActivePeriod] = useState('today');
  const [localPR, setLocalPR] = useState(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState(null);

  // Fetch own data for WoW/MoM
  useEffect(() => {
    if (activePeriod === 'today') { setLocalPR(null); return; }
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start;
    if (activePeriod === 'week') {
      const dow = today.getDay();
      start = new Date(today); start.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    } else {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    setLocalLoading(true);
    fetchRecordsForPeriod(fmt(start), fmt(today))
      .then(r => setLocalPR(r))
      .catch(() => setLocalPR([]))
      .finally(() => setLocalLoading(false));
  }, [activePeriod]);

  const effectivePR = activePeriod === 'today' ? periodRecords : (localPR || []);
  const effectiveWC = useMemo(() => effectivePR.filter(isWelcomeCallRecord), [effectivePR]);
  const effectiveUtil = useMemo(() => effectivePR.filter(isUtilizationRecord), [effectivePR]);
  const cbStats = useMemo(() => computeCallbackHonorStats(effectivePR), [effectivePR]);

  // ── Today mode: coaching snapshots ──
  const todayAgents = useMemo(() => {
    if (activePeriod !== 'today') return [];
    let agents = [...data];
    if (isAgentOnly && effectiveAgent) agents = agents.filter(a => a['Agent Name'] === effectiveAgent);
    return agents.sort((a, b) => {
      const order = { CRITICAL: 0, WARNING: 1, WATCH: 2, OK: 3 };
      return (order[a['Alert Level']] ?? 4) - (order[b['Alert Level']] ?? 4);
    });
  }, [data, activePeriod, isAgentOnly, effectiveAgent]);

  // ── Period mode: derive from records ──
  const periodAgents = useMemo(() => {
    if (activePeriod === 'today') return [];
    const names = new Set(effectivePR.map(r => r['Agent Name']).filter(Boolean));
    let list = [...names].map(name => computeAgentStats(name, effectivePR, effectiveWC, effectiveUtil));
    if (isAgentOnly && effectiveAgent) list = list.filter(a => a.name === effectiveAgent);
    return list.sort((a, b) => b.total - a.total);
  }, [activePeriod, effectivePR, effectiveWC, effectiveUtil, isAgentOnly, effectiveAgent]);

  return (
    <div className="space-y-5">
      {/* Period Toggle */}
      <div className="flex gap-2">
        {Object.entries(PERIOD_OPTS).map(([k, v]) => (
          <button key={k} onClick={() => setActivePeriod(k)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full ${activePeriod === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {v}
          </button>
        ))}
      </div>

      {localLoading && <div className="text-center py-10 text-gray-400">Loading {PERIOD_OPTS[activePeriod]} records...</div>}

      {/* ── TODAY MODE ── */}
      {activePeriod === 'today' && !localLoading && (
        todayAgents.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">No coaching data today</p>
            <p className="text-sm mt-1">Populates after first scrape cycle</p>
          </div>
        ) : (
          <div className="space-y-4">
            {todayAgents.map(agent => (
              <TodayAgentCard key={agent.id || agent['Agent Name']} agent={agent}
                expanded={expandedAgent === agent['Agent Name']}
                onToggle={() => setExpandedAgent(expandedAgent === agent['Agent Name'] ? null : agent['Agent Name'])}
                cbStats={cbStats} wcRecords={wcRecords} utilRecords={utilRecords} />
            ))}
          </div>
        )
      )}

      {/* ── PERIOD MODE ── */}
      {activePeriod !== 'today' && !localLoading && (
        periodAgents.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">No call data for {PERIOD_OPTS[activePeriod]}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {periodAgents.map(agent => (
              <PeriodAgentCard key={agent.name} agent={agent}
                expanded={expandedAgent === agent.name}
                onToggle={() => setExpandedAgent(expandedAgent === agent.name ? null : agent.name)}
                cbStats={cbStats} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── TODAY Agent Card (from coaching snapshot) ──
function TodayAgentCard({ agent, expanded, onToggle, cbStats, wcRecords, utilRecords }) {
  const f = agent;
  const name = f['Agent Name'] || '';
  const alert = f['Alert Level'] || 'OK';
  const alertColor = { CRITICAL: R, WARNING: A, WATCH: '#ea580c', OK: G }[alert] || GRAY;
  const dept = detectDept(name, wcRecords, utilRecords);
  const agentCb = cbStats?.byAgent?.[name];

  // QA bars
  const qData = [];
  for (let i = 1; i <= 6; i++) {
    const val = f[`Q${i} Pass %`] || f[`Q${i}`] || 0;
    qData.push({ q: `Q${i}`, val: typeof val === 'number' ? val : 0 });
  }

  // Radar
  const radarData = dept === 'wc'
    ? [
        { axis: 'Connection', val: f['Connection Rate'] || 0 },
        { axis: 'Pitch', val: f['Pitch Completion'] || 0 },
        { axis: 'QA', val: f['QA Score'] ? (f['QA Score'] / 6) * 100 : 0 },
        { axis: 'Activation', val: f['Activation Rate'] || 0 },
        { axis: 'DNP 6+', val: f['DNP Persistence'] || 0 },
        { axis: 'CB Honor', val: agentCb ? agentCb.rate * 100 : 0 },
      ]
    : [
        { axis: 'Connection', val: f['Connection Rate'] || 0 },
        { axis: 'Engagement', val: f['Engagement Rate'] || 0 },
        { axis: 'Sentiment', val: Math.max(0, ((f['Sentiment Delta'] || 0) + 1) * 50) },
        { axis: 'DNP 6+', val: f['DNP Persistence'] || 0 },
        { axis: 'CB Honor', val: agentCb ? agentCb.rate * 100 : 0 },
        { axis: 'Calls', val: Math.min(100, (f['Connected Calls'] || 0) * 5) },
      ];

  const brief = f['Coaching Brief'] || f['Brief'] || f['Coaching Notes'] || '';

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <div className="w-2 h-8 rounded-full" style={{ backgroundColor: alertColor }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{name}</span>
            <DeptBadge dept={dept} />
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white" style={{ backgroundColor: alertColor }}>{alert}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {f['Connected Calls'] || 0} calls · QA {f['QA Score'] || '—'}/6 · {f['Trend'] || '—'}
          </div>
        </div>
        {agentCb && <div className="text-right text-xs"><div className={`font-bold ${callbackHonorColor(agentCb.rate)}`}>{Math.round(agentCb.rate * 100)}%</div><div className="text-gray-400">CB Honor</div></div>}
        <span className="text-gray-400">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t pt-3">
          <div className="grid md:grid-cols-2 gap-4">
            {/* QA Bars */}
            <div>
              <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">QA Checkpoints</div>
              {qData.map(q => (
                <div key={q.q} className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] w-8 text-gray-500">{q.q}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3">
                    <div className="h-full rounded-full" style={{ width: `${q.val}%`, backgroundColor: tl(q.val, 70, 40) }} />
                  </div>
                  <span className="text-[10px] w-8 text-right font-bold" style={{ color: tl(q.val, 70, 40) }}>{q.val}%</span>
                </div>
              ))}
            </div>

            {/* Radar */}
            <div>
              <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">Performance Radar</div>
              <ResponsiveContainer width="100%" height={180}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9 }} />
                  <Radar dataKey="val" stroke={dept === 'wc' ? B : TEAL} fill={dept === 'wc' ? B : TEAL} fillOpacity={0.2} />
                  <ReTooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {brief && (
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-[10px] font-bold text-blue-800 uppercase mb-1">Coaching Brief</div>
              <p className="text-sm text-blue-900 whitespace-pre-wrap">{brief}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── PERIOD Agent Card (from raw records) ──
function PeriodAgentCard({ agent, expanded, onToggle, cbStats }) {
  const { name, dept, total, connected, activated, talkSec, qaEligible, qaPassed, qCounts, pitchDone, engaged } = agent;
  const agentCb = cbStats?.byAgent?.[name];

  const radarData = dept === 'wc'
    ? [
        { axis: 'Connection', val: pct(connected, total) },
        { axis: 'Pitch', val: pct(pitchDone, connected) },
        { axis: 'QA', val: pct(qaPassed, qaEligible) },
        { axis: 'Activation', val: pct(activated, total) },
        { axis: 'CB Honor', val: agentCb ? agentCb.rate * 100 : 0 },
      ]
    : [
        { axis: 'Connection', val: pct(connected, total) },
        { axis: 'Engagement', val: pct(engaged, total) },
        { axis: 'CB Honor', val: agentCb ? agentCb.rate * 100 : 0 },
        { axis: 'Calls', val: Math.min(100, total * 3) },
      ];

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{name}</span>
            <DeptBadge dept={dept} />
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {total} calls · {connected} connected · {fmtTalkTime(talkSec)}
          </div>
        </div>
        <div className="flex gap-4 text-xs text-right">
          {dept === 'wc' && <div><div className="font-bold" style={{ color: tl(pct(activated, total), 8, 5) }}>{pct(activated, total)}%</div><div className="text-gray-400">Act</div></div>}
          {dept === 'util' && <div><div className="font-bold" style={{ color: tl(pct(engaged, total), 40, 25) }}>{pct(engaged, total)}%</div><div className="text-gray-400">Eng</div></div>}
          {agentCb && <div><div className={`font-bold ${callbackHonorColor(agentCb.rate)}`}>{Math.round(agentCb.rate * 100)}%</div><div className="text-gray-400">CB</div></div>}
        </div>
        <span className="text-gray-400">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t pt-3">
          <div className="grid md:grid-cols-2 gap-4">
            {/* KPI Grid */}
            <div className="grid grid-cols-2 gap-2">
              <MiniKpi label="Connection" value={`${pct(connected, total)}%`} color={tl(pct(connected, total), 50, 30)} />
              {dept === 'wc' && <MiniKpi label="Activation" value={`${pct(activated, total)}%`} color={tl(pct(activated, total), 8, 5)} />}
              {dept === 'wc' && <MiniKpi label="Pitch ≥80%" value={`${pct(pitchDone, connected)}%`} color={tl(pct(pitchDone, connected), 75, 55)} />}
              {dept === 'wc' && <MiniKpi label="QA Pass" value={`${pct(qaPassed, qaEligible)}%`} color={tl(pct(qaPassed, qaEligible), 60, 30)} />}
              {dept === 'util' && <MiniKpi label="Engagement" value={`${pct(engaged, total)}%`} color={tl(pct(engaged, total), 40, 25)} />}
              <MiniKpi label="CB Honor" value={agentCb ? `${Math.round(agentCb.rate * 100)}%` : '—'} color={agentCb ? tl(agentCb.rate * 100, 85, 60) : GRAY} />
              <MiniKpi label="Talk Time" value={fmtTalkTime(talkSec)} />
            </div>

            {/* Radar */}
            <ResponsiveContainer width="100%" height={180}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9 }} />
                <Radar dataKey="val" stroke={dept === 'wc' ? B : TEAL} fill={dept === 'wc' ? B : TEAL} fillOpacity={0.2} />
                <ReTooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Q Bars for WC */}
          {dept === 'wc' && qaEligible > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">QA Checkpoints</div>
              <div className="grid grid-cols-6 gap-1">
                {qCounts.map((c, i) => {
                  const r = pct(c, qaEligible);
                  return (
                    <div key={i} className="text-center">
                      <div className="text-[10px] text-gray-400">Q{i+1}</div>
                      <div className="mx-auto w-6 bg-gray-100 rounded-full h-16 relative overflow-hidden">
                        <div className="absolute bottom-0 w-full rounded-full" style={{ height: `${r}%`, backgroundColor: tl(r, 70, 40) }} />
                      </div>
                      <div className="text-[10px] font-bold" style={{ color: tl(r, 70, 40) }}>{r}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeptBadge({ dept }) {
  return dept === 'wc'
    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Welcome Call</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-medium">Utilization</span>;
}

function MiniKpi({ label, value, color }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-lg font-bold" style={{ color: color || '#111' }}>{value}</div>
    </div>
  );
}
