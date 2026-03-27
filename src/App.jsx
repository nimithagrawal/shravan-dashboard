import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchTodayWithProgress, fetchRecordsForPeriod, fetchOpenCallbacks, fetchHotLeads, fetchLoanSignals, fetchChurnSignals, fetchCallbacksRequested, fetchTransactionIntents, fetchTodayCoaching, invalidateCache, getLastScrapedTime } from './lib/airtable';
import { scrapeAgeStatus, getPeriodDates, getPreviousPeriodDates, getComparisonPeriods, formatPeriodLabel, isConnectedCall } from './lib/helpers';
import CommandCenter from './components/CommandCenter';
import Overview from './components/Overview';
import VikasQueue from './components/VikasQueue';
import SamirQueue from './components/SamirQueue';
import AgentReview from './components/AgentReview';
import PitchPerformance from './components/PitchPerformance';
import ExecutiveDashboard from './components/ExecutiveDashboard';
import AccessDenied from './components/AccessDenied';
import { useAuth } from './context/AuthContext';

const ALL_TABS = [
  'Command Center',
  'Welcome Call',
  'Utilization',
  'Welcome Queue',
  'Util Queue',
  'Agent 360',
  'Pitch Lab',
  'Call Log',
  'Executive',
];

const ALL_ICONS = ['🏠', '📞', '⚙️', '📋', '🎯', '👨‍🏫', '🎤', '📜', '📈'];

const PERIODS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week',      label: 'This Week' },
  { key: 'lastweek',  label: 'Last Week' },
  { key: 'mtd',       label: 'MTD' },
  { key: 'lastmonth', label: 'Last Month' },
  { key: 'custom',    label: 'Custom' },
];

// Tabs that have a period selector
const PERIOD_TABS = new Set(['Welcome Call', 'Utilization', 'Call Log']);
// Tabs that need coaching data
const COACHING_TABS = new Set(['Command Center', 'Agent 360']);

export default function App() {
  const { user, loading: authLoading, canSeeTab, vikasAlert } = useAuth();

  const [tab, setTab] = useState(0);
  const [data, setData] = useState({
    today: [], openCallbacks: [], hotLeads: [], loans: [],
    churn: [], callbacksRequested: [], transactionIntents: [],
  });
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
  const [comparisonData, setComparisonData] = useState({ daily: [], weekly: [], monthly: [] });
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodProgress, setPeriodProgress] = useState(0);

  // Build visible tabs based on role
  const visibleTabs = ALL_TABS.filter(t => canSeeTab(t));
  const currentTabName = visibleTabs[tab] || visibleTabs[0];

  // Always fetch today's data
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
      if (selectedPeriod === 'today') setPeriodRecords(today);
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod]);

  useEffect(() => {
    if (!user) return;
    refresh();
    const id = setInterval(refresh, 300000);
    return () => clearInterval(id);
  }, [refresh, user]);

  // Period data fetch
  const fetchPeriodData = useCallback(async (period, cs, ce) => {
    const { start, end } = getPeriodDates(period, cs, ce);
    if (period === 'today') {
      setPeriodRecords(data.today);
      setPrevPeriodRecords([]);
      const cmp = getComparisonPeriods();
      try {
        const [dailyData, weeklyData, monthlyData] = await Promise.all([
          fetchRecordsForPeriod(cmp.daily.start, cmp.daily.end).catch(() => []),
          fetchRecordsForPeriod(cmp.weekly.start, cmp.weekly.end).catch(() => []),
          fetchRecordsForPeriod(cmp.monthly.start, cmp.monthly.end).catch(() => []),
        ]);
        setPrevPeriodRecords(dailyData);
        setComparisonData({ daily: dailyData, weekly: weeklyData, monthly: monthlyData });
      } catch (e) { console.error('Comparison fetch error:', e); }
      return;
    }
    setPeriodLoading(true);
    setPeriodProgress(0);
    try {
      const [records, prevRecords] = await Promise.all([
        fetchRecordsForPeriod(start, end, ({ loaded }) => setPeriodProgress(loaded)),
        fetchRecordsForPeriod(...Object.values(getPreviousPeriodDates(start, end))).catch(() => []),
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
    if (!loading && user) fetchPeriodData(selectedPeriod, customStart, customEnd);
  }, [selectedPeriod, customStart, customEnd, loading, fetchPeriodData, user]);

  // Lazy-fetch coaching data
  useEffect(() => {
    if (!COACHING_TABS.has(currentTabName)) return;
    let cancelled = false;
    const fetchCoaching = async () => {
      setCoachingLoading(true);
      try {
        const d = await fetchTodayCoaching();
        if (!cancelled) setCoachingData(d);
      } catch (e) {
        console.error('Coaching fetch error:', e);
      } finally {
        if (!cancelled) setCoachingLoading(false);
      }
    };
    fetchCoaching();
    const id = setInterval(() => {
      const istHour = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
      if (istHour >= 9 && istHour < 20) fetchCoaching();
    }, 600000);
    return () => { cancelled = true; clearInterval(id); };
  }, [currentTabName]);

  const handlePeriodChange = (key) => {
    setSelectedPeriod(key);
    setAgentFilter(null);
  };

  const removeRecord = (key, recordId) => {
    setData(prev => ({ ...prev, [key]: prev[key].filter(r => r.id !== recordId) }));
  };

  // Filter period records by category for Welcome Call / Utilization tabs
  const welcomeRecords = useMemo(() =>
    periodRecords.filter(r => r['callCategory'] === 'Welcome-Call'),
    [periodRecords]
  );
  const utilRecords = useMemo(() =>
    periodRecords.filter(r =>
      r['callCategory'] === 'Outbound-Service-Followup' ||
      r['callCategory'] === 'Outbound-Agent-Reachout'
    ),
    [periodRecords]
  );
  const prevWelcomeRecords = useMemo(() =>
    prevPeriodRecords.filter(r => r['callCategory'] === 'Welcome-Call'),
    [prevPeriodRecords]
  );
  const prevUtilRecords = useMemo(() =>
    prevPeriodRecords.filter(r =>
      r['callCategory'] === 'Outbound-Service-Followup' ||
      r['callCategory'] === 'Outbound-Agent-Reachout'
    ),
    [prevPeriodRecords]
  );

  // ── Auth gates ──
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400" style={{ fontFamily: 'Arial' }}>
        Loading...
      </div>
    );
  }
  if (!user) return <AccessDenied />;

  const scrapeAge = scrapeAgeStatus(lastScraped);
  const { start: periodStart, end: periodEnd } = getPeriodDates(selectedPeriod, customStart, customEnd);
  const showPeriodSelector = PERIOD_TABS.has(currentTabName);

  const LoadingBlock = ({ progress }) => (
    <div className="text-center py-20 text-gray-400">
      <p className="text-lg">Loading calls...</p>
      {progress > 0 && <p className="mt-2 font-mono text-sm">{progress.toLocaleString()} records</p>}
    </div>
  );

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
            <button onClick={() => refresh(true)} className="text-xs text-info hover:underline">
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

      {/* Vikas alert banner */}
      {vikasAlert && data.today.length > 0 && (() => {
        const critAgents = coachingData.filter(a => a['Alert Level'] === 'CRITICAL' && (a['Connected Calls'] || 0) >= 3);
        if (critAgents.length === 0) return null;
        return (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2">
            <p className="max-w-7xl mx-auto text-xs text-red-800 font-semibold">
              ⚠️ Action Required: {critAgents.map(a => a['Agent Name']).join(', ')} — CRITICAL status.
            </p>
          </div>
        );
      })()}

      {/* Desktop tabs */}
      <nav className="hidden md:block sticky top-[53px] z-40 bg-white border-b border-gray-200 overflow-x-auto">
        <div className="max-w-7xl mx-auto flex">
          {visibleTabs.map((t, i) => (
            <button
              key={t}
              onClick={() => { setTab(i); setAgentFilter(null); }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === i ? 'border-info text-info' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </nav>

      {/* Period selector */}
      {showPeriodSelector && !loading && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {PERIODS.map(p => (
                <button
                  key={p.key}
                  onClick={() => handlePeriodChange(p.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                    selectedPeriod === p.key ? 'bg-info text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {selectedPeriod === 'custom' && (
                <div className="flex items-center gap-1.5 ml-2">
                  <input type="date" value={customStart}
                    onChange={e => setCustomStart(e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-200 rounded-lg" />
                  <span className="text-xs text-gray-400">to</span>
                  <input type="date" value={customEnd}
                    onChange={e => setCustomEnd(e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-200 rounded-lg" />
                </div>
              )}
            </div>
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
          <LoadingBlock progress={loadProgress} />
        ) : (
          <>
            {currentTabName === 'Command Center' && (
              <CommandCenter today={data.today} coachingData={coachingData} />
            )}

            {currentTabName === 'Welcome Call' && (
              periodLoading ? <LoadingBlock progress={periodProgress} /> : (
                <Overview
                  records={welcomeRecords}
                  prevRecords={prevWelcomeRecords}
                  comparisonData={comparisonData}
                  period={selectedPeriod}
                  periodStart={periodStart}
                  periodEnd={periodEnd}
                  agentFilter={agentFilter}
                  setAgentFilter={setAgentFilter}
                  onRefresh={() => refresh(true)}
                />
              )
            )}

            {currentTabName === 'Utilization' && (
              periodLoading ? <LoadingBlock progress={periodProgress} /> : (
                <Overview
                  records={utilRecords}
                  prevRecords={prevUtilRecords}
                  comparisonData={comparisonData}
                  period={selectedPeriod}
                  periodStart={periodStart}
                  periodEnd={periodEnd}
                  agentFilter={agentFilter}
                  setAgentFilter={setAgentFilter}
                  onRefresh={() => refresh(true)}
                />
              )
            )}

            {currentTabName === 'Welcome Queue' && (
              <VikasQueue today={data.today} openCallbacks={data.openCallbacks}
                onRemove={removeRecord} onRefresh={refresh} />
            )}

            {currentTabName === 'Util Queue' && (
              <SamirQueue today={data.today} hotLeads={data.hotLeads} loans={data.loans}
                churn={data.churn} callbacksRequested={data.callbacksRequested}
                transactionIntents={data.transactionIntents}
                onRemove={removeRecord} onRefresh={refresh} />
            )}

            {currentTabName === 'Agent 360' && (
              coachingLoading ? (
                <div className="text-center py-20 text-gray-400">
                  <p className="text-lg">Loading coaching data...</p>
                </div>
              ) : (
                <AgentReview data={coachingData} />
              )
            )}

            {currentTabName === 'Pitch Lab' && <PitchPerformance />}

            {currentTabName === 'Call Log' && (
              periodLoading ? <LoadingBlock progress={periodProgress} /> : (
                <Overview
                  records={periodRecords}
                  prevRecords={prevPeriodRecords}
                  comparisonData={comparisonData}
                  period={selectedPeriod}
                  periodStart={periodStart}
                  periodEnd={periodEnd}
                  agentFilter={agentFilter}
                  setAgentFilter={setAgentFilter}
                  onRefresh={() => refresh(true)}
                />
              )
            )}

            {currentTabName === 'Executive' && <ExecutiveDashboard />}
          </>
        )}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 safe-area-bottom overflow-x-auto">
        <div className="flex">
          {visibleTabs.map((t, i) => {
            const icon = ALL_ICONS[ALL_TABS.indexOf(t)] || '•';
            return (
              <button
                key={t}
                onClick={() => { setTab(i); setAgentFilter(null); }}
                className={`flex-1 py-2 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors min-w-[60px] ${
                  tab === i ? 'text-info' : 'text-gray-400'
                }`}
              >
                <span className="text-lg">{icon}</span>
                <span className="truncate w-full text-center">{t.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
