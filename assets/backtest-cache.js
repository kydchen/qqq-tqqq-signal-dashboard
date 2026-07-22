/**
 * backtest-cache.js — in-memory cache for backtest API responses (UMD).
 *
 * The backtest request always asks for the five visible strategy sleeves
 * (the same set the chart can display), never the caller's current checkbox
 * selection: a later toggle must find its curve already in the cache. Only
 * successful responses are cached; failures (network error, non-200) throw
 * before the cache write, so they are never cached. The manual "refresh
 * data" button clears the whole cache, otherwise it would show stale
 * backtests.
 */
(function attachBacktestCache(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BacktestCache = api;
})(typeof self !== "undefined" ? self : this, function factory() {
  // Fixed request set: the five visible strategy keys from assets/app.js.
  const STRATEGIES_PARAM = "qqq,signalQqq,tqqq,signalTqqq,signal";

  function normalizeKey(params) {
    return `${String(params.start)}|${String(params.cost)}`;
  }

  function backtestUrl(params) {
    return `/api/backtest?start=${encodeURIComponent(params.start)}&cost=${encodeURIComponent(params.cost)}&strategies=${STRATEGIES_PARAM}`;
  }

  function create() {
    return new Map();
  }

  async function fetchCached(cache, params, fetchFn) {
    const key = normalizeKey(params);
    if (cache.has(key)) return cache.get(key);
    // fetchFn throws on failure, so failed responses never reach the cache.
    const data = await fetchFn(backtestUrl(params));
    cache.set(key, data);
    return data;
  }

  function clear(cache) {
    cache.clear();
  }

  return { STRATEGIES_PARAM, normalizeKey, backtestUrl, create, fetchCached, clear };
});
