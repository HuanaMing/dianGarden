(() => {
  const DAY_CYCLE_MS = 16 * 60 * 1000;
  const RAIN_CYCLE_MS = 10 * 60 * 1000;
  const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
  function getWorldTime(state, now = Date.now()) {
    const savedTime = Number.isFinite(state?.worldTimeMs) ? state.worldTimeMs : 60_000;
    const anchor = Number.isFinite(state?.worldTimeAnchor) ? state.worldTimeAnchor : now;
    return savedTime + Math.max(0, now - anchor);
  }
  function getState(state, now = Date.now()) {
    const worldTimeMs = getWorldTime(state, now);
    const dayPhase = mod(worldTimeMs, DAY_CYCLE_MS);
    const rainPhase = mod(worldTimeMs, RAIN_CYCLE_MS);
    const phase = dayPhase < 60_000 ? 'dawn'
      : dayPhase < 10 * 60_000 ? 'day'
        : dayPhase < 11 * 60_000 ? 'dusk' : 'night';
    const smooth = (value) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
    const lightLevel = phase === 'dawn' ? 0.18 + 0.82 * smooth(dayPhase / 60_000)
      : phase === 'day' ? 1
        : phase === 'dusk' ? 1 - 0.82 * smooth((dayPhase - 10 * 60_000) / 60_000) : 0.18;
    return {
      worldTimeMs,
      phase,
      isDay: phase === 'day',
      isRaining: rainPhase >= 8 * 60_000,
      lightLevel,
    };
  }
  function advance(state, now = Date.now()) {
    state.worldTimeMs = getWorldTime(state, now);
    state.worldTimeAnchor = now;
    return state.worldTimeMs;
  }
  window.skyEnvironment = { DAY_CYCLE_MS, RAIN_CYCLE_MS, getWorldTime, getState, advance };
})();
