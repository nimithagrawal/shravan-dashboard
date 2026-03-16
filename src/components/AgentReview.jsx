import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const ALERT_COLORS = {
  CRITICAL: '#DC2626',
  WARNING: '#D97706',
  WATCH: '#EA580C',
  OK: '#16A34A',
};

const ALERT_ORDER = { CRITICAL: 0, WARNING: 1, WATCH: 2, OK: 3 };

const TREND_ICONS = { Improving: '\u{1F4C8}', Flat: '\u{27A1}\u{FE0F}', Declining: '\u{1F4C9}' };

const Q_LABELS = {
  Q1: 'Agent Screened',
  Q2: 'Cashback Correct',
  Q3: 'WA Link Sent',
  Q4: 'Hi Attempt Made',
  Q5: 'Cashback Mechanic',
  Q6: 'No Improvised Claims',
};

function isAfter610PM() {
  const now = new Date(Date.now() + 5.5 * 3600000);
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  return h > 18 || (h === 18 && m >= 10);
}

function QBar({ label, pct, isTopMiss }) {
  if (pct === null || pct === undefined) return null;
  const color = pct >= 70 ? '#16A34A' : pct >= 40 ? '#D97706' : '#DC2626';
  const bars = Math.round(pct / 10);
  const desc = Q_LABELS[label] || '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ width: 130, fontSize: 12, fontWeight: isTopMiss ? 700 : 400, whiteSpace: 'nowrap' }}>
        {label}: {desc}
      </span>
      <div style={{ display: 'flex', gap: 1 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ width: 8, height: 10, borderRadius: 1,
            background: i < bars ? color : '#E5E7EB' }} />
        ))}
      </div>
      <span style={{ fontSize: 12, color, fontWeight: isTopMiss ? 700 : 400 }}>
        {pct}%{isTopMiss ? ' \u{2190}' : ''}
      </span>
    </div>
  );
}

function AgentCard({ record, isAgent }) {
  const f = record;
  const [expanded, setExpanded] = useState(false);
  const [showViolations, setShowViolations] = useState(false);

  const alertLevel = f['Alert Level'] || 'OK';
  const borderColor = ALERT_COLORS[alertLevel] || '#E5E7EB';
  const qaAvg = f['QA Score Today'] || 0;
  const connected = f['Connected Calls'] || 0;
  const scored = f['QA Scored Calls'] || 0;
  const coverage = f['QA Coverage Pct'] || 0;
  const trend = f['Trend'] || '\u{2014}';
  const qa7d = f['QA Score 7d Avg'];
  const trackingDay = f['Tracking Day'] || 1;
  const intradayAlert = f['Intraday Alert'] || '';
  const complianceCount = f['Compliance Count Today'] || 0;
  const topMiss = f['Top Miss'] || '';
  const coachingBrief = f['Coaching Brief'] || '';
  const actionPoints = f['Action Points'] || '';
  const patternFlag = f['Pattern Flag'] || '';
  const worstPattern = f['Worst Pattern'] || '';
  const bestCallId = f['Best Call ID'] || '';
  const bestCallURL = f['Best Call Recording URL'] || '';
  const agentName = f['Agent Name'] || '';

  const trendIcon = TREND_ICONS[trend] || '';
  const isBriefAvailable = coachingBrief.length > 0;
  const after610 = isAfter610PM();
  const topMissLabel = topMiss.match(/Q\d/)?.[0];

  const qFields = [
    { label: 'Q1', pct: f['Q1 Pass Pct'] },
    { label: 'Q2', pct: f['Q2 Pass Pct'] },
    { label: 'Q3', pct: f['Q3 Pass Pct'] },
    { label: 'Q4', pct: f['Q4 Pass Pct'] },
    { label: 'Q5', pct: f['Q5 Pass Pct'] },
    { label: 'Q6', pct: f['Q6 Pass Pct'] },
  ];

  return (
    <div style={{ border: `2px solid ${borderColor}`, borderRadius: 8, padding: 16,
      marginBottom: 12, background: '#fff' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{agentName}</span>
          {trendIcon && <span style={{ marginLeft: 8, fontSize: 14 }}>{trendIcon}</span>}
          {trackingDay <= 7 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: '#9CA3AF' }}>Day {trackingDay} of tracking</span>
          )}
        </div>
        <span style={{ background: borderColor, color: '#fff', borderRadius: 4,
          padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
          {alertLevel}
        </span>
      </div>

      {/* QA summary */}
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
        Today: <strong>{qaAvg}/6</strong> &nbsp;|&nbsp;
        {scored}/{connected} calls scored ({coverage}%{coverage < 50 ? ' \u{26A0}\u{FE0F}' : ''}) &nbsp;|&nbsp;
        7d avg: <strong>{qa7d !== null && qa7d !== undefined ? `${qa7d}/6` : '\u{2014}'}</strong>
        {trackingDay <= 7 && <span style={{ color: '#9CA3AF' }}> (establishing baseline)</span>}
      </div>

      {/* Q bars — 2 columns */}
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
        {qFields.map(({ label, pct }) => (
          <QBar key={label} label={label} pct={pct} isTopMiss={label === topMissLabel} />
        ))}
      </div>

      {/* Compliance + intraday alert — hidden for AGENT role */}
      {!isAgent && complianceCount > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4,
          padding: '4px 8px', fontSize: 12, color: '#B91C1C', marginBottom: 6 }}>
          {'\u{1F6A8}'} {complianceCount} compliance violation(s) today
        </div>
      )}
      {intradayAlert && !after610 && (
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>{intradayAlert}</div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {after610 && isBriefAvailable && (
          <button onClick={() => setExpanded(!expanded)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4,
              background: '#1D4ED8', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {expanded ? 'Hide Brief \u{2191}' : 'View Full Brief \u{2193}'}
          </button>
        )}
        {!after610 && (
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>Coaching brief available after 6:10 PM</span>
        )}
        {bestCallURL && (
          <a href={bestCallURL} target="_blank" rel="noreferrer"
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4,
              background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB',
              textDecoration: 'none' }}>
            {'\u{1F3A7}'} Best call ({bestCallId})
          </a>
        )}
        {!isAgent && complianceCount > 0 && (
          <button onClick={() => setShowViolations(!showViolations)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4,
            background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA', cursor: 'pointer' }}>
            {showViolations ? 'Hide Violations \u{2191}' : `Violations (${complianceCount}) \u{2192}`}
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
            {complianceCount} compliance violation(s) flagged today for {agentName}.
            Review call recordings and address before next shift.
          </div>
          {intradayAlert && (
            <div style={{ fontSize: 12, color: '#991B1B', marginTop: 6, fontStyle: 'italic' }}>
              {intradayAlert}
            </div>
          )}
        </div>
      )}

      {/* Expanded brief */}
      {expanded && isBriefAvailable && (
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
              {'\u{26A0}\u{FE0F}'} PATTERN FLAG: {patternFlag}
            </div>
          )}
          {!isAgent && worstPattern && (
            <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 4,
              padding: '6px 10px', fontSize: 12, color: '#B91C1C', marginTop: 6 }}>
              {'\u{1F501}'} STUCK PATTERN: {worstPattern}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentReview({ data }) {
  const { role, agentName } = useAuth();
  const isAgent = role === 'AGENT';

  // AGENT role: filter to only their own card
  const visibleData = isAgent && agentName
    ? data.filter(r => (r['Agent Name'] || '').toLowerCase() === agentName.toLowerCase())
    : data;

  if (!visibleData || visibleData.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF' }}>
        {isAgent
          ? 'No coaching data available for you today. Data populates after the first scrape cycle.'
          : 'No coaching data available for today. Data populates after the first scrape cycle.'}
      </div>
    );
  }

  // Sort: CRITICAL first
  const sorted = [...visibleData].sort((a, b) => {
    const aLevel = a['Alert Level'] || 'OK';
    const bLevel = b['Alert Level'] || 'OK';
    return (ALERT_ORDER[aLevel] ?? 4) - (ALERT_ORDER[bLevel] ?? 4);
  });

  // Team summary (only computed for non-AGENT roles)
  const teamQAAvg = !isAgent && data.length > 0
    ? (data.reduce((s, a) => s + (a['QA Score Today'] || 0), 0) / data.length).toFixed(2)
    : '\u{2014}';
  const q2Values = !isAgent ? data.map(a => a['Q2 Pass Pct']).filter(v => v !== null && v !== undefined) : [];
  const teamQ2Avg = q2Values.length > 0
    ? (q2Values.reduce((s, v) => s + v, 0) / q2Values.length).toFixed(0)
    : '\u{2014}';
  const totalCompliance = !isAgent ? data.reduce((s, a) => s + (a['Compliance Count Today'] || 0), 0) : 0;
  const avgCoverage = !isAgent && data.length > 0
    ? (data.reduce((s, a) => s + (a['QA Coverage Pct'] || 0), 0) / data.length).toFixed(0)
    : '\u{2014}';
  const criticalCount = !isAgent ? data.filter(a => a['Alert Level'] === 'CRITICAL').length : 0;
  const improvingCount = !isAgent ? data.filter(a => a['Trend'] === 'Improving').length : 0;

  // Vikas alert banner (hidden for AGENT role)
  const criticalWithData = !isAgent
    ? data.filter(a => a['Alert Level'] === 'CRITICAL' && (a['Connected Calls'] || 0) >= 3)
    : [];

  return (
    <div style={{ padding: 20 }}>

      {/* Vikas alert banner — hidden for AGENT */}
      {criticalWithData.length > 0 && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 6,
          padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#B91C1C' }}>
          {'\u{26A0}\u{FE0F}'} Action Required: {criticalWithData.map(a => a['Agent Name']).join(', ')} — CRITICAL status. Intervene before next shift.
        </div>
      )}

      <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 16 }}>
        {isAgent ? 'My Performance' : 'Agent Review'}
      </h2>

      {/* Agent cards */}
      {sorted.map(record => (
        <AgentCard key={record.id} record={record} isAgent={isAgent} />
      ))}

      {/* Team summary bar — hidden for AGENT role */}
      {!isAgent && (
        <div style={{ background: '#F3F4F6', borderRadius: 6, padding: '10px 14px',
          fontSize: 12, color: '#6B7280', marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>Team Avg: <strong>{teamQAAvg}/6</strong></span>
          <span>Q2 Team Rate: <strong>{teamQ2Avg}%</strong></span>
          <span>Compliance: <strong>{totalCompliance}</strong> today</span>
          <span>QA Coverage: <strong>{avgCoverage}%</strong>{Number(avgCoverage) < 50 ? ' \u{26A0}\u{FE0F}' : ''}</span>
          <span>Improving: <strong>{improvingCount}</strong></span>
          <span>Critical: <strong style={{ color: criticalCount > 0 ? '#DC2626' : 'inherit' }}>{criticalCount}</strong></span>
          {Number(teamQ2Avg) < 30 && (
            <span style={{ color: '#D97706' }}>{'\u{26A0}\u{FE0F}'} Q2 failure is team-wide — check script/training, not just individuals</span>
          )}
        </div>
      )}
    </div>
  );
}
