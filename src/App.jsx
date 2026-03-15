import { useState, useEffect, useCallback } from 'react';
import { fetchTodayWithProgress, fetchCallbacks, fetchHotLeads, fetchLoanSignals, fetchChurnSignals, fetchCallbacksRequested, invalidateCache, getLastScrapedTime } from './lib/airtable';
import { scrapeAgeStatus } from './lib/helpers';
import Overview from './components/Overview';
import VikasQueue from './components/VikasQueue';
import SamirQueue from './components/SamirQueue';

const TABS = ['Overview', 'Vikas Queue', 'Samir Queue'];
const TAB_ICONS = ['📊', '📋', '🎯'];

export default function App() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState({ today: [], callbacks: [], hotLeads: [], loans: [], churn: [], callbacksRequested: [] });
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [lastScraped, setLastScraped] = useState(null);
  const [agentFilter, setAgentFilter] = useState(null);

  const refresh = useCallback(async (force = false) => {
    try {
      if (force) invalidateCache();
      setLoadProgress(0);
      const [today, callbacks, hotLeads, loans, churn, callbacksRequested] = await Promise.all([
        fetchTodayWithProgress(({ loaded }) => setLoadProgress(loaded)),
        fetchCallbacks(),
        fetchHotLeads(), fetchLoanSignals(), fetchChurnSignals(),
        fetchCallbacksRequested(),
      ]);
      setData({ today, callbacks, hotLeads, loans, churn, callbacksRequested });
      setLastRefresh(new Date());
      setLastScraped(getLastScrapedTime(today));
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

  const scrapeAge = scrapeAgeStatus(lastScraped);

  return (
    <div className="min-h-screen bg-bg pb-16 md:pb-0">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Shravan</h1>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            {/* Scrape freshness */}
            {lastScraped && (
              <span className={`text-xs ${scrapeAge.color}`} title={`Last scraped: ${lastScraped}`}>
                Scraped {scrapeAge.label}
              </span>
            )}
            <button
              onClick={() => refresh(true)}
              className="text-xs text-info hover:underline"
              title="Force refresh (bypass cache)"
            >
              Refresh
            </button>
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

      {/* Desktop top tabs */}
      <nav className="hidden md:block sticky top-[53px] z-40 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto flex">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => { setTab(i); setAgentFilter(null); }}
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
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">Loading calls...</p>
            {loadProgress > 0 && <p className="mt-2 font-mono text-sm">{loadProgress} records</p>}
          </div>
        ) : (
          <>
            {tab === 0 && <Overview today={data.today} agentFilter={agentFilter} setAgentFilter={setAgentFilter} />}
            {tab === 1 && <VikasQueue today={data.today} callbacks={data.callbacks} callbacksRequested={data.callbacksRequested} onRemove={removeRecord} onRefresh={refresh} />}
            {tab === 2 && <SamirQueue hotLeads={data.hotLeads} loans={data.loans} churn={data.churn} callbacksRequested={data.callbacksRequested} onRemove={removeRecord} onRefresh={refresh} />}
          </>
        )}
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 safe-area-bottom">
        <div className="flex">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => { setTab(i); setAgentFilter(null); }}
              className={`flex-1 py-2 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors ${
                tab === i ? 'text-info' : 'text-gray-400'
              }`}
            >
              <span className="text-lg">{TAB_ICONS[i]}</span>
              {t}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
