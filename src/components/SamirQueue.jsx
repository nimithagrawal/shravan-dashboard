import { useState, useMemo, useEffect, Fragment } from 'react';
import { patchRecord } from '../lib/airtable';
import { sentimentScoreColor, fmtDuration, computeGist, gistColor, subscriberType, subscriberTypeColor, callLabelColor } from '../lib/helpers';

function detectChannel(r) {
  const s = (r['Summary'] || '').toLowerCase();
  if (s.includes('pharmacy') || s.includes('medicine') || s.includes('medic')) return 'pharmacy';
  if (s.includes('diagnostic') || s.includes('test') || s.includes('lab')) return 'diagnostics';
  if (s.includes('hospital') || s.includes('opd') || s.includes('surgery') || s.includes('doctor')) return 'healthcare';
  return null;
}

function ChannelChip({ record }) {
  const ch = detectChannel(record);
  if (!ch) return <span className="text-gray-300 text-xs">—</span>;
  const cfg = {
    pharmacy:    { emoji: '💊', label: 'Pharma',  bg: 'bg-blue-100',  color: 'text-blue-700' },
    diagnostics: { emoji: '🔬', label: 'Diag',    bg: 'bg-purple-100', color: 'text-purple-700' },
    healthcare:  { emoji: '🏥', label: 'Health',  bg: 'bg-teal-100',  color: 'text-teal-700' },
  }[ch];
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${cfg.bg} ${cfg.color}`}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}

function AttemptBadge({ count }) {
  if (!count || count <= 1) return <span className="text-xs text-gray-400">1st</span>;
  const color = count >= 6 ? 'bg-green-100 text-green-700' : count >= 3 ? 'bg-yellow-100 text-amber' : 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${color}`}>#{count}</span>;
}
import { ExpandableSummary, TranscriptViewer } from './SharedUI';
import PhoneNumber from './PhoneNumber';
import { useAuth } from '../context/AuthContext';

function Chip({ text, className }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>{text}</span>;
}

function toneColor(tone) {
  if (tone === 'interested') return 'bg-green-100 text-pass';
  if (tone === 'skeptical') return 'bg-yellow-100 text-amber';
  if (tone === 'hostile') return 'bg-red-100 text-fail';
  return 'bg-gray-100 text-gray-600';
}

function elapsedSinceHandoff(handoffTime) {
  if (!handoffTime) return null;
  const handoff = new Date(handoffTime);
  if (isNaN(handoff.getTime())) return null;
  const now = new Date();
  const diffMs = now - handoff;
  if (diffMs < 0) return null;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function urgencyColor(urgency) {
  if (urgency === 'Immediate') return 'bg-red-100 text-red-700 border-red-200';
  if (urgency === 'Today') return 'bg-amber-100 text-amber border-amber-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
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

function ThreeStateButton({ status, onPickUp, onResolve, color = 'bg-info' }) {
  if (status === 'Resolved') {
    return (
      <span className="px-3 py-1 text-xs font-medium rounded-lg bg-gray-200 text-gray-500 min-h-[44px] md:min-h-0 inline-flex items-center">
        &#x2713; Resolved
      </span>
    );
  }
  if (status === 'In Progress') {
    return (
      <button
        onClick={onResolve}
        className="px-3 py-1 text-xs font-medium rounded-lg bg-pass text-white hover:bg-green-700 active:scale-95 transition-all min-h-[44px] md:min-h-0"
      >
        &#x2713; Resolve
      </button>
    );
  }
  return (
    <button
      onClick={onPickUp}
      className={`px-3 py-1 text-xs font-medium rounded-lg text-white hover:opacity-90 active:scale-95 transition-all min-h-[44px] md:min-h-0 ${color}`}
    >
      &#x25B6; Pick Up
    </button>
  );
}

function SLABadge({ handoffTime, urgency }) {
  if (!handoffTime || urgency !== 'Immediate') return null;
  const elapsed = (Date.now() - new Date(handoffTime).getTime()) / 60000;
  if (elapsed > 60) return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white animate-pulse">SLA BREACH</span>;
  if (elapsed > 30) return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white">AT RISK</span>;
  return null;
}

function ExpandedRow({ r, colSpan }) {
  const label = r['Call Label'];
  return (
    <tr className="bg-gray-50">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="grid gap-3 text-xs max-w-4xl">
          {/* Call Label + meta at top */}
          <div className="flex flex-wrap items-center gap-2">
            {label && <Chip text={label} className={callLabelColor(label)} />}
            {r['Call Outcome'] && <span className="text-gray-500">Outcome: {r['Call Outcome']}</span>}
            {r['Conversion Signal'] && <span className="text-gray-500">Signal: {r['Conversion Signal']}</span>}
            {r['Customer Intent Signal'] && <span className="text-gray-500">Intent: {r['Customer Intent Signal']}</span>}
            {r['Customer Objection'] && <span className="text-gray-500">Objection: {r['Customer Objection']}</span>}
            {r['Attempt Number'] && <span className="text-gray-500">Attempt: {r['Attempt Number']}</span>}
            {r['Days Since Purchase'] != null && <span className="text-gray-500">Days Since Purchase: {r['Days Since Purchase']}</span>}
            {r['Bureau Score at Call'] && <span className="text-gray-500">Bureau: {r['Bureau Score at Call']}</span>}
          </div>
          {r['Summary'] && (
            <div>
              <p className="font-semibold text-gray-600">Summary</p>
              <p className="text-gray-700">{r['Summary']}</p>
            </div>
          )}
          {r['Transcript'] && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">Transcript</p>
              <TranscriptViewer transcript={r['Transcript']} agentName={r['Agent Name']} />
            </div>
          )}
          {r['Recording URL'] && (
            <div>
              <audio controls src={r['Recording URL']} className="h-8 w-full max-w-md" />
            </div>
          )}
        </div>
      </td>
    </tr>
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

export default function SamirQueue({ today = [], hotLeads, loans, churn, callbacksRequested = [], transactionIntents = [], onRemove, onRefresh, attemptMap = {} }) {
  const { canDo } = useAuth();
  const canOutreach = canDo('canInitiateOutreach');
  const [doneIds, setDoneIds] = useState(new Set());
  const [expanded, setExpanded] = useState(null);
  const [statusOverrides, setStatusOverrides] = useState({}); // { recordId: 'In Progress' | 'Resolved' }
  const [resolvedItems, setResolvedItems] = useState([]);
  const [showResolved, setShowResolved] = useState(false);

  // Live timer — re-render every 60s for elapsed time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const toggle = (key) => setExpanded(expanded === key ? null : key);

  const getStatus = (r) => statusOverrides[r.id] || r['Samir Action Status'] || 'New';

  const markDone = (id, action) => {
    setDoneIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      action();
    }, 1500);
  };

  const handlePickUp = async (r) => {
    try {
      await patchRecord(r.id, { 'Samir Action Status': 'In Progress' });
      setStatusOverrides(prev => ({ ...prev, [r.id]: 'In Progress' }));
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleResolve = async (r, sectionKey, removeFn) => {
    try {
      await patchRecord(r.id, {
        'Samir Action Status': 'Resolved',
        'Samir Resolved At': new Date().toISOString(),
      });
      setStatusOverrides(prev => ({ ...prev, [r.id]: 'Resolved' }));
      setResolvedItems(prev => [...prev, { ...r, _resolvedAt: new Date() }]);
      setTimeout(() => {
        if (removeFn) removeFn();
      }, 1500);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  // Transaction Signals: exclude Complaints + short calls (<30s) (FIX 5A)
  const sortedTransactions = useMemo(() =>
    [...transactionIntents]
      .filter(r => {
        const label = (r['Call Label'] || '').toLowerCase();
        if (label === 'complaint') return false;
        if ((r['Duration Seconds'] || 0) < 30) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort by urgency: Immediate > Today > Normal
        const urgencyOrder = { 'Immediate': 0, 'Today': 1, 'Normal': 2 };
        const ua = urgencyOrder[a['Samir Handoff Urgency']] ?? 2;
        const ub = urgencyOrder[b['Samir Handoff Urgency']] ?? 2;
        if (ua !== ub) return ua - ub;
        // Then by sentiment score
        const sentDiff = (b['Customer Sentiment Score'] || 0) - (a['Customer Sentiment Score'] || 0);
        if (sentDiff !== 0) return sentDiff;
        return (b['Duration Seconds'] || 0) - (a['Duration Seconds'] || 0);
      }),
    [transactionIntents]
  );

  // Check for overdue Immediate records (> 60 min)
  const overdueImmediate = useMemo(() => {
    const now = new Date();
    return sortedTransactions.filter(r => {
      if (r['Samir Handoff Urgency'] !== 'Immediate') return false;
      const handoff = r['Samir Handoff Time'];
      if (!handoff) return false;
      const handoffDate = new Date(handoff);
      const elapsedMin = (now - handoffDate) / 60000;
      return elapsedMin > 60;
    });
  }, [sortedTransactions]);

  // Complaints section — all records with Call Label = 'Complaint' (FIX 5B)
  const complaints = useMemo(() =>
    today.filter(r => (r['Call Label'] || '') === 'Complaint')
      .sort((a, b) => (b['Customer Sentiment Score'] || 0) - (a['Customer Sentiment Score'] || 0)),
    [today]
  );

  // Webinar Leads: exclude Transaction Intent records (FIX 5C)
  const sortedLeads = useMemo(() => {
    const txIds = new Set(transactionIntents.map(r => r.id));
    return [...hotLeads]
      .filter(r => !txIds.has(r.id))
      .sort((a, b) => (b['Customer Sentiment Score'] || 0) - (a['Customer Sentiment Score'] || 0));
  }, [hotLeads, transactionIntents]);

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

  const handleTransactionDone = async (r) => {
    try {
      await patchRecord(r.id, {
        'Transaction Intent': false,
        'Samir Handoff Urgency': 'Normal',
        'Samir Action Status': 'Resolved',
        'Samir Resolved At': new Date().toISOString(),
        'Notes': (r['Notes'] || '') + `\nSamir actioned at ${new Date().toLocaleTimeString('en-IN')}`
      });
      onRemove('transactionIntents', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleFollowUp = async (r) => {
    try {
      await patchRecord(r.id, {
        'Hot Lead': false,
        'Samir Action Status': 'Resolved',
        'Samir Resolved At': new Date().toISOString(),
      });
      onRemove('hotLeads', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleLoan = async (r) => {
    try {
      await patchRecord(r.id, {
        'Loan Signal': false,
        'Samir Action Status': 'Resolved',
        'Samir Resolved At': new Date().toISOString(),
      });
      onRemove('loans', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleRecovered = async (r) => {
    try {
      await patchRecord(r.id, {
        'Churn Signal': false,
        'Samir Action Status': 'Resolved',
        'Samir Resolved At': new Date().toISOString(),
      });
      onRemove('churn', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleCallbackDone = async (r) => {
    try {
      await patchRecord(r.id, {
        'Callback Requested': false,
        'Samir Action Status': 'Resolved',
        'Samir Resolved At': new Date().toISOString(),
      });
      onRemove('callbacksRequested', r.id);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const handleComplaintResolved = async (r) => {
    try {
      await patchRecord(r.id, {
        'Call Label': 'Engaged',
        'Samir Action Status': 'Resolved',
        'Samir Resolved At': new Date().toISOString(),
      });
    } catch (e) { alert('Failed: ' + e.message); }
  };

  // ── Hero KPIs ──
  const totalOpen = sortedTransactions.length + complaints.length + sortedLeads.length + sortedLoans.length + sortedChurn.length + sortedCallbacksReq.length;
  const slaBreaches = overdueImmediate.length;
  const resolvedCount = resolvedItems.length;
  const resolutionRate = (resolvedCount + totalOpen) > 0 ? Math.round((resolvedCount / (resolvedCount + totalOpen)) * 100) : 0;

  // Verdict
  const samirVerdict = slaBreaches > 0 || complaints.length > 3 ? 'red'
    : totalOpen > 10 || complaints.length > 0 ? 'amber' : 'green';
  const samirVerdictLabel = samirVerdict === 'green' ? 'Queue Clear' : samirVerdict === 'amber' ? 'Watch' : 'Action Needed';
  const samirVerdictBg = samirVerdict === 'green' ? 'bg-green-600' : samirVerdict === 'amber' ? 'bg-yellow-500' : 'bg-red-600';

  return (
    <div className="space-y-4">
      {/* ═══ VERDICT ═══ */}
      <div className={`${samirVerdictBg} text-white rounded-xl px-5 py-3 flex items-center justify-between`}>
        <div>
          <p className="text-2xl font-black">{samirVerdictLabel}</p>
          <p className="text-xs opacity-80">Samir Action Queue</p>
        </div>
        <div className="flex gap-2">
          {[
            slaBreaches === 0 ? 'green' : 'red',
            complaints.length === 0 ? 'green' : complaints.length <= 3 ? 'amber' : 'red',
            sortedTransactions.length === 0 ? 'green' : 'amber',
            resolutionRate >= 60 ? 'green' : resolutionRate >= 30 ? 'amber' : 'red',
          ].map((l, i) => <span key={i} className={`w-3 h-3 rounded-full ${l === 'green' ? 'bg-green-300' : l === 'amber' ? 'bg-yellow-300' : 'bg-red-300'}`} />)}
        </div>
      </div>

      {/* ═══ HERO KPIs ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className={`rounded-xl border p-4 col-span-2 ${slaBreaches > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">SLA Breaches</p>
          <p className={`text-4xl font-black ${slaBreaches > 0 ? 'text-red-700' : 'text-green-700'}`}>{slaBreaches}</p>
          <p className="text-[10px] text-gray-400">Immediate callbacks &gt;60min</p>
        </div>
        <div className={`rounded-xl border p-4 ${complaints.length > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Complaints</p>
          <p className={`text-2xl font-bold ${complaints.length > 0 ? 'text-red-700' : 'text-green-700'}`}>{complaints.length}</p>
          <p className="text-[10px] text-gray-400">CX response needed</p>
        </div>
        <div className={`rounded-xl border p-4 ${sortedTransactions.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
          <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Transactions</p>
          <p className={`text-2xl font-bold ${sortedTransactions.length > 0 ? 'text-yellow-700' : 'text-green-700'}`}>{sortedTransactions.length}</p>
          <p className="text-[10px] text-gray-400">Medical intent signals</p>
        </div>
        <div className={`rounded-xl border p-4 ${resolutionRate >= 60 ? 'bg-green-50 border-green-200' : resolutionRate >= 30 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Resolved</p>
          <p className={`text-2xl font-bold ${resolutionRate >= 60 ? 'text-green-700' : resolutionRate >= 30 ? 'text-yellow-700' : 'text-red-700'}`}>{resolutionRate}%</p>
          <p className="text-[10px] text-gray-400">{resolvedCount} done this session</p>
        </div>
        <div className="rounded-xl border p-4 bg-gray-50 border-gray-200">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Open Items</p>
          <p className="text-2xl font-bold text-gray-800">{totalOpen}</p>
          <p className="text-[10px] text-gray-400">{sortedLeads.length} leads · {sortedLoans.length} loans · {sortedChurn.length} churn</p>
        </div>
      </div>

      {/* RESOLVED SUMMARY BAR */}
      {resolvedItems.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-pass text-lg">&#x2713;</span>
              <p className="text-sm font-semibold text-green-800">
                {resolvedItems.length} item{resolvedItems.length > 1 ? 's' : ''} resolved this session
              </p>
            </div>
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="text-xs text-green-700 hover:underline"
            >
              {showResolved ? 'Hide' : 'Show'}
            </button>
          </div>
          {showResolved && (
            <div className="mt-2 space-y-1">
              {resolvedItems.map(r => (
                <div key={r.id} className="flex items-center gap-2 text-xs text-green-700">
                  <span className="text-gray-400">{r._resolvedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <PhoneNumber number={r['Mobile Number']} />
                  <span className="text-gray-500">{r['Samir Action Type'] || r['Call Label'] || '--'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TRANSACTION SIGNALS — customer-initiated health/medical intent */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <SectionHeader title="Transaction Signals" emoji="" count={sortedTransactions.length} badgeColor="bg-red-600" />
        <p className="px-4 text-[10px] text-gray-400 -mt-1 pb-2">Customer expressed medical/health transaction need (Gemini-detected)</p>
        {/* Overdue Immediate Alert */}
        {overdueImmediate.length > 0 && (
          <div className="mx-4 mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs font-bold text-red-800">
              ⚠️ {overdueImmediate.length} subscriber{overdueImmediate.length > 1 ? 's were' : ' was'} promised an immediate callback over 1 hour ago.
            </p>
            {overdueImmediate.slice(0, 3).map(r => (
              <p key={r.id} className="text-xs text-red-700 mt-1">
                <PhoneNumber number={r['Mobile Number']} /> — {r['Conversion Reason'] || r['Summary']?.slice(0, 50) || 'transaction signal'} — waiting since {r['Samir Handoff Time'] ? new Date(r['Samir Handoff Time']).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '?'}
              </p>
            ))}
          </div>
        )}
        {sortedTransactions.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">No transaction signals yet — goes live with next Gemini prompt update</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Channel</th>
                  <th className="px-4 py-2">Attempts</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Urgency</th>
                  <th className="px-4 py-2">What They Said</th>
                  <th className="px-4 py-2">Medical Context</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.map(r => {
                  const key = `sti-${r.id}`;
                  const attempts = attemptMap[String(r['Mobile Number'] || '')] || 1;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2">
                          <PhoneNumber number={r['Mobile Number']} />
                        </td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2"><ChannelChip record={r} /></td>
                        <td className="px-4 py-2"><AttemptBadge count={attempts} /></td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Date'] || '--'} {r['Call Time'] || ''}</td>
                        <td className="px-4 py-2">
                          {r['Samir Handoff Urgency'] ? (
                            <div>
                              <div className="flex items-center gap-1">
                                <Chip text={r['Samir Handoff Urgency']} className={urgencyColor(r['Samir Handoff Urgency'])} />
                                <SLABadge handoffTime={r['Samir Handoff Time']} urgency={r['Samir Handoff Urgency']} />
                              </div>
                              {r['Samir Handoff Time'] && (
                                <p className={`text-[10px] mt-0.5 ${r['Samir Handoff Urgency'] === 'Immediate' && elapsedSinceHandoff(r['Samir Handoff Time'])?.includes('h') ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                                  {elapsedSinceHandoff(r['Samir Handoff Time']) || ''}
                                </p>
                              )}
                            </div>
                          ) : '--'}
                        </td>
                        <td className="px-4 py-2 text-xs">{r['Customer Objection'] || '--'}</td>
                        <td className="px-4 py-2 text-xs">{r['Conversion Reason'] || r['Loan Context'] || r['Churn Reason'] || '--'}</td>
                        <td className="px-4 py-2">
                          {r['Customer Sentiment Score'] != null ? (
                            <span className={`font-mono font-bold ${sentimentScoreColor(r['Customer Sentiment Score'])}`}>{r['Customer Sentiment Score']}/5</span>
                          ) : '--'}
                        </td>
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canOutreach ? (
                            <ThreeStateButton
                              status={getStatus(r)}
                              onPickUp={() => handlePickUp(r)}
                              onResolve={() => handleResolve(r, 'transactionIntents', () => {
                                markDone(r.id, () => handleTransactionDone(r));
                              })}
                              color="bg-red-600"
                            />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={12} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* COMPLAINTS — escalation items (FIX 5B) */}
      {complaints.length > 0 && (
        <div className="bg-card rounded-xl shadow-sm border border-red-200 overflow-hidden">
          <SectionHeader title="Complaints" emoji="" count={complaints.length} badgeColor="bg-fail" />
          <p className="px-4 text-[10px] text-gray-400 -mt-1 pb-2">Calls labeled as Complaint — need escalation or resolution</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Objection</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {complaints.map(r => {
                  const key = `cmp-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2"><PhoneNumber number={r['Mobile Number']} /></td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Date'] || '--'} {r['Call Time'] || ''}</td>
                        <td className="px-4 py-2">{fmtDuration(r['Duration Seconds'])}</td>
                        <td className="px-4 py-2">
                          {r['Customer Sentiment Score'] != null ? (
                            <span className={`font-mono font-bold ${sentimentScoreColor(r['Customer Sentiment Score'])}`}>{r['Customer Sentiment Score']}/5</span>
                          ) : '--'}
                        </td>
                        <td className="px-4 py-2 text-xs">{r['Customer Objection'] || r['Churn Reason'] || '--'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canOutreach ? (
                            <ThreeStateButton
                              status={getStatus(r)}
                              onPickUp={() => handlePickUp(r)}
                              onResolve={() => {
                                setResolvedItems(prev => [...prev, { ...r, _resolvedAt: new Date() }]);
                                handleComplaintResolved(r);
                                setStatusOverrides(prev => ({ ...prev, [r.id]: 'Resolved' }));
                              }}
                              color="bg-fail"
                            />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={8} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WEBINAR LEADS (formerly Hot Leads) — agent conversion metric */}
      <div className="bg-card rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <SectionHeader title="Webinar Leads" emoji="" count={sortedLeads.length} badgeColor="bg-pass" />
        {sortedLeads.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">No webinar leads today — check back after next scrape</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Conversion Reason</th>
                  <th className="px-4 py-2">Tone</th>
                  <th className="px-4 py-2">Bureau</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map(r => {
                  const key = `shl-${r.id}`;
                  const gist = computeGist(r);
                  const subType = subscriberType(r);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2">
                          <PhoneNumber number={r['Mobile Number']} />
                        </td>
                        <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${subscriberTypeColor(subType)}`}>{subType}</span></td>
                        <td className={`px-4 py-2 text-xs ${gistColor(gist)}`}>{gist}</td>
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
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canOutreach ? (
                            <ThreeStateButton
                              status={getStatus(r)}
                              onPickUp={() => handlePickUp(r)}
                              onResolve={() => handleResolve(r, 'hotLeads', () => {
                                markDone(r.id, () => handleFollowUp(r));
                              })}
                              color="bg-pass"
                            />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={12} />}
                    </Fragment>
                  );
                })}
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
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Loan Context</th>
                  <th className="px-4 py-2">Days Since Purchase</th>
                  <th className="px-4 py-2">Bureau</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedLoans.map(r => {
                  const key = `sln-${r.id}`;
                  const gist = computeGist(r);
                  const subType = subscriberType(r);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2">
                          <PhoneNumber number={r['Mobile Number']} />
                        </td>
                        <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${subscriberTypeColor(subType)}`}>{subType}</span></td>
                        <td className={`px-4 py-2 text-xs ${gistColor(gist)}`}>{gist}</td>
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
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canOutreach ? (
                            <ThreeStateButton
                              status={getStatus(r)}
                              onPickUp={() => handlePickUp(r)}
                              onResolve={() => handleResolve(r, 'loans', () => {
                                markDone(r.id, () => handleLoan(r));
                              })}
                              color="bg-info"
                            />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={12} />}
                    </Fragment>
                  );
                })}
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
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Churn Reason</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Tone</th>
                  <th className="px-4 py-2">Prior Attempts</th>
                  <th className="px-4 py-2">Days Since Purchase</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedChurn.map(r => {
                  const key = `scr-${r.id}`;
                  const gist = computeGist(r);
                  const subType = subscriberType(r);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2">
                          <PhoneNumber number={r['Mobile Number']} />
                        </td>
                        <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${subscriberTypeColor(subType)}`}>{subType}</span></td>
                        <td className={`px-4 py-2 text-xs ${gistColor(gist)}`}>{gist}</td>
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
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canOutreach ? (
                            <ThreeStateButton
                              status={getStatus(r)}
                              onPickUp={() => handlePickUp(r)}
                              onResolve={() => handleResolve(r, 'churn', () => {
                                markDone(r.id, () => handleRecovered(r));
                              })}
                              color="bg-amber"
                            />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={14} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Gist</th>
                  <th className="px-4 py-2">Sentiment</th>
                  <th className="px-4 py-2">Objection</th>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 max-w-[200px]">Summary</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedCallbacksReq.map(r => {
                  const key = `scbr-${r.id}`;
                  const gist = computeGist(r);
                  const subType = subscriberType(r);
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggle(key)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-2">
                          <PhoneNumber number={r['Mobile Number']} />
                        </td>
                        <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${subscriberTypeColor(subType)}`}>{subType}</span></td>
                        <td className={`px-4 py-2 text-xs ${gistColor(gist)}`}>{gist}</td>
                        <td className="px-4 py-2">
                          {r['Customer Sentiment Score'] != null ? (
                            <span className={`font-mono font-bold ${sentimentScoreColor(r['Customer Sentiment Score'])}`}>{r['Customer Sentiment Score']}/5</span>
                          ) : '--'}
                        </td>
                        <td className="px-4 py-2 text-xs">{r['Customer Objection'] || '--'}</td>
                        <td className="px-4 py-2">{r['Agent Name'] || '--'}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs">{r['Call Date'] || '--'} {r['Call Time'] || ''}</td>
                        <td className="px-4 py-2">{r['Call Label'] ? <Chip text={r['Call Label']} className={callLabelColor(r['Call Label'])} /> : <span className="text-gray-300">--</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-[200px]"><ExpandableSummary text={r['Summary']} /></td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          {canOutreach ? (
                            <ThreeStateButton
                              status={getStatus(r)}
                              onPickUp={() => handlePickUp(r)}
                              onResolve={() => handleResolve(r, 'callbacksRequested', () => {
                                markDone(r.id, () => handleCallbackDone(r));
                              })}
                              color="bg-amber"
                            />
                          ) : (
                            <span className="text-xs text-gray-400">View only</span>
                          )}
                        </td>
                      </tr>
                      {expanded === key && <ExpandedRow r={r} colSpan={10} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
