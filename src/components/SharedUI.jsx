import { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

/**
 * ExpandableSummary — replaces truncate(r['Summary']) in table cells.
 * Shows first ~80 chars with a "more" toggle to expand inline.
 */
export function ExpandableSummary({ text, limit = 80 }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-gray-400">--</span>;
  if (text.length <= limit) return <span>{text}</span>;
  return (
    <span>
      {open ? text : text.slice(0, limit) + '...'}
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="ml-1 text-info text-[10px] font-medium hover:underline"
      >
        {open ? 'less' : 'more'}
      </button>
    </span>
  );
}

// ══════════════════════════════════════════════════════════════
// parseTranscript — Two-phase parser with vocabulary fingerprints
// Phase 1: Strip pre-connection audio (caller tunes, IVR)
// Phase 2: Classify using vocab fingerprints + alternation tracking
// ══════════════════════════════════════════════════════════════

// Caller tune / ringtone patterns — telecom network audio, not any human speaker
const CALLER_TUNE_PATTERNS = [
  // Poetry/shayari ringtones
  /^जानी तुमने/i, /^शेर को फ़ोन/i, /^माँ को लिखिये/i,
  /^आजा आजा/i, /^जशो दरो/i,
  // Devotional ringtones
  /जय हनुमान/i, /हनुमान चालीसा/i, /ॐ जय जगदीश/i,
  /कृष्णाय वासुदेवाय/i, /राम दूत/i, /जय कपी/i,
  /om jai jagdish/i, /jai ho jai ho/i,
  /सत्यम शिवम/i, /हरे राम/i, /हरे कृष्ण/i,
  // Song lyrics (common ringtone patterns)
  /mere rashke qamar/i, /tujhe dekha toh/i,
];

// IVR / automated system patterns
const IVR_PATTERNS = [
  /aapke dwara dial/i, /आपके द्वारा डायल/i,
  /the number you have dialed/i, /number you have called/i,
  /व्यस्त है/, /currently busy/i, /try later/i, /try again later/i,
  /switched off/i, /not reachable/i, /not available/i,
  /voicemail/i, /voice mail/i, /record your message/i,
  /forwarded to/i, /not answering/i, /unable to take/i,
  /व्यक्ति को कॉल कर/, /व्यक्ति से संपर्क/,
  /speaking to someone else/i, /दूसरे कॉल पर/,
  /उत्तर नहीं/, /is busy/i,
  /dialed number/i, /dialed is currently/i,
  /please try later/i, /currently unavailable/i,
  /the subscriber/i, /abhi upalabdh nahi/i,
  /कृपया प्रतीक्षा/, /krupaya pratiksha/i,
  /स्वीकार नहीं/, /aapki call sweekar/i,
];

// Agent opening patterns — first lines that signal conversation start
function buildAgentOpeningPatterns(agentFirst) {
  const patterns = [
    /namaste sir/i, /namaskar sir/i, /नमस्कार सर/i,
    /namaste madam/i, /namaskar madam/i,
    /good evening/i, /good morning/i, /good afternoon/i,
    /hello.*ayush/i, /हेलो.*आयुष/i,
    /main ayush/i, /मैं आयुष/i,
    /personal health guardian/i, /पर्सनल हेल्थ गार्डियन/i,
    /aapka personal/i, /आपका पर्सनल/i,
    /main ayushpay se/i, /main ayush pe se/i,
    /mera naam/i, /main bol raha/i, /main bol rahi/i,
    /ayushpay se/i, /ayushpay ki/i,
  ];
  if (agentFirst && agentFirst.length >= 3) {
    patterns.push(
      new RegExp(agentFirst + '.*baat kar', 'i'),
      new RegExp(agentFirst + '.*बात कर', 'i'),
      new RegExp('main ' + agentFirst, 'i'),
      new RegExp('मैं ' + agentFirst, 'i'),
      new RegExp('hum ' + agentFirst, 'i'),
    );
  }
  return patterns;
}

// AGENT vocabulary fingerprints — things only the agent would say
const AGENT_VOCAB = [
  // Openings (Devanagari — common STT output)
  /मैं आयुश पे से/, /मैं आयुष पे से/, /आयुष से बात कर/,
  /पर्सनल हेल्थ गार्डियन/, /personal health guardian/i,
  /वेलकम कॉल/, /welcome call/i,
  /नमस्कार सर मैं/, /नमस्कार मैडम/,
  /मेरी बात.*जी से हो रही/, /क्या मेरी बात/,
  // Openings (Romanized)
  /main ayushpay se/i, /ayush pe se/i,
  /ayush.*team se/i, /ayush dot team/i,
  // AyushPay-specific explanations
  /मैं आपको बताना चाहूं/, /main aapko bataana/i,
  /आगे बढ़ने से पहले/, /aage badhne se pehle/i,
  /एक छोटा सा काम/, /ek chhota sa kaam/i,
  /आयुष पे के माध्यम/, /ayushpay ke madhyam/i,
  /हमारी टीम/, /hamari team/i,
  /25% तक/, /25 percent/i, /कैशबैक/,
  /दस हज़ार/, /दस हजार/, /das hazaar/i,
  /₹10000/, /10,000/, /मेडिकल वॉलेट/,
  /व्हाट्सएप पर.*मैसेज/, /whatsapp par message/i, /whatsapp pe message/i,
  /रजिस्टर्ड मोबाइल/, /registered mobile/i,
  /पोर्टल.*लॉग इन/, /portal.*login/i, /पोर्टल लिंक/,
  /मैं आपको.*नंबर बता/, /main aapko.*number/i,
  /हाय का मैसेज/, /hi ka message/i,
  /लिंक.*व्हाट्सएप/, /link.*whatsapp/i,
  /आपके वॉलेट/, /aapke wallet/i, /aapka wallet/i,
  /हमारे डॉक्टर/, /hamare doctor/i,
  /15 लाख/, /15 lakh/i,
  /पहले साल.*बिना ब्याज/, /pehle saal.*bina byaaj/i,
  // Agent plan/product explanations
  /medical wallet/i, /health plan/i, /health protection/i,
  /lab test/i, /doctor consultation/i,
  /cashback wallet/i,
  /roynet/i, /roinet/i, /bitcom/i, /rnfi/i, /रॉयनेट/, /रॉन्ग कॉनिड/,
  /आपने.*प्लान लिया/, /aapne plan liya/i,
  // Agent questions/instructions to subscriber
  /आपको.*आया है.*नहीं/,
  /क्या आप.*चेक कर/, /आपने चेक कर/,
  /आपने.*भेज दिया/, /आपने.*सेंड कर/,
  /आप.*जॉइन.*करेंगे/,
  /कन्फर्मेशन.*दे दीजिए/, /कन्फर्म कर/,
  /लिखिए|नोट कर लीजिए/,
  /main aapko inform/i, /main aapko contact/i,
  /confirmation ke liye/i, /confirm karne ke liye/i,
  /kya meri baat/i, /kya main baat kar/i,
  /aapko ek link/i, /aapke paas ek link/i,
  /login kar lijiye/i,
  // Agent-style transitions
  /मैं आपको.*बताना चाहूंगी/, /मैं आपको.*बताता हूं/, /मैं आपको.*बता देता/,
  /बेनिफिट्स बताना/, /चार बे/, /आपकी.*सहायता/,
  /इसी संबंध में/, /छोटी सी वेलकम/, /सात से आठ मिनट/,
  /क्वेश्चन पूछना/, /क्वेश्चन.*पूछूंगी/,
  /एजेंट से पर्सपेक्टिव/, /कस्टमर को कैसे ऑफर/,
  /कॉल बैक अरेंज/, /मैं जान सकती/,
  /रियल कैश/, /रियल मनी/, /डायरेक्टली बैंक/,
];

// SUBSCRIBER vocabulary fingerprints — things only subscriber would say
const SUBSCRIBER_VOCAB = [
  // Short acknowledgments (always subscriber) — exact match with optional punctuation
  /^(हाँ|हां|हाँ जी|हां जी|जी|ठीक है|ठीक|ok|okay|हम्म|hmm|अच्छा)[।.!?]?$/i,
  /^(नहीं|नहीं जी|नहीं सर|बोलिए|बताइए|बोलो)[।.!?]?$/i,
  /^(बिल्कुल|जरूर|ओके|ओके सर|ओके जी|धन्यवाद)[।.!?]?$/i,
  /^(haan|haan ji|ji|theek hai|theek|ok|okay|nahi|nahi ji|hello)[।.!?]?$/i,
  /^(bataiye|boliye|bol|ha|hmm|hm|acha|accha|sahi|bilkul|zaroor)[।.!?]?$/i,
  /^(haanji|bolo|kya hai|kaun|kon)[।.!?]?$/i,
  // Short with "sir/madam" suffix (subscriber politeness)
  /^(हाँ सर|हां सर|जी सर|ठीक है सर|ओके सर|नहीं सर)[।.!?]?$/i,
  /^(हाँ मैम|हां मैम|जी मैम|ठीक है मैम|ओके मैम|बोलिए मैम)[।.!?]?$/i,
  /^(हां मैम चलिए|हाँ मैम चलिए)[।.!?]?$/i,
  // Subscriber identifying themselves / their situation
  /मेरा ब्रदर/, /मेरे भाई/, /mere.*bhai/,
  /मेरे.*माताजी/, /मेरी.*माँ/, /meri.*mata/i, /meri.*maa/i,
  /मेरे.*पिताजी/, /mere.*pita/i,
  /मेरे.*रिलेटिव/, /मेरा.*रिश्तेदार/,
  /^नहीं नहीं (मैं|मेरा|मेरे|मेरी|हम|एजेंट|कस्टमर|यूजर)/, /^नहीं एक्चुअली/,  // subscriber corrections (with context)
  // Subscriber-specific expressions
  /मुझे.*समझ नहीं/, /samajh nahi/i,
  /हम.*बिजी/, /hum.*busy/i,
  /अभी.*नहीं.*कर पाऊंगा/,
  /खाना खा रहा/, /khaana kha raha/i,
  /गाड़ी चला रहा/, /gaadi chala/i,
  /दुकान पर/, /dukan par/i,
  /बाद में.*call/, /baad mein/i,
  /एप.*डाउनलोड नहीं/, /app.*download nahi/i,
  /प्ले स्टोर/, /play store/i,
  // Subscriber questions to agent
  /कितना.*मिलेगा/,
  /कैसे.*ऑर्डर/,
  /कब.*मिलेगा/,
  /कहाँ से.*लें/,
  /क्या नहीं हो रहा/, // subscriber confusion/questions
  /नहीं है मैडम/, /नहीं है सर/,
  /रेगुलर मेडिसिन/, // subscriber describing their needs
  /मेरा नाम/, // subscriber stating their name
  /मैं शायद.*हूँ/, /मैं.*यूजर/,  // subscriber self-identification
];

/**
 * parseTranscript — Two-phase transcript parser with vocabulary fingerprints.
 *
 * Phase 1: Strip pre-connection audio (caller tunes, IVR before agent speaks)
 * Phase 2: Classify using vocab fingerprints + speaker alternation tracking
 *
 * Speaker types:
 *   Operator   — IVR/automated messages, caller tunes (pre-connection)
 *   Agent      — AyushPay agent (identified by vocab fingerprints + continuity)
 *   Subscriber — customer responses (short acknowledgments, questions, objections)
 */
export function parseTranscript(transcript, agentName) {
  if (!transcript) return null;
  const STT_FAILED = ['[STT Failed]', '[STT Failed — audio could not be processed]'];
  if (STT_FAILED.some(s => transcript.includes(s))) return null;

  // ── PHASE 1: Strip pre-connection audio ──────────────────────
  const agentFirst = (agentName || '').split(' ')[0].toLowerCase();
  const AGENT_OPENING_PATTERNS = buildAgentOpeningPatterns(agentFirst);

  // Split into lines
  let lines = transcript.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

  // If only 1-2 lines (blob transcript), split by sentence endings
  if (lines.length <= 2) {
    lines = transcript
      .split(/(?<=[।.!?])\s+/)
      .filter(s => s.trim().length > 3)
      .map(s => s.trim());
  }

  // If still only 1 segment, try splitting on punctuation boundaries
  if (lines.length <= 1 && transcript.length > 100) {
    lines = transcript
      .split(/(?<=[।.!?])/)
      .filter(s => s.trim().length > 3)
      .map(s => s.trim());
  }

  // Find where the actual conversation starts
  // Look for agent greeting as the real starting point
  let conversationStartIndex = 0;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    if (AGENT_OPENING_PATTERNS.some(p => p.test(lines[i]))) {
      // Handle merged caller-tune + agent greeting in same line
      // e.g. "जानी तुमने...शेर अपने हिसाब से फ़ोन उठाएगा जब मूड होगा नमस्कार सर मैं आयुष पेश से..."
      if (i === 0 && CALLER_TUNE_PATTERNS.some(p => p.test(lines[i]))) {
        // Split this line at the agent opening pattern match point
        for (const p of AGENT_OPENING_PATTERNS) {
          const m = lines[i].search(p);
          if (m > 10) { // Must have at least some text before the match
            const callerTunePart = lines[i].slice(0, m).trim();
            const agentPart = lines[i].slice(m).trim();
            if (callerTunePart && agentPart) {
              lines.splice(i, 1, callerTunePart, agentPart);
              conversationStartIndex = i + 1;
            }
            break;
          }
        }
        if (conversationStartIndex === 0) conversationStartIndex = i;
      } else {
        conversationStartIndex = i;
      }
      break;
    }
  }

  // ── PHASE 2: Classify with vocabulary fingerprints + continuity ──
  const results = [];
  // After operator/IVR block, agent speaks first; otherwise start as agent
  let lastSpeaker = conversationStartIndex > 0 ? 'ivr' : 'agent';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLen = line.length;

    // Lines before conversation start = check for caller tune / IVR
    if (i < conversationStartIndex) {
      const isIVRLine = IVR_PATTERNS.some(p => p.test(line));
      const isCallerTune = CALLER_TUNE_PATTERNS.some(p => p.test(line));
      if (isIVRLine || isCallerTune) {
        results.push({
          speaker: 'Operator',
          text: line,
          icon: '🤖',
          colorClass: 'bg-gray-100 border-l-4 border-gray-400',
          isOperator: true,
        });
        continue;
      }
      // Pre-conversation line that doesn't match known patterns — still operator
      results.push({
        speaker: 'Operator',
        text: line,
        icon: '🤖',
        colorClass: 'bg-gray-100 border-l-4 border-gray-400',
        isOperator: true,
      });
      continue;
    }

    // IVR anywhere in call = OPERATOR
    if (IVR_PATTERNS.some(p => p.test(line)) && lineLen > 30) {
      results.push({
        speaker: 'Operator',
        text: line,
        icon: '🤖',
        colorClass: 'bg-gray-100 border-l-4 border-gray-400',
        isOperator: true,
      });
      lastSpeaker = 'ivr';
      continue;
    }

    // Strong AGENT vocabulary match
    if (AGENT_VOCAB.some(p => p.test(line))) {
      results.push({
        speaker: `Agent (${agentName || 'Agent'})`,
        text: line,
        icon: '👤',
        colorClass: 'bg-green-50 border-l-4 border-green-400',
        isOperator: false,
      });
      lastSpeaker = 'agent';
      continue;
    }

    // Strong SUBSCRIBER vocabulary match (including short acknowledgments)
    if (SUBSCRIBER_VOCAB.some(p => p.test(line))) {
      results.push({
        speaker: 'Subscriber',
        text: line,
        icon: '👥',
        colorClass: 'bg-blue-50 border-l-4 border-blue-400',
        isOperator: false,
      });
      lastSpeaker = 'subscriber';
      continue;
    }

    // CONTINUITY RULE:
    // After a subscriber line, the next unmatched line is probably agent
    // After an agent line, the next short unmatched line is probably subscriber
    // Alternate when uncertain
    if (lastSpeaker === 'subscriber') {
      // Subscriber just spoke, this is likely agent responding
      results.push({
        speaker: `Agent (${agentName || 'Agent'})`,
        text: line,
        icon: '👤',
        colorClass: 'bg-green-50 border-l-4 border-green-400',
        isOperator: false,
      });
      lastSpeaker = 'agent';
    } else if (lastSpeaker === 'agent' && lineLen < 60) {
      // Agent just spoke, this short line is likely subscriber
      results.push({
        speaker: 'Subscriber',
        text: line,
        icon: '👥',
        colorClass: 'bg-blue-50 border-l-4 border-blue-400',
        isOperator: false,
      });
      lastSpeaker = 'subscriber';
    } else {
      // Long ambiguous line after agent = probably agent continuing
      results.push({
        speaker: `Agent (${agentName || 'Agent'})`,
        text: line,
        icon: '👤',
        colorClass: 'bg-green-50 border-l-4 border-green-400',
        isOperator: false,
      });
      lastSpeaker = 'agent';
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * TranscriptViewer — renders parsed transcript with speaker attribution.
 *
 * Display rules:
 * 1. Operator lines collapsed behind "Show pre-connection audio (X lines)" toggle
 * 2. Default: show first 4 CONVERSATION lines (skip Operator)
 * 3. "Show all N turns" expands full transcript
 *
 * Speaker styles:
 *   🤖 OPERATOR / NETWORK — grey bg, grey border, italic, collapsed by default
 *   👤 AGENT (NAME)       — green bg, green border, bold label
 *   👥 SUBSCRIBER         — blue bg, blue border
 */
export function TranscriptViewer({ transcript, agentName }) {
  const [expanded, setExpanded] = useState(false);
  const [showOperator, setShowOperator] = useState(false);

  if (!transcript || transcript.startsWith('[STT Failed]')) {
    return <div className="text-gray-400 text-sm italic">Transcript not available</div>;
  }

  const turns = parseTranscript(transcript, agentName);
  if (!turns || turns.length === 0) {
    return <div className="text-gray-400 text-sm italic">Empty transcript</div>;
  }

  // Separate operator (pre-connection) lines from conversation lines
  const operatorTurns = turns.filter(t => t.isOperator);
  const conversationTurns = turns.filter(t => !t.isOperator);

  // Default: show first 4 conversation lines
  const PREVIEW_COUNT = 4;
  const displayConversation = expanded ? conversationTurns : conversationTurns.slice(0, PREVIEW_COUNT);
  const hasMoreConversation = conversationTurns.length > PREVIEW_COUNT;

  return (
    <div className="space-y-1.5 text-sm">
      {/* Operator / pre-connection audio — collapsed by default */}
      {operatorTurns.length > 0 && (
        <div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowOperator(!showOperator); }}
            className="text-gray-400 text-[10px] hover:text-gray-600 hover:underline font-medium mb-1"
          >
            {showOperator
              ? '▲ Hide pre-connection audio'
              : `▶ Show pre-connection audio (${operatorTurns.length} line${operatorTurns.length > 1 ? 's' : ''})`}
          </button>
          {showOperator && (
            <div className="space-y-1 mb-2">
              {operatorTurns.map((turn, i) => (
                <div key={`op-${i}`} className={`p-2 rounded ${turn.colorClass}`}>
                  <div className="font-semibold text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">
                    {turn.icon} OPERATOR / NETWORK
                  </div>
                  <div className="text-gray-500 text-xs italic">{turn.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conversation turns — Agent + Subscriber */}
      {displayConversation.map((turn, i) => (
        <div key={i} className={`p-2 rounded ${turn.colorClass}`}>
          <div className="font-semibold text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
            {turn.icon}{' '}
            {turn.speaker === 'Operator' ? 'OPERATOR / NETWORK' : turn.speaker.toUpperCase()}
          </div>
          <div className="text-gray-800 text-xs">{turn.text}</div>
        </div>
      ))}

      {/* Expand/collapse for conversation */}
      {hasMoreConversation && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-info text-xs hover:underline font-medium"
        >
          {expanded ? '▲ Show less' : `▼ Show all ${conversationTurns.length} turns`}
        </button>
      )}

      {/* Edge case: no conversation turns at all */}
      {conversationTurns.length === 0 && operatorTurns.length > 0 && (
        <div className="text-gray-400 text-xs italic">No conversation detected — only IVR/network audio</div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// EmotionalJourneyChart — Recharts line chart of sentiment over call duration
// Reads JSON from Airtable "Emotional Journey" field:
//   [{ window: "0:00-0:30", sentiment: 3.2, label: "Neutral opening" }, ...]
// ══════════════════════════════════════════════════════════════

const SENTIMENT_COLORS = {
  positive: '#22c55e',
  neutral: '#6b7280',
  negative: '#ef4444',
};

function sentimentColor(val) {
  if (val >= 3.5) return SENTIMENT_COLORS.positive;
  if (val >= 2.5) return SENTIMENT_COLORS.neutral;
  return SENTIMENT_COLORS.negative;
}

export function EmotionalJourneyChart({ journeyJson }) {
  const data = useMemo(() => {
    if (!journeyJson) return null;
    try {
      const parsed = typeof journeyJson === 'string' ? JSON.parse(journeyJson) : journeyJson;
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      return parsed.map((w, i) => ({
        idx: i,
        time: w.window || `${i * 30}s`,
        sentiment: Number(w.sentiment) || 3,
        label: w.label || w.key_moment || '',
      }));
    } catch {
      return null;
    }
  }, [journeyJson]);

  if (!data) return null;

  const avg = data.reduce((s, d) => s + d.sentiment, 0) / data.length;
  const min = Math.min(...data.map(d => d.sentiment));
  const max = Math.max(...data.map(d => d.sentiment));
  const delta = data.length >= 2 ? data[data.length - 1].sentiment - data[0].sentiment : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
          Emotional Journey
        </span>
        <div className="flex gap-3 text-[10px] text-gray-500">
          <span>Avg: <b className="text-gray-700">{avg.toFixed(1)}</b></span>
          <span>Min: <b style={{ color: sentimentColor(min) }}>{min.toFixed(1)}</b></span>
          <span>Max: <b style={{ color: sentimentColor(max) }}>{max.toFixed(1)}</b></span>
          <span>
            Delta:{' '}
            <b style={{ color: delta >= 0 ? '#22c55e' : '#ef4444' }}>
              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
            </b>
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
          />
          <YAxis
            domain={[1, 5]}
            ticks={[1, 2, 3, 4, 5]}
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceLine y={3} stroke="#d1d5db" strokeDasharray="3 3" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-gray-800 text-white text-[10px] px-2 py-1 rounded shadow-lg max-w-[200px]">
                  <div className="font-semibold">{d.time}</div>
                  <div>Sentiment: <b>{d.sentiment.toFixed(1)}</b>/5</div>
                  {d.label && <div className="text-gray-300 mt-0.5">{d.label}</div>}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="sentiment"
            stroke="#6366f1"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              const hasLabel = payload.label && payload.label.length > 0;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={hasLabel ? 4 : 2.5}
                  fill={sentimentColor(payload.sentiment)}
                  stroke={hasLabel ? '#6366f1' : 'none'}
                  strokeWidth={hasLabel ? 1.5 : 0}
                />
              );
            }}
            activeDot={{ r: 5, fill: '#6366f1' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
