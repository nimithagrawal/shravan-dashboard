import { useState, useRef, useCallback } from 'react';
import { maskPhone } from '../lib/helpers';

const PIN = '0504';

export default function PhoneNumber({ number, className = '' }) {
  const [revealed, setRevealed] = useState(false);
  const [showPinInput, setShowPinInput] = useState(false);
  const [pin, setPin] = useState('');
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  const reveal = useCallback(() => {
    setRevealed(true);
    setShowPinInput(false);
    setPin('');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setRevealed(false), 30000);
  }, []);

  const handleClick = () => {
    if (revealed) return;
    setShowPinInput(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handlePinSubmit = (e) => {
    e.preventDefault();
    if (pin === PIN) {
      reveal();
    } else {
      setPin('');
      inputRef.current?.focus();
    }
  };

  const handleCancel = () => {
    setShowPinInput(false);
    setPin('');
  };

  if (!number) return <span className="text-gray-400">--</span>;

  if (revealed) {
    return (
      <a href={`tel:${number}`} className={`text-info underline ${className}`}>
        {number}
      </a>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {showPinInput ? (
        <form onSubmit={handlePinSubmit} className="inline-flex items-center gap-1">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-info"
            placeholder="PIN"
          />
          <button type="submit" className="text-xs text-info hover:underline">Go</button>
          <button type="button" onClick={handleCancel} className="text-xs text-gray-400 hover:text-gray-600">×</button>
        </form>
      ) : (
        <button
          onClick={handleClick}
          className="text-gray-600 hover:text-info cursor-pointer font-mono text-sm"
          title="Click to reveal (PIN required)"
        >
          {maskPhone(number)}
        </button>
      )}
    </span>
  );
}
