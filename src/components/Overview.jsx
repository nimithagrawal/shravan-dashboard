import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  qaScore, qaRating, fmtDuration, outcomeColor, ratingColor, kpiColor,
  sentimentDotColor, sentimentScoreColor, conversionSignalColor,
  callCategoryColor, callLabelColor,
  computeCallTag, callTagColor, isHumanPickup, isConnectedCall,
  maskPhone, intentChipColor,
  fmtTalkTime, fmtAvgTalkTime,
  subscriberType, subscriberTypeColor, pitchQualityIssue,
  extractScheduledCallback, formatCallbackDue, callbackDueColor,
} from '../lib/helpers';
import { ExpandableSummary, TranscriptViewer, EmotionalJourneyChart } from './SharedUI';
import PhoneNumber from './PhoneNumber';

function ChangeChip({ value, label }) {
  if (value == null) return null;
  const arrow = value >= 0 ? '\u2191' : '\u2193';
  const color = value >= 0 ? 'text-pass' : 'text-fail';
  return (
    <span className={`${color} whitespace-nowrap`}>
      {arrow}{value >= 0 ? '+' : ''}{value}% {label}
    </span>
  );
}

function KpiCard({ label, value, color, badge, comparison, comparisons, subtitle }) {
  const hasMulti = comparisons && (comparisons.daily != null || comparisons.weekly != null || comparisons.monthly != null);
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100 relative">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
      {subtitle && <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>}
      {badge != null && badge > 0 && (
        <span className="absolute top-2 right-2 bg-fail text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span>
      )}
      {hasMulti ? (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px]">
          <ChangeChip value={comparisons.daily} label="d" />
          <ChangeChip value={comparisons.weekly} label="w" />
          <ChangeChip value={comparisons.monthly} label="m" />
        </div>
      ) : comparison != null && (
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

export default function Overview({ records, prevRecords = [], comparisonData = {}, period, periodStart, periodEnd, agentFilter, setAgentFilter, onRefresh }) {
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
  const [filterCallbackDue, setFilterCallbackDue] = useState('');

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
      _subType: subscriberType(r),
      _callbackWhen: extractScheduledCallback(r),
    })),
    [records]
  );

  // Duplicate mobile detection (FIX 8)
  const mobileCounts = useMemo(() => {
    const counts = {};
    enriched.forEach(r => {
      const m = String(r['Mobile Number'] || '');
      if (m) counts[m] = (counts[m] || 0) + 1;
    });
    return counts;
  }, [enriched]);
  const uniqueSubscribers = Object.keys(mobileCounts).length;

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

  // Multi-period comparisons (daily/weekly/monthly)
  const multiCmp = useMemo(() => {
    const compute = (dataset) => {
      if (!dataset || dataset.length === 0) return { total: null, pickup: null, talkTime: null };
      const t = dataset.length;
      const hp = dataset.filter(r => isHumanPickup(r)).length;
      const hpRate = t > 0 ? Math.round((hp / t) * 100) : 0;
      const conn = dataset.filter(r => isConnectedCall(r));
      const tt = conn.reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);
      return {
        total: pctChange(total, t),
        pickup: pctChange(humanPickupRate, hpRate),
        talkTime: pctChange(totalTalkTimeSec, tt),
      };
    };
    return {
      daily: compute(comparisonData.daily),
      weekly: compute(comparisonData.weekly),
      monthly: compute(comparisonData.monthly),
    };
  }, [comparisonData, total, humanPickupRate, totalTalkTimeSec]);

  const cmpTotalMulti = isToday ? { daily: multiCmp.daily.total, weekly: multiCmp.weekly.total, monthly: multiCmp.monthly.total } : null;
  const cmpPickupMulti = isToday ? { daily: multiCmp.daily.pickup, weekly: multiCmp.weekly.pickup, monthly: multiCmp.monthly.pickup } : null;
  const cmpTalkTimeMulti = isToday ? { daily: multiCmp.daily.talkTime, weekly: multiCmp.weekly.talkTime, monthly: multiCmp.monthly.talkTime } : null;

  // Hot + Warm
  const hotCount = enriched.filter(r => r._tag === 'HOT').length;
  const warmCount = enriched.filter(r => r._tag === 'WARM').length;
  const callbackRequestedCount = enriched.filter(r => r['Callback Requested']).length;

  // Agent vs Customer vs Disputed
  const agentSubCount = enriched.filter(r => r._subType === 'Agent/CSP').length;
  const disputedSubCount = enriched.filter(r => r._subType === 'Disputed').length;
  const customerSubCount = total - agentSubCount - disputedSubCount;

  // ── New metrics from upgraded pipeline ──
  const fullPitchCalls = enriched.filter(r => r['Call Framework'] === 'Full Pitch');
  const tier2Calls = enriched.filter(r => String(r['Gemini Tier']) === '2');

  // Agent Talk % average (Tier 2 only)
  const talkPcts = tier2Calls.map(r => r['Agent Talk %']).filter(v => v != null);
  const avgTalkPct = talkPcts.length > 0 ? Math.round(talkPcts.reduce((a, b) => a + b, 0) / talkPcts.length) : null;

  // Monologue rate
  const monologueCounts = tier2Calls.map(r => r['Monologue Segments']).filter(v => v != null);
  const avgMonologues = monologueCounts.length > 0 ? (monologueCounts.reduce((a, b) => a + b, 0) / monologueCounts.length).toFixed(1) : null;

  // Weighted QA score average
  const qaScores = enriched.map(r => r['QA Score']).filter(v => v != null && v > 0);
  const avgQaScore = qaScores.length > 0 ? Math.round(qaScores.reduce((a, b) => a + b, 0) / qaScores.length) : null;
  const qaPassCount = enriched.filter(r => r['QA Pass'] === true).length;
  const qaPassRate = qaScores.length > 0 ? Math.round((qaPassCount / qaScores.length) * 100) : null;

  // Drop funnel
  const dropStages = tier2Calls.map(r => r['Drop Stage']).filter(Boolean);
  const completedCalls = dropStages.filter(s => s === 'Complete').length;
  const completionRate = dropStages.length > 0 ? Math.round((completedCalls / dropStages.length) * 100) : null;

  // Compliance violation rate
  const violationRate = fullPitchCalls.length > 0 ? Math.round((violations / fullPitchCalls.length) * 100) : 0;

  // Sentiment delta average
  const sentimentDeltas = tier2Calls.map(r => r['Sentiment Delta']).filter(v => v != null);
  const avgSentimentDelta = sentimentDeltas.length > 0 ? (sentimentDeltas.reduce((a, b) => a + b, 0) / sentimentDeltas.length).toFixed(1) : null;

  // ── Acoustic Intelligence (agent-level aggregation) ──
  const acousticByAgent = useMemo(() => {
    const agents = {};
    enriched.forEach(r => {
      const name = r['Agent Name'];
      if (!name) return;
      if (!agents[name]) agents[name] = { speechRates: [], deadAirs: [], overtalks: [], pitches: [], calls: 0 };
      const a = agents[name];
      a.calls++;
      if (r['Speech Rate WPM'] > 0) a.speechRates.push(r['Speech Rate WPM']);
      if (r['Dead Air %'] != null) a.deadAirs.push(r['Dead Air %']);
      if (r['Overtalk Estimate'] != null) a.overtalks.push(r['Overtalk Estimate']);
      if (r['Pitch Mean Hz'] > 0) a.pitches.push(r['Pitch Mean Hz']);
    });
    const avg = arr => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;
    return Object.entries(agents).map(([name, d]) => ({
      name,
      calls: d.calls,
      speechRate: avg(d.speechRates),
      deadAir: avg(d.deadAirs),
      overtalk: avg(d.overtalks),
      pitch: avg(d.pitches),
      // Acoustic health score: penalize high dead air + high overtalk + too fast/slow speech
      score: (() => {
        const sr = avg(d.speechRates);
        const da = avg(d.deadAirs);
        const ot = avg(d.overtalks);
        if (sr == null && da == null) return null;
        let s = 100;
        if (da != null) s -= Math.min(da * 2, 30);         // Dead air penalty
        if (ot != null) s -= Math.min(ot * 0.5, 20);       // Overtalk penalty
        if (sr != null) s -= Math.min(Math.abs(sr - 140) * 0.3, 20); // Ideal ~140 WPM
        return Math.max(0, Math.round(s));
      })(),
    })).filter(a => a.speechRate != null || a.deadAir != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [enriched]);

  // ── Emotional Journey aggregation (team-level) ──
  const emotionalJourneyStats = useMemo(() => {
    const arcCounts = {};
    const sentimentArcs = enriched.map(r => r['Sentiment Arc Type']).filter(v => v && v !== 'unknown');
    sentimentArcs.forEach(arc => { arcCounts[arc] = (arcCounts[arc] || 0) + 1; });
    const total = sentimentArcs.length;
    return {
      total,
      arcs: Object.entries(arcCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([arc, count]) => ({ arc, count, pct: Math.round((count / total) * 100) })),
      risingPct: total > 0 ? Math.round(((arcCounts['Rising'] || 0) / total) * 100) : 0,
      decliningPct: total > 0 ? Math.round(((arcCounts['Declining'] || 0) / total) * 100) : 0,
    };
  }, [enriched]);

  // ── Intelligence Signals (new fields) ──
  const intelStats = useMemo(() => {
    const competitors = {};
    const lifeEvents = {};
    const arcCounts = {};
    let highNeed = 0, medNeed = 0;
    let lowDigital = 0, highDigital = 0;
    let coachingMoments = [];
    enriched.forEach(r => {
      const comp = r['Competitor Mentioned'];
      if (comp && comp.trim()) competitors[comp] = (competitors[comp] || 0) + 1;
      const le = r['Life Event Detected'];
      if (le && le !== 'none') lifeEvents[le] = (lifeEvents[le] || 0) + 1;
      const needScore = r['Immediate Need Score'];
      if (needScore >= 4) highNeed++;
      else if (needScore >= 2) medNeed++;
      const dr = r['Digital Readiness'];
      if (dr === 'low') lowDigital++;
      else if (dr === 'high') highDigital++;
      const cm = r['Coaching Moment'];
      if (cm && cm.trim()) coachingMoments.push({ agent: r['Agent Name'], moment: cm, call: r['Call ID'] });
    });
    return {
      competitors: Object.entries(competitors).sort((a, b) => b[1] - a[1]).slice(0, 5),
      lifeEvents: Object.entries(lifeEvents).sort((a, b) => b[1] - a[1]).slice(0, 5),
      highNeed, medNeed,
      lowDigital, highDigital,
      coachingMoments: coachingMoments.slice(0, 10),
    };
  }, [enriched]);

  // North Star RAG thresholds (per Analysis Framework Section 11)
  const ragColor = (val, green, amber) => {
    if (val == null) return 'text-gray-400';
    return val >= green ? 'text-emerald-600' : val >= amber ? 'text-amber-500' : 'text-red-500';
  };
  const ragDot = (val, green, amber) => {
    if (val == null) return 'bg-gray-300';
    return val >= green ? 'bg-emerald-500' : val >= amber ? 'bg-amber-400' : 'bg-red-500';
  };

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

  // ── QA Analysis (Welcome Calls only) ──
  const qaAnalysis = useMemo(() => {
    const STT_FAILED = ['[STT Failed]', '[STT Failed — audio could not be processed]', 'failed', ''];
    const wc = enriched.filter(r => {
      const cat = r.callCategory || r['Call Disposition'];
      const fw = r.evaluationFramework || r['Evaluation Framework'];
      return cat === 'Welcome-Call' || fw === 'Welcome-Call-QA';
    });
    // Only score calls with real conversations (dur>45 + real transcript)
    const scored = wc.filter(r => {
      const dur = r['Duration Seconds'];
      if (dur == null || dur <= 45) return false;
      const tx = (r['Transcript'] || '').trim();
      return tx && !STT_FAILED.includes(tx);
    }).map(r => ({ ...r, _qs: qaScore(r), _qr: qaRating(qaScore(r)) }));
    const pass = scored.filter(r => r._qr === 'PASS').length;
    const amber = scored.filter(r => r._qr === 'AMBER').length;
    const fail = scored.filter(r => r._qr === 'FAIL').length;
    // Q1-Q6 failure rates
    const qFails = QA_LABELS.map(q => ({
      label: q.replace(/^Q\d\s/, ''),
      short: q.slice(0, 2),
      failCount: scored.filter(r => !r[q]).length,
      failRate: scored.length > 0 ? Math.round(scored.filter(r => !r[q]).length / scored.length * 100) : 0,
    }));
    // Per-agent QA (scored only)
    const agentQa = {};
    scored.forEach(r => {
      const a = r['Agent Name'] || 'Unknown';
      if (!agentQa[a]) agentQa[a] = { name: a, scores: [], pass: 0, amber: 0, fail: 0 };
      agentQa[a].scores.push(r._qs);
      if (r._qr === 'PASS') agentQa[a].pass++;
      else if (r._qr === 'AMBER') agentQa[a].amber++;
      else agentQa[a].fail++;
    });
    const agentList = Object.values(agentQa).map(a => ({
      ...a,
      total: a.scores.length,
      avg: +(a.scores.reduce((s, v) => s + v, 0) / a.scores.length).toFixed(1),
    })).sort((a, b) => a.avg - b.avg); // worst first
    // Per-agent summary for ALL welcome calls (shown even when scored=0)
    const agentWcMap = {};
    wc.forEach(r => {
      const a = r['Agent Name'] || 'Unknown';
      if (!agentWcMap[a]) agentWcMap[a] = { name: a, total: 0, connected: 0, totalDur: 0, outcomes: {} };
      agentWcMap[a].total++;
      const dur = r['Duration Seconds'] || 0;
      agentWcMap[a].totalDur += dur;
      if (r._connected) agentWcMap[a].connected++;
      const oc = r['Call Outcome'] || 'Unknown';
      agentWcMap[a].outcomes[oc] = (agentWcMap[a].outcomes[oc] || 0) + 1;
    });
    const agentWcList = Object.values(agentWcMap).map(a => ({
      ...a,
      avgDur: a.total > 0 ? Math.round(a.totalDur / a.total) : 0,
      connectRate: a.total > 0 ? Math.round((a.connected / a.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
    return { wc: wc.length, scored: scored.length, pass, amber, fail, qFails, agentList, agentWcList };
  }, [enriched]);

  // Welcome Call Activation Funnel (Section F)
  const activationFunnel = useMemo(() => {
    const welcome = enriched.filter(r => {
      const cat = r.callCategory || r['Call Disposition'];
      const fw = r.evaluationFramework || r['Evaluation Framework'];
      return cat === 'Welcome-Call' || fw === 'Welcome-Call-QA';
    });
    const connected = welcome.filter(r => r._human);
    const engaged = connected.filter(r => (r['Duration Seconds'] || 0) > 30 && r['Call Label'] !== 'No Connect');
    const actionRequired = engaged.filter(r =>
      r['Call Label'] === 'Lab Lead' || r['Call Label'] === 'Medicine Lead' ||
      r['Call Label'] === 'Callback Set' || r['Call Label'] === 'Complaint'
    );
    const activated = engaged.filter(r => r['Call Label'] === 'Activated');
    const activationRate = welcome.length > 0 ? Math.round((activated.length / welcome.length) * 100) : 0;
    return { welcome: welcome.length, connected: connected.length, engaged: engaged.length, actionRequired: actionRequired.length, activated: activated.length, activationRate };
  }, [enriched]);

  // ── Pitch Quality Analysis — Completed calls tagged rejected/cold/dead ──
  const pitchAnalysis = useMemo(() => {
    const completed = enriched.filter(r => r['Call Outcome'] === 'Completed');
    const problematic = completed.filter(r =>
      r['Customer Intent Signal'] === 'Rejected' ||
      r['Conversion Signal'] === 'cold' ||
      r['Conversion Signal'] === 'dead'
    ).map(r => ({
      ...r,
      _pitchIssue: pitchQualityIssue(r),
    }));

    // Group by issue type
    const issueMap = {};
    problematic.forEach(r => {
      const issue = r._pitchIssue.issue;
      if (!issueMap[issue]) issueMap[issue] = { issue, count: 0, withCallback: 0, records: [] };
      issueMap[issue].count++;
      if (r._pitchIssue.hasCapturedCallback) issueMap[issue].withCallback++;
      if (issueMap[issue].records.length < 3) issueMap[issue].records.push(r);
    });
    const issues = Object.values(issueMap).sort((a, b) => b.count - a.count);

    // Per-agent breakdown
    const agentMap = {};
    problematic.forEach(r => {
      const a = r['Agent Name'] || 'Unknown';
      if (!agentMap[a]) agentMap[a] = { name: a, rejected: 0, cold: 0, dead: 0, total: 0, withCallback: 0 };
      agentMap[a].total++;
      if (r['Customer Intent Signal'] === 'Rejected') agentMap[a].rejected++;
      if (r['Conversion Signal'] === 'cold') agentMap[a].cold++;
      if (r['Conversion Signal'] === 'dead') agentMap[a].dead++;
      if (r._pitchIssue.hasCapturedCallback) agentMap[a].withCallback++;
    });
    const agents = Object.values(agentMap).sort((a, b) => b.total - a.total);

    const callbackCaptureRate = problematic.length > 0
      ? Math.round((problematic.filter(r => r._pitchIssue.hasCapturedCallback).length / problematic.length) * 100)
      : 0;

    return {
      completedCount: completed.length,
      problematicCount: problematic.length,
      problematicRate: completed.length > 0 ? Math.round((problematic.length / completed.length) * 100) : 0,
      callbackCaptureRate,
      issues,
      agents,
      records: problematic,
    };
  }, [enriched]);

  // ── Callback Tracker — group callbacks by resolved date ──
  const callbackTracker = useMemo(() => {
    const withCallback = enriched.filter(r => r._callbackWhen);
    const byDate = {};
    withCallback.forEach(r => {
      const dateKey = r._callbackWhen.resolvedDate || 'unresolved';
      if (!byDate[dateKey]) byDate[dateKey] = { date: dateKey, records: [] };
      byDate[dateKey].records.push(r);
    });
    // Sort: overdue first, then today, tomorrow, future, unresolved last
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return Object.values(byDate).sort((a, b) => {
      if (a.date === 'unresolved') return 1;
      if (b.date === 'unresolved') return -1;
      return a.date.localeCompare(b.date);
    }).map(group => ({
      ...group,
      label: group.date === 'unresolved' ? 'No Date' :
             group.date < todayStr ? 'Overdue' :
             group.date === todayStr ? 'Today' :
             (() => {
               const d = new Date(group.date + 'T00:00:00');
               const tmr = new Date(now);
               tmr.setDate(tmr.getDate() + 1);
               const tmrStr = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
               if (group.date === tmrStr) return 'Tomorrow';
               return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
             })(),
      isOverdue: group.date !== 'unresolved' && group.date < todayStr,
      isToday: group.date === todayStr,
    }));
  }, [enriched]);

  const totalCallbacksDue = callbackTracker.reduce((s, g) => s + g.records.length, 0);

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
    if (filterCallbackDue) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
      const tmrStr = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
      if (filterCallbackDue === 'has_callback') {
        rows = rows.filter(r => r._callbackWhen);
      } else if (filterCallbackDue === 'overdue') {
        rows = rows.filter(r => r._callbackWhen?.resolvedDate && r._callbackWhen.resolvedDate < todayStr);
      } else if (filterCallbackDue === 'today') {
        rows = rows.filter(r => r._callbackWhen?.resolvedDate === todayStr);
      } else if (filterCallbackDue === 'tomorrow') {
        rows = rows.filter(r => r._callbackWhen?.resolvedDate === tmrStr);
      } else if (filterCallbackDue === 'no_callback') {
        rows = rows.filter(r => !r._callbackWhen && (r['Needs Callback'] || r['Callback Requested']));
      }
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
  }, [enriched, effectiveAgentFilter, filterOutcome, filterTag, filterCategory, filterTimeRange, filterCallbackDue, search, sortField, sortDir, isMultiDay]);

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
    setFilterCallbackDue('');
    setAgentFilter(null);
  };

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortArrow = (field) => sortField === field ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';

  const hasFilters = effectiveAgentFilter || filterOutcome || filterTag || filterCategory || filterTimeRange || filterCallbackDue || search;

  // FIX 9: Zero-calls messaging
  if (total === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-lg text-gray-500">No calls processed yet {isToday ? 'today' : 'for this period'}</p>
        {prevTotal > 0 && isToday && (
          <div className="mt-3 text-sm text-gray-400">
            <p>Yesterday: {prevTotal} calls, {prevHumanPickups} connected ({prevPickupRate}% pickup rate)</p>
            <p className="text-xs mt-1">{fmtTalkTime(prevTalkTime)} total talk time</p>
          </div>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="mt-4 px-4 py-2 bg-info text-white rounded-lg text-sm font-medium hover:bg-blue-700 active:scale-95 transition-all min-h-[44px]"
          >
            Refresh Now
          </button>
        )}
        <p className="text-[10px] text-gray-300 mt-4">Scraper runs every 30 minutes Mon-Sat 9:30 AM - 7 PM IST</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats Row */}
      <div className="bg-white rounded-lg px-4 py-2 text-xs text-gray-600 border border-gray-100 shadow-sm">
        {summaryLine}
      </div>

      {/* A) KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Calls" value={total.toLocaleString()} comparison={!isToday ? cmpTotal : null} comparisons={cmpTotalMulti} subtitle={uniqueSubscribers !== total ? `${uniqueSubscribers} unique subscribers` : null} />
        <KpiCard label="Human Pickup Rate" value={`${humanPickupRate}%`} color={kpiColor(humanPickupRate, 25, 15)} comparison={!isToday ? cmpPickup : null} comparisons={cmpPickupMulti} />
        {isMultiDay ? (
          <KpiCard label="Avg Daily Calls" value={avgDailyCalls} />
        ) : (
          <KpiCard label="Callbacks Pending" value={callbacksPending} badge={urgentCallbacks} />
        )}
        <KpiCard label="Total Talk Time" value={fmtTalkTime(totalTalkTimeSec)} comparison={!isToday ? cmpTalkTime : null} comparisons={cmpTalkTimeMulti} />
        <KpiCard label="Compliance" value={violations > 0 ? `${violations} issue${violations > 1 ? 's' : ''}` : 'Clean'} color={violations > 0 ? 'text-fail' : 'text-pass'} />
        {activationFunnel.welcome > 0 ? (
          <KpiCard
            label="Activation Rate"
            value={`${activationFunnel.activationRate}%`}
            color={activationFunnel.activationRate > 25 ? 'text-pass' : activationFunnel.activationRate >= 10 ? 'text-amber' : 'text-fail'}
            subtitle={`${activationFunnel.activated} of ${activationFunnel.welcome} welcome calls`}
          />
        ) : (
          <KpiCard label="Active Signals" value={activeSignals} color={activeSignals > 0 ? 'text-info' : 'text-gray-400'} />
        )}
      </div>

      {/* North Star Metrics — 6 key indicators with RAG thresholds */}
      {(avgQaScore != null || qaPassRate != null || violationRate != null) && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">North Star Metrics</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="text-center">
              <div className={`inline-block w-2 h-2 rounded-full mb-1 ${ragDot(avgQaScore, 70, 55)}`} />
              <p className={`text-xl font-bold ${ragColor(avgQaScore, 70, 55)}`}>{avgQaScore ?? '-'}</p>
              <p className="text-[10px] text-gray-500">QA Score Avg</p>
            </div>
            <div className="text-center">
              <div className={`inline-block w-2 h-2 rounded-full mb-1 ${ragDot(qaPassRate, 75, 60)}`} />
              <p className={`text-xl font-bold ${ragColor(qaPassRate, 75, 60)}`}>{qaPassRate != null ? `${qaPassRate}%` : '-'}</p>
              <p className="text-[10px] text-gray-500">QA Pass Rate</p>
            </div>
            <div className="text-center">
              <div className={`inline-block w-2 h-2 rounded-full mb-1 ${ragDot(completionRate, 60, 40)}`} />
              <p className={`text-xl font-bold ${ragColor(completionRate, 60, 40)}`}>{completionRate != null ? `${completionRate}%` : '-'}</p>
              <p className="text-[10px] text-gray-500">Pitch Completion</p>
            </div>
            <div className="text-center">
              <div className={`inline-block w-2 h-2 rounded-full mb-1 ${ragDot(avgTalkPct != null ? (100 - Math.abs(avgTalkPct - 55)) : null, 80, 60)}`} />
              <p className={`text-xl font-bold ${ragColor(avgTalkPct != null ? (100 - Math.abs(avgTalkPct - 55)) : null, 80, 60)}`}>{avgTalkPct != null ? `${avgTalkPct}%` : '-'}</p>
              <p className="text-[10px] text-gray-500">Agent Talk Ratio</p>
              <p className="text-[8px] text-gray-400">ideal: 55%</p>
            </div>
            <div className="text-center">
              <div className={`inline-block w-2 h-2 rounded-full mb-1 ${ragDot(100 - violationRate, 95, 85)}`} />
              <p className={`text-xl font-bold ${ragColor(100 - violationRate, 95, 85)}`}>{violationRate}%</p>
              <p className="text-[10px] text-gray-500">Violation Rate</p>
            </div>
            <div className="text-center">
              <div className={`inline-block w-2 h-2 rounded-full mb-1 ${ragDot(avgSentimentDelta != null ? parseFloat(avgSentimentDelta) + 2 : null, 2, 1)}`} />
              <p className={`text-xl font-bold ${ragColor(avgSentimentDelta != null ? parseFloat(avgSentimentDelta) + 2 : null, 2, 1)}`}>{avgSentimentDelta != null ? (avgSentimentDelta > 0 ? `+${avgSentimentDelta}` : avgSentimentDelta) : '-'}</p>
              <p className="text-[10px] text-gray-500">Sentiment Delta</p>
            </div>
          </div>
        </div>
      )}

      {/* Subscriber Type + Pitch Quality Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-card rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Customers</p>
          <p className="text-xl font-bold text-blue-700">{customerSubCount}</p>
          <p className="text-[10px] text-gray-400">{total > 0 ? Math.round((customerSubCount / total) * 100) : 0}% of total</p>
        </div>
        <div className="bg-card rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Agent / CSP</p>
          <p className="text-xl font-bold text-purple-700">{agentSubCount}</p>
          <p className="text-[10px] text-gray-400">{total > 0 ? Math.round((agentSubCount / total) * 100) : 0}% of total</p>
        </div>
        <div className="bg-card rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Disputed</p>
          <p className={`text-xl font-bold ${disputedSubCount > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{disputedSubCount}</p>
          <p className="text-[10px] text-gray-400">Denied purchase / wrong person</p>
        </div>
        <div className="bg-card rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Pitch Issues</p>
          <p className={`text-xl font-bold ${pitchAnalysis.problematicRate > 30 ? 'text-fail' : pitchAnalysis.problematicRate > 15 ? 'text-amber' : 'text-pass'}`}>
            {pitchAnalysis.problematicCount}
          </p>
          <p className="text-[10px] text-gray-400">{pitchAnalysis.problematicRate}% of {pitchAnalysis.completedCount} completed</p>
        </div>
        <div className="bg-card rounded-xl p-3 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Callback Capture</p>
          <p className={`text-xl font-bold ${pitchAnalysis.callbackCaptureRate >= 50 ? 'text-pass' : pitchAnalysis.callbackCaptureRate >= 25 ? 'text-amber' : 'text-fail'}`}>
            {pitchAnalysis.callbackCaptureRate}%
          </p>
          <p className="text-[10px] text-gray-400">Of rejected/cold calls</p>
        </div>
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

      {/* QA Analysis — Welcome Calls */}
      <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">QA Analysis — Welcome Calls</h2>
          <span className="text-xs text-gray-400">{qaAnalysis.wc} welcome / {total} total calls</span>
        </div>
        <div className="space-y-4">
          {qaAnalysis.scored === 0 ? (
            <div className="text-xs text-gray-500">
              <p>No scoreable Welcome Calls {isToday ? 'today' : 'for this period'} (need dur&gt;45s + real transcript).</p>
              {Object.keys(categoryBreakdown).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                    <span key={cat} className="inline-flex items-center gap-1">
                      <Chip text={cat} className={callCategoryColor(cat)} />
                      <span className="font-mono">{count}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* QA Scoring Funnel */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">Scoring Funnel</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-bold">{qaAnalysis.wc}</span>
                  <span className="text-gray-400">Welcome</span>
                  <span className="text-gray-300">&rarr;</span>
                  <span className="font-mono font-bold">{qaAnalysis.scored}</span>
                  <span className="text-gray-400">Scoreable (dur&gt;45s + transcript)</span>
                  <span className="text-gray-300">&rarr;</span>
                  <span className="font-mono font-bold text-fail">{qaAnalysis.fail + qaAnalysis.amber}</span>
                  <span className="text-gray-400">Need Attention</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {qaAnalysis.wc - qaAnalysis.scored} calls excluded: short calls (&le;45s) or failed transcription
                </p>
              </div>

              {/* Score Distribution */}
              <div>
                <p className="text-xs text-gray-500 mb-2">{qaAnalysis.scored} calls scored (dur&gt;45s, real transcript)</p>
                <div className="flex gap-3 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-pass"></span>
                    <span className="font-bold text-pass">{qaAnalysis.pass}</span>
                    <span className="text-xs text-gray-500">Pass</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-amber"></span>
                    <span className="font-bold text-amber">{qaAnalysis.amber}</span>
                    <span className="text-xs text-gray-500">Amber</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-fail"></span>
                    <span className="font-bold text-fail">{qaAnalysis.fail}</span>
                    <span className="text-xs text-gray-500">Fail</span>
                  </div>
                </div>
                {/* Score bar */}
                <div className="flex h-3 rounded-full overflow-hidden mt-2 bg-gray-100">
                  {qaAnalysis.pass > 0 && <div className="bg-pass" style={{ width: `${(qaAnalysis.pass / qaAnalysis.scored) * 100}%` }} />}
                  {qaAnalysis.amber > 0 && <div className="bg-amber" style={{ width: `${(qaAnalysis.amber / qaAnalysis.scored) * 100}%` }} />}
                  {qaAnalysis.fail > 0 && <div className="bg-fail" style={{ width: `${(qaAnalysis.fail / qaAnalysis.scored) * 100}%` }} />}
                </div>
              </div>

              {/* Q1-Q6 Failure Breakdown */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Question Failure Rates</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {qaAnalysis.qFails.map(q => (
                    <div key={q.short} className="flex items-center gap-2 text-xs">
                      <span className="font-bold text-gray-500 w-6">{q.short}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2 relative">
                        <div className={`h-2 rounded-full ${q.failRate > 50 ? 'bg-fail' : q.failRate > 25 ? 'bg-amber' : 'bg-pass'}`}
                          style={{ width: `${Math.max(q.failRate, q.failCount > 0 ? 5 : 0)}%` }} />
                      </div>
                      <span className={`w-8 text-right font-mono ${q.failRate > 50 ? 'text-fail' : q.failRate > 25 ? 'text-amber' : 'text-gray-500'}`}>
                        {q.failRate}%
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-gray-400">
                  {qaAnalysis.qFails.map(q => (
                    <span key={q.short}>{q.short}: {q.label}</span>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Agent QA Performance — always visible when welcome calls exist */}
          {qaAnalysis.agentList.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Agent QA Performance</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="px-3 py-1.5">Agent</th>
                      <th className="px-3 py-1.5">Scored</th>
                      <th className="px-3 py-1.5">Avg</th>
                      <th className="px-3 py-1.5">Pass</th>
                      <th className="px-3 py-1.5">Amber</th>
                      <th className="px-3 py-1.5">Fail</th>
                      <th className="px-3 py-1.5">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qaAnalysis.agentList.map(a => (
                      <tr key={a.name} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium">{a.name}</td>
                        <td className="px-3 py-1.5 font-mono">{a.total}</td>
                        <td className="px-3 py-1.5 font-mono font-bold">
                          <span className={a.avg >= 5 ? 'text-pass' : a.avg >= 3 ? 'text-amber' : 'text-fail'}>{a.avg}/6</span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-pass">{a.pass}</td>
                        <td className="px-3 py-1.5 font-mono text-amber">{a.amber}</td>
                        <td className="px-3 py-1.5 font-mono text-fail">{a.fail}</td>
                        <td className="px-3 py-1.5">
                          <Chip
                            text={a.avg >= 5 ? 'Good' : a.avg >= 3 ? 'Watch' : 'Needs Coaching'}
                            className={a.avg >= 5 ? 'bg-green-100 text-pass' : a.avg >= 3 ? 'bg-yellow-100 text-amber' : 'bg-red-100 text-fail'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : qaAnalysis.agentWcList.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Agent QA Performance</p>
              <p className="text-[10px] text-gray-400 mb-2">No calls scored yet — showing welcome call activity per agent</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="px-3 py-1.5">Agent</th>
                      <th className="px-3 py-1.5">WC Calls</th>
                      <th className="px-3 py-1.5">Connected</th>
                      <th className="px-3 py-1.5">Connect %</th>
                      <th className="px-3 py-1.5">Avg Dur</th>
                      <th className="px-3 py-1.5">QA Score</th>
                      <th className="px-3 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qaAnalysis.agentWcList.map(a => (
                      <tr key={a.name} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium">{a.name}</td>
                        <td className="px-3 py-1.5 font-mono">{a.total}</td>
                        <td className="px-3 py-1.5 font-mono">{a.connected}</td>
                        <td className="px-3 py-1.5 font-mono">
                          <span className={a.connectRate >= 30 ? 'text-pass' : a.connectRate >= 15 ? 'text-amber' : 'text-fail'}>
                            {a.connectRate}%
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono">{a.avgDur}s</td>
                        <td className="px-3 py-1.5 font-mono text-gray-400">--</td>
                        <td className="px-3 py-1.5">
                          <Chip
                            text={a.avgDur > 45 ? 'On Track' : 'Short Calls'}
                            className={a.avgDur > 45 ? 'bg-green-100 text-pass' : 'bg-yellow-100 text-amber'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Welcome Call Pipeline — Activation Funnel */}
      {activationFunnel.welcome > 0 && (
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Welcome Call Pipeline {isToday ? '— Today' : ''}</h2>
            <span className="text-xs text-gray-400">{activationFunnel.welcome} welcome calls</span>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Welcome Calls', count: activationFunnel.welcome, color: '#6b7280', pct: 100 },
              { label: 'Connected (human)', count: activationFunnel.connected, color: '#2563eb', pct: activationFunnel.welcome > 0 ? Math.round((activationFunnel.connected / activationFunnel.welcome) * 100) : 0 },
              { label: 'Engaged (conv >30s)', count: activationFunnel.engaged, color: '#d97706', pct: activationFunnel.welcome > 0 ? Math.round((activationFunnel.engaged / activationFunnel.welcome) * 100) : 0 },
              { label: 'Action Required', count: activationFunnel.actionRequired, color: '#ea580c', pct: activationFunnel.welcome > 0 ? Math.round((activationFunnel.actionRequired / activationFunnel.welcome) * 100) : 0 },
              { label: 'Activated', count: activationFunnel.activated, color: '#16a34a', pct: activationFunnel.welcome > 0 ? Math.round((activationFunnel.activated / activationFunnel.welcome) * 100) : 0 },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-3 text-xs">
                <span className="w-32 text-gray-600 font-medium">{step.label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 relative">
                  <div
                    className="h-5 rounded-full transition-all"
                    style={{ width: `${Math.max(step.pct, step.count > 0 ? 5 : 0)}%`, background: step.color }}
                  />
                </div>
                <span className="w-12 text-right font-mono font-bold">{step.count}</span>
                <span className="w-10 text-right font-mono text-gray-400">{step.pct}%</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs">
            <span className={`font-bold ${activationFunnel.activationRate > 25 ? 'text-pass' : activationFunnel.activationRate >= 10 ? 'text-amber' : 'text-fail'}`}>
              Activation Rate: {activationFunnel.activationRate}%
            </span>
            {activationFunnel.connected > 0 && (
              <span className="text-gray-500">
                Connect Rate: {Math.round((activationFunnel.connected / activationFunnel.welcome) * 100)}%
              </span>
            )}
            {activationFunnel.engaged > 0 && activationFunnel.connected > 0 && (
              <span className="text-gray-500">
                Engagement Rate: {Math.round((activationFunnel.engaged / activationFunnel.connected) * 100)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Pitch Quality Analysis — Rejected/Cold/Dead Completed Calls */}
      {pitchAnalysis.problematicCount > 0 && (
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Pitch Quality Analysis</h2>
            <span className="text-xs text-gray-400">
              {pitchAnalysis.problematicCount} of {pitchAnalysis.completedCount} completed calls need review
            </span>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            These are completed calls where paid subscribers were tagged as rejected, cold, or dead.
            {pitchAnalysis.callbackCaptureRate < 50 && (
              <span className="text-fail font-medium"> Only {pitchAnalysis.callbackCaptureRate}% had a callback captured — busy subscribers should always have a follow-up scheduled.</span>
            )}
          </p>

          {/* Issue Breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
            {pitchAnalysis.issues.map(issue => (
              <div key={issue.issue} className="bg-gray-50 rounded-lg p-2.5 text-xs">
                <p className="font-semibold text-gray-700">{issue.issue}</p>
                <p className="text-lg font-bold text-gray-900">{issue.count}</p>
                <p className="text-[10px] text-gray-400">
                  {issue.withCallback}/{issue.count} have callback
                </p>
              </div>
            ))}
          </div>

          {/* Per-Agent Pitch Issues Table */}
          {pitchAnalysis.agents.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Agent-wise Pitch Issues</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="px-3 py-1.5">Agent</th>
                      <th className="px-3 py-1.5">Total Issues</th>
                      <th className="px-3 py-1.5">Rejected</th>
                      <th className="px-3 py-1.5">Cold</th>
                      <th className="px-3 py-1.5">Dead</th>
                      <th className="px-3 py-1.5">Callback Captured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pitchAnalysis.agents.map(a => (
                      <tr key={a.name} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium">{a.name}</td>
                        <td className="px-3 py-1.5 font-mono font-bold">{a.total}</td>
                        <td className="px-3 py-1.5 font-mono text-fail">{a.rejected || 0}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-500">{a.cold || 0}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-800">{a.dead || 0}</td>
                        <td className="px-3 py-1.5">
                          <span className={`font-mono font-bold ${a.total > 0 && Math.round((a.withCallback / a.total) * 100) < 50 ? 'text-fail' : 'text-pass'}`}>
                            {a.withCallback}/{a.total} ({a.total > 0 ? Math.round((a.withCallback / a.total) * 100) : 0}%)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Callback Tracker — Grouped by Due Date */}
      {totalCallbacksDue > 0 && (
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Callback Tracker</h2>
            <span className="text-xs text-gray-400">{totalCallbacksDue} callbacks identified from call summaries</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Customers who requested a specific callback date/time. Extracted from call summaries and Callback Due field.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 mb-4">
            {callbackTracker.map(group => (
              <div
                key={group.date}
                onClick={() => {
                  if (group.date === 'unresolved') setFilterCallbackDue('has_callback');
                  else if (group.isOverdue) setFilterCallbackDue('overdue');
                  else if (group.isToday) setFilterCallbackDue('today');
                  else setFilterCallbackDue('has_callback');
                }}
                className={`rounded-lg p-2.5 text-xs cursor-pointer transition-colors hover:ring-2 hover:ring-info/30 ${
                  group.isOverdue ? 'bg-red-50 border border-red-200' :
                  group.isToday ? 'bg-amber-50 border border-amber-200' :
                  'bg-gray-50 border border-gray-200'
                }`}
              >
                <p className={`font-semibold ${group.isOverdue ? 'text-red-700' : group.isToday ? 'text-amber-700' : 'text-gray-700'}`}>
                  {group.label}
                </p>
                <p className={`text-lg font-bold ${group.isOverdue ? 'text-red-600' : group.isToday ? 'text-amber-600' : 'text-gray-900'}`}>
                  {group.records.length}
                </p>
                {group.date !== 'unresolved' && (
                  <p className="text-[10px] text-gray-400">{group.date}</p>
                )}
              </div>
            ))}
          </div>
          {/* Quick list of callbacks with times */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-3 py-1.5">Due</th>
                  <th className="px-3 py-1.5">Time</th>
                  <th className="px-3 py-1.5">Mobile</th>
                  <th className="px-3 py-1.5">Agent</th>
                  <th className="px-3 py-1.5">Call Date</th>
                  <th className="px-3 py-1.5">Label</th>
                  <th className="px-3 py-1.5">Summary</th>
                </tr>
              </thead>
              <tbody>
                {callbackTracker.flatMap(group =>
                  group.records.map(r => (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-1.5">
                        <Chip text={formatCallbackDue(r._callbackWhen)} className={callbackDueColor(r._callbackWhen)} />
                      </td>
                      <td className="px-3 py-1.5 font-mono">{r._callbackWhen?.resolvedTime || '--'}</td>
                      <td className="px-3 py-1.5"><PhoneNumber number={r['Mobile Number']} /></td>
                      <td className="px-3 py-1.5">{r['Agent Name'] || '--'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                      </td>
                      <td className="px-3 py-1.5">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                      <td className="px-3 py-1.5 text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} limit={60} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      {/* Acoustic Intelligence — Agent-Level */}
      {acousticByAgent.length > 0 && (
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Acoustic Intelligence</h2>
            <span className="text-xs text-gray-400">From audio analysis · ideal: ~140 WPM, dead air &lt;10%, overtalk &lt;15%</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-3 py-1.5">Agent</th>
                  <th className="px-3 py-1.5">Health</th>
                  <th className="px-3 py-1.5">Speech Rate</th>
                  <th className="px-3 py-1.5">Dead Air</th>
                  <th className="px-3 py-1.5">Overtalk</th>
                  <th className="px-3 py-1.5">Pitch Hz</th>
                  <th className="px-3 py-1.5">Calls w/ Audio</th>
                </tr>
              </thead>
              <tbody>
                {acousticByAgent.map(a => (
                  <tr key={a.name} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium">{a.name}</td>
                    <td className="px-3 py-1.5">
                      {a.score != null ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 bg-gray-100 rounded-full h-2">
                            <div className={`h-2 rounded-full ${a.score >= 75 ? 'bg-emerald-500' : a.score >= 55 ? 'bg-amber-400' : 'bg-red-500'}`}
                              style={{ width: `${a.score}%` }} />
                          </div>
                          <span className={`font-mono font-bold ${a.score >= 75 ? 'text-emerald-600' : a.score >= 55 ? 'text-amber-500' : 'text-red-500'}`}>
                            {a.score}
                          </span>
                        </div>
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {a.speechRate != null ? (
                        <span className={a.speechRate > 180 ? 'text-red-500' : a.speechRate < 100 ? 'text-amber-500' : 'text-gray-700'}>
                          {a.speechRate} wpm
                        </span>
                      ) : '--'}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {a.deadAir != null ? (
                        <span className={a.deadAir > 20 ? 'text-red-500' : a.deadAir > 10 ? 'text-amber-500' : 'text-emerald-600'}>
                          {a.deadAir}%
                        </span>
                      ) : '--'}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {a.overtalk != null ? (
                        <span className={a.overtalk > 25 ? 'text-red-500' : a.overtalk > 15 ? 'text-amber-500' : 'text-emerald-600'}>
                          {a.overtalk}
                        </span>
                      ) : '--'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-500">{a.pitch != null ? `${a.pitch}` : '--'}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-400">{a.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Intelligence Signals */}
      {(intelStats.competitors.length > 0 || intelStats.lifeEvents.length > 0 || intelStats.highNeed > 0 || intelStats.coachingMoments.length > 0) && (
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Intelligence Signals</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Immediate Need */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Immediate Need</p>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-red-600 font-medium">High (4-5)</span>
                  <span className="font-mono font-bold text-red-600">{intelStats.highNeed}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-amber-600">Medium (2-3)</span>
                  <span className="font-mono text-amber-600">{intelStats.medNeed}</span>
                </div>
                {intelStats.lowDigital > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <p className="text-[10px] text-gray-400 mb-1">Digital Readiness</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-red-500">Low digital</span>
                      <span className="font-mono">{intelStats.lowDigital}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-600">High digital</span>
                      <span className="font-mono">{intelStats.highDigital}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Competitors Mentioned */}
            {intelStats.competitors.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Competitors Mentioned</p>
                <div className="space-y-1">
                  {intelStats.competitors.map(([name, count]) => (
                    <div key={name} className="flex items-center gap-2 text-xs">
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-purple-400 h-2 rounded-full"
                          style={{ width: `${(count / intelStats.competitors[0][1]) * 100}%` }} />
                      </div>
                      <span className="text-gray-600 w-20 truncate">{name}</span>
                      <span className="font-mono font-bold text-purple-600">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Life Events */}
            {intelStats.lifeEvents.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Life Events Detected</p>
                <div className="space-y-1">
                  {intelStats.lifeEvents.map(([event, count]) => (
                    <div key={event} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 capitalize">{event.replace(/_/g, ' ')}</span>
                      <span className="font-mono font-bold text-blue-600">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sentiment Arc Distribution */}
            {emotionalJourneyStats.total > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Sentiment Arcs</p>
                <div className="space-y-1">
                  {emotionalJourneyStats.arcs.map(({ arc, count, pct }) => (
                    <div key={arc} className="flex items-center gap-2 text-xs">
                      <span className={`w-16 ${arc === 'Rising' ? 'text-emerald-600' : arc === 'Declining' ? 'text-red-500' : 'text-gray-600'}`}>
                        {arc}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className={`h-2 rounded-full ${arc === 'Rising' ? 'bg-emerald-400' : arc === 'Declining' ? 'bg-red-400' : arc === 'U-Shape' ? 'bg-blue-400' : 'bg-gray-400'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono w-8 text-right text-gray-500">{pct}%</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {emotionalJourneyStats.risingPct}% improving · {emotionalJourneyStats.decliningPct}% declining
                </p>
              </div>
            )}
          </div>

          {/* Coaching Moments Feed */}
          {intelStats.coachingMoments.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 mb-2">AI Coaching Moments</p>
              <div className="space-y-1.5">
                {intelStats.coachingMoments.slice(0, 5).map((cm, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-gray-400 w-24 shrink-0">{cm.agent}</span>
                    <span className="text-gray-600 italic">"{cm.moment}"</span>
                  </div>
                ))}
              </div>
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
            <select value={filterCallbackDue} onChange={(e) => setFilterCallbackDue(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-info">
              <option value="">All Callbacks</option>
              <option value="has_callback">Has Callback</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due Today</option>
              <option value="tomorrow">Due Tomorrow</option>
              <option value="no_callback">Needs CB (No Date)</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-2">Tag</th>
                <th className="px-4 py-2">Type</th>
                {isMultiDay && <th className="px-4 py-2">Date</th>}
                <th className="px-4 py-2 cursor-pointer select-none hover:text-gray-800" onClick={() => toggleSort('time')}>Time{sortArrow('time')}</th>
                <th className="px-4 py-2">Agent</th>
                <th className="px-4 py-2">Mobile</th>
                <th className="px-4 py-2 cursor-pointer select-none hover:text-gray-800" onClick={() => toggleSort('duration')}>Duration{sortArrow('duration')}</th>
                <th className="px-4 py-2">Outcome</th>
                <th className="px-4 py-2">Sent.</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">CB Due</th>
                <th className="px-4 py-2">QA</th>
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={isMultiDay ? 14 : 13} className="px-4 py-8 text-center text-gray-400">No calls match your filters</td></tr>
              )}
              {visible.map((r, i) => (
                <React.Fragment key={r.id || i}>
                  <tr
                    onClick={() => setExpanded(expanded === i ? null : i)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-2"><Chip text={r._tag} className={callTagColor(r._tag)} /></td>
                    <td className="px-4 py-2"><Chip text={r._subType} className={subscriberTypeColor(r._subType)} /></td>
                    {isMultiDay && (
                      <td className="px-4 py-2 whitespace-nowrap text-xs">
                        {r['Call Date'] ? new Date(r['Call Date'] + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '--'}
                      </td>
                    )}
                    <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Time'] || '--'}</td>
                    <td className="px-4 py-2 text-xs">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2">
                      <PhoneNumber number={r['Mobile Number']} />
                      {mobileCounts[String(r['Mobile Number'] || '')] > 1 && (
                        <span className="ml-1 text-[9px] font-bold text-gray-400">&times;{mobileCounts[String(r['Mobile Number'] || '')]}</span>
                      )}
                    </td>
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
                    <td className="px-4 py-2">
                      {r._callbackWhen ? (
                        <Chip text={formatCallbackDue(r._callbackWhen)} className={callbackDueColor(r._callbackWhen)} />
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-2">
                      {r._qs > 0 ? (
                        <span className={`font-mono text-xs font-bold ${r._qr === 'PASS' ? 'text-pass' : r._qr === 'AMBER' ? 'text-amber' : 'text-fail'}`}>{r._qs}/6</span>
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-2">
                      {r['Call Label'] ? (
                        <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} />
                      ) : <span className="text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} limit={60} /></td>
                  </tr>
                  {expanded === i && (
                    <tr className="bg-gray-50">
                      <td colSpan={isMultiDay ? 14 : 13} className="px-4 py-4">
                        <div className="grid gap-3 text-xs max-w-4xl">
                          <div className="flex flex-wrap gap-4 items-center">
                            {r['Call Label'] && <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} />}
                            <Chip text={r._tag} className={callTagColor(r._tag)} />
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
                          {r['QA Score'] != null && (
                            <div className="flex flex-wrap gap-4 items-center">
                              <span>QA Score: <b className={r['QA Score'] >= 70 ? 'text-pass' : r['QA Score'] >= 50 ? 'text-amber-600' : 'text-fail'}>{r['QA Score']}/100</b></span>
                              {r['QA Pass'] != null && (
                                <Chip text={r['QA Pass'] ? 'PASS' : 'FAIL'} className={r['QA Pass'] ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} />
                              )}
                              {r['Coaching Priority'] && <Chip text={`Priority: ${r['Coaching Priority']}`} className={r['Coaching Priority'] === 'High' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'} />}
                            </div>
                          )}
                          {(r['Agent Talk %'] != null || r['Sentiment Delta'] != null) && (
                            <div className="flex flex-wrap gap-4 text-gray-600">
                              {r['Agent Talk %'] != null && <span>Agent Talk: <b>{r['Agent Talk %']}%</b></span>}
                              {r['Subscriber Talk %'] != null && <span>Sub Talk: <b>{r['Subscriber Talk %']}%</b></span>}
                              {r['Monologue Segments'] != null && <span>Monologues: <b>{r['Monologue Segments']}</b></span>}
                              {r['Turn Count'] != null && <span>Turns: <b>{r['Turn Count']}</b></span>}
                              {r['Sentiment Delta'] != null && (
                                <span>Sentiment \u0394: <b className={r['Sentiment Delta'] >= 0 ? 'text-pass' : 'text-fail'}>{r['Sentiment Delta'] >= 0 ? '+' : ''}{r['Sentiment Delta']}</b></span>
                              )}
                              {r['Drop Stage'] && <span>Drop: <b>{r['Drop Stage']}</b></span>}
                            </div>
                          )}
                          {(r['Speech Rate WPM'] != null || r['Dead Air %'] != null) && (
                            <div className="flex flex-wrap gap-4 text-gray-600">
                              <span className="font-semibold text-gray-500">Acoustic:</span>
                              {r['Speech Rate WPM'] != null && <span>Speech: <b>{r['Speech Rate WPM']} wpm</b></span>}
                              {r['Pitch Mean Hz'] != null && <span>Pitch: <b>{r['Pitch Mean Hz']} Hz</b></span>}
                              {r['Dead Air %'] != null && <span>Dead Air: <b className={r['Dead Air %'] > 15 ? 'text-fail' : 'text-pass'}>{r['Dead Air %']}%</b></span>}
                              {r['Overtalk %'] != null && <span>Overtalk: <b className={r['Overtalk %'] > 10 ? 'text-fail' : 'text-pass'}>{r['Overtalk %']}%</b></span>}
                            </div>
                          )}
                          {r['Compliance Detail'] && (
                            <p className="text-fail font-semibold">Compliance: {r['Compliance Detail']}</p>
                          )}
                          {r['Summary'] && (
                            <div>
                              <p className="font-semibold text-gray-600">Summary</p>
                              <p className="text-gray-700">{r['Summary']}</p>
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-gray-600 mb-1">Transcript</p>
                            <TranscriptViewer transcript={r['Transcript']} agentName={r['Agent Name']} />
                          </div>
                          {r['Emotional Journey'] && (
                            <EmotionalJourneyChart journeyJson={r['Emotional Journey']} />
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
                            {r._callbackWhen && (
                              <Chip text={`CB Due: ${formatCallbackDue(r._callbackWhen)}`} className={callbackDueColor(r._callbackWhen)} />
                            )}
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
