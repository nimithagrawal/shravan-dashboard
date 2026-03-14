import { useState, useEffect, useCallback } from 'react';
import { fetchToday, fetchRecent, fetchCallbacks, fetchHotLeads, fetchLoanSignals, fetchChurnSignals } from './lib/airtable';
import Overview from './components/Overview';
import VikasQueue from './components/VikasQueue';
import SamirQueue from './components/SamirQueue';

const TABS = ['Overview', 'Vikas Queue', 'Samir Queue'];

export default function App() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState({ today: [], recent: [], callbacks: [], hotLeads: [], loans: [], churn: [] });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [today, recent, callbacks, hotLeads, loans, churn] = await Promise.all([
        fetchToday(), fetchRecent(50), fetchCallbacks(),
        fetchHotLeads(), fetchLoanSignals(), fetchChurnSignals(),
      ]);
      setData({ today, recent, callbacks, hotLeads, loans, churn });
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 120000);
    return () => clearInterval(id);
  }, [refresh]);

  const removeRecord = (key, recordId) => {
    setData(prev => ({ ...prev, [key]: prev[key].filter(r => r.id !== recordId) }));
  };

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Shravan</h1>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              Live <span className="inline-block w-2 h-2 rounded-full bg-pass pulse-dot"></span>
            </span>
            {lastRefresh && (
              <span className="hidden sm:inline">
                {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </header>

      <nav className="sticky top-[53px] z-40 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto flex">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === i ? 'border-info text-info' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading...</div>
        ) : (
          <>
            {tab === 0 && <Overview today={data.today} recent={data.recent} />}
            {tab === 1 && <VikasQueue today={data.today} callbacks={data.callbacks} onRemove={removeRecord} onRefresh={refresh} />}
            {tab === 2 && <SamirQueue hotLeads={data.hotLeads} loans={data.loans} churn={data.churn} onRemove={removeRecord} onRefresh={refresh} />}
          </>
        )}
      </main>
    </div>
  );
}
