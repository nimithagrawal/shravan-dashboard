import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { fetchRecordsForPeriod } from '../lib/airtable';
import { isConnectedCall } from '../lib/helpers';

// ── Period helpers (IST) ──
function todayIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtShort(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function getPeriodBounds(mode) {
  const now = todayIST();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay();
  const thisMon = addDays(today, -(dow === 0 ? 6 : dow - 1));

  if (mode === 'wow') {
    const start = thisMon;
    const prevStart = addDays(thisMon, -7);
    const prevEnd = addDays(thisMon, -1);
    return {
      curr: { start: fmtDate(start), end: fmtDate(today), label: 'This Week' },
      prev: { start: fmtDate(prevStart), end: fmtDate(prevEnd), label: 'Last Week' },
    };
  }
  if (mode === 'mom') {
    const currStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      curr: { start: fmtDate(currStart), end: fmtDate(today), label: 'This Month' },
      prev: { start: fmtDate(prevStart), end: fmtDate(prevEnd), label: 'Last Month' },
    };
  }
  // qtd
  const qMonth = Math.floor(today.getMonth() / 3) * 3;
  const qStart = new Date(today.getFullYear(), qMonth, 1);
  const prevQStart = new Date(today.getFullYear(), qMonth - 3, 1);
  const prevQEnd = new Date(today.getFullYear(), qMonth, 0);
  return {
    curr: { start: fmtDate(qStart), end: fmtDate(today), label: 'This Quarter' },
    prev: { start: fmtDate(prevQStart), end: fmtDate(prevQEnd), label: 'Last Quarter' },
  };
}

// ── Metrics computation ──
function computeMetrics(records) {
  if (!records || records.length === 0) return null;
  const total = records.length;
  const connected = records.filter(isConnectedCall).length;
  const connRate = total > 0 ? Math.round((connected / total) * 100) : 0;

  const hotLeads = records.filter(r => r['Hot Lead']).length;
  const churnSignals = records.filter(r => r['Churn Signal']).length;
  const loanSignals = records.filter(r => r['Loan Signal']).length;
  const hotRate = connected > 0 ? +((hotLeads / connected) * 100).toFixed(1) : 0;
  const churnRate = connected > 0 ? +((churnSignals / connected) * 100).toFixed(1) : 0;

  const talkTimeSec = records.reduce((s, r) => s + (r['Duration Seconds'] || 0), 0);
  const talkTimeHrs = (talkTimeSec / 3600).toFixed(1);

  // QA from individual call fields
  const qaFields = [
    'Q1 User Agent Screened', 'Q2 Cashback Correct', 'Q3 WA Link Sent',
    'Q4 Hi Attempt Made', 'Q5 Cashback Mechanic Explained', 'Q6 No Improvised Claims',
  ];
  const qaScoredRecords = records.filter(r => qaFields.some(f => r[f] !== null && r[f] !== undefined));
  const qaScores = qaScoredRecords.map(r => qaFields.filter(f => r[f]).length);
  const qaAvg = qaScores.length > 0
    ? +(qaScores.reduce((s, v) => s + v, 0) / qaScores.length).toFixed(2)
    : null;

  const q2Passes = qaScoredRecords.filter(r => r['Q2 Cashback Correct']).length;
  const q2Rate = qaScoredRecords.length > 0
    ? Math.round((q2Passes / qaScoredRecords.length) * 100)
    : null;

  return { total, connected, connRate, hotLeads, hotRate, churnSignals, churnRate, loanSignals, talkTimeHrs, qaAvg, q2Rate, qaScoredCount: qaScoredRecords.length };
}

// Agent breakdown
function computeAgentTable(records) {
  const map = {};
  for (const r of records) {
    const a = r['Agent Name'] || 'Unknown';
    if (!map[a]) map[a] = { name: a, total: 0, connected: 0, hotLeads: 0, churnSignals: 0, qaScores: [], talkTimeSec: 0 };
    const m = map[a];
    m.total++;
    if (isConnectedCall(r)) m.connected++;
    if (r['Hot Lead']) m.hotLeads++;
    if (r['Churn Signal']) m.churnSignals++;
    m.talkTimeSec += r['Duration Seconds'] || 0;
    const qaFields = ['Q1 User Agent Screened','Q2 Cashback Correct','Q3 WA Link Sent','Q4 Hi Attempt Made','Q5 Cashback Mechanic Explained','Q6 No Improvised Claims'];
    if (qaFields.some(f => r[f] !== null && r[f] !== undefined)) {
      m.qaScores.push(qaFields.filter(f => r[f]).length);
    }
  }
  return Object.values(map).map(m => ({
    ...m,
    connRate: m.total > 0 ? Math.round((m.connected / m.total) * 100) : 0,
    hotRate: m.connected > 0 ? +((m.hotLeads / m.connected) * 100).toFixed(1) : 0,
    qaAvg: m.qaScores.length > 0
      ? +(m.qaScores.reduce((s,v)=>s+v,0) / m.qaScores.length).toFixed(1)
      : null,
    talkTimeHrs: (m.talkTimeSec / 3600).toFixed(1),
  })).sort((a, b) => b.hotLeads - a.hotLeads);
}

// Daily trend data (group records by date)
function computeDailyTrend(records) {
  const byDate = {};
  for (const r of records) {
    const d = (r['Call Date'] || '').slice(0, 10);
    if (!d) continue;
    if (!byDate[d]) byDate[d] = { date: d, total: 0, connected: 0, hotLeads: 0 };
    byDate[d].total++;
    if (isConnectedCall(r)) byDate[d].connected++;
    if (r['Hot Lead']) byDate[d].hotLeads++;
  }
  return Object.values(byDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      ...d,
      label: fmtShort(d.date),
      connRate: d.total > 0 ? Math.round((d.connected / d.total) * 100) : 0,
    }));
}

// Delta between two values
function delta(curr, prev) {
  if (curr == null || prev == null || prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

function DeltaBadge({ pct }) {
  if (pct == null) return null;
  const color = pct >= 0 ? '#16A34A' : '#DC2626';
  return (
    <span style={{ fontSize: 11, color, fontWeight: 600, marginLeft: 6 }}>
      {pct >= 0 ? '↑' : '↓'}{Math.abs(pct)}%
    </span>
  );
}

function L0Card({ label, value, prev, unit = '', color, description }) {
  const d = delta(value, prev);
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px',
      border: '1px solid #E5E7EB', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || '#111827' }}>
        {value != null ? `${value}${unit}` : '—'}
        <DeltaBadge pct={d} />
      </div>
      {prev != null && (
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
          prev: {prev}{unit}
        </div>
      )}
      {description && <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>{description}</div>}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase',
      letterSpacing: '0.08em', margin: '20px 0 10px' }}>
      {children}
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [mode, setMode] = useState('wow');
  const [currRecords, setCurrRecords] = useState([]);
  const [prevRecords, setPrevRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const bounds = getPeriodBounds(mode);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchRecordsForPeriod(bounds.curr.start, bounds.curr.end).catch(() => []),
      fetchRecordsForPeriod(bounds.prev.start, bounds.prev.end).catch(() => []),
    ]).then(([curr, prev]) => {
      if (cancelled) return;
      setCurrRecords(curr);
      setPrevRecords(prev);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [mode, bounds.curr.start, bounds.curr.end, bounds.prev.start, bounds.prev.end]);

  const currM = useMemo(() => computeMetrics(currRecords), [currRecords]);
  const prevM = useMemo(() => computeMetrics(prevRecords), [prevRecords]);
  const agentTable = useMemo(() => computeAgentTable(currRecords), [currRecords]);
  const dailyTrend = useMemo(() => computeDailyTrend(currRecords), [currRecords]);

  const MODES = [
    { key: 'wow', label: 'WoW' },
    { key: 'mom', label: 'MoM' },
    { key: 'qtd', label: 'Quarterly' },
  ];

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      {/* Header + mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: 20, margin: 0 }}>Executive View</h2>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
            {bounds.curr.label}: {bounds.curr.start} → {bounds.curr.end}
            &nbsp;|&nbsp;vs {bounds.prev.label}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {MODES.map(m => (
            <button key={m.key} onClick={() => setMode(m.key)}
              style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                background: mode === m.key ? '#1D4ED8' : '#F3F4F6',
                color: mode === m.key ? '#fff' : '#374151' }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Loading strategic data...</div>
      ) : !currM ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>No data for this period.</div>
      ) : (
        <>
          {/* L0 — Business Outcomes */}
          <SectionLabel>L0 · Business Outcomes</SectionLabel>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <L0Card
              label="Hot Leads"
              value={currM.hotLeads}
              prev={prevM?.hotLeads}
              color={currM.hotLeads > 0 ? '#15803D' : '#374151'}
              description="High-intent pipeline"
            />
            <L0Card
              label="Hot Lead Rate"
              value={currM.hotRate}
              prev={prevM?.hotRate}
              unit="%"
              color={currM.hotRate >= 5 ? '#15803D' : currM.hotRate >= 2 ? '#D97706' : '#DC2626'}
              description="of connected calls"
            />
            <L0Card
              label="Churn Signals"
              value={currM.churnSignals}
              prev={prevM?.churnSignals}
              color={currM.churnSignals > 10 ? '#DC2626' : '#D97706'}
              description="Retention risk flagged"
            />
            <L0Card
              label="Loan Signals"
              value={currM.loanSignals}
              prev={prevM?.loanSignals}
              color="#7C3AED"
              description="Loan interest expressed"
            />
            <L0Card
              label="Connection Rate"
              value={currM.connRate}
              prev={prevM?.connRate}
              unit="%"
              color={currM.connRate >= 45 ? '#15803D' : currM.connRate >= 30 ? '#D97706' : '#DC2626'}
              description="Human answers / total dials"
            />
          </div>

          {/* L1 — Operational Indicators */}
          <SectionLabel>L1 · Operational Indicators</SectionLabel>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <L0Card label="Total Calls" value={currM.total} prev={prevM?.total} />
            <L0Card label="Connected Calls" value={currM.connected} prev={prevM?.connected} />
            <L0Card
              label="Talk Time"
              value={currM.talkTimeHrs}
              prev={prevM?.talkTimeHrs}
              unit="h"
              description="Total agent talk time"
            />
            <L0Card
              label="Team QA Avg"
              value={currM.qaAvg != null ? `${currM.qaAvg}/6` : '—'}
              prev={prevM?.qaAvg != null ? prevM.qaAvg : null}
              color={currM.qaAvg >= 4.5 ? '#15803D' : currM.qaAvg >= 3 ? '#D97706' : '#DC2626'}
              description={`${currM.qaScoredCount} calls scored`}
            />
            <L0Card
              label="Q2 (Cashback) Rate"
              value={currM.q2Rate != null ? currM.q2Rate : '—'}
              prev={prevM?.q2Rate}
              unit={currM.q2Rate != null ? '%' : ''}
              color={currM.q2Rate >= 60 ? '#15803D' : currM.q2Rate >= 30 ? '#D97706' : '#DC2626'}
              description="Biggest script miss"
            />
          </div>

          {/* Trend Chart */}
          {dailyTrend.length > 1 && (
            <>
              <SectionLabel>Call Volume + Hot Lead Trend</SectionLabel>
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB',
                padding: '16px 8px', marginBottom: 8 }}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dailyTrend} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="connected" name="Connected" fill="#93C5FD" radius={[2,2,0,0]} />
                    <Bar yAxisId="left" dataKey="hotLeads" name="Hot Leads" fill="#16A34A" radius={[2,2,0,0]} />
                    <Line yAxisId="right" type="monotone" dataKey="connRate" name="Conn Rate %" stroke="#F59E0B" strokeWidth={2} dot={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* Agent Contribution Table */}
          {agentTable.length > 0 && (
            <>
              <SectionLabel>Agent Contribution</SectionLabel>
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                      {['Agent', 'Calls', 'Connected', 'Conn %', 'Hot Leads', 'Hot %', 'Churn', 'Talk Time', 'QA Avg'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11,
                          fontWeight: 700, color: '#6B7280', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agentTable.map((a, i) => (
                      <tr key={a.name}
                        style={{ borderBottom: '1px solid #F3F4F6',
                          background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600 }}>{a.name}</td>
                        <td style={{ padding: '8px 12px' }}>{a.total}</td>
                        <td style={{ padding: '8px 12px' }}>{a.connected}</td>
                        <td style={{ padding: '8px 12px', color: a.connRate >= 45 ? '#16A34A' : a.connRate >= 30 ? '#D97706' : '#DC2626', fontWeight: 600 }}>
                          {a.connRate}%
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 700,
                          color: a.hotLeads > 0 ? '#15803D' : '#374151' }}>
                          {a.hotLeads}
                        </td>
                        <td style={{ padding: '8px 12px', color: a.hotRate >= 5 ? '#16A34A' : a.hotRate >= 2 ? '#D97706' : '#6B7280' }}>
                          {a.hotRate}%
                        </td>
                        <td style={{ padding: '8px 12px',
                          color: a.churnSignals > 3 ? '#DC2626' : '#374151' }}>
                          {a.churnSignals}
                        </td>
                        <td style={{ padding: '8px 12px' }}>{a.talkTimeHrs}h</td>
                        <td style={{ padding: '8px 12px',
                          color: a.qaAvg === null ? '#9CA3AF' : a.qaAvg >= 4.5 ? '#16A34A' : a.qaAvg >= 3 ? '#D97706' : '#DC2626',
                          fontWeight: a.qaAvg !== null ? 600 : 400 }}>
                          {a.qaAvg !== null ? `${a.qaAvg}/6` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Summary insight */}
          <div style={{ background: '#EFF6FF', borderRadius: 8, padding: '12px 16px',
            marginTop: 20, fontSize: 13, color: '#1E40AF', lineHeight: 1.6 }}>
            <strong>Period Summary ({bounds.curr.label}):</strong>&nbsp;
            {currM.total.toLocaleString()} calls · {currM.connected.toLocaleString()} connected ({currM.connRate}%) ·&nbsp;
            {currM.hotLeads} hot leads ({currM.hotRate}% rate) ·&nbsp;
            {currM.churnSignals} churn signals ·&nbsp;
            {currM.talkTimeHrs}h total talk time
            {prevM && (
              <>&nbsp;|&nbsp;
                vs {bounds.prev.label}: {prevM.total.toLocaleString()} calls, {prevM.hotLeads} hot leads ({prevM.hotRate}%)
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
