(() => {
  const DAY_CYCLE_MS = 16 * 60 * 1000;
  const RAIN_CYCLE_MS = 10 * 60 * 1000;
  const TRANSITION_SECONDS = 60;
  const RAIN_TRANSITION_SECONDS = 5;
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
    const daySecond = Math.floor(dayPhase / 1000);
    const rainSecond = Math.floor(rainPhase / 1000);
    const dawn = dayPhase < TRANSITION_SECONDS * 1000;
    const dusk = dayPhase >= 10 * 60_000 && dayPhase < 11 * 60_000;
    const phase = dawn ? 'dawn'
      : dayPhase < 10 * 60_000 ? 'day'
        : dusk ? 'dusk' : 'night';
    const phaseProgress = dawn
      ? Math.min(1, daySecond / TRANSITION_SECONDS)
      : dusk ? Math.min(1, Math.floor((dayPhase - 10 * 60_000) / 1000) / TRANSITION_SECONDS) : 0;
    const daylightProgress = dawn ? phaseProgress
      : dayPhase < 10 * 60_000 ? 1
        : dusk ? 1 - phaseProgress : 0;
    const lightLevel = 0.18 + 0.82 * daylightProgress;

    // Rain visuals blend during the final five seconds before each weather-state boundary.
    const rainBlend = rainSecond < 8 * 60 - RAIN_TRANSITION_SECONDS
      ? 0
      : rainSecond < 8 * 60
        ? (rainSecond - (8 * 60 - RAIN_TRANSITION_SECONDS)) / RAIN_TRANSITION_SECONDS
        : rainSecond < 10 * 60 - RAIN_TRANSITION_SECONDS
          ? 1
          : rainSecond < 10 * 60
            ? (10 * 60 - rainSecond) / RAIN_TRANSITION_SECONDS
            : 0;
    return {
      worldTimeMs,
      phase,
      phaseProgress,
      daylightProgress,
      isDay: phase === 'day',
      isRaining: rainPhase >= 8 * 60_000,
      rainBlend: Math.max(0, Math.min(1, rainBlend)),
      lightLevel,
    };
  }
  function advance(state, now = Date.now()) {
    state.worldTimeMs = getWorldTime(state, now);
    state.worldTimeAnchor = now;
    return state.worldTimeMs;
  }
  window.skyEnvironment = {
    DAY_CYCLE_MS, RAIN_CYCLE_MS, getWorldTime, getState, advance,
    TRANSITION_SECONDS, RAIN_TRANSITION_SECONDS,
  };
})();
