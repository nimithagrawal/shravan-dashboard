import { useState, useEffect } from 'react';
import {
  fetchAllPitchVersions, fetchLatestSuggestion,
  updateSuggestionStatus, approveAndCreateVersion
} from '../lib/airtable';

export default function PitchPerformance() {
  const [versions,    setVersions]    = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [nimithNote,  setNimithNote]  = useState('');
  const [acting,      setActing]      = useState(false);

  useEffect(() => {
    fetchAllPitchVersions().then(setVersions);
    fetchLatestSuggestion().then(setSuggestions);
  }, []);

  const latestSuggestion = suggestions[0];
  const activeVersion    = versions.find(v => v['Status'] === 'Active');
  const pastVersions     = versions.filter(v => v['Status'] === 'Superseded');

  // Funnel bar component
  const FunnelMetric = ({ label, value, target, prev }) => {
    const pct   = value || 0;
    const hit   = pct >= target;
    const delta = prev !== undefined && prev !== null ? parseFloat((pct - prev).toFixed(1)) : null;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          fontSize: 12, marginBottom: 2 }}>
          <span style={{ color: '#374151' }}>{label}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {delta !== null && delta !== 0 && (
              <span style={{ color: delta > 0 ? '#16A34A' : '#DC2626', fontWeight: 600 }}>
                {delta > 0 ? '+' : ''}{delta}pp
              </span>
            )}
            <span style={{ fontWeight: 700, color: hit ? '#16A34A' : '#DC2626' }}>
              {pct}% {hit ? '\u2713' : `(target: ${target}%)`}
            </span>
          </div>
        </div>
        <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3 }}>
          <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(pct, 100)}%`,
            background: hit ? '#16A34A' : '#F59E0B' }} />
        </div>
      </div>
    );
  };

  const handleApprove = async () => {
    if (!latestSuggestion) return;
    setActing(true);
    try {
      const newId = await approveAndCreateVersion(
        latestSuggestion.id, activeVersion?.['Version ID'], latestSuggestion
      );
      alert(`Created ${newId}. Active from tomorrow. Brief Vikas before morning shift.`);
      fetchAllPitchVersions().then(setVersions);
      fetchLatestSuggestion().then(setSuggestions);
    } catch (e) {
      alert('Error: ' + e.message);
    }
    setActing(false);
  };

  const handleReject = async (status) => {
    if (!latestSuggestion) return;
    setActing(true);
    await updateSuggestionStatus(latestSuggestion.id, status, nimithNote);
    fetchLatestSuggestion().then(setSuggestions);
    setActing(false);
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>

      {/* SECTION A: ACTIVE VERSION FUNNEL */}
      {activeVersion && (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB',
          borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between',
            marginBottom: 12 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {activeVersion['Version ID']}
              </span>
              <span style={{ marginLeft: 8, background: '#D1FAE5', color: '#065F46',
                borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                ACTIVE
              </span>
            </div>
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
              Since {activeVersion['Active From']} &middot; {activeVersion['Total Calls'] || 0} calls
            </span>
          </div>

          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12,
            background: '#F9FAFB', padding: '8px 10px', borderRadius: 4 }}>
            <strong>Changed:</strong> {activeVersion['What Changed']}
          </div>

          <FunnelMetric label="Hook Retention (stayed >45s)" value={activeVersion['Hook Retention Pct']}  target={80} />
          <FunnelMetric label="Completion Rate (full conversation)" value={activeVersion['Completion Rate Pct']} target={85} />
          <FunnelMetric label="Activation Rate (sent Hi on WA)"    value={activeVersion['Activation Rate Pct']} target={8}  />
          <FunnelMetric label="Callback Quality (specific time)"   value={activeVersion['Callback Quality Pct']} target={60} />

          <div style={{ marginTop: 8, fontSize: 12, color: '#6B7280' }}>
            Hook Fails this version: <strong>{activeVersion['Hook Fail Count'] || 0}</strong>
            &nbsp;&middot;&nbsp;
            Drop Rate: <strong>{activeVersion['Drop Rate Pct'] || 0}%</strong>
          </div>
        </div>
      )}

      {/* SECTION B: WEEKLY SUGGESTION CARD */}
      {latestSuggestion && (
        <div style={{ background: '#fff', border: '2px solid #7C3AED',
          borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#7C3AED' }}>
              Weekly Pitch Suggestion
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, background: '#F3F4F6',
                borderRadius: 4, padding: '2px 8px', color: '#374151' }}>
                Bottleneck: <strong>{latestSuggestion['Bottleneck Identified']}</strong>
              </span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                {latestSuggestion['Suggestion Date']} &middot; {latestSuggestion['Calls Analysed']} calls
              </span>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Verdict on current version
            </div>
            <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>
              {latestSuggestion['Verdict']}
            </p>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Recommended change
            </div>
            <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>
              {latestSuggestion['Recommended Change']}
            </p>
          </div>

          <div style={{ marginBottom: 10, background: '#FDF4FF',
            border: '1px solid #E9D5FF', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#7C3AED', marginBottom: 4 }}>
              New script section
            </div>
            <pre style={{ fontSize: 12, color: '#374151', margin: 0,
              whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {latestSuggestion['New Script Section']}
            </pre>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Hypothesis
            </div>
            <p style={{ fontSize: 13, color: '#374151', margin: 0, fontStyle: 'italic' }}>
              {latestSuggestion['Hypothesis']}
            </p>
          </div>

          <div style={{ marginBottom: 12, fontSize: 12, color: '#6B7280' }}>
            <strong>Watch for:</strong> {latestSuggestion['Watch For']}
            <br />
            <strong>Coaching needed:</strong> {latestSuggestion['Coaching Implication']}
          </div>

          {latestSuggestion['Status'] === 'Pending Review' && (
            <div>
              <textarea
                placeholder="Your notes (optional)..."
                value={nimithNote}
                onChange={e => setNimithNote(e.target.value)}
                style={{ width: '100%', padding: 8, fontSize: 12, borderRadius: 4,
                  border: '1px solid #D1D5DB', marginBottom: 8, resize: 'vertical',
                  minHeight: 60 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleApprove} disabled={acting}
                  style={{ background: '#7C3AED', color: '#fff', border: 'none',
                    borderRadius: 4, padding: '8px 16px', fontSize: 13,
                    fontWeight: 600, cursor: 'pointer', opacity: acting ? 0.5 : 1 }}>
                  Approve &rarr; Deploy as next version
                </button>
                <button onClick={() => handleReject('Deferred')} disabled={acting}
                  style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB',
                    borderRadius: 4, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>
                  Defer
                </button>
                <button onClick={() => handleReject('Rejected')} disabled={acting}
                  style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA',
                    borderRadius: 4, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>
                  Reject
                </button>
              </div>
            </div>
          )}
          {latestSuggestion['Status'] !== 'Pending Review' && (
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>
              Status: <strong>{latestSuggestion['Status']}</strong>
              {latestSuggestion['Implemented As Version'] && (
                <> &middot; Implemented as <strong>{latestSuggestion['Implemented As Version']}</strong></>
              )}
            </div>
          )}
        </div>
      )}

      {/* SECTION C: INSTITUTIONAL MEMORY */}
      {pastVersions.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB',
          borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
            Institutional Memory &mdash; {pastVersions.length} tested versions
          </div>
          {pastVersions.map(v => {
            const verdict = v['Hypothesis Verdict'];
            const verdictColor = {
              Confirmed: '#16A34A', Refuted: '#DC2626',
              Inconclusive: '#9CA3AF', Pending: '#D97706',
            }[verdict] || '#9CA3AF';
            return (
              <div key={v.id} style={{ borderLeft: `3px solid ${verdictColor}`,
                paddingLeft: 10, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{v['Version ID']}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: verdictColor }}>
                    {verdict}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 2 }}>
                  {v['What Changed']?.substring(0, 120)}{v['What Changed']?.length > 120 ? '...' : ''}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                  Hook: {v['Hook Retention Pct']}% &middot; Activation: {v['Activation Rate Pct']}% &middot; {v['Total Calls']} calls
                </div>
                {v['Result'] && (
                  <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, fontStyle: 'italic' }}>
                    {v['Result']?.substring(0, 150)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!activeVersion && suggestions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9CA3AF' }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>No pitch data yet</p>
          <p style={{ fontSize: 13 }}>The Pitch Improvement Engine runs every Sunday at 8 PM IST.</p>
        </div>
      )}
    </div>
  );
}
