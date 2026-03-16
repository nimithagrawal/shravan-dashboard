import { useState, useEffect } from 'react';
import { fetchAgentCallbacks } from '../lib/subscribers';
import PhoneNumber from './PhoneNumber';

const STAGE_COLORS = {
  'Hook Failed':        '#F97316',
  'Pitch Dropped':      '#EAB308',
  'Late Drop':          '#9CA3AF',
  'Immediate Hang Up':  '#DC2626',
};

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

export default function AgentCallbackBriefing({ agentName }) {
  const [callbacks, setCallbacks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!agentName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAgentCallbacks(agentName)
      .then(data => { if (!cancelled) setCallbacks(data); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agentName]);

  // Don't render if no callbacks and not loading
  if (!loading && callbacks.length === 0) return null;

  return (
    <div style={{ marginTop: 10 }}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: '1px solid #E5E7EB', borderRadius: 6,
          padding: '6px 12px', cursor: 'pointer', width: '100%',
          fontSize: 13, fontWeight: 600, color: '#374151',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span>{'\uD83D\uDCCB'} Callbacks with Context ({loading ? '...' : callbacks.length})</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF' }}>
          {expanded ? '\u25B2' : '\u25BC'}
        </span>
      </button>

      {/* Error state */}
      {error && expanded && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#DC2626', padding: '4px 8px' }}>
          Failed to load callbacks: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && expanded && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#9CA3AF', padding: '4px 8px' }}>
          Loading callbacks...
        </div>
      )}

      {/* Expanded list */}
      {expanded && !loading && !error && callbacks.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {callbacks.map(cb => {
            const stage = cb['Last Call Drop Stage'] || '';
            const borderColor = STAGE_COLORS[stage] || '#D1D5DB';
            const mobile = cb['Mobile Number'] || cb['Mobile'] || '';
            const name = cb['Subscriber Name'] || cb['Name'] || '';
            const date = cb['Last Call Date'];
            const duration = cb['Last Call Duration'];
            const briefing = cb['Next Call Briefing'] || '';

            return (
              <div
                key={cb.id}
                style={{
                  borderLeft: `4px solid ${borderColor}`,
                  borderRadius: 6,
                  padding: '10px 12px',
                  background: '#FAFAFA',
                  border: `1px solid #E5E7EB`,
                  borderLeftWidth: 4,
                  borderLeftColor: borderColor,
                }}
              >
                {/* Top row: number + name + stage badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <PhoneNumber number={mobile} className="text-sm font-mono" />
                  {name && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>{name}</span>
                  )}
                  {stage && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: '#fff',
                      background: borderColor, borderRadius: 3,
                      padding: '1px 6px', whiteSpace: 'nowrap',
                    }}>
                      {stage}
                    </span>
                  )}
                </div>

                {/* Meta row: date + duration */}
                <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>
                  {formatDate(date)}
                  {duration !== null && duration !== undefined && (
                    <span> &middot; {formatDuration(duration)}</span>
                  )}
                </div>

                {/* Briefing text */}
                <div style={{
                  fontSize: 12, color: '#374151', lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', background: '#fff',
                  borderRadius: 4, padding: '6px 8px',
                  border: '1px solid #F3F4F6',
                }}>
                  {briefing}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
