import { useState, useEffect } from 'react';
import { fetchTodaySnapshots, markInterventionWindow } from '../lib/snapshots';
import { useAuth } from '../context/AuthContext';

export default function IntradayProgress({ agentName }) {
  const { role } = useAuth();
  const [snapshots, setSnapshots] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchTodaySnapshots(agentName).then(setSnapshots);
    const interval = setInterval(
      () => fetchTodaySnapshots(agentName).then(setSnapshots),
      10 * 60 * 1000 // refresh every 10 min
    );
    return () => clearInterval(interval);
  }, [agentName]);

  // Need >=2 snapshots to show progress
  if (snapshots.length < 2) return null;

  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];

  // Total delta from first snapshot to now
  const totalDelta = (key) => {
    const f = first[key] ?? null;
    const l = latest[key] ?? null;
    if (f === null || l === null) return null;
    return parseFloat((l - f).toFixed(1));
  };

  const qKeys = ['Q1','Q2','Q3','Q4','Q5','Q6'];
  const qLabels = {
    Q1: 'Q1 Agent Screened',
    Q2: 'Q2 Cashback',
    Q3: 'Q3 WA Link',
    Q4: 'Q4 Hi Attempt',
    Q5: 'Q5 Mechanic',
    Q6: 'Q6 No Claims',
  };

  const deltaColor = (d) => {
    if (d === null) return '#9CA3AF';
    if (d > 5)  return '#16A34A';
    if (d > 0)  return '#4ADE80';
    if (d === 0) return '#9CA3AF';
    if (d > -5) return '#F97316';
    return '#DC2626';
  };

  const deltaArrow = (d) => {
    if (d === null || d === 0) return '\u2192';
    return d > 0 ? '\u2191' : '\u2193';
  };

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #F3F4F6', paddingTop: 10 }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280',
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Today's Progress
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>
            {snapshots[0]['Snapshot Time']} \u2192 {latest['Snapshot Time']}
            &nbsp;({snapshots.length} windows)
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ fontSize: 11, color: '#6B7280', background: '#F3F4F6',
              border: 'none', cursor: 'pointer', padding: '2px 6px',
              borderRadius: 4 }}>
            {expanded ? 'Less \u2191' : 'Detail \u2193'}
          </button>
        </div>
      </div>

      {/* Q-row summary: label | sparkline dots | total delta */}
      {qKeys.map(q => {
        const cumKey  = `${q} Cumulative Pct`;
        const values  = snapshots.map(s => s[cumKey] ?? null).filter(v => v !== null);
        if (!values.length) return null;

        const td = totalDelta(cumKey);
        const latestVal = latest[cumKey] ?? null;

        return (
          <div key={q} style={{ display: 'flex', alignItems: 'center',
            gap: 6, marginBottom: 3 }}>

            {/* Label */}
            <span style={{ width: 90, fontSize: 11, color: '#6B7280', flexShrink: 0 }}>
              {qLabels[q]}
            </span>

            {/* Mini sparkline — dots representing each window */}
            <div style={{ display: 'flex', gap: 2, alignItems: 'center', flex: 1 }}>
              {values.map((v, i) => {
                const isIntervention = snapshots[i]['Intervention Window'];
                return (
                  <div key={i} title={`${snapshots[i]['Snapshot Time']}: ${v}%`}
                    style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: isIntervention ? '#7C3AED' : (
                        v >= 70 ? '#16A34A' : v >= 40 ? '#D97706' : '#DC2626'
                      ),
                      flexShrink: 0,
                    }}
                  />
                );
              })}
              {/* Current value */}
              <span style={{ fontSize: 11, color: '#374151', marginLeft: 4 }}>
                {latestVal !== null ? `${latestVal}%` : '\u2014'}
              </span>
            </div>

            {/* Total delta */}
            <span style={{ fontSize: 11, fontWeight: 600,
              color: deltaColor(td), flexShrink: 0, width: 44, textAlign: 'right' }}>
              {td !== null ? `${td > 0 ? '+' : ''}${td}% ${deltaArrow(td)}` : '\u2014'}
            </span>
          </div>
        );
      })}

      {/* QA Avg row */}
      {(() => {
        const td = totalDelta('QA Avg Cumulative');
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            marginTop: 4, paddingTop: 4, borderTop: '1px dashed #F3F4F6' }}>
            <span style={{ width: 90, fontSize: 11, fontWeight: 600, color: '#374151' }}>
              QA Avg
            </span>
            <div style={{ flex: 1, fontSize: 11, color: '#374151' }}>
              {first['QA Avg Cumulative']}/6 \u2192 {latest['QA Avg Cumulative']}/6
            </div>
            <span style={{ fontSize: 11, fontWeight: 700,
              color: deltaColor(td), width: 44, textAlign: 'right' }}>
              {td !== null ? `${td > 0 ? '+' : ''}${td} ${deltaArrow(td)}` : '\u2014'}
            </span>
          </div>
        );
      })()}

      {/* Expanded detail: per-window table */}
      {expanded && (
        <div style={{ marginTop: 8, overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#9CA3AF', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', paddingBottom: 4 }}>Time</th>
                <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Q5</th><th>Q6</th>
                <th>Avg</th>
                {role !== 'AGENT' && <th>Flag</th>}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap, i) => {
                const isIntervention = snap['Intervention Window'];
                const prev = i > 0 ? snapshots[i - 1] : null;

                return (
                  <tr key={snap.id}
                    style={{ background: isIntervention ? '#F5F3FF' : 'transparent' }}>
                    <td style={{ color: '#374151', paddingRight: 8 }}>
                      {snap['Snapshot Time']}
                      {isIntervention && (
                        <span style={{ marginLeft: 4, fontSize: 10,
                          background: '#7C3AED', color: '#fff',
                          borderRadius: 3, padding: '0 4px' }}>
                          coached
                        </span>
                      )}
                    </td>
                    {qKeys.map(q => {
                      const val    = snap[`${q} Cumulative Pct`];
                      const prevVal = prev?.[`${q} Cumulative Pct`];
                      const d = (val !== null && val !== undefined && prevVal !== null && prevVal !== undefined)
                        ? parseFloat((val - prevVal).toFixed(1)) : null;
                      return (
                        <td key={q} style={{ textAlign: 'right', paddingRight: 6,
                          color: val !== null ? '#374151' : '#D1D5DB' }}>
                          {val !== null ? `${val}%` : '\u2014'}
                          {d !== null && d !== 0 && (
                            <span style={{ fontSize: 10, marginLeft: 2,
                              color: d > 0 ? '#16A34A' : '#DC2626' }}>
                              {d > 0 ? `+${d}` : d}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {snap['QA Avg Cumulative'] ?? '\u2014'}
                    </td>
                    {role !== 'AGENT' && (
                      <td style={{ textAlign: 'center' }}>
                        {!isIntervention && (
                          <button
                            onClick={() => markInterventionWindow(snap.id)
                              .then(() => fetchTodaySnapshots(agentName).then(setSnapshots))}
                            title="Mark: I coached before this window"
                            style={{ fontSize: 10, background: 'none', border: '1px solid #D1D5DB',
                              borderRadius: 3, cursor: 'pointer', padding: '1px 4px',
                              color: '#6B7280' }}>
                            {'\u270E'}
                          </button>
                        )}
                        {isIntervention && (
                          <span style={{ color: '#7C3AED', fontSize: 14 }}>{'\u25CF'}</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
