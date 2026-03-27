import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchTodayWithProgress, fetchRecordsForPeriod, fetchOpenCallbacks, fetchHotLeads,
         fetchLoanSignals, fetchChurnSignals, fetchCallbacksRequested, fetchTransactionIntents,
         fetchTodayCoaching, fetchTeamConfig, invalidateCache, getLastScrapedTime } from './lib/airtable';
import { scrapeAgeStatus, getPeriodDates, getPreviousPeriodDates, getComparisonPeriods,
         formatPeriodLabel, isWelcomeCallRecord, isUtilizationRecord,
         computeCallbackHonorStats, buildAttemptMap, computeDNPPersistenceRate } from './lib/helpers';
import { TAB_NAMES, TAB_PERMISSIONS } from './lib/auth';

import CommandCenter        from './components/CommandCenter';
import WelcomeCallDashboard from './components/WelcomeCallDashboard';
import UtilizationDashboard from './components/UtilizationDashboard';
import VikasQueue           from './components/VikasQueue';
import SamirQueue           from './components/SamirQueue';
import AgentReview          from './components/AgentReview';
import PitchPerformance     from './components/PitchPerformance';
import Overview             from './components/Overview';
import ExecutiveDashboard   from './components/ExecutiveDashboard';
import AccessDenied         from './components/AccessDenied';
import ErrorBoundary        from './components/ErrorBoundary';
import { useAuth }        from './context/AuthContext';

const TAB_ICONS = {
  [TAB_NAMES.COMMAND_CENTER]: '🏢',
  [TAB_NAMES.WELCOME_CALL]:   '📞',
  [TAB_NAMES.UTILIZATION]:    '💊',
  [TAB_NAMES.WELCOME_QUEUE]:  '📋',
  [TAB_NAMES.UTIL_QUEUE]:     '🎯',
  [TAB_NAMES.AGENT_360]:      '👨‍🏫',
  [TAB_NAMES.PITCH_LAB]:      '🎤',
  [TAB_NAMES.CALL_LOG]:       '📜',
  [TAB_NAMES.EXECUTIVE]:      '📊',
};

// Tabs that show a period selector
const PERIOD_TABS = new Set([
  TAB_NAMES.COMMAND_CENTER,
  TAB_NAMES.WELCOME_CALL,
  TAB_NAMES.UTILIZATION,
  TAB_NAMES.AGENT_360,
  TAB_NAMES.CALL_LOG,
  TAB_NAMES.EXECUTIVE,
]);

// Tabs that lazy-load coaching data
const COACHING_TABS = new Set([
  TAB_NAMES.COMMAND_CENTER,
  TAB_NAMES.AGENT_360,
  TAB_NAMES.EXECUTIVE,
]);

const PERIODS = [
  { key: 'today',     label: 'Today'      },
  { key: 'yesterday', label: 'Yesterday'  },
  { key: 'week',      label: 'This Week'  },
  { key: 'lastweek',  label: 'Last Week'  },
  { key: 'mtd',       label: 'MTD'        },
  { key: 'lastmonth', label: 'Last Month' },
  { key: 'custom',    label: 'Custom'     },
];

export default function App() {
  const { user, loading: authLoading, canSeeTab, vikasAlert } = useAuth();

  // ── Tab state ──
  const [tab, setTab] = useState(0);

  // ── Raw data ──
  const [data, setData] = useState({
    today: [], openCallbacks: [], hotLeads: [],
    loans: [], churn: [], callbacksRequested: [], transactionIntents: [],
  });
  const [loading, setLoading]           = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [lastRefresh, setLastRefresh]   = useState(null);
  const [lastScraped, setLastScraped]   = useState(null);
  const [fetchError, setFetchError]     = useState(null);

  // ── Agent filter ──
  const [agentFilter, setAgentFilter] = useState(null);

  // ── Coaching (lazy) ──
  const [coachingData, setCoachingData]     = useState([]);
  const [coachingLoading, setCoachingLoading] = useState(false);

  // ── Team config ──
  const [teamConfig, setTeamConfig] = useState([]);

  // ── Period state ──
  const [selectedPeriod, setSelectedPeriod] = useState('today');
  const [customStart, setCustomStart]       = useState('');
  const [customEnd, setCustomEnd]           = useState('');
  const [periodRecords, setPeriodRecords]   = useState([]);
  const [prevPeriodRecords, setPrevPeriodRecords] = useState([]);
  const [comparisonData, setComparisonData] = useState({ daily: [], weekly: [], monthly: [] });
  const [periodLoading, setPeriodLoading]   = useState(false);
  const [periodProgress, setPeriodProgress] = useState(0);

  // ── Derived: department-split records ──
  const wcRecords   = useMemo(() => periodRecords.filter(isWelcomeCallRecord),   [periodRecords]);
  const utilRecords = useMemo(() => periodRecords.filter(isUtilizationRecord),   [periodRecords]);
  const wcPrev      = useMemo(() => prevPeriodRecords.filter(isWelcomeCallRecord),   [prevPeriodRecords]);
  const utilPrev    = useMemo(() => prevPeriodRecords.filter(isUtilizationRecord),   [prevPeriodRecords]);

  // ── Derived: attempt maps (across ALL period records for attempt depth) ──
  const wcAttemptMap   = useMemo(() => buildAttemptMap(wcRecords),   [wcRecords]);
  const utilAttemptMap = useMemo(() => buildAttemptMap(utilRecords), [utilRecords]);

  // ── Derived: DNP persistence rates ──
  const wcDNPRate   = useMemo(() => computeDNPPersistenceRate(wcAttemptMap),   [wcAttemptMap]);
  const utilDNPRate = useMemo(() => computeDNPPersistenceRate(utilAttemptMap), [utilAttemptMap]);

  // ── Derived: callback honor stats ──
  const wcCallbackHonor   = useMemo(() => computeCallbackHonorStats(wcRecords),   [wcRecords]);
  const utilCallbackHonor = useMemo(() => computeCallbackHonorStats(utilRecords), [utilRecords]);

  // ── Visible tabs ──
  const visibleTabs    = (TAB_PERMISSIONS[user?.role] || []).filter(t => canSeeTab(t));
  const currentTabName = visibleTabs[tab] || visibleTabs[0];

  // ── Primary data fetch ──
  const refresh = useCallback(async (force = false) => {
    try {
      if (force) invalidateCache();
      setLoadProgress(0);
      const [today, openCallbacks, hotLeads, loans, churn, callbacksRequested, transactionIntents] =
        await Promise.all([
          fetchTodayWithProgress(({ loaded }) => setLoadProgress(loaded)),
          fetchOpenCallbacks(),
          fetchHotLeads(), fetchLoanSignals(), fetchChurnSignals(),
          fetchCallbacksRequested(),
          fetchTransactionIntents(),
        ]);
      setData({ today, openCallbacks, hotLeads, loans, churn, callbacksRequested, transactionIntents });
      setFetchError(null);
      setLastRefresh(new Date());
      setLastScraped(getLastScrapedTime(today));
      if (selectedPeriod === 'today') setPeriodRecords(today);
    } catch (e) {
      console.error('Fetch error:', e);
      setFetchError(e.message);
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

  // ── Team config fetch ──
  useEffect(() => {
    if (!user) return;
    fetchTeamConfig().then(setTeamConfig).catch(() => {});
  }, [user]);

  // ── Period data fetch ──
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

  // ── Coaching lazy fetch ──
  useEffect(() => {
    if (!COACHING_TABS.has(currentTabName)) return;
    let cancelled = false;
    const load = async () => {
      setCoachingLoading(true);
      try {
        const d = await fetchTodayCoaching();
        if (!cancelled) setCoachingData(d);
      } catch (e) { console.error('Coaching fetch error:', e); }
      finally { if (!cancelled) setCoachingLoading(false); }
    };
    load();
    const id = setInterval(() => {
      const istHour = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
      if (istHour >= 9 && istHour < 20) load();
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

  // ── Auth gates ──
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400" style={{ fontFamily: 'Arial' }}>
        Loading...
      </div>
    );
  }
  if (!user) return <AccessDenied />;

  const scrapeAge  = scrapeAgeStatus(lastScraped);
  const { start: periodStart, end: periodEnd } = getPeriodDates(selectedPeriod, customStart, customEnd);
  const showPeriodSelector = PERIOD_TABS.has(currentTabName);
  const isPeriodLoading    = periodLoading && showPeriodSelector;

  // Shared props for dept dashboards
  const sharedPeriodProps = {
    period: selectedPeriod, periodStart, periodEnd,
    agentFilter, setAgentFilter,
    teamConfig,
  };

  return (
    <div className="min-h-screen bg-bg pb-16 md:pb-0">
      {/* ── Header ── */}
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

      {/* ── Critical agent alert banner ── */}
      {vikasAlert && data.today.length > 0 && (() => {
        const critAgents = coachingData.filter(a => a['Alert Level'] === 'CRITICAL' && (a['Connected Calls'] || 0) >= 3);
        if (critAgents.length === 0) return null;
        return (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2">
            <p className="max-w-7xl mx-auto text-xs text-red-800 font-semibold">
              ⚠️ Action Required: {critAgents.map(a => a['Agent Name']).join(', ')} — CRITICAL status. Intervene before next shift.
            </p>
          </div>
        );
      })()}

      {/* ── Desktop tab bar ── */}
      <nav className="hidden md:block sticky top-[53px] z-40 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto flex">
          {visibleTabs.map((t, i) => (
            <button
              key={t}
              onClick={() => { setTab(i); setAgentFilter(null); }}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === i ? 'border-info text-info' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_ICONS[t] || ''} {t}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Period selector (Command Center, Welcome Call, Utilization, Agent 360) ── */}
      {showPeriodSelector && !loading && (
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

      {/* ── Fetch error ── */}
      {fetchError && (
        <div className="mx-4 mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center justify-between">
          <span>Failed to load data: {fetchError}</span>
          <button onClick={() => refresh(true)} className="ml-3 px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">Retry</button>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {loading ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">Loading calls...</p>
            {loadProgress > 0 && <p className="mt-2 font-mono text-sm">{loadProgress} records</p>}
          </div>
        ) : (
          <>
            {/* Command Center */}
            {currentTabName === TAB_NAMES.COMMAND_CENTER && (
              isPeriodLoading ? <LoadingBlock progress={periodProgress} /> : (
                <ErrorBoundary>
                  <CommandCenter
                    wcRecords={wcRecords}       wcPrev={wcPrev}
                    utilRecords={utilRecords}   utilPrev={utilPrev}
                    wcAttemptMap={wcAttemptMap} utilAttemptMap={utilAttemptMap}
                    wcDNPRate={wcDNPRate}       utilDNPRate={utilDNPRate}
                    wcCallbackHonor={wcCallbackHonor} utilCallbackHonor={utilCallbackHonor}
                    coachingData={coachingData} teamConfig={teamConfig}
                    {...sharedPeriodProps}
                  />
                </ErrorBoundary>
              )
            )}

            {/* Welcome Call Dashboard */}
            {currentTabName === TAB_NAMES.WELCOME_CALL && (
              isPeriodLoading ? <LoadingBlock progress={periodProgress} /> : (
                <ErrorBoundary>
                  <WelcomeCallDashboard
                    records={wcRecords}       prevRecords={wcPrev}
                    allRecords={periodRecords}
                    attemptMap={wcAttemptMap} dnpRate={wcDNPRate}
                    callbackHonor={wcCallbackHonor}
                    coachingData={coachingData}
                    {...sharedPeriodProps}
                  />
                </ErrorBoundary>
              )
            )}

            {/* Utilization Dashboard */}
            {currentTabName === TAB_NAMES.UTILIZATION && (
              isPeriodLoading ? <LoadingBlock progress={periodProgress} /> : (
                <ErrorBoundary>
                  <UtilizationDashboard
                    records={utilRecords}     prevRecords={utilPrev}
                    attemptMap={utilAttemptMap} dnpRate={utilDNPRate}
                    callbackHonor={utilCallbackHonor}
                    coachingData={coachingData}
                    {...sharedPeriodProps}
                  />
                </ErrorBoundary>
              )
            )}

            {/* Welcome Queue (Vikas) */}
            {currentTabName === TAB_NAMES.WELCOME_QUEUE && (
              <ErrorBoundary>
                <VikasQueue
                  today={wcRecords.length > 0 ? wcRecords : data.today.filter(isWelcomeCallRecord)}
                  openCallbacks={data.openCallbacks.filter(isWelcomeCallRecord)}
                  attemptMap={wcAttemptMap}
                  onRemove={removeRecord} onRefresh={refresh}
                />
              </ErrorBoundary>
            )}

            {/* Utilization Queue (Samir) */}
            {currentTabName === TAB_NAMES.UTIL_QUEUE && (
              <ErrorBoundary>
                <SamirQueue
                  today={utilRecords.length > 0 ? utilRecords : data.today.filter(isUtilizationRecord)}
                  hotLeads={data.hotLeads.filter(isUtilizationRecord)}
                  loans={data.loans} churn={data.churn}
                  callbacksRequested={data.callbacksRequested.filter(isUtilizationRecord)}
                  transactionIntents={data.transactionIntents}
                  attemptMap={utilAttemptMap}
                  onRemove={removeRecord} onRefresh={refresh}
                />
              </ErrorBoundary>
            )}

            {/* Agent 360 */}
            {currentTabName === TAB_NAMES.AGENT_360 && (
              coachingLoading ? (
                <div className="text-center py-20 text-gray-400">
                  <p className="text-lg">Loading agent data...</p>
                </div>
              ) : (
                <ErrorBoundary>
                  <AgentReview
                    data={coachingData}
                    periodRecords={periodRecords}
                    wcRecords={wcRecords} utilRecords={utilRecords}
                    attemptMap={buildAttemptMap(periodRecords)}
                    teamConfig={teamConfig}
                    userRole={user?.role}
                    userAgentName={user?.agentNameMatch}
                    userDepartment={user?.department}
                    period={selectedPeriod}
                    periodStart={periodStart} periodEnd={periodEnd}
                  />
                </ErrorBoundary>
              )
            )}

            {/* Pitch Lab */}
            {currentTabName === TAB_NAMES.PITCH_LAB && (
              <ErrorBoundary>
                <PitchPerformance
                  wcRecords={wcRecords}
                  utilRecords={utilRecords}
                  userRole={user?.role}
                  userDepartment={user?.department}
                />
              </ErrorBoundary>
            )}

            {/* Call Log (Overview — all period records, both depts) */}
            {currentTabName === TAB_NAMES.CALL_LOG && (
              isPeriodLoading ? <LoadingBlock progress={periodProgress} /> : (
                <ErrorBoundary>
                  <Overview
                    records={periodRecords}
                    prevRecords={prevPeriodRecords}
                    comparisonData={comparisonData}
                    period={selectedPeriod}
                    periodStart={periodStart}
                    periodEnd={periodEnd}
                    agentFilter={agentFilter}
                    setAgentFilter={setAgentFilter}
                    onRefresh={refresh}
                  />
                </ErrorBoundary>
              )
            )}

            {/* Executive Dashboard */}
            {currentTabName === TAB_NAMES.EXECUTIVE && (
              <ErrorBoundary>
                <ExecutiveDashboard />
              </ErrorBoundary>
            )}
          </>
        )}
      </main>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 safe-area-bottom">
        <div className="flex">
          {visibleTabs.map((t, i) => (
            <button
              key={t}
              onClick={() => { setTab(i); setAgentFilter(null); }}
              className={`flex-1 py-2 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors ${
                tab === i ? 'text-info' : 'text-gray-400'
              }`}
            >
              <span className="text-lg">{TAB_ICONS[t] || '📄'}</span>
              <span className="leading-tight text-center">{t}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function LoadingBlock({ progress }) {
  return (
    <div className="text-center py-20 text-gray-400">
      <p className="text-lg">Loading calls...</p>
      {progress > 0 && <p className="mt-2 font-mono text-sm">{progress.toLocaleString()} records</p>}
    </div>
  );
}
