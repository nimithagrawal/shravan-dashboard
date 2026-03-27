import { useState, useMemo } from 'react';
import { patchRecord } from '../lib/airtable';
import {
  fmtDuration, maskPhone, isConnectedCall, computeLeadScore,
  extractScheduledCallback, formatCallbackDue, callbackDueColor,
} from '../lib/helpers';
import PhoneNumber from './PhoneNumber';

const G = '#10b981', A = '#f59e0b', R = '#ef4444';
function tl(v, g, a) { return v >= g ? G : v >= a ? A : R; }

export default function VikasQueue({
  today = [], openCallbacks = [], attemptMap = {},
  onRemove, onRefresh,
}) {
  const [view, setView] = useState('today'); // today | callbacks | dnp
  const [expanded, setExpanded] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  // ── Today's calls sorted by time desc ──
  const todayCalls = useMemo(() =>
    [...today].sort((a, b) => (b['Scraped At'] || b._createdTime || '').localeCompare(a['Scraped At'] || a._createdTime || '')),
    [today]
  );

  // ── Open callbacks sorted by due time ──
  const callbacks = useMemo(() => {
    return openCallbacks.map(r => {
      const cb = extractScheduledCallback(r);
      return { ...r, _cb: cb };
    }).filter(r => r._cb).sort((a, b) => {
      const ta = new Date(a._cb.dateTime || 0).getTime();
      const tb = new Date(b._cb.dateTime || 0).getTime();
      return ta - tb;
    });
  }, [openCallbacks]);

  // ── DNP subscribers needing more attempts ──
  const dnpList = useMemo(() => {
    const entries = Object.entries(attemptMap).map(([phone, count]) => {
      const rec = today.find(r => (r['Phone Number'] || r['Mobile Number'] || '') === phone);
      return { phone, count, name: rec?.['Subscriber Name'] || rec?.['Name'] || '—', lastOutcome: rec?.['Call Outcome'] || '—', leadScore: rec ? computeLeadScore(rec) : 0 };
    }).filter(e => e.count < 6 && e.lastOutcome === 'Did Not Pick');
    return entries.sort((a, b) => b.leadScore - a.leadScore);
  }, [attemptMap, today]);

  const handleAction = async (recordId, fields, key) => {
    setActionLoading(recordId);
    try {
      await patchRecord(recordId, fields);
      if (onRemove && key) onRemove(key, recordId);
    } catch (e) { console.error('Action failed:', e); }
    setActionLoading(null);
  };

  return (
    <div className="space-y-4">
      {/* View Toggle */}
      <div className="flex gap-2">
        {[
          { key: 'today', label: `Today (${todayCalls.length})` },
          { key: 'callbacks', label: `Callbacks (${callbacks.length})` },
          { key: 'dnp', label: `DNP Queue (${dnpList.length})` },
        ].map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full ${view === v.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* ── TODAY VIEW ── */}
      {view === 'today' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-2">Subscriber</th>
              <th className="text-center px-2">Outcome</th>
              <th className="text-center px-2">Duration</th>
              <th className="text-center px-2">Attempts</th>
              <th className="text-center px-2">Lead Score</th>
              <th className="text-center px-2">Agent</th>
            </tr></thead>
            <tbody>
              {todayCalls.slice(0, 100).map(r => {
                const phone = r['Phone Number'] || r['Mobile Number'] || '';
                const attempts = attemptMap[phone] || 1;
                const leadScore = computeLeadScore(r);
                const outcome = r['Call Outcome'] || '—';
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r['Subscriber Name'] || r['Name'] || '—'}</div>
                      <div className="text-gray-400"><PhoneNumber number={phone} /></div>
                    </td>
                    <td className="text-center px-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${outcome === 'Completed' ? 'bg-green-100 text-green-700' : outcome === 'Did Not Pick' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{outcome}</span>
                    </td>
                    <td className="text-center px-2 text-gray-500">{fmtDuration(r['Duration Seconds'])}</td>
                    <td className="text-center px-2"><AttemptBadge count={attempts} /></td>
                    <td className="text-center px-2"><LeadBadge score={leadScore} /></td>
                    <td className="text-center px-2 text-gray-500">{(r['Agent Name'] || '').split(' ')[0]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {todayCalls.length === 0 && <div className="text-center py-10 text-gray-400">No calls today</div>}
        </div>
      )}

      {/* ── CALLBACKS VIEW ── */}
      {view === 'callbacks' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          {callbacks.length === 0 ? (
            <div className="text-center py-10 text-gray-400">No pending callbacks</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2">Subscriber</th>
                <th className="text-center px-2">Due</th>
                <th className="text-center px-2">Status</th>
                <th className="text-center px-2">Attempts</th>
                <th className="text-center px-2">Agent</th>
              </tr></thead>
              <tbody>
                {callbacks.map(r => {
                  const phone = r['Phone Number'] || r['Mobile Number'] || '';
                  const attempts = attemptMap[phone] || 1;
                  const cb = r._cb;
                  return (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r['Subscriber Name'] || r['Name'] || '—'}</div>
                        <div className="text-gray-400"><PhoneNumber number={phone} /></div>
                      </td>
                      <td className={`text-center px-2 font-medium ${callbackDueColor(cb)}`}>{formatCallbackDue(cb)}</td>
                      <td className="text-center px-2"><span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">{cb.status || 'Scheduled'}</span></td>
                      <td className="text-center px-2"><AttemptBadge count={attempts} /></td>
                      <td className="text-center px-2 text-gray-500">{(r['Agent Name'] || '').split(' ')[0]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── DNP QUEUE VIEW ── */}
      {view === 'dnp' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-3 py-2 bg-red-50 border-b text-xs text-red-700">
            Subscribers who didn't pick up and need more attempts (target: 6-8 attempts)
          </div>
          {dnpList.length === 0 ? (
            <div className="text-center py-10 text-gray-400">All DNP subscribers have adequate attempts</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2">Subscriber</th>
                <th className="text-center px-2">Attempts</th>
                <th className="text-center px-2">Lead Score</th>
                <th className="text-center px-2">Remaining</th>
              </tr></thead>
              <tbody>
                {dnpList.slice(0, 50).map(e => (
                  <tr key={e.phone} className="border-b border-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{e.name}</div>
                      <div className="text-gray-400">{maskPhone(e.phone)}</div>
                    </td>
                    <td className="text-center px-2"><AttemptBadge count={e.count} /></td>
                    <td className="text-center px-2"><LeadBadge score={e.leadScore} /></td>
                    <td className="text-center px-2 font-bold" style={{ color: R }}>{6 - e.count} more</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function AttemptBadge({ count }) {
  const color = count >= 6 ? G : count >= 3 ? A : R;
  return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: color }}>{count}</span>;
}

function LeadBadge({ score }) {
  const color = score >= 60 ? G : score >= 30 ? A : '#d1d5db';
  return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: color, color: score >= 30 ? '#fff' : '#6b7280' }}>{score}</span>;
}
