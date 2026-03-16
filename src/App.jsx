import { useState, useEffect, useCallback } from 'react';
import { fetchTodayWithProgress, fetchRecordsForPeriod, fetchOpenCallbacks, fetchHotLeads, fetchLoanSignals, fetchChurnSignals, fetchCallbacksRequested, fetchTransactionIntents, fetchTodayCoaching, invalidateCache, getLastScrapedTime } from './lib/airtable';
import { scrapeAgeStatus, getPeriodDates, getPreviousPeriodDates, formatPeriodLabel } from './lib/helpers';
import Overview from './components/Overview';
import VikasQueue from './components/VikasQueue';
import SamirQueue from './components/SamirQueue';
import AgentReview from './components/AgentReview';

const TABS = ['Overview', 'Vikas Queue', 'Samir Queue', 'Agent Review'];
const TAB_ICONS = ['\u{1F4CA}', '\u{1F4CB}', '\u{1F3AF}', '\u{1F468}\u{200D}\u{1F3EB}'];
const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This Week' },
  { key: 'lastweek', label: 'Last Week' },
  { key: 'mtd', label: 'MTD' },
  { key: 'lastmonth', label: 'Last Month' },
  { key: 'custom', label: 'Custom' },
];

export default function App() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState({ today: [], openCallbacks: [], hotLeads: [], loans: [], churn: [], callbacksRequested: [], transactionIntents: [] });
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [lastScraped, setLastScraped] = useState(null);
  const [agentFilter, setAgentFilter] = useState(null);

  // Coaching state (lazy loaded)
  const [coachingData, setCoachingData] = useState([]);
  const [coachingLoading, setCoachingLoading] = useState(false);

  // Period state
  const [selectedPeriod, setSelectedPeriod] = useState('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [periodRecords, setPeriodRecords] = useState([]);
  const [prevPeriodRecords, setPrevPeriodRecords] = useState([]);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodProgress, setPeriodProgress] = useState(0);

  // Always fetch today's data + action queues (for Vikas/Samir tabs)
  const refresh = useCallback(async (force = false) => {
    try {
      if (force) invalidateCache();
      setLoadProgress(0);
      const [today, openCallbacks, hotLeads, loans, churn, callbacksRequested, transactionIntents] = await Promise.all([
        fetchTodayWithProgress(({ loaded }) => setLoadProgress(loaded)),
        fetchOpenCallbacks(),
        fetchHotLeads(), fetchLoanSignals(), fetchChurnSignals(),
        fetchCallbacksRequested(),
        fetchTransactionIntents(),
      ]);
      setData({ today, openCallbacks, hotLeads, loans, churn, callbacksRequested, transactionIntents });
      setLastRefresh(new Date());
      setLastScraped(getLastScrapedTime(today));
      // If period is "today", use the same data
      if (selectedPeriod === 'today') {
        setPeriodRecords(today);
      }
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 300000); // 5 min
    return () => clearInterval(id);
  }, [refresh]);

  // Fetch period data when period changes
  const fetchPeriodData = useCallback(async (period, cs, ce) => {
    const { start, end } = getPeriodDates(period, cs, ce);
    if (period === 'today') {
      // Already handled by refresh()
      setPeriodRecords(data.today);
      setPrevPeriodRecords([]);
      // Fetch yesterday for comparison
      const prev = getPreviousPeriodDates(start, end);
      try {
        const prevData = await fetchRecordsForPeriod(prev.start, prev.end);
        setPrevPeriodRecords(prevData);
      } catch (e) { console.error('Prev period fetch error:', e); }
      return;
    }
    setPeriodLoading(true);
    setPeriodProgress(0);
    try {
      const [records, prevRecords] = await Promise.all([
        fetchRecordsForPeriod(start, end, ({ loaded }) => setPeriodProgress(loaded)),
        fetchRecordsForPeriod(
          ...Object.values(getPreviousPeriodDates(start, end))
        ).catch(() => []),
      ]);
      setPeriodRecords(records);
      setPrevPeriodRecords(prevRecords);
    } catch (e) {
      console.error('Period fetch error:', e);
    } finally {
      setPeriodLoading(false);
    }
  }, [data.today]);

  useEffect(() => {
    if (!loading) {
      fetchPeriodData(selectedPeriod, customStart, customEnd);
    }
  }, [selectedPeriod, customStart, customEnd, loading, fetchPeriodData]);

  // Lazy-fetch coaching data when Agent Review tab is active
  useEffect(() => {
    if (tab !== 3) return;
    let cancelled = false;
    const fetchCoaching = async () => {
      setCoachingLoading(true);
      try {
        const data = await fetchTodayCoaching();
        if (!cancelled) setCoachingData(data);
      } catch (e) {
        console.error('Coaching fetch error:', e);
      } finally {
        if (!cancelled) setCoachingLoading(false);
      }
    };
    fetchCoaching();
    // Auto-refresh every 10 min during calling hours (9AM-8PM IST)
    const id = setInterval(() => {
      const istHour = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
      if (istHour >= 9 && istHour < 20) fetchCoaching();
    }, 600000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tab]);

  const handlePeriodChange = (key) => {
    setSelectedPeriod(key);
    setAgentFilter(null);
  };

  const removeRecord = (key, recordId) => {
    setData(prev => ({ ...prev, [key]: prev[key].filter(r => r.id !== recordId) }));
  };

  const scrapeAge = scrapeAgeStatus(lastScraped);
  const { start: periodStart, end: periodEnd } = getPeriodDates(selectedPeriod, customStart, customEnd);

  return (
    <div className="min-h-screen bg-bg pb-16 md:pb-0">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Shravan</h1>
          <div className="flex items-center gap-3 text-sm text-gray-500">
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

      {/* Period selector — Overview tab only */}
      {tab === 0 && !loading && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {PERIODS.map(p => (
                <button
                  key={p.key}
                  onClick={() => handlePeriodChange(p.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                    selectedPeriod === p.key
                      ? 'bg-info text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {selectedPeriod === 'custom' && (
                <div className="flex items-center gap-1.5 ml-2">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-200 rounded-lg"
                  />
                  <span className="text-xs text-gray-400">to</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-200 rounded-lg"
                  />
                </div>
              )}
            </div>
            {/* Period label + count */}
            {selectedPeriod !== 'today' && (
              <p className="text-xs text-gray-500 mt-1">
                {formatPeriodLabel(periodStart, periodEnd)}
                {!periodLoading && ` | ${periodRecords.length.toLocaleString()} calls`}
              </p>
            )}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-4">
        {loading ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">Loading calls...</p>
            {loadProgress > 0 && <p className="mt-2 font-mono text-sm">{loadProgress} records</p>}
          </div>
        ) : (
          <>
            {tab === 0 && (
              periodLoading ? (
                <div className="text-center py-20 text-gray-400">
                  <p className="text-lg">Loading calls...</p>
                  {periodProgress > 0 && <p className="mt-2 font-mono text-sm">{periodProgress.toLocaleString()} records</p>}
                </div>
              ) : (
                <Overview
                  records={periodRecords}
                  prevRecords={prevPeriodRecords}
                  period={selectedPeriod}
                  periodStart={periodStart}
                  periodEnd={periodEnd}
                  agentFilter={agentFilter}
                  setAgentFilter={setAgentFilter}
                  onRefresh={() => refresh(true)}
                />
              )
            )}
            {tab === 1 && <VikasQueue today={data.today} openCallbacks={data.openCallbacks} onRemove={removeRecord} onRefresh={refresh} />}
            {tab === 2 && <SamirQueue today={data.today} hotLeads={data.hotLeads} loans={data.loans} churn={data.churn} callbacksRequested={data.callbacksRequested} transactionIntents={data.transactionIntents} onRemove={removeRecord} onRefresh={refresh} />}
            {tab === 3 && (
              coachingLoading ? (
                <div className="text-center py-20 text-gray-400">
                  <p className="text-lg">Loading coaching data...</p>
                </div>
              ) : (
                <AgentReview data={coachingData} />
              )
            )}
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
