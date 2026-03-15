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

/**
 * parseTranscript — splits raw transcript into speaker-attributed turns.
 * Uses agentName to identify agent lines, IVR patterns for system messages,
 * and defaults remaining lines to Subscriber.
 */
export function parseTranscript(transcript, agentName) {
  if (!transcript || transcript.startsWith('[STT Failed]')) return null;

  const ivrPatterns = [
    'aapke dwara dial', 'the number you have dialed',
    'your call has been forwarded', 'please try later',
    'व्यस्त है', 'switched off', 'not available',
    'dialed number', 'nahi mil raha', 'currently unavailable',
    'is busy', 'the subscriber', 'abhi upalabdh nahi',
  ];

  const agentFirst = (agentName || '').split(' ')[0].toLowerCase();
  const agentPatterns = [
    ...(agentFirst.length >= 3 ? [agentFirst] : []),
    'main ayushpay', 'namaste sir main', 'namaste madam main',
    'good evening sir', 'good evening madam',
    'good morning sir', 'good morning madam',
    'namaskar sir', 'namaskar madam',
    'baat kar raha hoon', 'baat kar rahi hoon',
    'aapka personal health', 'ayushpay se', 'ayushpay ki',
    'mera naam', 'main bol raha', 'main bol rahi',
  ];

  const lines = transcript
    .split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  return lines.map(line => {
    const lower = line.toLowerCase();
    if (ivrPatterns.some(p => lower.includes(p))) {
      return { speaker: 'IVR', text: line };
    }
    if (agentPatterns.some(p => lower.includes(p))) {
      return { speaker: 'Agent', text: line, agentName: agentName || 'Agent' };
    }
    return { speaker: 'Subscriber', text: line };
  });
}

const SPEAKER_STYLES = {
  IVR: 'bg-gray-100 border-l-4 border-gray-400',
  Agent: 'bg-green-50 border-l-4 border-green-400',
  Subscriber: 'bg-blue-50 border-l-4 border-blue-400',
};

const SPEAKER_ICONS = {
  IVR: '\u{1F916}',
  Agent: '\u{1F464}',
  Subscriber: '\u{1F465}',
};

/**
 * TranscriptViewer — renders parsed transcript with speaker attribution.
 * Shows first 3 turns by default, expandable to full transcript.
 * Only used inside expanded row detail views (not in table cells).
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
          className={`p-2 rounded ${SPEAKER_STYLES[turn.speaker] || SPEAKER_STYLES.Subscriber}`}
        >
          <div className="font-semibold text-[10px] text-gray-500 mb-0.5">
            {SPEAKER_ICONS[turn.speaker] || '\u{1F465}'}{' '}
            {turn.speaker === 'Agent' ? `Agent (${turn.agentName})` : turn.speaker}
          </div>
          <div className="text-gray-800 text-xs">{turn.text}</div>
        </div>
      ))}
      {turns.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-info text-xs hover:underline font-medium"
        >
          {expanded ? '\u25B2 Show less' : `\u25BC Show all ${turns.length} turns`}
        </button>
      )}
    </div>
  );
}
