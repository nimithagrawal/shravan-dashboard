import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchPostActivationWastes } from '../lib/subscribers';
import PhoneNumber from './PhoneNumber';

export default function PostActivationWasteAlert() {
  const { vikasAlert } = useAuth();
  const [wastes, setWastes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!vikasAlert) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPostActivationWastes()
      .then(data => { if (!cancelled) setWastes(data); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vikasAlert]);

  // Only visible to users with vikasAlert permission
  if (!vikasAlert) return null;

  // Don't render if no wastes found (and not loading)
  if (!loading && wastes.length === 0 && !error) return null;

  return (
    <div style={{
      background: '#FEF2F2',
      border: '2px solid #FECACA',
      borderRadius: 8,
      padding: 16,
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{
        fontSize: 15, fontWeight: 700, color: '#B91C1C', marginBottom: 10,
      }}>
        {'\uD83D\uDEA8'} POST-ACTIVATION WASTE — {loading ? '...' : wastes.length} subscriber(s) called after activation today
      </div>

      {/* Error state */}
      {error && (
        <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 8 }}>
          Failed to load waste data: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ fontSize: 12, color: '#9CA3AF' }}>
          Loading...
        </div>
      )}

      {/* Waste list */}
      {!loading && !error && wastes.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {wastes.map(w => {
              const mobile = w['Mobile Number'] || w['Mobile'] || '';
              const calledBy = w['Called Today By'] || '--';
              const calledAt = w['Called Today At'] || '--';
              const status = w['Current Status'] || '--';

              return (
                <div
                  key={w.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: '#fff', borderRadius: 6,
                    padding: '8px 12px', border: '1px solid #FECACA',
                    flexWrap: 'wrap',
                  }}
                >
                  <PhoneNumber number={mobile} className="text-sm font-mono" />
                  <span style={{ fontSize: 12, color: '#6B7280' }}>
                    by <strong style={{ color: '#374151' }}>{calledBy}</strong>
                  </span>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>
                    at <strong style={{ color: '#374151' }}>{calledAt}</strong>
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#fff',
                    background: '#16A34A', borderRadius: 3,
                    padding: '1px 6px',
                  }}>
                    {status}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#991B1B',
            borderTop: '1px solid #FECACA', paddingTop: 8,
          }}>
            Remove these numbers from tomorrow's call list.
          </div>
        </>
      )}
    </div>
  );
}
