import { useState, useEffect, useMemo } from 'react';
import {
  fetchAllPitchVersions, fetchLatestSuggestion,
  updateSuggestionStatus, approveAndCreateVersion,
} from '../lib/airtable';

// ─────────────────────────── constants ───────────────────────────

const CHANNELS = [
  { key: 'welcome',     label: 'Welcome Call',  emoji: '📞', color: '#1D4ED8', bg: '#EFF6FF' },
  { key: 'pharmacy',    label: 'Pharmacy',       emoji: '💊', color: '#7C3AED', bg: '#F5F3FF' },
  { key: 'diagnostics', label: 'Diagnostics',    emoji: '🔬', color: '#0F766E', bg: '#F0FDFA' },
  { key: 'healthcare',  label: 'Healthcare',     emoji: '🏥', color: '#B45309', bg: '#FFFBEB' },
];

const Q_LABELS = [
  { key: 'Q1 User Agent Screened',         short: 'Q1 Screen' },
  { key: 'Q2 Cashback Correct',            short: 'Q2 Cashback' },
  { key: 'Q3 WA Link Sent',               short: 'Q3 WA Link' },
  { key: 'Q4 Hi Attempt Made',            short: 'Q4 Hi' },
  { key: 'Q5 Cashback Mechanic Explained', short: 'Q5 Mechanic' },
  { key: 'Q6 No Improvised Claims',       short: 'Q6 Compliant' },
];

// ─────────────────────────── helpers ───────────────────────────

function computeDropoffFromRecords(records) {
  // Filter to QA-eligible records (welcome calls, >45s, has transcript)
  const eligible = records.filter(r => {
    const dur = r['Duration Seconds'] || r.fields?.['Duration Seconds'] || 0;
    const cat = r['Call Disposition'] || r['callCategory'] || r.fields?.['Call Disposition'] || '';
    const fw  = r['Evaluation Framework'] || r['evaluationFramework'] || r.fields?.['Evaluation Framework'] || '';
    return dur > 45 && (cat === 'Welcome-Call' || fw === 'Welcome-Call-QA');
  });
  if (eligible.length === 0) return null;
  return Q_LABELS.map(({ key, short }) => {
    const passing = eligible.filter(r => r[key] || r.fields?.[key]).length;
    return { label: short, pct: Math.round(passing / eligible.length * 100), count: passing, total: eligible.length };
  });
}

function colorForPct(pct) {
  return pct >= 70 ? '#16A34A' : pct >= 40 ? '#D97706' : '#DC2626';
}

// ─────────────────────────── sub-components ───────────────────────────

function FunnelMetric({ label, value, target, prev }) {
  const pct   = value || 0;
  const hit   = pct >= target;
  const delta = prev != null ? parseFloat((pct - prev).toFixed(1)) : null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span style={{ color: '#374151' }}>{label}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {delta !== null && delta !== 0 && (
            <span style={{ color: delta > 0 ? '#16A34A' : '#DC2626', fontWeight: 600 }}>
              {delta > 0 ? '+' : ''}{delta}pp
            </span>
          )}
          <span style={{ fontWeight: 700, color: hit ? '#16A34A' : '#DC2626' }}>
            {pct}% {hit ? '✓' : `(target: ${target}%)`}
          </span>
        </div>
      </div>
      <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3 }}>
        <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(pct, 100)}%`,
          background: hit ? '#16A34A' : '#F59E0B' }} />
      </div>
    </div>
  );
}

function DropoffCurve({ dropoff }) {
  if (!dropoff) return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
      No QA-eligible calls found for drop-off analysis.
    </div>
  );

  const maxPct = Math.max(...dropoff.map(d => d.pct), 1);

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        Pitch Drop-off Curve &nbsp;·&nbsp; {dropoff[0]?.total || 0} calls analysed
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
        {dropoff.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: colorForPct(d.pct), marginBottom: 2 }}>
              {d.pct}%
            </span>
            <div style={{
              width: '100%', borderRadius: '3px 3px 0 0',
              height: `${Math.round(d.pct / maxPct * 60)}px`,
              background: colorForPct(d.pct),
              transition: 'height 0.3s ease',
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {dropoff.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: '#9CA3AF',
            paddingTop: 3, borderTop: '1px solid #F3F4F6' }}>
            {d.label}
          </div>
        ))}
      </div>
      {/* Biggest drop callout */}
      {(() => {
        let biggestDrop = 0; let biggestIdx = -1;
        for (let i = 1; i < dropoff.length; i++) {
          const drop = dropoff[i-1].pct - dropoff[i].pct;
          if (drop > biggestDrop) { biggestDrop = drop; biggestIdx = i; }
        }
        if (biggestIdx < 0 || biggestDrop < 5) return null;
        return (
          <div style={{ marginTop: 8, background: '#FEF3C7', border: '1px solid #FDE68A',
            borderRadius: 4, padding: '5px 10px', fontSize: 11, color: '#92400E' }}>
            ⚠️ Biggest drop: {dropoff[biggestIdx-1].label} → {dropoff[biggestIdx].label} (−{biggestDrop}pp) — focus coaching here
          </div>
        );
      })()}
    </div>
  );
}

function VersionTimeline({ versions }) {
  if (!versions || versions.length === 0) return null;
  const all = [...versions].sort((a, b) =>
    (a['Active From'] || '').localeCompare(b['Active From'] || '')
  );

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        Version Timeline — {all.length} versions
      </div>
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <div style={{ position: 'absolute', left: 7, top: 0, bottom: 0,
          width: 2, background: '#E5E7EB' }} />
        {all.map((v, i) => {
          const verdict = v['Hypothesis Verdict'];
          const dotColor = { Confirmed: '#16A34A', Refuted: '#DC2626', Inconclusive: '#9CA3AF', Pending: '#D97706' }[verdict] || '#9CA3AF';
          const isActive = v['Status'] === 'Active';
          return (
            <div key={v.id} style={{ position: 'relative', marginBottom: 14, paddingLeft: 16 }}>
              <div style={{
                position: 'absolute', left: -13, top: 4,
                width: 10, height: 10, borderRadius: '50%',
                background: isActive ? '#1D4ED8' : dotColor,
                border: isActive ? '2px solid #93C5FD' : '2px solid #fff',
                boxShadow: '0 0 0 1px #E5E7EB',
              }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>
                  {v['Version ID']}
                  {isActive && (
                    <span style={{ marginLeft: 6, background: '#DBEAFE', color: '#1D4ED8',
                      fontSize: 10, fontWeight: 600, borderRadius: 3, padding: '1px 5px' }}>
                      ACTIVE
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 10, color: '#9CA3AF' }}>{v['Active From']}</span>
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 2 }}>
                {v['What Changed']?.substring(0, 100)}{v['What Changed']?.length > 100 ? '...' : ''}
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#9CA3AF' }}>
                <span>Hook {v['Hook Retention Pct']}%</span>
                <span>Activation {v['Activation Rate Pct']}%</span>
                <span>{v['Total Calls']} calls</span>
                {verdict && (
                  <span style={{ color: dotColor, fontWeight: 600 }}>{verdict}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScriptCard({ channel, isActive = false }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = CHANNELS.find(c => c.key === channel) || CHANNELS[0];

  const PLACEHOLDER_SCRIPTS = {
    welcome: `Opening: "Namaskar! Main [Name] bol raha hoon Ayushpay ki taraf se. Kya aap [sub name] ji se baat kar sakta hoon?"

Hook (first 45s): Confirm they're an Ayushpay subscriber → mention their active benefit → ask one qualifying question about current health spend.

Key points to cover:
• What Ayushpay gives them (cashback + healthcare network)
• WhatsApp link for easy access
• One specific use case relevant to them

Consent: "Kya main aapko WhatsApp pe details bhej sakta hoon?"`,
    pharmacy: `Opening: "Aapko pata hai aap Ayushpay ke through medicine 20% saste le sakte hain?"

Qualify: "Kya aap regularly koi medicine lete hain ya ghar mein koi leta hai?"

If yes → Route to pharmacy partner / share partner list.
If no → Ask about family health needs.

Close: Book pharmacy visit or send partner list on WhatsApp.`,
    diagnostics: `Opening: "Ayushpay mein aapko diagnostic tests pe bhi discount milta hai — blood tests, X-ray, sab."

Qualify: "Kya doctor ne koi test recommend kiya hai recently?"

If yes → Share nearest lab partner + pricing.
If no → Mention annual preventive check-up package.

Close: Book test or send partner network on WhatsApp.`,
    healthcare: `Opening: "Ayushpay ke through aap OPD consultations aur surgery pe bhi benefit le sakte hain."

Qualify: "Kya family mein koi ongoing health issue hai ya doctor visit upcoming hai?"

Healthcare urgency check:
• Surgery planned? → Escalate to Samir immediately
• OPD needed? → Share doctor network
• Hospitalization? → Guide through cashless process

Close: Connect with Samir for high-urgency cases, else send network details.`,
  };

  return (
    <div style={{
      border: `1px solid ${isActive ? cfg.color : '#E5E7EB'}`,
      borderRadius: 8, overflow: 'hidden', background: '#fff',
    }}>
      <div style={{
        background: isActive ? cfg.bg : '#F9FAFB',
        padding: '10px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16 }}>{cfg.emoji}</span>
          <span style={{ fontWeight: 600, fontSize: 13, color: isActive ? cfg.color : '#374151' }}>
            {cfg.label} Script
          </span>
          {isActive && (
            <span style={{ background: cfg.color, color: '#fff', fontSize: 10, fontWeight: 700,
              borderRadius: 3, padding: '1px 5px' }}>APPROVED</span>
          )}
        </div>
        <button onClick={() => setExpanded(!expanded)}
          style={{ fontSize: 11, color: '#6B7280', background: 'none', border: '1px solid #D1D5DB',
            borderRadius: 3, padding: '2px 8px', cursor: 'pointer' }}>
          {expanded ? 'Hide ↑' : 'View Script ↓'}
        </button>
      </div>
      {expanded && (
        <div style={{ padding: 14 }}>
          <pre style={{ fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap',
            fontFamily: 'inherit', color: '#374151', margin: 0 }}>
            {PLACEHOLDER_SCRIPTS[channel] || 'Script not yet configured.'}
          </pre>
          <div style={{ marginTop: 10, padding: '6px 10px', background: '#F9FAFB',
            borderRadius: 4, fontSize: 11, color: '#9CA3AF' }}>
            💡 When a new pitch version is approved, this script updates automatically for agent training and QA criteria.
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── main export ───────────────────────────

export default function PitchPerformance({ wcRecords = [], userRole }) {
  const [versions,    setVersions]    = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [nimithNote,  setNimithNote]  = useState('');
  const [acting,      setActing]      = useState(false);
  const [activeTab,   setActiveTab]   = useState('performance');

  useEffect(() => {
    fetchAllPitchVersions().then(setVersions);
    fetchLatestSuggestion().then(setSuggestions);
  }, []);

  const latestSuggestion = suggestions[0];
  const activeVersion    = versions.find(v => v['Status'] === 'Active');
  const pastVersions     = versions.filter(v => v['Status'] === 'Superseded');
  const allVersions      = versions;
  const hasSuggestion    = latestSuggestion?.['Status'] === 'Pending Review';
  const canApprove       = userRole === 'ADMIN' || userRole === 'MANAGER' || userRole === 'MANAGER_WELCOME';

  // Drop-off from actual call records
  const dropoff = useMemo(() => computeDropoffFromRecords(wcRecords), [wcRecords]);

  // Hero KPIs
  const hookPct       = activeVersion?.['Hook Retention Pct']  || 0;
  const completionPct = activeVersion?.['Completion Rate Pct'] || 0;
  const activationPct = activeVersion?.['Activation Rate Pct'] || 0;
  const cbQualityPct  = activeVersion?.['Callback Quality Pct'] || 0;
  const pitchLights   = [
    hookPct >= 80       ? 'green' : hookPct >= 60       ? 'amber' : 'red',
    completionPct >= 85 ? 'green' : completionPct >= 65 ? 'amber' : 'red',
    activationPct >= 8  ? 'green' : activationPct >= 5  ? 'amber' : 'red',
    cbQualityPct >= 60  ? 'green' : cbQualityPct >= 40  ? 'amber' : 'red',
  ];
  const pitchReds    = pitchLights.filter(l => l === 'red').length;
  const pitchGreens  = pitchLights.filter(l => l === 'green').length;
  const pitchVerdict = pitchReds >= 2 ? 'red' : pitchGreens >= 3 ? 'green' : 'amber';

  const handleApprove = async () => {
    if (!latestSuggestion) return;
    setActing(true);
    try {
      const newId = await approveAndCreateVersion(
        latestSuggestion.id, activeVersion?.['Version ID'], latestSuggestion
      );
      alert(`Created ${newId}. Active from tomorrow. QA criteria updated. Brief agents before next shift.`);
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

  const TABS = [
    { key: 'performance', label: 'Performance' },
    { key: 'suggestion',  label: `Suggestion${hasSuggestion ? ' 🔔' : ''}` },
    { key: 'scripts',     label: 'Script Library' },
    { key: 'history',     label: 'Version History' },
  ];

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: 20 }}>

      {/* Header + AI badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Pitch Lab</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ background: '#FDF4FF', border: '1px solid #E9D5FF', color: '#7C3AED',
            fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '3px 8px' }}>
            ✨ Powered by Claude Sonnet
          </span>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>
            Analysis runs weekly · suggestions auto-generated
          </span>
        </div>
      </div>

      {/* Verdict banner */}
      {activeVersion && (
        <div className="space-y-3 mb-4">
          <div className={`${pitchVerdict === 'green' ? 'bg-green-600' : pitchVerdict === 'amber' ? 'bg-yellow-500' : 'bg-red-600'} text-white rounded-xl px-5 py-3 flex items-center justify-between`}>
            <div>
              <p className="text-2xl font-black">
                {pitchVerdict === 'green' ? 'Pitch Working' : pitchVerdict === 'amber' ? 'Pitch Needs Watch' : 'Pitch Underperforming'}
              </p>
              <p className="text-xs opacity-80">
                {activeVersion['Version ID']} — {activeVersion['Total Calls'] || 0} calls &nbsp;·&nbsp;
                {pastVersions.length} versions tested
              </p>
            </div>
            <div className="flex gap-2">
              {pitchLights.map((l, i) => (
                <span key={i} className={`w-3 h-3 rounded-full ${l === 'green' ? 'bg-green-300' : l === 'amber' ? 'bg-yellow-300' : 'bg-red-300'}`} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Hook Retention', val: hookPct, target: '80%', li: 0 },
              { label: 'Completion', val: completionPct, target: '85%', li: 1 },
              { label: 'Activation', val: activationPct, target: '8%', li: 2 },
              { label: 'CB Quality', val: cbQualityPct, target: '60%', li: 3 },
            ].map(({ label, val, target, li }) => (
              <div key={label} className={`rounded-xl border p-4 ${pitchLights[li] === 'green' ? 'bg-green-50 border-green-200' : pitchLights[li] === 'amber' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">{label}</p>
                <p className={`text-2xl font-bold ${pitchLights[li] === 'green' ? 'text-green-700' : pitchLights[li] === 'amber' ? 'text-yellow-700' : 'text-red-700'}`}>{val}%</p>
                <p className="text-[10px] text-gray-400">target {target}</p>
              </div>
            ))}
            <div className={`rounded-xl border p-4 ${hasSuggestion ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">AI Suggestion</p>
              <p className={`text-2xl font-bold ${hasSuggestion ? 'text-purple-700' : 'text-gray-500'}`}>{hasSuggestion ? 'Pending' : 'None'}</p>
              <p className="text-[10px] text-gray-400">{pastVersions.length} versions tested</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #E5E7EB',
        paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: 'none', background: 'none',
              borderBottom: activeTab === t.key ? '2px solid #1D4ED8' : '2px solid transparent',
              color: activeTab === t.key ? '#1D4ED8' : '#6B7280',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ PERFORMANCE TAB ══ */}
      {activeTab === 'performance' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Active version funnel */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
            {activeVersion ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{activeVersion['Version ID']}</span>
                    <span style={{ marginLeft: 8, background: '#D1FAE5', color: '#065F46',
                      borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                      ACTIVE
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: '#9CA3AF' }}>
                    Since {activeVersion['Active From']} · {activeVersion['Total Calls'] || 0} calls
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12,
                  background: '#F9FAFB', padding: '8px 10px', borderRadius: 4 }}>
                  <strong>Changed:</strong> {activeVersion['What Changed']}
                </div>
                <FunnelMetric label="Hook Retention (stayed >45s)"     value={activeVersion['Hook Retention Pct']}  target={80} />
                <FunnelMetric label="Completion (full conversation)"    value={activeVersion['Completion Rate Pct']} target={85} />
                <FunnelMetric label="Activation (sent Hi on WA)"       value={activeVersion['Activation Rate Pct']} target={8}  />
                <FunnelMetric label="Callback Quality (specific time)"  value={activeVersion['Callback Quality Pct']} target={60} />
                <div style={{ marginTop: 8, fontSize: 12, color: '#6B7280' }}>
                  Hook Fails: <strong>{activeVersion['Hook Fail Count'] || 0}</strong>
                  &nbsp;·&nbsp; Drop Rate: <strong>{activeVersion['Drop Rate Pct'] || 0}%</strong>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
                No active version — run the pitch engine to generate the first version.
              </div>
            )}
          </div>

          {/* Drop-off curve from live records */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
              Live Drop-off Curve
              <span style={{ marginLeft: 8, fontSize: 11, color: '#9CA3AF', fontWeight: 400 }}>
                from {wcRecords.length} call records this period
              </span>
            </div>
            <DropoffCurve dropoff={dropoff} />
          </div>
        </div>
      )}

      {/* ══ SUGGESTION TAB ══ */}
      {activeTab === 'suggestion' && (
        <>
          {latestSuggestion ? (
            <div style={{ background: '#fff', border: '2px solid #7C3AED', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#7C3AED' }}>
                  ✨ Claude Sonnet Analysis
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, background: '#F3F4F6', borderRadius: 4,
                    padding: '2px 8px', color: '#374151' }}>
                    Bottleneck: <strong>{latestSuggestion['Bottleneck Identified']}</strong>
                  </span>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                    {latestSuggestion['Suggestion Date']} · {latestSuggestion['Calls Analysed']} calls
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
                  Proposed new script section
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

              {/* QA auto-update notice */}
              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
                padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#1D4ED8' }}>
                ℹ️ Approving this pitch will automatically update QA criteria (Q1–Q6) and the Script Library for agent training.
              </div>

              {latestSuggestion['Status'] === 'Pending Review' ? (
                <div>
                  <textarea
                    placeholder="Your notes (optional)..."
                    value={nimithNote}
                    onChange={e => setNimithNote(e.target.value)}
                    style={{ width: '100%', padding: 8, fontSize: 12, borderRadius: 4,
                      border: '1px solid #D1D5DB', marginBottom: 8, resize: 'vertical',
                      minHeight: 60 }}
                  />
                  {canApprove ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={handleApprove} disabled={acting}
                        style={{ background: '#7C3AED', color: '#fff', border: 'none',
                          borderRadius: 4, padding: '8px 16px', fontSize: 13,
                          fontWeight: 600, cursor: 'pointer', opacity: acting ? 0.5 : 1 }}>
                        ✓ Approve → Deploy as next version
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
                  ) : (
                    <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                      Approval requires ADMIN or MANAGER role.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                  Status: <strong>{latestSuggestion['Status']}</strong>
                  {latestSuggestion['Implemented As Version'] && (
                    <> · Implemented as <strong>{latestSuggestion['Implemented As Version']}</strong></>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9CA3AF' }}>
              <p style={{ fontSize: 16, marginBottom: 8 }}>No suggestion pending</p>
              <p style={{ fontSize: 13 }}>Claude Sonnet analysis runs weekly. Check back after the next Sunday 8 PM IST run.</p>
            </div>
          )}
        </>
      )}

      {/* ══ SCRIPT LIBRARY TAB ══ */}
      {activeTab === 'scripts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>
            Approved call scripts per channel. Scripts auto-update when a new pitch version is approved.
            Agents are trained on the latest approved version.
          </div>
          {CHANNELS.map(ch => (
            <ScriptCard key={ch.key} channel={ch.key} isActive={ch.key === 'welcome' && !!activeVersion} />
          ))}
        </div>
      )}

      {/* ══ VERSION HISTORY TAB ══ */}
      {activeTab === 'history' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
            <VersionTimeline versions={allVersions} />
            {allVersions.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>
                No versions recorded yet.
              </div>
            )}
          </div>

          {/* Past version cards */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Institutional Memory — {pastVersions.length} tested
            </div>
            {pastVersions.length === 0 ? (
              <div style={{ color: '#9CA3AF', fontSize: 13 }}>No superseded versions yet.</div>
            ) : (
              pastVersions.map(v => {
                const verdict = v['Hypothesis Verdict'];
                const verdictColor = {
                  Confirmed: '#16A34A', Refuted: '#DC2626',
                  Inconclusive: '#9CA3AF', Pending: '#D97706',
                }[verdict] || '#9CA3AF';
                return (
                  <div key={v.id} style={{ borderLeft: `3px solid ${verdictColor}`,
                    paddingLeft: 10, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{v['Version ID']}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: verdictColor }}>{verdict}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#374151', marginBottom: 2 }}>
                      {v['What Changed']?.substring(0, 120)}{v['What Changed']?.length > 120 ? '...' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                      Hook: {v['Hook Retention Pct']}% · Activation: {v['Activation Rate Pct']}% · {v['Total Calls']} calls
                    </div>
                    {v['Result'] && (
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, fontStyle: 'italic' }}>
                        {v['Result']?.substring(0, 150)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!activeVersion && suggestions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9CA3AF' }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>No pitch data yet</p>
          <p style={{ fontSize: 13 }}>Claude Sonnet analysis runs every Sunday at 8 PM IST.</p>
        </div>
      )}
    </div>
  );
}
