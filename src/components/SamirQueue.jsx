import { useState, useMemo } from 'react';
import { patchRecord } from '../lib/airtable';
import { truncate, sentimentScoreColor } from '../lib/helpers';
import PhoneNumber from './PhoneNumber';

function Chip({ text, className }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>{text}</span>;
}

function toneColor(tone) {
  if (tone === 'interested') return 'bg-green-100 text-pass';
  if (tone === 'skeptical') return 'bg-yellow-100 text-amber';
  if (tone === 'hostile') return 'bg-red-100 text-fail';
  return 'bg-gray-100 text-gray-600';
}

function sentimentColor(s) {
  if (s === 'positive') return 'bg-green-100 text-pass';
  if (s === 'neutral') return 'bg-gray-100 text-gray-600';
  return 'bg-red-100 text-fail';
}

function ActionButton({ label, onClick, color = 'bg-pass', recordId, doneIds }) {
  const isDone = doneIds.has(recordId);
  return (
    <button
      onClick={isDone ? undefined : onClick}
      disabled={isDone}
      className={`px-3 py-1 text-xs font-medium rounded-lg text-white transition-all whitespace-nowrap min-h-[44px] md:min-h-0 ${
        isDone ? 'bg-gray-300 cursor-default' : `${color} hover:opacity-90 active:scale-95`
      }`}
    >
      {isDone ? 'Done' : label}
    </button>
  );
}

function SectionHeader({ title, emoji, count, badgeColor = 'bg-pass' }) {
  return (
    <div className="flex items-center gap-2 p-4 pb-2">
      <h3 className="text-sm font-semibold text-gray-700">{emoji} {title}</h3>
      <span className={`${badgeColor} text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full`}>{count}</span>
    </div>
  );
}

export default function SamirQueue({ hotLeads, loans, churn, callbacksRequested = [], onRemove, onRefresh }) {
  const [doneIds, setDoneIds] = useState(new Set());

  const markDone = (id, action) => {
    setDoneIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      action();
    }, 1500);
  };

  // Hot leads: sentiment score DESC
  const sortedLeads = useMemo(() =>
    [...hotLeads].sort((a, b) => (b['Customer Sentiment Score'] || 0) - (a['Customer Sentiment Score'] || 0)),
    [hotLeads]
  );

  // Loans: Days Since Purchase ASC (most recent purchase first = most time-sensitive)
  const sortedLoans = useMemo(() =>
    [...loans].sort((a, b) => (a['Days Since Purchase'] ?? 9999) - (b['Days Since Purchase'] ?? 9999)),
    [loans]
  );

  // Churn: Prior Attempts DESC (most attempts = most at risk)
  const sortedChurn = useMemo(() =>
    [...churn].sort((a, b) => (b['Prior Call Attempts'] || 0) - (a['Prior Call Attempts'] || 0)),
    [churn]
  );

  // Callbacks: Call Time ASC (earliest first)
  const sortedCallbacksReq = useMemo(() =>
    [...callbacksRequested].sort((a, b) => (a['Call Time'] || '').localeCompare(b['Call Time'] || '')),
    [callbacksRequested]
  );

  const handleFollowUp = async (r) => {
    try {
      await patchRecord(r.id, { 'Hot Lead': false });
      onRemove('hotLeads', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleLoan = async (r) => {
    try {
      await patchRecord(r.id, { 'Loan Signal': false });
      onRemove('loans', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleRecovered = async (r) => {
    try {
      await patchRecord(r.id, { 'Churn Signal': false });
      onRemove('churn', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleCallbackDone = async (r) => {
    try {
      await patchRecord(r.id, { 'Callback Requested': false });
      onRemove('callbacksRequested', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Samir — Action Queue</h2>
        <p className="text-sm text-gray-500">Callbacks · Leads · Loans · Churn</p>
        <p className="text-[10px] text-gray-400 mt-0.5">Action queues always show today's data</p>
      </div>

      {/* CALLBACKS REQUESTED */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <SectionHeader title="Callbacks Requested" emoji="" count={sortedCallbacksReq.length} badgeColor="bg-amber" />
        {sortedCallbacksReq.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">No callback requests</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Objection</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedCallbacksReq.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <PhoneNumber number={r['Mobile Number']} />
                    </td>
                    <td className="px-4 py-2">
                      {r['Customer Sentiment Score'] != null ? (
                        <span className={`font-mono font-bold ${sentimentScoreColor(r['Customer Sentiment Score'])}`}>{r['Customer Sentiment Score']}/5</span>
                      ) : '--'}
                    </td>
                    <td className="px-4 py-2 text-xs">{r['Customer Objection'] || '--'}</td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Date'] || '--'} {r['Call Time'] || ''}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      <ActionButton
                        label="Called Back"
                        onClick={() => markDone(r.id, () => handleCallbackDone(r))}
                        color="bg-amber"
                        recordId={r.id}
                        doneIds={doneIds}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* HOT LEADS */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <SectionHeader title="Hot Leads" emoji="" count={sortedLeads.length} badgeColor="bg-pass" />
        {sortedLeads.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">No hot leads today — check back after next scrape</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Conversion Reason</th>
                  <th className="px-4 py-2">Tone</th>
                  <th className="px-4 py-2">Bureau</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <PhoneNumber number={r['Mobile Number']} />
                    </td>
                    <td className="px-4 py-2">
                      {r['Customer Sentiment Score'] != null ? (
                        <span className={`font-mono font-bold ${sentimentScoreColor(r['Customer Sentiment Score'])}`}>{r['Customer Sentiment Score']}/5</span>
                      ) : '--'}
                    </td>
                    <td className="px-4 py-2 text-xs">{r['Conversion Reason'] || '--'}</td>
                    <td className="px-4 py-2"><Chip text={r['Customer Tone'] || '--'} className={toneColor(r['Customer Tone'])} /></td>
                    <td className="px-4 py-2 font-mono">{r['Bureau Score at Call'] || '--'}</td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Date'] || '--'} {r['Call Time'] || ''}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      <ActionButton
                        label="Followed Up"
                        onClick={() => markDone(r.id, () => handleFollowUp(r))}
                        recordId={r.id}
                        doneIds={doneIds}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* LOAN SIGNALS */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <SectionHeader title="Loan Signals" emoji="" count={sortedLoans.length} badgeColor="bg-info" />
        {sortedLoans.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">No loan signals right now</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Loan Context</th>
                  <th className="px-4 py-2">Days Since Purchase</th>
                  <th className="px-4 py-2">Bureau</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedLoans.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <PhoneNumber number={r['Mobile Number']} />
                    </td>
                    <td className="px-4 py-2">
                      {r['Customer Sentiment Score'] != null ? (
                        <span className={`font-mono font-bold ${sentimentScoreColor(r['Customer Sentiment Score'])}`}>{r['Customer Sentiment Score']}/5</span>
                      ) : '--'}
                    </td>
                    <td className="px-4 py-2 text-xs">{r['Loan Context'] || '--'}</td>
                    <td className="px-4 py-2 font-mono">{r['Days Since Purchase'] ?? '--'}</td>
                    <td className="px-4 py-2 font-mono">{r['Bureau Score at Call'] || '--'}</td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Date'] || '--'}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      <ActionButton
                        label="Initiate Loan"
                        onClick={() => markDone(r.id, () => handleLoan(r))}
                        color="bg-info"
                        recordId={r.id}
                        doneIds={doneIds}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CHURN RISK */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <SectionHeader title="Churn Risk" emoji="" count={sortedChurn.length} badgeColor="bg-fail" />
        {sortedChurn.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">No churn risks right now</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Churn Reason</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Tone</th>
                  <th className="px-4 py-2">Prior Attempts</th>
                  <th className="px-4 py-2">Days Since Purchase</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedChurn.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <PhoneNumber number={r['Mobile Number']} />
                    </td>
                    <td className="px-4 py-2">
                      {r['Customer Sentiment Score'] != null ? (
                        <span className={`font-mono font-bold ${sentimentScoreColor(r['Customer Sentiment Score'])}`}>{r['Customer Sentiment Score']}/5</span>
                      ) : '--'}
                    </td>
                    <td className="px-4 py-2 text-xs">{r['Churn Reason'] || '--'}</td>
                    <td className="px-4 py-2"><Chip text={r['Sentiment'] || '--'} className={sentimentColor(r['Sentiment'])} /></td>
                    <td className="px-4 py-2"><Chip text={r['Customer Tone'] || '--'} className={toneColor(r['Customer Tone'])} /></td>
                    <td className="px-4 py-2 font-mono">{r['Prior Call Attempts'] ?? '--'}</td>
                    <td className="px-4 py-2 font-mono">{r['Days Since Purchase'] ?? '--'}</td>
                    <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Date'] || '--'}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]">{truncate(r['Summary'])}</td>
                    <td className="px-4 py-2">
                      <ActionButton
                        label="Recovered"
                        onClick={() => markDone(r.id, () => handleRecovered(r))}
                        color="bg-amber"
                        recordId={r.id}
                        doneIds={doneIds}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
