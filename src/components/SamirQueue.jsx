import { useState, useMemo } from 'react';
import { patchRecord } from '../lib/airtable';
import {
  fmtDuration, maskPhone, isConnectedCall, detectUtilizationChannel,
  extractScheduledCallback, formatCallbackDue, callbackDueColor,
} from '../lib/helpers';
import PhoneNumber from './PhoneNumber';

const G = '#10b981', A = '#f59e0b', R = '#ef4444';
const CH_CFG = {
  pharmacy:    { emoji: '💊', label: 'Pharmacy',    bg: 'bg-blue-100',   text: 'text-blue-700' },
  diagnostics: { emoji: '🔬', label: 'Diagnostics', bg: 'bg-purple-100', text: 'text-purple-700' },
  healthcare:  { emoji: '🏥', label: 'Healthcare',  bg: 'bg-red-100',    text: 'text-red-700' },
  general:     { emoji: '📋', label: 'General',     bg: 'bg-gray-100',   text: 'text-gray-600' },
};

export default function SamirQueue({
  today = [], hotLeads = [], loans = [], churn = [],
  callbacksRequested = [], transactionIntents = [],
  attemptMap = {}, onRemove, onRefresh,
}) {
  const [view, setView] = useState('channels'); // channels | callbacks | signals
  const [channelFilter, setChannelFilter] = useState(null);

  // ── Channel-grouped calls ──
  const channelGroups = useMemo(() => {
    const groups = { healthcare: [], pharmacy: [], diagnostics: [], general: [] };
    today.forEach(r => {
      const ch = detectUtilizationChannel(r);
      (groups[ch] || groups.general).push(r);
    });
    return groups;
  }, [today]);

  // ── Callbacks ──
  const callbacks = useMemo(() => {
    const all = [...callbacksRequested, ...today.filter(r => extractScheduledCallback(r))];
    const seen = new Set();
    return all.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
      .map(r => ({ ...r, _cb: extractScheduledCallback(r) }))
      .filter(r => r._cb)
      .sort((a, b) => new Date(a._cb.dateTime || 0).getTime() - new Date(b._cb.dateTime || 0).getTime());
  }, [callbacksRequested, today]);

  // ── High-value signals ──
  const signals = useMemo(() => {
    const items = [];
    hotLeads.forEach(r => items.push({ ...r, _signal: 'Hot Lead', _priority: 3 }));
    loans.forEach(r => items.push({ ...r, _signal: 'Loan Signal', _priority: 2 }));
    churn.forEach(r => items.push({ ...r, _signal: 'Churn Risk', _priority: 4 }));
    transactionIntents.forEach(r => items.push({ ...r, _signal: 'Transaction Intent', _priority: 1 }));
    return items.sort((a, b) => b._priority - a._priority);
  }, [hotLeads, loans, churn, transactionIntents]);

  const filteredToday = channelFilter ? (channelGroups[channelFilter] || []) : today;

  return (
    <div className="space-y-4">
      {/* View Toggle */}
      <div className="flex gap-2">
        {[
          { key: 'channels', label: `By Channel (${today.length})` },
          { key: 'callbacks', label: `Callbacks (${callbacks.length})` },
          { key: 'signals', label: `Signals (${signals.length})` },
        ].map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full ${view === v.key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* ── CHANNEL VIEW ── */}
      {view === 'channels' && (
        <>
          {/* Channel summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(CH_CFG).map(([key, cfg]) => {
              const count = (channelGroups[key] || []).length;
              const connected = (channelGroups[key] || []).filter(isConnectedCall).length;
              return (
                <div key={key}
                  className={`rounded-xl border p-3 cursor-pointer ${channelFilter === key ? 'ring-2 ring-teal-500' : ''} ${cfg.bg}`}
                  onClick={() => setChannelFilter(channelFilter === key ? null : key)}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">{cfg.emoji}</span>
                    <span className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</span>
                  </div>
                  <div className="text-2xl font-bold mt-1">{count}</div>
                  <div className="text-[10px] text-gray-500">{connected} connected</div>
                </div>
              );
            })}
          </div>

          {/* Call table */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2">Subscriber</th>
                <th className="text-center px-2">Channel</th>
                <th className="text-center px-2">Outcome</th>
                <th className="text-center px-2">Duration</th>
                <th className="text-center px-2">Attempts</th>
                <th className="text-center px-2">Agent</th>
              </tr></thead>
              <tbody>
                {filteredToday.slice(0, 80).map(r => {
                  const phone = r['Phone Number'] || r['Mobile Number'] || '';
                  const ch = detectUtilizationChannel(r);
                  const cfg = CH_CFG[ch] || CH_CFG.general;
                  const attempts = attemptMap[phone] || 1;
                  const outcome = r['Call Outcome'] || '—';
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r['Subscriber Name'] || r['Name'] || '—'}</div>
                        <div className="text-gray-400"><PhoneNumber number={phone} /></div>
                      </td>
                      <td className="text-center px-2">
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>{cfg.emoji} {cfg.label}</span>
                      </td>
                      <td className="text-center px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${outcome === 'Completed' ? 'bg-green-100 text-green-700' : outcome === 'Did Not Pick' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{outcome}</span>
                      </td>
                      <td className="text-center px-2 text-gray-500">{fmtDuration(r['Duration Seconds'])}</td>
                      <td className="text-center px-2">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: attempts >= 6 ? G : attempts >= 3 ? A : R }}>{attempts}</span>
                      </td>
                      <td className="text-center px-2 text-gray-500">{(r['Agent Name'] || '').split(' ')[0]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredToday.length === 0 && <div className="text-center py-10 text-gray-400">No calls{channelFilter ? ` in ${CH_CFG[channelFilter]?.label}` : ''}</div>}
          </div>

          {channelFilter && <button onClick={() => setChannelFilter(null)} className="text-xs text-teal-600 hover:underline">Clear channel filter</button>}
        </>
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
                <th className="text-center px-2">Channel</th>
                <th className="text-center px-2">Due</th>
                <th className="text-center px-2">Status</th>
                <th className="text-center px-2">Attempts</th>
              </tr></thead>
              <tbody>
                {callbacks.map(r => {
                  const phone = r['Phone Number'] || r['Mobile Number'] || '';
                  const ch = detectUtilizationChannel(r);
                  const cfg = CH_CFG[ch] || CH_CFG.general;
                  return (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r['Subscriber Name'] || r['Name'] || '—'}</div>
                        <div className="text-gray-400"><PhoneNumber number={phone} /></div>
                      </td>
                      <td className="text-center px-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${cfg.bg} ${cfg.text}`}>{cfg.emoji}</span></td>
                      <td className={`text-center px-2 font-medium ${callbackDueColor(r._cb)}`}>{formatCallbackDue(r._cb)}</td>
                      <td className="text-center px-2"><span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">{r._cb.status || 'Scheduled'}</span></td>
                      <td className="text-center px-2">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: (attemptMap[phone] || 1) >= 6 ? G : A }}>{attemptMap[phone] || 1}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── SIGNALS VIEW ── */}
      {view === 'signals' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-3 py-2 bg-amber-50 border-b text-xs text-amber-700">
            High-value subscriber signals — prioritize these for outreach
          </div>
          {signals.length === 0 ? (
            <div className="text-center py-10 text-gray-400">No active signals</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2">Subscriber</th>
                <th className="text-center px-2">Signal</th>
                <th className="text-center px-2">Channel</th>
                <th className="text-center px-2">Attempts</th>
              </tr></thead>
              <tbody>
                {signals.slice(0, 50).map((r, i) => {
                  const phone = r['Phone Number'] || r['Mobile Number'] || '';
                  const ch = detectUtilizationChannel(r);
                  const cfg = CH_CFG[ch] || CH_CFG.general;
                  const sigColor = r._signal === 'Churn Risk' ? 'bg-red-100 text-red-700' : r._signal === 'Hot Lead' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700';
                  return (
                    <tr key={`${r.id}-${i}`} className="border-b border-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r['Subscriber Name'] || r['Name'] || '—'}</div>
                        <div className="text-gray-400"><PhoneNumber number={phone} /></div>
                      </td>
                      <td className="text-center px-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sigColor}`}>{r._signal}</span></td>
                      <td className="text-center px-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${cfg.bg} ${cfg.text}`}>{cfg.emoji} {cfg.label}</span></td>
                      <td className="text-center px-2">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: (attemptMap[phone] || 1) >= 6 ? G : A }}>{attemptMap[phone] || 1}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
