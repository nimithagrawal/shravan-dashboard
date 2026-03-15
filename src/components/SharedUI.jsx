import { useState } from 'react';

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

// ── IVR / Operator detection ──
const IVR_MARKERS = [
  'aapke dwara dial', 'आपके द्वारा डायल', 'dial kiya gaya number',
  'डायल किया गया नंबर', 'व्यस्त है', 'व्यस्त अछि', 'व्यस्त आहे',
  'switched off', 'not reachable', 'not available',
  'try later', 'try again later', 'forwarded to voicemail',
  'voice mail', 'voicemail', 'please try later',
  'number you have dialed', 'the number you have called',
  'you have dialed', 'dialed is currently', 'currently busy',
  'speak to someone else', 'dusre call par', 'दूसरे कॉल पर',
  'krupaya pratiksha', 'कृपया प्रतीक्षा',
  'nahi mil raha', 'unable to take your call',
  'person you are trying', 'व्यक्ति को कॉल', 'व्यक्ति से संपर्क',
  'aapki call sweekar', 'स्वीकार नहीं',
  'is busy', 'the subscriber', 'abhi upalabdh nahi',
  'currently unavailable', 'dialed number',
];

function isIVR(text) {
  const t = text.toLowerCase();
  return IVR_MARKERS.some(m => t.includes(m));
}

// ── Agent detection (content-based, NOT name-based) ──
const AGENT_OPENINGS = [
  'main ayushpay se', 'main ayush pe se', 'main ayush se',
  'namaste sir main', 'namaskar sir main', 'namaskar main',
  'namaste madam main', 'namaskar madam main',
  'good evening sir', 'good morning sir', 'good afternoon sir',
  'good evening madam', 'good morning madam',
  'aapka personal health', 'आपका पर्सनल हेल्थ',
  'personal health guardian', 'पर्सनल हेल्थ गार्डियन',
  'baat kar raha hoon ayush', 'baat kar rahi hoon ayush',
  'mera naam', 'main bol raha', 'main bol rahi',
  'ayushpay se', 'ayushpay ki',
];

const AGENT_BODY = [
  'aapko bataana chahoon', 'आपको बताना चाहूं',
  'aage badhne se pehle', 'आगे बढ़ने से पहले',
  'ek chhota sa', 'एक छोटा सा',
  'hamari team', 'हमारी टीम',
  'ayushpay ke madhyam', 'ayush pe ke madhyam',
  'आयुष पे के माध्यम', 'आयुष पे के थ्रू',
  '25% tak', '25 percent', 'cashback wallet',
  'das hazaar', '₹10000', '10000 ka', '10,000',
  'medical wallet', 'health plan', 'health protection',
  'main aapko bata', 'मैं आपको बता',
  'aapke wallet', 'aapka wallet', 'आपके वॉलेट',
  'hamare doctor', 'हमारे डॉक्टर',
  'whatsapp par message', 'whatsapp pe message',
  'whatsapp par link', 'whatsapp pe link',
  'lab test', 'doctor consultation',
  'main aapko inform', 'main aapko contact',
  'aapne plan liya', 'आपने प्लान लिया',
  'roynet se', 'roinet se', 'bitcom se', 'rnfi ke',
  'register mobile number', 'registered mobile',
  'portal login', 'login kar lijiye',
  'aapka ayushpay', 'आपका आयुष पे',
  'aapko ek link', 'aapke paas ek link',
  'confirmation ke liye', 'confirm karne ke liye',
  'kya meri baat', 'kya main baat kar',
];

const SUBSCRIBER_SHORT = [
  'haan', 'haan ji', 'ji', 'theek hai', 'theek', 'ok', 'okay',
  'nahi', 'nahi ji', 'bataiye', 'boliye', 'bol',
  'हाँ', 'जी', 'ठीक है', 'ठीक', 'नहीं', 'बोलिए', 'बताइए',
  'ha', 'hmm', 'hm', 'acha', 'accha', 'अच्छा', 'हम्म',
  'sahi', 'bilkul', 'zaroor', 'बिल्कुल', 'जरूर',
  'hello', 'haanji', 'bolo', 'kya hai', 'kaun', 'kon',
];

function isAgent(text, agentFirst) {
  const t = text.toLowerCase();
  const len = text.trim().length;

  // Agent name in text (opening line)
  if (agentFirst && agentFirst.length >= 3) {
    if (t.includes('main ' + agentFirst) || t.includes('मैं ' + agentFirst) ||
        t.includes(agentFirst + ' baat kar') || t.includes(agentFirst + ' बात कर') ||
        t.includes('hum ' + agentFirst)) {
      return true;
    }
  }

  // Strong opening patterns
  if (AGENT_OPENINGS.some(p => t.includes(p))) return true;

  // Body patterns (only for longer text)
  if (len > 60 && AGENT_BODY.some(p => t.includes(p))) return true;

  // Very long segments (>150 chars) that don't start with short subscriber words
  if (len > 150 && !t.match(/^(haan|ji|nahi|theek|ok|ठीक|हाँ|नहीं|जी|hello|hmm)/)) return true;

  return false;
}

function isSubscriber(text) {
  const t = text.toLowerCase().trim();
  const len = text.trim().length;

  // Exact short responses
  if (SUBSCRIBER_SHORT.some(r => t === r || t === r + '.' || t === r + '।')) return true;

  // Very short = likely subscriber
  if (len < 25) return true;

  return false;
}

/**
 * parseTranscript — splits raw transcript into speaker-attributed turns.
 * Uses CONTENT PATTERNS (not just agent name) for classification.
 *
 * Speaker types:
 *   Operator — IVR/automated messages
 *   Agent    — AyushPay agent (identified by speech patterns, length, context)
 *   Subscriber — customer responses (short, questions, objections)
 */
export function parseTranscript(transcript, agentName) {
  if (!transcript) return null;
  const STT_FAILED = ['[STT Failed]', '[STT Failed — audio could not be processed]'];
  if (STT_FAILED.some(s => transcript.includes(s))) return null;

  // Split into segments — by newline first
  let rawSegments = transcript.split(/\n/).filter(s => s.trim().length > 0);

  // If only 1-2 segments (no newlines / blob), split by sentence endings
  if (rawSegments.length <= 2) {
    rawSegments = transcript
      .split(/(?<=[।.!?])\s+/)
      .filter(s => s.trim().length > 3);
  }

  // If still only 1 segment, try splitting on question marks within text
  if (rawSegments.length <= 1 && transcript.length > 100) {
    rawSegments = transcript
      .split(/(?<=[।.!?])/)
      .filter(s => s.trim().length > 3);
  }

  const agentFirst = (agentName || '').split(' ')[0].toLowerCase();

  // Track last speaker for context-based continuation
  let lastSpeaker = 'agent'; // calls typically start with agent

  return rawSegments.map((seg) => {
    const text = seg.trim();
    if (!text) return null;

    let speaker, icon, colorClass;

    if (isIVR(text)) {
      speaker = 'Operator';
      icon = '🤖';
      colorClass = 'bg-gray-100 border-l-4 border-gray-400';
      lastSpeaker = 'ivr';
    } else if (isAgent(text, agentFirst)) {
      speaker = `Agent (${agentName || 'Agent'})`;
      icon = '👤';
      colorClass = 'bg-green-50 border-l-4 border-green-400';
      lastSpeaker = 'agent';
    } else if (isSubscriber(text)) {
      speaker = 'Subscriber';
      icon = '👥';
      colorClass = 'bg-blue-50 border-l-4 border-blue-400';
      lastSpeaker = 'subscriber';
    } else {
      // Ambiguous — use context: if last was subscriber, switch to agent
      // (agents speak more and longer), if last was agent, check length
      if (lastSpeaker === 'subscriber' || text.length > 80) {
        speaker = `Agent (${agentName || 'Agent'})`;
        icon = '👤';
        colorClass = 'bg-green-50 border-l-4 border-green-400';
        lastSpeaker = 'agent';
      } else {
        speaker = 'Subscriber';
        icon = '👥';
        colorClass = 'bg-blue-50 border-l-4 border-blue-400';
        lastSpeaker = 'subscriber';
      }
    }

    return { speaker, text, icon, colorClass };
  }).filter(Boolean);
}

/**
 * TranscriptViewer — renders parsed transcript with speaker attribution.
 * Shows first 3 turns by default, expandable to full transcript.
 * Three distinct speaker styles:
 *   🤖 IVR / Operator — grey bg, grey border, italic
 *   👤 Agent          — green bg, green border
 *   👥 Subscriber     — blue bg, blue border
 */
export function TranscriptViewer({ transcript, agentName }) {
  const [expanded, setExpanded] = useState(false);

  if (!transcript || transcript.startsWith('[STT Failed]')) {
    return <div className="text-gray-400 text-sm italic">Transcript not available</div>;
  }

  const turns = parseTranscript(transcript, agentName);
  if (!turns || turns.length === 0) {
    return <div className="text-gray-400 text-sm italic">Empty transcript</div>;
  }

  const preview = turns.slice(0, 3);
  const displayTurns = expanded ? turns : preview;

  return (
    <div className="space-y-1.5 text-sm">
      {displayTurns.map((turn, i) => (
        <div
          key={i}
          className={`p-2 rounded ${turn.colorClass}`}
        >
          <div className="font-semibold text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
            {turn.icon}{' '}
            {turn.speaker === 'Operator'
              ? 'IVR / Operator'
              : turn.speaker}
          </div>
          <div className={`text-gray-800 text-xs ${turn.speaker === 'Operator' ? 'italic' : ''}`}>
            {turn.text}
          </div>
        </div>
      ))}
      {turns.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-info text-xs hover:underline font-medium"
        >
          {expanded ? '▲ Show less' : `▼ Show all ${turns.length} turns`}
        </button>
      )}
    </div>
  );
}
