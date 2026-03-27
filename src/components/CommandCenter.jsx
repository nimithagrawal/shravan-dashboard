import { useMemo } from 'react';
import { isConnectedCall, fmtTalkTime, computeCallTag } from '../lib/helpers';

const CATEGORY_LABELS = {
  'Welcome-Call': 'Welcome Call',
  'Outbound-Service-Followup': 'Utilization',
  'Outbound-Agent-Reachout': 'Agent Reachout',
  'Inbound-Subscriber': 'Inbound',
};

function StatBox({ label, value, sub, color, big }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px',
      border: '1px solid #E5E7EB', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: big ? 32 : 24, fontWeight: 800, color: color || '#111827', lineHeight: 1 }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase',
      letterSpacing: '0.07em', margin: '20px 0 10px' }}>
      {children}
    </div>
  );
}

function CategoryBlock({ label, records, color }) {
  const total = records.length;
  const connected = records.filter(isConnectedCall).length;
  const hotLeads = records.filter(r => r['Hot Lead']).length;
  const connRate = total > 0 ? Math.round((connected / total) * 100) : 0;
  const hotRate = connected > 0 ? Math.round((hotLeads / connected) * 100) : 0;
  const talkSec = records.filter(isConnectedCall).reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);
  const callbacks = records.filter(r => r['Needs Callback'] || r['Callback Requested']).length;

  return (
    <div style={{ background: '#fff', borderRadius: 10, border: `2px solid ${color}`,
      padding: '16px 20px', flex: 1, minWidth: 220 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color, marginBottom: 12 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', fontSize: 13 }}>
        <div><span style={{ color: '#9CA3AF', fontSize: 11 }}>Calls</span><br /><strong>{total}</strong></div>
        <div><span style={{ color: '#9CA3AF', fontSize: 11 }}>Connected</span><br />
          <strong style={{ color: connRate >= 45 ? '#16A34A' : connRate >= 30 ? '#D97706' : '#DC2626' }}>
            {connected} ({connRate}%)
          </strong>
        </div>
        <div><span style={{ color: '#9CA3AF', fontSize: 11 }}>Hot Leads</span><br />
          <strong style={{ color: hotLeads > 0 ? '#16A34A' : '#374151' }}>
            {hotLeads} ({hotRate}%)
          </strong>
        </div>
        <div><span style={{ color: '#9CA3AF', fontSize: 11 }}>Talk Time</span><br />
          <strong>{fmtTalkTime(talkSec)}</strong>
        </div>
        <div><span style={{ color: '#9CA3AF', fontSize: 11 }}>Callbacks</span><br />
          <strong style={{ color: callbacks > 0 ? '#D97706' : '#374151' }}>{callbacks}</strong>
        </div>
      </div>
    </div>
  );
}

export default function CommandCenter({ today, coachingData }) {
  const records = today || [];

  const enriched = useMemo(() => records.map(r => ({
    ...r,
    _tag: computeCallTag(r),
    _connected: isConnectedCall(r),
  })), [records]);

  const total = enriched.length;
  const connected = enriched.filter(r => r._connected).length;
  const connRate = total > 0 ? Math.round((connected / total) * 100) : 0;
  const talkSec = enriched.filter(r => r._connected).reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);
  const hotLeads = enriched.filter(r => r['Hot Lead']).length;
  const hotRate = connected > 0 ? Math.round((hotLeads / connected) * 100) : 0;
  const churnSignals = enriched.filter(r => r['Churn Signal']).length;
  const loanSignals = enriched.filter(r => r['Loan Signal']).length;
  const callbacks = enriched.filter(r => r['Needs Callback'] || r['Callback Requested']).length;
  const violations = enriched.filter(r => r['Compliance Violation']).length;

  // By category
  const welcomeRecords = enriched.filter(r => r['callCategory'] === 'Welcome-Call');
  const utilRecords = enriched.filter(r =>
    r['callCategory'] === 'Outbound-Service-Followup' ||
    r['callCategory'] === 'Outbound-Agent-Reachout'
  );
  const inboundRecords = enriched.filter(r => r['callCategory'] === 'Inbound-Subscriber');

  // Agent alerts from coaching data
  const criticalAgents = (coachingData || []).filter(a => a['Alert Level'] === 'CRITICAL');
  const warningAgents = (coachingData || []).filter(a => a['Alert Level'] === 'WARNING');

  // Top performers (hot leads)
  const agentHotLeads = {};
  enriched.filter(r => r['Hot Lead']).forEach(r => {
    const a = r['Agent Name'] || 'Unknown';
    agentHotLeads[a] = (agentHotLeads[a] || 0) + 1;
  });
  const topLeaders = Object.entries(agentHotLeads)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const now = new Date(Date.now() + 5.5 * 3600000); // IST
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <h2 style={{ fontWeight: 800, fontSize: 20, margin: 0 }}>Command Center</h2>
        <span style={{ fontSize: 12, color: '#9CA3AF' }}>Live · {timeStr} IST</span>
      </div>

      {/* Alerts banner */}
      {criticalAgents.length > 0 && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 8,
          padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#B91C1C', fontWeight: 600 }}>
          ⚠️ CRITICAL agents: {criticalAgents.map(a => a['Agent Name']).join(', ')} — intervene before next shift
        </div>
      )}

      {/* Top KPIs */}
      <SectionTitle>Today at a Glance</SectionTitle>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatBox label="Total Calls" value={total} big />
        <StatBox
          label="Connection Rate"
          value={`${connRate}%`}
          sub={`${connected} connected`}
          color={connRate >= 45 ? '#16A34A' : connRate >= 30 ? '#D97706' : '#DC2626'}
        />
        <StatBox
          label="Hot Leads"
          value={hotLeads}
          sub={`${hotRate}% of connected`}
          color={hotLeads > 0 ? '#16A34A' : '#374151'}
        />
        <StatBox label="Talk Time" value={fmtTalkTime(talkSec)} sub="productive" />
        <StatBox
          label="Callbacks"
          value={callbacks}
          color={callbacks > 10 ? '#D97706' : '#374151'}
        />
        {churnSignals > 0 && (
          <StatBox label="Churn Signals" value={churnSignals} color="#DC2626" sub="retention risk" />
        )}
        {loanSignals > 0 && (
          <StatBox label="Loan Signals" value={loanSignals} color="#7C3AED" />
        )}
        {violations > 0 && (
          <StatBox label="Violations" value={violations} color="#DC2626" />
        )}
      </div>

      {/* Category breakdown */}
      <SectionTitle>Call Mix Breakdown</SectionTitle>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {welcomeRecords.length > 0 && (
          <CategoryBlock label="Welcome Call" records={welcomeRecords} color="#1D4ED8" />
        )}
        {utilRecords.length > 0 && (
          <CategoryBlock label="Utilization" records={utilRecords} color="#D97706" />
        )}
        {inboundRecords.length > 0 && (
          <CategoryBlock label="Inbound" records={inboundRecords} color="#16A34A" />
        )}
        {welcomeRecords.length === 0 && utilRecords.length === 0 && (
          <div style={{ color: '#9CA3AF', fontSize: 13, padding: 12 }}>No calls categorized yet today.</div>
        )}
      </div>

      {/* Two-column: Agent alerts + Top hot lead agents */}
      <div style={{ display: 'flex', gap: 16, marginTop: 20, flexWrap: 'wrap' }}>

        {/* Agent QA Alerts */}
        {(criticalAgents.length > 0 || warningAgents.length > 0) && (
          <div style={{ flex: 1, minWidth: 240, background: '#fff', borderRadius: 10,
            border: '1px solid #E5E7EB', padding: '16px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase',
              letterSpacing: '0.07em', marginBottom: 12 }}>Agent QA Alerts</div>
            {criticalAgents.map(a => (
              <div key={a.id || a['Agent Name']} style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F3F4F6', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{a['Agent Name']}</span>
                <span style={{ background: '#DC2626', color: '#fff', fontSize: 11,
                  borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>CRITICAL</span>
              </div>
            ))}
            {warningAgents.map(a => (
              <div key={a.id || a['Agent Name']} style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F3F4F6', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{a['Agent Name']}</span>
                <span style={{ background: '#D97706', color: '#fff', fontSize: 11,
                  borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>WARNING</span>
              </div>
            ))}
          </div>
        )}

        {/* Hot lead leaderboard */}
        {topLeaders.length > 0 && (
          <div style={{ flex: 1, minWidth: 240, background: '#fff', borderRadius: 10,
            border: '1px solid #E5E7EB', padding: '16px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase',
              letterSpacing: '0.07em', marginBottom: 12 }}>Hot Lead Leaderboard</div>
            {topLeaders.map(([agent, count], i) => (
              <div key={agent} style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F3F4F6', fontSize: 13 }}>
                <span>
                  <span style={{ color: '#9CA3AF', marginRight: 8 }}>#{i + 1}</span>
                  <span style={{ fontWeight: 600 }}>{agent}</span>
                </span>
                <span style={{ fontWeight: 700, color: '#16A34A' }}>{count} 🔥</span>
              </div>
            ))}
          </div>
        )}

        {/* Call tag summary */}
        {(() => {
          const tagCounts = {};
          enriched.forEach(r => { tagCounts[r._tag] = (tagCounts[r._tag] || 0) + 1; });
          const topTags = Object.entries(tagCounts)
            .filter(([t]) => t !== 'COLD' && t !== 'NO CONNECT')
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);
          if (topTags.length === 0) return null;
          return (
            <div style={{ flex: 1, minWidth: 240, background: '#fff', borderRadius: 10,
              border: '1px solid #E5E7EB', padding: '16px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase',
                letterSpacing: '0.07em', marginBottom: 12 }}>Call Signal Mix</div>
              {topTags.map(([tag, count]) => (
                <div key={tag} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #F3F4F6', fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{tag}</span>
                  <span style={{ color: '#374151' }}>{count}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {total === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>
          No calls scraped yet today. Check back after the first scrape cycle.
        </div>
      )}
    </div>
  );
}
