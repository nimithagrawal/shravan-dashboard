import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import IntradayProgress from './IntradayProgress';
import AgentCallbackBriefing from './AgentCallbackBriefing';
import PostActivationWasteAlert from './PostActivationWasteAlert';
import { fetchTodaySnapshots } from '../lib/snapshots';
import { computeCallbackHonorStats } from '../lib/helpers';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, Tooltip as ReTooltip,
} from 'recharts';

// ─────────────────────────── constants ───────────────────────────

const ALERT_COLORS = {
  CRITICAL: '#DC2626', WARNING: '#D97706', WATCH: '#EA580C', OK: '#16A34A',
};
const ALERT_ORDER = { CRITICAL: 0, WARNING: 1, WATCH: 2, OK: 3 };
const TREND_ICONS = { Improving: '📈', Flat: '➡️', Declining: '📉' };
const Q_LABELS = {
  Q1: 'Agent Screened', Q2: 'Cashback Correct', Q3: 'WA Link Sent',
  Q4: 'Hi Attempt Made', Q5: 'Cashback Mechanic', Q6: 'No Improvised Claims',
};
const PERIOD_LABELS = { today: 'Today', week: 'Week-on-Week', month: 'Month-on-Month' };

// ─────────────────────────── pure helpers ───────────────────────────

function isAfter610PM() {
  const now = new Date(Date.now() + 5.5 * 3600000);
  const h = now.getUTCHours(); const m = now.getUTCMinutes();
  return h > 18 || (h === 18 && m >= 10);
}

function detectAgentDept(agentName, wcRecords, utilRecords) {
  const wc = wcRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName).length;
  const ut = utilRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName).length;
  if (wc === 0 && ut === 0) return null;
  return wc >= ut ? 'welcome' : 'util';
}

function computeAgentPeriodStats(agentName, allRecords, wcRecords, utilRecords, cbHonorStats) {
  const agentAll  = allRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName);
  const agentWC   = wcRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName);
  const agentUtil = utilRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName);
  const total   = agentAll.length;
  const wcTotal = agentWC.length;
  const utilTotal = agentUtil.length;
  const dept = wcTotal >= utilTotal ? 'welcome' : 'util';

  const connected = agentAll.filter(r => {
    const o = (r.fields?.['Call Outcome'] || '').toLowerCase();
    return !o.includes('dnp') && !o.includes('did not') && !o.includes('no answer') && !o.includes('no-answer');
  }).length;
  const connectionRate = total > 0 ? Math.round(connected / total * 100) : 0;
  const dnpRate = total > 0 ? Math.round((total - connected) / total * 100) : 0;

  // unique phones + attempt depth
  const phoneAttempts = {};
  for (const r of agentAll) {
    const phone = r.fields?.['Phone Number'] || r.fields?.['Mobile Number'] || '';
    if (phone) phoneAttempts[phone] = (phoneAttempts[phone] || 0) + 1;
  }
  const uniqueSubscribers = Object.keys(phoneAttempts).length;
  const avgAttempts = uniqueSubscribers > 0
    ? (Object.values(phoneAttempts).reduce((s, v) => s + v, 0) / uniqueSubscribers).toFixed(1) : 0;
  const highAttemptPct = uniqueSubscribers > 0
    ? Math.round(Object.values(phoneAttempts).filter(v => v >= 6).length / uniqueSubscribers * 100) : 0;

  // WC-specific
  const pitchCompleted  = agentWC.filter(r => (r.fields?.['Pitch Completion Score'] || 0) >= 80).length;
  const pitchCompletionPct = agentWC.length > 0 ? Math.round(pitchCompleted / agentWC.length * 100) : null;
  const consentClear = agentWC.filter(r => (r.fields?.['Consent Score'] || 0) >= 7).length;
  const consentRate  = agentWC.length > 0 ? Math.round(consentClear / agentWC.length * 100) : null;
  const activations  = agentWC.filter(r =>
    (r.fields?.['Activation Status'] || '').toLowerCase().includes('activated')
  ).length;
  const activationRate = agentWC.length > 0 ? Math.round(activations / agentWC.length * 100) : null;

  // Util-specific
  const engagedCalls = agentUtil.filter(r => (r.fields?.['Talk Time'] || 0) > 120).length;
  const engagementRate = agentUtil.length > 0 ? Math.round(engagedCalls / agentUtil.length * 100) : null;
  const sentCalls = agentUtil.filter(r =>
    r.fields?.['Sentiment Score Start'] != null && r.fields?.['Sentiment Score End'] != null
  );
  const avgSentimentDelta = sentCalls.length > 0
    ? (sentCalls.reduce((s, r) =>
        s + ((r.fields?.['Sentiment Score End'] || 0) - (r.fields?.['Sentiment Score Start'] || 0)), 0
      ) / sentCalls.length).toFixed(2)
    : null;
  const channels = { pharmacy: 0, diagnostics: 0, healthcare: 0 };
  for (const r of agentUtil) {
    const sum = (r.fields?.['Summary'] || '').toLowerCase();
    if (sum.includes('pharmacy') || sum.includes('medicine') || sum.includes('medic')) channels.pharmacy++;
    else if (sum.includes('diagnostic') || sum.includes('test') || sum.includes('lab')) channels.diagnostics++;
    else if (sum.includes('hospital') || sum.includes('opd') || sum.includes('surgery') || sum.includes('doctor')) channels.healthcare++;
  }

  // QA from records
  const qaRecs = agentAll.filter(r => r.fields?.['QA Score'] != null);
  const avgQA  = qaRecs.length > 0
    ? (qaRecs.reduce((s, r) => s + (r.fields?.['QA Score'] || 0), 0) / qaRecs.length).toFixed(1)
    : null;

  const cbStats = cbHonorStats?.byAgent?.[agentName] || null;

  return {
    agentName, dept, total, wcTotal, utilTotal, connected, connectionRate,
    dnpRate, avgAttempts, highAttemptPct, uniqueSubscribers,
    pitchCompletionPct, consentRate, activations, activationRate,
    engagementRate, avgSentimentDelta, channels, avgQA, cbStats,
  };
}

function buildRadarData(stats) {
  const cb = stats.cbStats ? Math.round(stats.cbStats.rate * 100) : 0;
  if (stats.dept === 'welcome') {
    return [
      { subject: 'Connection',  value: stats.connectionRate  || 0, fullMark: 100 },
      { subject: 'Pitch Done',  value: stats.pitchCompletionPct ?? 0, fullMark: 100 },
      { subject: 'Consent',     value: stats.consentRate     ?? 0, fullMark: 100 },
      { subject: 'Activation',  value: stats.activationRate  ?? 0, fullMark: 100 },
      { subject: 'DNP 6+',      value: stats.highAttemptPct  || 0, fullMark: 100 },
      { subject: 'Callback',    value: cb, fullMark: 100 },
    ];
  }
  return [
    { subject: 'Connection',   value: stats.connectionRate || 0, fullMark: 100 },
    { subject: 'Engagement',   value: stats.engagementRate ?? 0, fullMark: 100 },
    { subject: 'Pharma',       value: stats.total > 0 ? Math.round(stats.channels.pharmacy   / stats.total * 100) : 0, fullMark: 100 },
    { subject: 'Diagnostics',  value: stats.total > 0 ? Math.round(stats.channels.diagnostics/ stats.total * 100) : 0, fullMark: 100 },
    { subject: 'DNP 6+',       value: stats.highAttemptPct || 0, fullMark: 100 },
    { subject: 'Callback',     value: cb, fullMark: 100 },
  ];
}

// ─────────────────────────── micro components ───────────────────────────

function DeptBadge({ dept }) {
  if (!dept) return null;
  const cfg = dept === 'welcome'
    ? { bg: '#EFF6FF', color: '#1D4ED8', label: 'Welcome Call' }
    : { bg: '#F0FDFA', color: '#0F766E', label: 'Utilization' };
  return (
    <span style={{ background: cfg.bg, color: cfg.color, fontSize: 10, fontWeight: 600,
      borderRadius: 3, padding: '1px 6px', marginLeft: 6, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || '#111827' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#9CA3AF' }}>{sub}</div>}
    </div>
  );
}

function QBar({ label, pct, isTopMiss }) {
  if (pct === null || pct === undefined) return null;
  const color = pct >= 70 ? '#16A34A' : pct >= 40 ? '#D97706' : '#DC2626';
  const bars = Math.round(pct / 10);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ width: 130, fontSize: 12, fontWeight: isTopMiss ? 700 : 400, whiteSpace: 'nowrap' }}>
        {label}: {Q_LABELS[label] || ''}
      </span>
      <div style={{ display: 'flex', gap: 1 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ width: 8, height: 10, borderRadius: 1,
            background: i < bars ? color : '#E5E7EB' }} />
        ))}
      </div>
      <span style={{ fontSize: 12, color, fontWeight: isTopMiss ? 700 : 400 }}>
        {pct}%{isTopMiss ? ' ←' : ''}
      </span>
    </div>
  );
}

function AgentRadar({ agentName, wcRecords, utilRecords, periodRecords, cbHonorStats, deptOverride }) {
  const stats = useMemo(() => {
    const agentAll  = periodRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName);
    const agentWC   = wcRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName);
    const agentUtil = utilRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName);
    const total = agentAll.length;
    const dept  = deptOverride || (agentWC.length >= agentUtil.length ? 'welcome' : 'util');

    const phoneAttempts = {};
    for (const r of agentAll) {
      const phone = r.fields?.['Phone Number'] || r.fields?.['Mobile Number'] || '';
      if (phone) phoneAttempts[phone] = (phoneAttempts[phone] || 0) + 1;
    }
    const uniquePhones = Object.keys(phoneAttempts).length;
    const highAttemptPct = uniquePhones > 0
      ? Math.round(Object.values(phoneAttempts).filter(v => v >= 6).length / uniquePhones * 100) : 0;

    const connected = agentAll.filter(r => {
      const o = (r.fields?.['Call Outcome'] || '').toLowerCase();
      return !o.includes('dnp') && !o.includes('did not') && !o.includes('no answer');
    }).length;

    const pitchCompleted = agentWC.filter(r => (r.fields?.['Pitch Completion Score'] || 0) >= 80).length;
    const consentClear   = agentWC.filter(r => (r.fields?.['Consent Score'] || 0) >= 7).length;
    const activations    = agentWC.filter(r =>
      (r.fields?.['Activation Status'] || '').toLowerCase().includes('activated')
    ).length;
    const engagedCalls   = agentUtil.filter(r => (r.fields?.['Talk Time'] || 0) > 120).length;

    const channels = { pharmacy: 0, diagnostics: 0, healthcare: 0 };
    for (const r of agentUtil) {
      const s = (r.fields?.['Summary'] || '').toLowerCase();
      if (s.includes('pharmacy') || s.includes('medicine')) channels.pharmacy++;
      else if (s.includes('diagnostic') || s.includes('test') || s.includes('lab')) channels.diagnostics++;
      else if (s.includes('hospital') || s.includes('opd') || s.includes('surgery')) channels.healthcare++;
    }

    return {
      dept,
      connectionRate:    total > 0 ? Math.round(connected / total * 100) : 0,
      pitchCompletionPct: agentWC.length > 0 ? Math.round(pitchCompleted / agentWC.length * 100) : 0,
      consentRate:        agentWC.length > 0 ? Math.round(consentClear / agentWC.length * 100) : 0,
      activationRate:     agentWC.length > 0 ? Math.round(activations / agentWC.length * 100) : 0,
      engagementRate:     agentUtil.length > 0 ? Math.round(engagedCalls / agentUtil.length * 100) : 0,
      highAttemptPct,
      channels, total,
      cbStats: cbHonorStats?.byAgent?.[agentName] || null,
    };
  }, [agentName, wcRecords, utilRecords, periodRecords, cbHonorStats, deptOverride]);

  const radarData = buildRadarData(stats);
  const color = stats.dept === 'welcome' ? '#1D4ED8' : '#0F766E';

  return (
    <div style={{ height: 200, marginBottom: 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={radarData}>
          <PolarGrid stroke="#E5E7EB" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#6B7280' }} />
          <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.2} />
          <ReTooltip formatter={(v) => [`${v}%`, '']} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DnpCallbackStrip({ agentName, periodRecords, cbHonorStats }) {
  const agentRecords = periodRecords.filter(r => (r.fields?.['Agent Name'] || '') === agentName);
  const phoneAttempts = {};
  for (const r of agentRecords) {
    const phone = r.fields?.['Phone Number'] || r.fields?.['Mobile Number'] || '';
    if (phone) phoneAttempts[phone] = (phoneAttempts[phone] || 0) + 1;
  }
  const uniquePhones    = Object.keys(phoneAttempts).length;
  const highAttemptCount = Object.values(phoneAttempts).filter(v => v >= 6).length;
  const highAttemptPct   = uniquePhones > 0 ? Math.round(highAttemptCount / uniquePhones * 100) : 0;
  const cbStats = cbHonorStats?.byAgent?.[agentName];
  const cbRate  = cbStats ? Math.round(cbStats.rate * 100) : null;

  if (uniquePhones === 0 && cbRate === null) return null;

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' }}>
      {uniquePhones > 0 && (
        <div style={{
          background: highAttemptPct >= 40 ? '#F0FDF4' : '#FEF3C7',
          border: `1px solid ${highAttemptPct >= 40 ? '#BBF7D0' : '#FDE68A'}`,
          borderRadius: 4, padding: '3px 10px', fontSize: 11,
        }}>
          <span style={{ color: '#6B7280' }}>DNP Persist </span>
          <strong style={{ color: highAttemptPct >= 40 ? '#15803D' : '#B45309' }}>
            {highAttemptPct}%
          </strong>
          <span style={{ color: '#9CA3AF' }}> ({highAttemptCount}/{uniquePhones} reached 6+)</span>
        </div>
      )}
      {cbRate !== null && (
        <div style={{
          background: cbRate >= 80 ? '#F0FDF4' : cbRate >= 60 ? '#FEF3C7' : '#FEF2F2',
          border: `1px solid ${cbRate >= 80 ? '#BBF7D0' : cbRate >= 60 ? '#FDE68A' : '#FECACA'}`,
          borderRadius: 4, padding: '3px 10px', fontSize: 11,
        }}>
          <span style={{ color: '#6B7280' }}>Callback Honor </span>
          <strong style={{ color: cbRate >= 80 ? '#15803D' : cbRate >= 60 ? '#B45309' : '#DC2626' }}>
            {cbRate}%
          </strong>
          <span style={{ color: '#9CA3AF' }}> ({cbStats.onTime}/{cbStats.total} on time)</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── TODAY agent card ───────────────────────────

function AgentCard({ record, isAgent, dept, wcRecords, utilRecords, cbHonorStats, periodRecords }) {
  const f = record;
  const [expanded, setExpanded] = useState(false);
  const [showViolations, setShowViolations] = useState(false);
  const [showRadar, setShowRadar] = useState(false);

  const alertLevel    = f['Alert Level'] || 'OK';
  const borderColor   = ALERT_COLORS[alertLevel] || '#E5E7EB';
  const qaAvg         = f['QA Score Today'] || 0;
  const scored        = f['QA Scored Calls'] || 0;
  const coverage      = f['QA Coverage Pct'] || 0;
  const trend         = f['Trend'] || '—';
  const qa7d          = f['QA Score 7d Avg'];
  const trackingDay   = f['Tracking Day'] || 1;
  const intradayAlert = f['Intraday Alert'] || '';
  const complianceCount = f['Compliance Count Today'] || 0;
  const topMiss       = f['Top Miss'] || '';
  const coachingBrief = f['Coaching Brief'] || '';
  const actionPoints  = f['Action Points'] || '';
  const patternFlag   = f['Pattern Flag'] || '';
  const worstPattern  = f['Worst Pattern'] || '';
  const bestCallId    = f['Best Call ID'] || '';
  const bestCallURL   = f['Best Call Recording URL'] || '';
  const agentName     = f['Agent Name'] || '';
  const trendIcon     = TREND_ICONS[trend] || '';
  const after610      = isAfter610PM();
  const topMissLabel  = topMiss.match(/Q\d/)?.[0];

  const qFields = ['Q1','Q2','Q3','Q4','Q5','Q6'].map(q => ({
    label: q, pct: f[`${q} Pass Pct`],
  }));

  return (
    <div style={{ border: `2px solid ${borderColor}`, borderRadius: 8, padding: 16,
      marginBottom: 12, background: '#fff' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{agentName}</span>
          <DeptBadge dept={dept} />
          {trendIcon && <span style={{ fontSize: 14 }}>{trendIcon}</span>}
          {trackingDay <= 7 && (
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>Day {trackingDay}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setShowRadar(!showRadar)}
            style={{ padding: '2px 8px', fontSize: 11, borderRadius: 3,
              border: '1px solid #D1D5DB',
              background: showRadar ? '#EFF6FF' : '#F9FAFB',
              color: '#374151', cursor: 'pointer' }}>
            {showRadar ? 'Hide Radar' : 'Radar'}
          </button>
          <span style={{ background: borderColor, color: '#fff', borderRadius: 4,
            padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
            {alertLevel}
          </span>
        </div>
      </div>

      {/* Radar (optional) */}
      {showRadar && (
        <AgentRadar
          agentName={agentName}
          wcRecords={wcRecords} utilRecords={utilRecords}
          periodRecords={periodRecords}
          cbHonorStats={cbHonorStats}
          deptOverride={dept}
        />
      )}

      {/* QA summary */}
      {(() => {
        const disputed = f['Disputed Calls'] || 0;
        const csp      = f['CSP Calls'] || 0;
        const lb       = f['Language Barrier Calls'] || 0;
        const excluded = disputed + csp + lb;
        const parts = [];
        if (csp > 0)      parts.push(`${csp} Agent/CSP`);
        if (disputed > 0) parts.push(`${disputed} Disputed`);
        if (lb > 0)       parts.push(`${lb} Lang Barrier`);
        return (
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
            QA: <strong>{qaAvg}/6</strong> ({scored} Full Pitch calls)
            {excluded > 0 && (
              <span style={{ color: '#9CA3AF', fontSize: 11 }}>
                &nbsp;&nbsp;|&nbsp;&nbsp;+{excluded} excluded ({parts.join(', ')})
              </span>
            )}
            &nbsp;&nbsp;|&nbsp;&nbsp;Coverage: {coverage}%{coverage < 50 ? ' ⚠️' : ''}
            &nbsp;&nbsp;|&nbsp;&nbsp;7d avg: <strong>{qa7d != null ? `${qa7d}/6` : '—'}</strong>
            {trackingDay <= 7 && <span style={{ color: '#9CA3AF' }}> (establishing baseline)</span>}
          </div>
        );
      })()}

      {/* Q bars */}
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 6 }}>
        {qFields.map(({ label, pct }) => (
          <QBar key={label} label={label} pct={pct} isTopMiss={label === topMissLabel} />
        ))}
      </div>

      {/* DNP + Callback strip */}
      <DnpCallbackStrip
        agentName={agentName}
        periodRecords={periodRecords}
        cbHonorStats={cbHonorStats}
      />

      {/* Call mix badges */}
      {(() => {
        const disputed = f['Disputed Calls'] || 0;
        const csp      = f['CSP Calls'] || 0;
        const lb       = f['Language Barrier Calls'] || 0;
        if (disputed === 0 && csp === 0 && lb === 0) return null;
        return (
          <div style={{ display: 'flex', gap: 8, marginTop: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            {disputed > 0 && (
              <span style={{ background: '#FEF2F2', color: '#B91C1C', fontSize: 11,
                borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
                ⚠️ {disputed} Disputed
              </span>
            )}
            {csp > 0 && (
              <span style={{ background: '#F5F3FF', color: '#7C3AED', fontSize: 11,
                borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
                🏪 {csp} Agent/CSP
              </span>
            )}
            {lb > 0 && (
              <span style={{ background: '#F0FDFA', color: '#0F766E', fontSize: 11,
                borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
                🗣️ {lb} Language Barrier
              </span>
            )}
          </div>
        );
      })()}

      <IntradayProgress agentName={agentName} />

      {!isAgent && complianceCount > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4,
          padding: '4px 8px', fontSize: 12, color: '#B91C1C', marginBottom: 6 }}>
          🚨 {complianceCount} compliance violation(s) today
        </div>
      )}
      {intradayAlert && !after610 && (
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>{intradayAlert}</div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {after610 && coachingBrief.length > 0 && (
          <button onClick={() => setExpanded(!expanded)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4,
              background: '#1D4ED8', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {expanded ? 'Hide Brief ↑' : 'View Full Brief ↓'}
          </button>
        )}
        {!after610 && (
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>Coaching brief available after 6:10 PM</span>
        )}
        {bestCallURL && (
          <a href={bestCallURL} target="_blank" rel="noreferrer"
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4,
              background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', textDecoration: 'none' }}>
            🎧 Best call ({bestCallId})
          </a>
        )}
        {!isAgent && complianceCount > 0 && (
          <button onClick={() => setShowViolations(!showViolations)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4,
              background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA', cursor: 'pointer' }}>
            {showViolations ? 'Hide Violations ↑' : `Violations (${complianceCount}) →`}
          </button>
        )}
      </div>

      {/* Violations detail */}
      {showViolations && complianceCount > 0 && (
        <div style={{ marginTop: 10, padding: 10, background: '#FEF2F2',
          borderRadius: 6, borderLeft: '3px solid #DC2626' }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#B91C1C', marginBottom: 6 }}>
            COMPLIANCE VIOLATIONS ({complianceCount})
          </div>
          <div style={{ fontSize: 12, color: '#7F1D1D', lineHeight: 1.6 }}>
            {complianceCount} violation(s) flagged today for {agentName}.
            Review recordings before next shift.
          </div>
          {intradayAlert && (
            <div style={{ fontSize: 12, color: '#991B1B', marginTop: 6, fontStyle: 'italic' }}>
              {intradayAlert}
            </div>
          )}
        </div>
      )}

      {/* Expanded coaching brief */}
      {expanded && coachingBrief.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, background: '#F9FAFB',
          borderRadius: 6, borderLeft: '3px solid #1D4ED8' }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 10 }}>
            {coachingBrief}
          </div>
          {actionPoints && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>ACTION POINTS</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{actionPoints}</div>
            </div>
          )}
          {patternFlag && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 4,
              padding: '6px 10px', fontSize: 12, color: '#92400E' }}>
              ⚠️ PATTERN FLAG: {patternFlag}
            </div>
          )}
          {!isAgent && worstPattern && (
            <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 4,
              padding: '6px 10px', fontSize: 12, color: '#B91C1C', marginTop: 6 }}>
              🔁 STUCK PATTERN: {worstPattern}
            </div>
          )}
        </div>
      )}

      {/* HiL Review badge */}
      {(() => {
        const hilCount = f['HiL Review Count Today'] || 0;
        const hilCaught = f['HiL Compliance Caught'] || 0;
        return hilCount > 0 ? (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE',
            borderRadius: 4, padding: '6px 10px', marginTop: 6, fontSize: 11 }}>
            🔍 <strong>{hilCount} calls human-reviewed today</strong>
            {hilCaught > 0 && (
              <span style={{ color: '#DC2626', marginLeft: 8 }}>
                {hilCaught} compliance issue(s) found
              </span>
            )}
          </div>
        ) : null;
      })()}

      <AgentCallbackBriefing agentName={agentName} />
    </div>
  );
}

// ─────────────────────────── WoW / MoM agent card ───────────────────────────

function PeriodAgentCard({ stats, isAgent, period }) {
  const [showRadar, setShowRadar] = useState(false);
  const {
    agentName, dept, total, uniqueSubscribers, connectionRate,
    highAttemptPct, avgAttempts, pitchCompletionPct, consentRate,
    activations, activationRate, engagementRate, avgSentimentDelta,
    channels, avgQA, cbStats,
  } = stats;

  const cbRate = cbStats ? Math.round(cbStats.rate * 100) : null;
  const accentColor = dept === 'welcome' ? '#1D4ED8' : '#0F766E';
  const cardBorder  = dept === 'welcome' ? '#BFDBFE' : '#99F6E4';
  const periodLabel = period === 'week' ? 'this week' : 'this month';

  // Pre-build radar data since we already have the computed stats
  const radarData = buildRadarData(stats);

  return (
    <div style={{ border: `2px solid ${cardBorder}`, borderRadius: 8, padding: 16,
      marginBottom: 12, background: '#fff' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{agentName}</span>
          <DeptBadge dept={dept} />
        </div>
        <button onClick={() => setShowRadar(!showRadar)}
          style={{ padding: '2px 8px', fontSize: 11, borderRadius: 3,
            border: '1px solid #D1D5DB',
            background: showRadar ? '#EFF6FF' : '#F9FAFB',
            color: '#374151', cursor: 'pointer' }}>
          {showRadar ? 'Hide Radar' : 'Radar'}
        </button>
      </div>

      {/* Radar */}
      {showRadar && (
        <div style={{ height: 200, marginBottom: 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="#E5E7EB" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#6B7280' }} />
              <Radar dataKey="value" stroke={accentColor} fill={accentColor} fillOpacity={0.2} />
              <ReTooltip formatter={(v) => [`${v}%`, '']} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 6 }}>
        <Kpi label="Total Calls"       value={total}        sub={`${uniqueSubscribers} unique numbers`} />
        <Kpi label="Connection Rate"   value={`${connectionRate}%`}
          sub={`${Math.round(total * connectionRate / 100)} connected`}
          color={connectionRate >= 70 ? '#15803D' : connectionRate >= 50 ? '#B45309' : '#DC2626'} />
        <Kpi label="DNP Persistence"   value={`${highAttemptPct}%`}
          sub={`avg ${avgAttempts} attempts`}
          color={highAttemptPct >= 40 ? '#15803D' : '#B45309'} />

        {dept === 'welcome' && pitchCompletionPct !== null && (
          <Kpi label="Pitch Complete" value={`${pitchCompletionPct}%`} sub="≥80% score"
            color={pitchCompletionPct >= 60 ? '#15803D' : pitchCompletionPct >= 40 ? '#B45309' : '#DC2626'} />
        )}
        {dept === 'welcome' && consentRate !== null && (
          <Kpi label="Consent Clear" value={`${consentRate}%`} sub="score ≥7"
            color={consentRate >= 50 ? '#15803D' : consentRate >= 30 ? '#B45309' : '#DC2626'} />
        )}
        {dept === 'welcome' && activationRate !== null && (
          <Kpi label="Activated" value={`${activationRate}%`} sub={`${activations} total`}
            color={activationRate >= 20 ? '#15803D' : activationRate >= 10 ? '#B45309' : '#DC2626'} />
        )}

        {dept === 'util' && engagementRate !== null && (
          <Kpi label="Engagement" value={`${engagementRate}%`} sub=">2min calls"
            color={engagementRate >= 50 ? '#15803D' : engagementRate >= 30 ? '#B45309' : '#DC2626'} />
        )}
        {dept === 'util' && avgSentimentDelta !== null && (
          <Kpi label="Sentiment Δ"
            value={parseFloat(avgSentimentDelta) > 0 ? `+${avgSentimentDelta}` : `${avgSentimentDelta}`}
            sub="avg per call"
            color={parseFloat(avgSentimentDelta) > 0 ? '#15803D' : '#DC2626'} />
        )}
        {dept === 'util' && (
          <Kpi label="Channels"
            value={`${channels.pharmacy}💊 ${channels.diagnostics}🔬 ${channels.healthcare}🏥`}
            sub="pharma / diag / care" />
        )}

        {cbRate !== null && (
          <Kpi label="Callback Honor" value={`${cbRate}%`}
            sub={`${cbStats.onTime}/${cbStats.total} on time`}
            color={cbRate >= 80 ? '#15803D' : cbRate >= 60 ? '#B45309' : '#DC2626'} />
        )}
        {avgQA !== null && (
          <Kpi label="Avg QA Score" value={`${avgQA}/6`} sub={periodLabel}
            color={parseFloat(avgQA) >= 4 ? '#15803D' : parseFloat(avgQA) >= 3 ? '#B45309' : '#DC2626'} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── BiggestMovesPanel ───────────────────────────

function BiggestMovesPanel({ userRole }) {
  const [allMoves, setAllMoves] = useState([]);
  const isAgent = userRole === 'AGENT';

  useEffect(() => {
    if (isAgent) return;
    fetchTodaySnapshots(null).then(snaps => {
      const byAgent = {};
      for (const s of snaps) {
        const a = s['Agent Name'];
        if (!byAgent[a]) byAgent[a] = [];
        byAgent[a].push(s);
      }
      const moves = [];
      for (const [agent, agentSnaps] of Object.entries(byAgent)) {
        agentSnaps.sort((a, b) => (a['Window Number'] || 0) - (b['Window Number'] || 0));
        for (let i = 1; i < agentSnaps.length; i++) {
          const prev = agentSnaps[i - 1]; const curr = agentSnaps[i];
          for (const q of ['Q1','Q2','Q3','Q4','Q5','Q6']) {
            const p = prev[`${q} Cumulative Pct`] ?? null;
            const c = curr[`${q} Cumulative Pct`] ?? null;
            if (p === null || c === null) continue;
            const d = parseFloat((c - p).toFixed(1));
            if (Math.abs(d) >= 5) moves.push({ agent, q, delta: d, time: curr['Snapshot Time'] });
          }
        }
      }
      moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      setAllMoves(moves.slice(0, 5));
    });
  }, [isAgent]);

  if (isAgent || !allMoves.length) return null;

  return (
    <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB',
      borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Biggest Moves Today
      </div>
      {allMoves.map((m, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
          fontSize: 12, marginBottom: 4, color: '#374151' }}>
          <span>
            <strong>{m.agent}</strong>&nbsp; {m.q}&nbsp;
            <span style={{ color: '#9CA3AF' }}>{m.time} window</span>
          </span>
          <span style={{ fontWeight: 700, color: m.delta > 0 ? '#16A34A' : '#DC2626' }}>
            {m.delta > 0 ? '+' : ''}{m.delta}% {m.delta > 0 ? '↑' : '↓'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── main export ───────────────────────────

export default function AgentReview({
  data = [],
  periodRecords = [], wcRecords = [], utilRecords = [],
  teamConfig = [],
  userRole, userAgentName, userDepartment,
  period = 'today', periodStart, periodEnd,
}) {
  const { role: authRole, agentName: authAgentName } = useAuth();
  const role      = userRole || authRole;
  const agentName = userAgentName || authAgentName;
  const isAgent   = role === 'AGENT';

  // Internal period selector (independent from the page-level period)
  const [activePeriod, setActivePeriod] = useState('today');

  // Callback honor stats computed from period records
  const cbHonorStats = useMemo(() =>
    computeCallbackHonorStats(periodRecords), [periodRecords]);

  // Dept map per agent name
  const agentDeptMap = useMemo(() => {
    const names = new Set([
      ...periodRecords.map(r => r.fields?.['Agent Name'] || ''),
      ...(data || []).map(r => r['Agent Name'] || ''),
    ]);
    const map = {};
    for (const name of names) {
      if (name) map[name] = detectAgentDept(name, wcRecords, utilRecords);
    }
    return map;
  }, [periodRecords, data, wcRecords, utilRecords]);

  // TODAY — snapshot-based cards
  const visibleData = useMemo(() => {
    const d = data || [];
    return isAgent && agentName
      ? d.filter(r => (r['Agent Name'] || '').toLowerCase() === agentName.toLowerCase())
      : d;
  }, [data, isAgent, agentName]);

  const sortedToday = useMemo(() => [...visibleData].sort((a, b) =>
    (ALERT_ORDER[a['Alert Level'] || 'OK'] ?? 4) - (ALERT_ORDER[b['Alert Level'] || 'OK'] ?? 4)
  ), [visibleData]);

  // WoW / MoM — record-derived cards
  const agentPeriodStats = useMemo(() => {
    if (activePeriod === 'today') return [];
    const names = new Set(periodRecords.map(r => r.fields?.['Agent Name'] || '').filter(Boolean));
    return [...names]
      .map(name => computeAgentPeriodStats(name, periodRecords, wcRecords, utilRecords, cbHonorStats))
      .filter(s => s.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [activePeriod, periodRecords, wcRecords, utilRecords, cbHonorStats]);

  const visiblePeriodStats = useMemo(() =>
    isAgent && agentName
      ? agentPeriodStats.filter(s => s.agentName.toLowerCase() === agentName.toLowerCase())
      : agentPeriodStats,
  [agentPeriodStats, isAgent, agentName]);

  // Team stats for TODAY verdict
  const teamStats = useMemo(() => {
    if (isAgent || !data || data.length === 0) return null;
    const d = data;
    const qaAvg = (d.reduce((s, a) => s + (a['QA Score Today'] || 0), 0) / d.length).toFixed(2);
    const q2Vals = d.map(a => a['Q2 Pass Pct']).filter(v => v != null);
    const q2Avg  = q2Vals.length > 0
      ? (q2Vals.reduce((s, v) => s + v, 0) / q2Vals.length).toFixed(0) : '—';
    const totalCompliance = d.reduce((s, a) => s + (a['Compliance Count Today'] || 0), 0);
    const avgCoverage     = (d.reduce((s, a) => s + (a['QA Coverage Pct'] || 0), 0) / d.length).toFixed(0);
    const criticalCount   = d.filter(a => a['Alert Level'] === 'CRITICAL').length;
    const improvingCount  = d.filter(a => a['Trend'] === 'Improving').length;
    return { qaAvg, q2Avg, totalCompliance, avgCoverage, criticalCount, improvingCount };
  }, [isAgent, data]);

  const verdict = teamStats
    ? (teamStats.criticalCount > 0 || teamStats.totalCompliance > 2 ? 'red'
      : Number(teamStats.avgCoverage) < 50 || Number(teamStats.qaAvg) < 3 ? 'amber' : 'green')
    : null;

  return (
    <div style={{ padding: 20 }}>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(PERIOD_LABELS).map(([key, label]) => (
          <button key={key} onClick={() => setActivePeriod(key)}
            style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              border: `1px solid ${activePeriod === key ? '#1D4ED8' : '#D1D5DB'}`,
              background: activePeriod === key ? '#1D4ED8' : '#fff',
              color: activePeriod === key ? '#fff' : '#374151',
              cursor: 'pointer' }}>
            {label}
          </button>
        ))}
        {activePeriod !== 'today' && periodStart && (
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>
            {periodStart}{periodEnd ? ` – ${periodEnd}` : ''}
          </span>
        )}
      </div>

      {/* ══════════ TODAY mode ══════════ */}
      {activePeriod === 'today' && (
        <>
          <PostActivationWasteAlert />

          {/* Critical banner */}
          {!isAgent && (() => {
            const critical = (data || []).filter(
              a => a['Alert Level'] === 'CRITICAL' && (a['Connected Calls'] || 0) >= 3
            );
            return critical.length > 0 ? (
              <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 6,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#B91C1C' }}>
                ⚠️ Action Required: {critical.map(a => a['Agent Name']).join(', ')} — CRITICAL. Intervene before next shift.
              </div>
            ) : null;
          })()}

          {/* Verdict + hero KPIs */}
          {!isAgent && verdict && teamStats && (
            <div className="space-y-3 mb-6">
              <div className={`${verdict === 'green' ? 'bg-green-600' : verdict === 'amber' ? 'bg-yellow-500' : 'bg-red-600'} text-white rounded-xl px-5 py-3 flex items-center justify-between`}>
                <div>
                  <p className="text-2xl font-black">
                    {verdict === 'green' ? 'Team On Track' : verdict === 'amber' ? 'Watch' : 'Action Needed'}
                  </p>
                  <p className="text-xs opacity-80">Agent Review — {(data || []).length} agents</p>
                </div>
                <div className="flex gap-2">
                  {[
                    teamStats.criticalCount === 0 ? 'green' : 'red',
                    teamStats.totalCompliance === 0 ? 'green' : teamStats.totalCompliance <= 2 ? 'amber' : 'red',
                    Number(teamStats.qaAvg) >= 4 ? 'green' : Number(teamStats.qaAvg) >= 3 ? 'amber' : 'red',
                    Number(teamStats.avgCoverage) >= 70 ? 'green' : Number(teamStats.avgCoverage) >= 50 ? 'amber' : 'red',
                  ].map((l, i) => (
                    <span key={i} className={`w-3 h-3 rounded-full ${l === 'green' ? 'bg-green-300' : l === 'amber' ? 'bg-yellow-300' : 'bg-red-300'}`} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div className={`rounded-xl border p-4 col-span-2 ${Number(teamStats.qaAvg) >= 4 ? 'bg-green-50 border-green-200' : Number(teamStats.qaAvg) >= 3 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Team QA Avg</p>
                  <p className={`text-4xl font-black ${Number(teamStats.qaAvg) >= 4 ? 'text-green-700' : Number(teamStats.qaAvg) >= 3 ? 'text-yellow-700' : 'text-red-700'}`}>{teamStats.qaAvg}/6</p>
                  <p className="text-[10px] text-gray-400">Q2 team rate: {teamStats.q2Avg}%</p>
                </div>
                <div className={`rounded-xl border p-4 ${teamStats.criticalCount === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Critical</p>
                  <p className={`text-2xl font-bold ${teamStats.criticalCount > 0 ? 'text-red-700' : 'text-green-700'}`}>{teamStats.criticalCount}</p>
                  <p className="text-[10px] text-gray-400">need intervention</p>
                </div>
                <div className={`rounded-xl border p-4 ${teamStats.totalCompliance === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Compliance</p>
                  <p className={`text-2xl font-bold ${teamStats.totalCompliance === 0 ? 'text-green-700' : 'text-red-700'}`}>{teamStats.totalCompliance}</p>
                  <p className="text-[10px] text-gray-400">violations today</p>
                </div>
                <div className={`rounded-xl border p-4 ${Number(teamStats.avgCoverage) >= 70 ? 'bg-green-50 border-green-200' : Number(teamStats.avgCoverage) >= 50 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">QA Coverage</p>
                  <p className={`text-2xl font-bold ${Number(teamStats.avgCoverage) >= 70 ? 'text-green-700' : Number(teamStats.avgCoverage) >= 50 ? 'text-yellow-700' : 'text-red-700'}`}>{teamStats.avgCoverage}%</p>
                  <p className="text-[10px] text-gray-400">target 70%+</p>
                </div>
                <div className={`rounded-xl border p-4 ${teamStats.improvingCount >= (data || []).length / 2 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Improving</p>
                  <p className={`text-2xl font-bold ${teamStats.improvingCount >= (data || []).length / 2 ? 'text-green-700' : 'text-yellow-700'}`}>{teamStats.improvingCount}/{(data || []).length}</p>
                  <p className="text-[10px] text-gray-400">trending up</p>
                </div>
              </div>
            </div>
          )}

          <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 16 }}>
            {isAgent ? 'My Performance' : 'Agent Review'}
          </h2>

          <BiggestMovesPanel userRole={role} />

          {/* Special call types */}
          {!isAgent && (() => {
            const d = data || [];
            const totalDisputed = d.reduce((s, a) => s + (a['Disputed Calls'] || 0), 0);
            const totalCSP      = d.reduce((s, a) => s + (a['CSP Calls'] || 0), 0);
            const totalLB       = d.reduce((s, a) => s + (a['Language Barrier Calls'] || 0), 0);
            if (!totalDisputed && !totalCSP && !totalLB) return null;
            return (
              <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6,
                padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9A3412',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  🔍 Special Call Types Today
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                  {totalDisputed > 0 && <span style={{ color: '#B91C1C' }}><strong>{totalDisputed}</strong> Disputed</span>}
                  {totalCSP > 0 && <span style={{ color: '#7C3AED' }}><strong>{totalCSP}</strong> Agent/CSP</span>}
                  {totalLB > 0 && <span style={{ color: '#0F766E' }}><strong>{totalLB}</strong> Language Barrier</span>}
                </div>
              </div>
            );
          })()}

          {visibleData.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>
              {isAgent
                ? 'No coaching data for you today. Populates after first scrape cycle.'
                : 'No coaching data today. Populates after first scrape cycle.'}
            </div>
          ) : (
            <>
              {sortedToday.map(record => (
                <AgentCard
                  key={record.id || record['Agent Name']}
                  record={record}
                  isAgent={isAgent}
                  dept={agentDeptMap[record['Agent Name']]}
                  wcRecords={wcRecords}
                  utilRecords={utilRecords}
                  cbHonorStats={cbHonorStats}
                  periodRecords={periodRecords}
                />
              ))}

              {/* Team summary bar */}
              {!isAgent && teamStats && (
                <div style={{ background: '#F3F4F6', borderRadius: 6, padding: '10px 14px',
                  fontSize: 12, color: '#6B7280', marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <span>Team Avg: <strong>{teamStats.qaAvg}/6</strong></span>
                  <span>Q2 Rate: <strong>{teamStats.q2Avg}%</strong></span>
                  <span>Compliance: <strong>{teamStats.totalCompliance}</strong></span>
                  <span>QA Coverage: <strong>{teamStats.avgCoverage}%</strong>{Number(teamStats.avgCoverage) < 50 ? ' ⚠️' : ''}</span>
                  <span>Improving: <strong>{teamStats.improvingCount}</strong></span>
                  <span>Critical: <strong style={{ color: teamStats.criticalCount > 0 ? '#DC2626' : 'inherit' }}>{teamStats.criticalCount}</strong></span>
                  {Number(teamStats.q2Avg) < 30 && (
                    <span style={{ color: '#D97706' }}>⚠️ Q2 failure team-wide — check script/training</span>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ══════════ WoW / MoM mode ══════════ */}
      {activePeriod !== 'today' && (
        <>
          <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
            {isAgent ? 'My Performance' : 'Agent Performance'} — {PERIOD_LABELS[activePeriod]}
          </h2>
          {periodStart && (
            <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16 }}>
              {periodStart}{periodEnd ? ` – ${periodEnd}` : ''}&nbsp;·&nbsp;
              {periodRecords.length} calls across {visiblePeriodStats.length} agent{visiblePeriodStats.length !== 1 ? 's' : ''}
            </p>
          )}

          {/* Period team summary strip */}
          {!isAgent && visiblePeriodStats.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
              <Kpi label="Total Agents" value={visiblePeriodStats.length} />
              <Kpi label="Total Calls"
                value={visiblePeriodStats.reduce((s, st) => s + st.total, 0)} />
              <Kpi label="Avg Connection"
                value={`${Math.round(visiblePeriodStats.reduce((s, st) => s + st.connectionRate, 0) / visiblePeriodStats.length)}%`}
                color="#1D4ED8" />
              <Kpi label="Avg Callback Honor"
                value={(() => {
                  const with_cb = visiblePeriodStats.filter(s => s.cbStats);
                  return with_cb.length === 0 ? '—'
                    : `${Math.round(with_cb.reduce((s, st) => s + st.cbStats.rate * 100, 0) / with_cb.length)}%`;
                })()}
                color="#0F766E" />
            </div>
          )}

          {visiblePeriodStats.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>
              No calls found for this period.
            </div>
          ) : (
            visiblePeriodStats.map(stats => (
              <PeriodAgentCard
                key={stats.agentName}
                stats={stats}
                isAgent={isAgent}
                period={activePeriod}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}
