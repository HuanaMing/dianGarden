(async () => {
  const STARTING_COINS = 120;
  const MAX_DRONES = 8;
  const DRONE_BATTERY_DRAIN_PER_SECOND = 0.32;
  const DRONE_BATTERY_CHARGE_PER_SECOND = 0.44;
  const DRONE_MIN_JOB_BATTERY = 8;
  const GUEST_MODE_KEY = 'sky-garden-guest-mode-v1';
  const IS_GUEST_GARDEN = (() => { try { return localStorage.getItem(GUEST_MODE_KEY) === 'true'; } catch (_) { return false; } })();
  const STORAGE_KEY = IS_GUEST_GARDEN ? 'sky-garden-guest-save-v1' : 'sky-garden-save-v1';
  const AUTO_CROP_KEY = IS_GUEST_GARDEN ? 'sky-garden-guest-auto-crops-v1' : 'sky-garden-auto-crops-v1';
  const FLOWER_VARIANTS_KEY = IS_GUEST_GARDEN ? 'sky-garden-guest-flower-variants-v1' : 'sky-garden-flower-variants-v1';
  const MAX_FLOWER_VARIANTS = 30;
  const CROP_CATALOG_VERSION = 4;
  const WATER_DURATION = 30_000;
  const WATER_GROWTH_RATE = 1.2;
  const crops = (window.flowerCatalog || []).map((flower) => ({
    ...flower, icon: flower.emoji, seedIcon: '🌱', meaning: flower.meaning,
  }));
  function flowerIconMarkup(flower, className = 'flower-pixel-icon') {
    if (!flower?.image) return flower?.emoji || '🌱';
    return '<img class="' + className + '" src="' + flower.image + '" width="32" height="32" alt="" aria-hidden="true" decoding="async" style="image-rendering:pixelated">';
  }
  if (crops.length !== 11) throw new Error('花卉目錄載入失敗');
  let persistenceAvailable = true;
  let persistenceWarning = '';
  let skipSaveOnExit = false;
  window.addEventListener('diangarden:restore-cloud-save', () => { skipSaveOnExit = true; });
  function getNextPlotPosition(plots, blockedDocks = []) {
    const occupied = new Set(plots.map((plot) => `${plot.x},${plot.z}`));
    for (const plot of plots) {
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const candidate = [plot.x + dx, plot.z + dz];
        if (occupied.has(`${candidate[0]},${candidate[1]}`)) continue;
        const tile = { x: candidate[0], z: candidate[1] };
        if (blockedDocks.some((dock) => dockOverlapsPlot(dock, tile))) continue;
        return candidate;
      }
    }
    return null;
  }
  function defaultPlotPositions(count) {
    const plots = [[-1, 0], [0, 0], [1, 0]].slice(0, count).map(([x, z]) => ({ x, z }));
    while (plots.length < count) {
      const [x, z] = getNextPlotPosition(plots);
      plots.push({ x, z });
    }
    return plots;
  }
  function dockOverlapsPlot(dockPosition, plot) {
    if (!dockPosition || !plot || !Number.isFinite(plot.x) || !Number.isFinite(plot.z)) return false;
    return Math.abs(dockPosition.x - plot.x) < 0.84 && Math.abs(dockPosition.z - plot.z) < 0.8;
  }
  function plotY(plot) { return Number.isFinite(plot?.y) ? plot.y : 0; }
  function isHalfUnitHeight(value) { return Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 1e-8; }
  function dockBaseY(dock) { return 1.3 + (Number.isInteger(dock?.y) ? dock.y : 0); }
  function plotHasSupportAbove(plot, plots, docks) {
    const y = plotY(plot);
    if (plots.some((other) => other !== plot && other.x === plot.x && other.z === plot.z && plotY(other) > y)) return true;
    return docks.some((dock) => dockOverlapsPlot(dock, plot) && dockBaseY(dock) > y);
  }
  function validStacking(plots, docks) {
    for (let index = 0; index < plots.length; index += 1) {
      const plot = plots[index], y = plotY(plot);
      for (let otherIndex = index + 1; otherIndex < plots.length; otherIndex += 1) {
        const other = plots[otherIndex];
          if (plot.x === other.x && plot.z === other.z && Math.abs(y - plotY(other)) < 0.5) return false;
      }
      if (plotHasSupportAbove(plot, plots, docks) && plot.grassOnly !== true) return false;
        if (docks.some((dock) => dockOverlapsPlot(dock, plot) && dockBaseY(dock) < y && dockBaseY(dock) + 0.066 > y - 0.5)) return false;
    }
    return true;
  }
  function findDroneDock(plots, existing) {
    const candidates = [];
    for (let radius = 1; radius <= 12; radius += 1) {
      for (let x = -radius; x <= radius; x += 1) for (let z = -radius; z <= radius; z += 1) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
        candidates.push({ x, z: z + 1.55 });
      }
      const free = candidates.find((point) => !plots.some((plot) => dockOverlapsPlot(point, plot))
        && !existing.some((dock) => Math.hypot(point.x - dock.x, point.z - dock.z) < 0.85));
      if (free) return { ...free, y: 0 };
      candidates.length = 0;
    }
    return { x: 0, z: 14, y: 0 };
  }
  function normalizeDrones(saved, plots, dockPosition) {
    const count = saved.droneCount || saved.drones?.length || 1;
    const drones = Array.isArray(saved.drones) ? saved.drones.slice(0, count).map((drone, index) => ({
      dockPosition: { x: drone.dockPosition.x, z: drone.dockPosition.z, y: Number.isInteger(drone.dockPosition.y) ? drone.dockPosition.y : 0 },
      deployed: drone.deployed !== false,
      deploymentOrder: Number.isInteger(drone.deploymentOrder) ? drone.deploymentOrder : drone.deployed === false ? 0 : index + 1,
      battery: Number.isFinite(drone.battery) ? Math.max(0, Math.min(100, drone.battery)) : 100,
      batteryUpdatedAt: Number.isFinite(drone.batteryUpdatedAt) ? drone.batteryUpdatedAt : Date.now(),
    })) : [{ dockPosition: { ...dockPosition }, deployed: true, deploymentOrder: 1, battery: 100, batteryUpdatedAt: Date.now() }];
    while (drones.length < count) drones.push({ dockPosition: findDroneDock(plots, drones.map((drone) => drone.dockPosition)), deployed: true, deploymentOrder: drones.length + 1, battery: 100, batteryUpdatedAt: Date.now() });
    drones[0].dockPosition = { ...dockPosition };
    const deploymentSequence = Math.max(saved.deploymentSequence || 0, ...drones.map((drone) => drone.deploymentOrder));
    return { drones, deploymentSequence };
  }
  function createFreshGame() {
    const plots = defaultPlotPositions(3).map(({ x, z }) => ({ crop: null, plantedAt: null, manual: false, grassOnly: false, x, z, y: 0 }));
    const dockPosition = { x: 0, z: 1.55, y: 0 };
    return { coins: STARTING_COINS, cropCatalogVersion: CROP_CATALOG_VERSION, gardenName: '花明摸魚花園', avatarMode: 'auto', avatarCrop: 0, hudCollapsed: false, autoMode: false, autoCropSelection: [0], flowerVariants: [], worldTimeMs: 60_000, worldTimeAnchor: Date.now(), lastObservedRaining: false, droneCount: 1, deploymentSequence: 1, drones: [{ dockPosition, deployed: true, deploymentOrder: 1, battery: 100, batteryUpdatedAt: Date.now() }], lastOnlineAt: null, lastOfflineReturnAt: null, dockPosition, plots };
  }
  function isValidVariantList(variants) {
    return Array.isArray(variants) && variants.length <= MAX_FLOWER_VARIANTS
      && new Set(variants.map((variant) => variant?.id)).size === variants.length
      && variants.every((variant) => variant && typeof variant.id === 'string' && variant.id.length >= 1 && variant.id.length <= 80
        && typeof variant.name === 'string' && variant.name.trim().length >= 1 && variant.name.length <= 20
        && Number.isInteger(variant.cropIndex) && variant.cropIndex >= 0 && variant.cropIndex < crops.length
        && typeof variant.color === 'string' && /^#[0-9a-f]{6}$/i.test(variant.color));
  }
  function readFlowerVariants() {
    const serialized = localStorage.getItem(FLOWER_VARIANTS_KEY);
    if (!serialized) return [];
    const variants = JSON.parse(serialized);
    if (!isValidVariantList(variants)) throw new Error('變種資料不相容');
    return variants;
  }
  function isValidSave(saved, flowerVariants = []) {
    if (!saved || typeof saved !== 'object' || !Number.isFinite(saved.coins) || saved.coins < 0 || !Array.isArray(saved.plots) || !saved.plots.length) return false;
    if (saved.cropCatalogVersion !== undefined && (!Number.isInteger(saved.cropCatalogVersion) || saved.cropCatalogVersion < 1 || saved.cropCatalogVersion > CROP_CATALOG_VERSION)) return false;
    if (saved.autoMode !== undefined && typeof saved.autoMode !== 'boolean') return false;
    if (saved.autoCropSelection !== undefined && (!Array.isArray(saved.autoCropSelection) || saved.autoCropSelection.some((index) => !Number.isInteger(index) || index < 0 || index >= crops.length) || new Set(saved.autoCropSelection).size !== saved.autoCropSelection.length)) return false;
    if (saved.gardenName !== undefined && (typeof saved.gardenName !== 'string' || saved.gardenName.trim().length < 1 || saved.gardenName.trim().length > 24)) return false;
    if (saved.avatarMode !== undefined && !['auto', 'manual'].includes(saved.avatarMode)) return false;
    if (saved.avatarCrop !== undefined && (!Number.isInteger(saved.avatarCrop) || saved.avatarCrop < 0 || saved.avatarCrop >= crops.length)) return false;
    if (saved.hudCollapsed !== undefined && typeof saved.hudCollapsed !== 'boolean') return false;
    if (saved.droneCount !== undefined && (!Number.isInteger(saved.droneCount) || saved.droneCount < 1 || saved.droneCount > MAX_DRONES)) return false;
    if (saved.deploymentSequence !== undefined && (!Number.isInteger(saved.deploymentSequence) || saved.deploymentSequence < 0)) return false;
    if (saved.drones !== undefined && (!Array.isArray(saved.drones) || saved.drones.length < 1 || saved.drones.length > MAX_DRONES || saved.drones.some((drone) => !drone || !drone.dockPosition || !Number.isFinite(drone.dockPosition.x) || !Number.isFinite(drone.dockPosition.z) || (drone.dockPosition.y !== undefined && (!Number.isInteger(drone.dockPosition.y) || drone.dockPosition.y < -8 || drone.dockPosition.y > 8)) || (drone.deployed !== undefined && typeof drone.deployed !== 'boolean') || (drone.deploymentOrder !== undefined && (!Number.isInteger(drone.deploymentOrder) || drone.deploymentOrder < 0)) || (drone.battery !== undefined && (!Number.isFinite(drone.battery) || drone.battery < 0 || drone.battery > 100)) || (drone.batteryUpdatedAt !== undefined && (!Number.isFinite(drone.batteryUpdatedAt) || drone.batteryUpdatedAt < 0))))) return false;
    if (saved.lastOnlineAt !== undefined && saved.lastOnlineAt !== null && (!Number.isFinite(saved.lastOnlineAt) || saved.lastOnlineAt < 0)) return false;
    if (saved.lastOfflineReturnAt !== undefined && saved.lastOfflineReturnAt !== null && (!Number.isFinite(saved.lastOfflineReturnAt) || saved.lastOfflineReturnAt < 0)) return false;
    if (saved.worldTimeMs !== undefined && (!Number.isFinite(saved.worldTimeMs) || saved.worldTimeMs < 0)) return false;
    if (saved.worldTimeAnchor !== undefined && (!Number.isFinite(saved.worldTimeAnchor) || saved.worldTimeAnchor < 0)) return false;
    if (saved.lastObservedRaining !== undefined && typeof saved.lastObservedRaining !== 'boolean') return false;
    if (saved.dockPosition !== undefined && (!saved.dockPosition || !Number.isFinite(saved.dockPosition.x) || !Number.isFinite(saved.dockPosition.z) || (saved.dockPosition.y !== undefined && (!Number.isInteger(saved.dockPosition.y) || saved.dockPosition.y < -8 || saved.dockPosition.y > 8)))) return false;
    const hasAnyPosition = saved.plots.some((plot) => plot && (plot.x !== undefined || plot.z !== undefined));
    const hasAllPositions = saved.plots.every((plot) => plot && Number.isInteger(plot.x) && Number.isInteger(plot.z));
    if (hasAnyPosition !== hasAllPositions) return false;
    if (hasAllPositions) {
      const uniquePositions = new Set(saved.plots.map((plot) => `${plot.x},${plot.z},${Number.isFinite(plot.y) ? plot.y : 0}`));
      if (uniquePositions.size !== saved.plots.length) return false;
    }
    return saved.plots.every((plot) => plot && typeof plot === 'object'
      && (plot.y === undefined || (isHalfUnitHeight(plot.y) && plot.y >= -8 && plot.y <= 8))
      && (plot.manual === undefined || typeof plot.manual === 'boolean')
      && (plot.grassOnly === undefined || typeof plot.grassOnly === 'boolean')
      && (plot.watered === undefined || typeof plot.watered === 'boolean')
      && (plot.waterSource === undefined || plot.waterSource === null || ['rain', 'drone', 'manual'].includes(plot.waterSource))
      && (plot.growthBonusMs === undefined || (Number.isFinite(plot.growthBonusMs) && plot.growthBonusMs >= 0))
      && (plot.plantHeight === undefined || plot.plantHeight === null || (Number.isFinite(plot.plantHeight) && plot.plantHeight >= 0.9 && plot.plantHeight <= 1.1))
      && (plot.variantId === undefined || plot.variantId === null || flowerVariants.some((variant) => variant.id === plot.variantId && variant.cropIndex === plot.crop))
      && (plot.crop !== null || plot.variantId === undefined || plot.variantId === null)
      && ((plot.waterStartedAt === undefined && plot.waterUntil === undefined)
        || (Number.isFinite(plot.waterStartedAt) && Number.isFinite(plot.waterUntil) && plot.waterUntil > plot.waterStartedAt && plot.watered === true))
      && (plot.crop === null
      ? plot.plantedAt === null || plot.plantedAt === undefined
      : Number.isInteger(plot.crop) && plot.crop >= 0 && plot.crop < crops.length && Number.isFinite(plot.plantedAt) && plot.plantedAt >= 0));
  }
  function loadGame() {
    let flowerVariants = [];
    try { flowerVariants = readFlowerVariants(); }
    catch (_) { persistenceAvailable = false; persistenceWarning = '花卉變種資料無法讀取或格式不相容；原資料保留。'; }
    let serialized;
    try { serialized = localStorage.getItem(STORAGE_KEY); } catch (_) { persistenceAvailable = false; persistenceWarning = '瀏覽器無法讀取存檔；重新整理可能會遺失本次進度。'; return { ...createFreshGame(), flowerVariants }; }
    if (serialized === null) return { ...createFreshGame(), flowerVariants };
    let saved;
    try { saved = JSON.parse(serialized); } catch (_) { persistenceAvailable = false; persistenceWarning = '存檔格式無法讀取；原存檔保留，本次進度只保留在此頁面。'; return { ...createFreshGame(), flowerVariants }; }
    if (!isValidSave(saved, flowerVariants)) { persistenceAvailable = false; persistenceWarning = '存檔資料不相容；原存檔保留，本次進度只保留在此頁面。'; return { ...createFreshGame(), flowerVariants }; }
    const legacyPositions = defaultPlotPositions(saved.plots.length);
    const plots = saved.plots.map((plot, index) => ({
      ...plot,
      manual: plot.manual === true,
      grassOnly: plot.grassOnly === true,
      x: Number.isInteger(plot.x) ? plot.x : legacyPositions[index].x,
      z: Number.isInteger(plot.z) ? plot.z : legacyPositions[index].z,
      y: isHalfUnitHeight(plot.y) ? plot.y : 0,
      plantedAt: plot.crop === null ? null : plot.plantedAt,
      plantHeight: plot.crop === null ? null : Number.isFinite(plot.plantHeight) ? plot.plantHeight : 1,
    }));
    const dockPosition = saved.dockPosition ? { ...saved.dockPosition, y: Number.isInteger(saved.dockPosition.y) ? saved.dockPosition.y : 0 } : { x: 0, z: 1.55, y: 0 };
    const { drones, deploymentSequence } = normalizeDrones(saved, plots, dockPosition);
    // Older saves can contain stacked land or raised docks from before grass support was enforced.
    // Preserve their coordinates and adapt the lower plots to the new surface rule on load.
    const deployedDocks = drones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition);
    plots.forEach((plot) => { if (plotHasSupportAbove(plot, plots, deployedDocks)) plot.grassOnly = true; });
    return { ...saved, cropCatalogVersion: CROP_CATALOG_VERSION, gardenName: saved.gardenName || '花明摸魚花園', avatarMode: saved.avatarMode === 'manual' ? 'manual' : 'auto', avatarCrop: Number.isInteger(saved.avatarCrop) && saved.avatarCrop >= 0 && saved.avatarCrop < crops.length ? saved.avatarCrop : 0, hudCollapsed: saved.hudCollapsed === true, autoMode: saved.autoMode === true, autoCropSelection: Array.isArray(saved.autoCropSelection) ? saved.autoCropSelection : [0], flowerVariants, worldTimeMs: Number.isFinite(saved.worldTimeMs) ? saved.worldTimeMs : 60_000, worldTimeAnchor: Number.isFinite(saved.worldTimeAnchor) ? saved.worldTimeAnchor : Date.now(), lastObservedRaining: typeof saved.lastObservedRaining === 'boolean' ? saved.lastObservedRaining : window.skyEnvironment.getState(saved).isRaining, droneCount: drones.length, deploymentSequence, drones, dockPosition, plots };
  }
  if (window.diangardenCloudReady) {
    // Startup is explicitly gated by cloud-save.js: only a resolved login flow or guest choice may start the game.
    await window.diangardenCloudReady;
  }
  const game = loadGame();
  let rainStartedAt = game.lastObservedRaining ? Date.now() : null;
  function getAutomaticPlotCount() { return window.gardenEconomy.getAutomaticPlotCount(game.plots); }
  function getLandCost() { return window.gardenEconomy.getLandCost(getAutomaticPlotCount()); }
  function getPlotLabel(index) {
    const plot = game.plots[index];
    if (plot?.manual === true) return '手動地塊';
    return `自動地塊 ${game.plots.slice(0, index + 1).filter((item) => item.manual !== true).length}`;
  }
  function getDroneCost() { return window.gardenEconomy.getDroneCost(game.droneCount); }
  function getPlantablePlotCount() { return window.gardenEconomy.getPlantablePlotCount(game.plots); }
  function getHarvestReward(crop) { return window.gardenEconomy.getHarvestReward(crop, getPlantablePlotCount()); }
  try {
    const savedSelection = JSON.parse(localStorage.getItem(AUTO_CROP_KEY) || 'null');
    if (Array.isArray(savedSelection) && savedSelection.every((index) => Number.isInteger(index) && index >= 0 && index < crops.length)
      && new Set(savedSelection).size === savedSelection.length) game.autoCropSelection = savedSelection;
    else localStorage.setItem(AUTO_CROP_KEY, JSON.stringify(game.autoCropSelection));
  } catch (_) { /* Keep the selection loaded from the garden save when preference storage is unavailable. */ }
  function getPlantedCrop(plot) {
    const base = crops[plot?.crop] || crops[0];
    const variant = game.flowerVariants.find((item) => item.id === plot?.variantId);
    const variantName = variant?.name || plot?.variantName;
    const variantColor = variant?.color || plot?.variantColor;
    return variantName && variantColor
      ? { ...base, name: `${base.name}・${variantName}`, customColor: variantColor }
      : base;
  }
  function simulateOfflineProgress(state, now = Date.now()) {
    return window.gardenEconomy.simulateOfflineProgress(state, now, crops, window.skyEnvironment);
  }
  const offlineReport = simulateOfflineProgress(game);
  const plotSelector = document.querySelector('#plot-selector');
  const coinsDisplay = document.querySelector('#coins');
  const toast = document.querySelector('#toast');
  const saveStatus = document.querySelector('#save-status');
  let cloudSessionExpired = Boolean(window.diangardenCloudSessionExpired);
  window.addEventListener('diangarden:cloud-session-state', (event) => {
    cloudSessionExpired = Boolean(event.detail?.expired);
    updateSaveStatus();
  });
  const jobStatus = document.querySelector('#job-status');
  const jobQueueDisplay = document.querySelector('#job-queue');
  const expandButton = document.querySelector('#world-expand');
  const manualLandButton = document.querySelector('#world-buy-manual-plot');
  const autoModeButton = document.querySelector('#auto-mode');
  const buyDroneButton = document.querySelector('#buy-drone');
  const droneFleetDisplay = document.querySelector('#drone-fleet');
  const dronePanelToggle = document.querySelector('#drone-panel-toggle');
  const settingsToggle = document.querySelector('#settings-toggle');
  const settingsPanel = document.querySelector('#settings-panel');
  const powerSaveToggle = document.querySelector('#power-save-toggle');
  const droneJobsPanel = document.querySelector('#drone-jobs');
  const hudToggle = document.querySelector('#hud-toggle');
  const hudCollapsedSummary = document.querySelector('#hud-collapsed-summary');
  const environmentStatus = document.querySelector('#environment-status');
  const gardenNameDisplay = document.querySelector('#garden-name-display');
  const gardenAvatar = document.querySelector('#garden-avatar');
  const avatarDialog = document.querySelector('#avatar-dialog');
  const avatarModeSelect = document.querySelector('#avatar-mode');
  const avatarFlowerPicker = document.querySelector('#avatar-flower-picker');
  const avatarFlowerLabel = document.querySelector('#avatar-flower-label');
  const avatarCurrentFlower = document.querySelector('#avatar-current-flower');
  const avatarFlowerOptions = document.querySelector('#avatar-flower-options');
  const gardenNameEditor = document.querySelector('#garden-name-editor');
  const gardenNameInput = document.querySelector('#garden-name-input');
  const resetProgressButton = document.querySelector('#reset-progress');
  const resetDialog = document.querySelector('#reset-dialog');
  const confirmResetButton = document.querySelector('#confirm-reset');
  const dialog = document.querySelector('#farm-dialog');
  const dialogTitle = document.querySelector('#farm-dialog-title');
  const dialogContent = document.querySelector('#farm-dialog-content');
  let toastTimeout;
  let dialogContext = null;
  let activePlotIndex = -1;
  let dockIsSelected = false;
  let isResetting = false;
  const activeJobs = new Map();
  const returningDrones = new Set();
  const lastCompletedPlotByDrone = new Map();
  let nextDroneIndex = 0;
  const jobQueue = [];
  let lastBatterySaveAt = Date.now();
  function updateBatteries(now = Date.now()) {
    game.drones.forEach((drone, index) => {
      const previous = Number.isFinite(drone.batteryUpdatedAt) ? drone.batteryUpdatedAt : now;
      const elapsed = Math.max(0, now - previous);
      let battery = Number.isFinite(drone.battery) ? drone.battery : 100;
      if (elapsed > 0) {
        const working = activeJobs.has(index);
        const animationPaused = working && document.visibilityState === 'hidden';
        // Sample the virtual weather at short intervals so offline and in-flight charging follow the day/night and rain cycle.
        for (let cursor = previous; cursor < now;) {
          const duration = Math.min(60_000, now - cursor);
          const environment = window.skyEnvironment.getState(game, cursor + duration / 2);
          if (working && !animationPaused) battery -= duration / 1000 * DRONE_BATTERY_DRAIN_PER_SECOND;
          if (!animationPaused && environment.isDay && !environment.isRaining) battery += duration / 1000 * DRONE_BATTERY_CHARGE_PER_SECOND;
          cursor += duration;
          if (!working && battery >= 100) { battery = 100; break; }
        }
      }
      drone.battery = Math.max(0, Math.min(100, battery));
      drone.batteryUpdatedAt = now;
    });
  }
  function estimateJobBattery(job, droneIndex) {
    const drone = game.drones[droneIndex];
    const destination = job.kind === 'expand' ? job.position : game.plots[job.index];
    const distance = destination ? Math.hypot(destination.x - drone.dockPosition.x, destination.z - drone.dockPosition.z) : 0;
    const estimatedSeconds = distance * 3 + 8;
    // Reserve gross drain even in daylight so a job remains safe if weather or time changes en route.
    return Math.max(DRONE_MIN_JOB_BATTERY, estimatedSeconds * DRONE_BATTERY_DRAIN_PER_SECOND + 3);
  }
  function save() {
    // Cloud restore is replacing this page's in-memory state; never persist it over the restored save.
    if (skipSaveOnExit || isResetting) return true;
    if (!persistenceAvailable) return false;
    game.lastOnlineAt = Date.now();
    try {
      updateBatteries(game.lastOnlineAt);
      window.skyEnvironment.advance(game, game.lastOnlineAt);
      game.savedAt = game.lastOnlineAt;
      const { flowerVariants, ...saveData } = game;
      localStorage.setItem(FLOWER_VARIANTS_KEY, JSON.stringify(flowerVariants));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData));
      localStorage.setItem(AUTO_CROP_KEY, JSON.stringify(game.autoCropSelection));
      window.dispatchEvent(new CustomEvent('diangarden:save', { detail: { savedAt: game.lastOnlineAt } }));
      return true;
    }
    catch (_) { persistenceAvailable = false; persistenceWarning = '自動儲存失敗；重新整理可能會遺失本次進度。'; updateSaveStatus(); notify(persistenceWarning); return false; }
  }
  function notify(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove('show'), 2100); }
  function updateSaveStatus() { if (!saveStatus) return; saveStatus.textContent = persistenceWarning || (cloudSessionExpired ? '暫停同步雲端進度' : '進度會自動儲存'); saveStatus.classList.toggle('save-warning', !persistenceAvailable || cloudSessionExpired); }
  if (offlineReport) save();
  window.addEventListener('pagehide', () => { if (!isResetting && !skipSaveOnExit) save(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !isResetting && !skipSaveOnExit) save(); });
  function growthElapsed(plot, now = Date.now()) {
    if (!plot || plot.crop === null || !Number.isFinite(plot.plantedAt)) return 0;
    let elapsed = Math.max(0, now - plot.plantedAt) + (plot.growthBonusMs || 0);
    if (Number.isFinite(plot.waterStartedAt) && Number.isFinite(plot.waterUntil)) {
      const boostedDuration = Math.max(0, Math.min(now, plot.waterUntil) - plot.waterStartedAt);
      elapsed += boostedDuration * (WATER_GROWTH_RATE - 1);
    }
    return elapsed;
  }
  function settleExpiredWaterBoosts(now = Date.now()) {
    let changed = false;
    game.plots.forEach((plot) => {
      if (!Number.isFinite(plot.waterStartedAt) || !Number.isFinite(plot.waterUntil) || now < plot.waterUntil) return;
      plot.growthBonusMs = (plot.growthBonusMs || 0) + (plot.waterUntil - plot.waterStartedAt) * (WATER_GROWTH_RATE - 1);
      delete plot.waterStartedAt; delete plot.waterUntil; changed = true;
    });
    if (changed) save();
  }
  function applyRainMoisture(now = Date.now(), wetnessStart = 1) {
    game.plots.forEach((plot) => {
      if (plot.crop === null) return;
      if (Number.isFinite(plot.waterStartedAt) && Number.isFinite(plot.waterUntil)) {
        const boostedDuration = Math.max(0, Math.min(now, plot.waterUntil) - plot.waterStartedAt);
        plot.growthBonusMs = (plot.growthBonusMs || 0) + boostedDuration * (WATER_GROWTH_RATE - 1);
      }
      plot.watered = true;
      plot.waterSource = 'rain';
      plot.waterWetnessStart = Math.max(0, Math.min(1, wetnessStart));
      plot.waterStartedAt = now;
      plot.waterUntil = now + WATER_DURATION;
    });
  }
  function updateHud() {
    coinsDisplay.textContent = game.coins; updateSaveStatus(); updateAvatarDisplay();
    if (manualLandButton) { manualLandButton.textContent = `手動地塊 · ${getLandCost()} 🪙`; manualLandButton.setAttribute('aria-label', `購買手動地塊，花費 ${getLandCost()} 金幣`); }
    const environment = window.skyEnvironment.getState(game);
    updateEnvironmentDisplay(environment);
    window.skyWorld?.setPlotPositions(game.plots.map(({ x, z, y }) => ({ x, z, y })));
    window.skyWorld?.setLandCount(game.plots.length);
    window.skyWorld?.setDockPosition(game.dockPosition);
    window.skyWorld?.setDroneCount(game.droneCount);
    window.skyWorld?.setDroneDocks(game.drones.map((drone) => ({ ...drone.dockPosition, deployed: drone.deployed, deploymentOrder: drone.deploymentOrder, battery: drone.battery })));
    updateBuyDroneButton();
    const now = Date.now();
    window.skyWorld?.setPlots(game.plots.map((plot) => ({ ...plot, customColor: plot.crop === null ? null : getPlantedCrop(plot).customColor, elapsed: growthElapsed(plot, now), growTime: crops[plot.crop]?.growTime ?? crops[0].growTime })));
  }
  function updateEnvironmentDisplay(environment = window.skyEnvironment.getState(game)) {
    const now = Date.now();
    if (game.lastObservedRaining !== true && environment.isRaining) rainStartedAt = now;
    if (game.lastObservedRaining === true && !environment.isRaining) {
      const rainWetness = rainStartedAt === null ? 1 : Math.min(1, Math.max(0, (now - rainStartedAt) / 1680));
      applyRainMoisture(now, rainWetness);
      rainStartedAt = null;
      game.lastObservedRaining = false;
      save();
    } else game.lastObservedRaining = environment.isRaining;
    environmentStatus.textContent = `${environment.isRaining ? '🌧 陰雨 · 全株濕潤' : '☀ 晴朗'} · ${({ dawn: '🌅 清晨', day: '☀ 白天', dusk: '🌇 黃昏', night: '🌙 夜晚' })[environment.phase]}`;
    window.skyWorld?.setEnvironment(environment);
  }
  function selectPlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= game.plots.length) return;
    dockIsSelected = false;
    activePlotIndex = index;
    plotSelector.querySelectorAll('[data-plot-button]').forEach((button) => {
      const selected = Number(button.dataset.plotButton) === index;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    window.skyWorld?.setSelectedPlot(index);
  }
  function renderFarmDialog() {
    if (!dialog.open || !dialogContext) return;
    dialog.classList.remove('has-variant-panel', 'has-seed-picker');
    if (dialogContext.type === 'expansion' || dialogContext.type === 'manual-expansion') {
      const isManual = dialogContext.type === 'manual-expansion';
      const cost = getLandCost();
      dialogTitle.textContent = isManual ? '購買手動地塊' : '購買自動地塊';
      const description = isManual ? '手動地塊不計入自動地塊數，但仍會影響可種植地塊的收成淨利倍率；無人機不會自動照料。' : '價格依目前自動地塊數計算；手動地塊不會推進價格曲線。新地塊可由無人機執行自動工作。';
      dialogContent.innerHTML = `<p class="seed-dialog-description">${description} 需要 ${cost} 枚金幣。你目前有 ${game.coins} 枚。</p><div class="dialog-actions"><button class="dialog-cancel" type="button" data-dialog-cancel>再想想</button><button class="action-button" type="button" data-confirm-expansion ${game.coins < cost ? 'disabled' : ''}>確認購買　${cost} 🪙</button></div>`;
      dialogContent.querySelector('[data-dialog-cancel]').addEventListener('click', () => dialog.close());
      dialogContent.querySelector('[data-confirm-expansion]').addEventListener('click', () => { if (game.coins >= cost) { dialog.close(); if (isManual) buyManualLand(); else buyLand(); } });
      return;
    }
    const index = dialogContext.index;
    const plot = game.plots[index];
    if (!plot) { dialog.close(); return; }
    selectPlot(index);
    dialogTitle.textContent = getPlotLabel(index);
    if (plot.crop === null) {
      dialog.classList.add('has-seed-picker');
      const deleteAction = game.plots.length > 1 ? `<button class="dialog-delete-plot" type="button" data-delete-plot ${hasDroneJobs() ? 'disabled' : ''}>${hasDroneJobs() ? '無人機工作時無法刪除' : '刪除這塊地'}</button>` : '';
      dialogContent.innerHTML = `${plotModeSettingMarkup(plot, index)}<p class="seed-dialog-description">${plot.grassOnly ? '草地地塊無法種植；切換地塊性質後即可播種。' : `選擇要種下的花種。你目前有 ${game.coins} 枚金幣。`}</p><div class="seed-picker-layout"><div class="seed-picker-main"><div class="seed-options"></div></div><aside class="variant-picker-panel" id="variant-picker-panel" hidden><div class="variant-picker-heading"><h3 id="variant-picker-title">選擇花種變種</h3><button class="variant-picker-close" type="button" aria-label="關閉變種選單">×</button></div><div class="variant-seed-options" id="variant-seed-options"></div></aside></div>${deleteAction}`;
      const options = dialogContent.querySelector('.seed-options');
      const variantPanel = dialogContent.querySelector('#variant-picker-panel');
      const variantPanelTitle = dialogContent.querySelector('#variant-picker-title');
      const variantOptions = dialogContent.querySelector('#variant-seed-options');
      if (plot.grassOnly) options.innerHTML = '<p class="seed-dialog-description">此地塊是純草地，不能播種。</p>';
      else crops.forEach((crop, cropIndex) => {
        const row = document.createElement('div'); row.className = 'seed-choice-row';
        const option = document.createElement('button'); option.className = 'seed-option'; option.type = 'button';
        option.innerHTML = `<span class="seed-option-icon">${flowerIconMarkup(crop, 'flower-pixel-icon seed-pixel-icon')}</span><span class="seed-option-copy"><strong>${crop.name}</strong><small>種子 ${crop.seedCost} 🪙 · 生長約 ${crop.growTime / 1000} 秒 · 收成 ${getHarvestReward(crop)} 🪙</small></span>`;
        option.disabled = game.coins < crop.seedCost;
        option.addEventListener('click', () => { if (game.plots[index]?.crop === null && game.coins >= crop.seedCost) { dialog.close(); plant(index, cropIndex); } });
        const variantTrigger = document.createElement('button'); variantTrigger.className = 'seed-variant-trigger'; variantTrigger.type = 'button'; variantTrigger.textContent = '▷';
        variantTrigger.setAttribute('aria-label', `開啟${crop.name}變種選單`); variantTrigger.setAttribute('aria-controls', 'variant-picker-panel'); variantTrigger.setAttribute('aria-expanded', 'false');
        variantTrigger.addEventListener('click', () => {
          const samePanelOpen = !variantPanel.hidden && variantPanel.dataset.cropIndex === String(cropIndex);
          dialogContent.querySelectorAll('.seed-variant-trigger').forEach((button) => button.setAttribute('aria-expanded', 'false'));
          if (samePanelOpen) {
            variantPanel.hidden = true; dialog.classList.remove('has-variant-panel'); return;
          }
          variantOptions.replaceChildren();
          variantPanelTitle.textContent = `${crop.name}・自訂變種`;
          const matchingVariants = game.flowerVariants.filter((variant) => variant.cropIndex === cropIndex);
          if (!matchingVariants.length) {
            const empty = document.createElement('p'); empty.className = 'variant-picker-empty'; empty.textContent = '尚未保存這種花的變種。可先到花卉圖鑑自訂並保存花色。'; variantOptions.append(empty);
          }
          matchingVariants.forEach((variant) => {
            const variantOption = document.createElement('button'); variantOption.className = 'variant-seed-option'; variantOption.type = 'button';
            variantOption.disabled = game.coins < crop.seedCost;
            const swatch = document.createElement('span'); swatch.className = 'variant-seed-swatch'; swatch.style.backgroundColor = variant.color; swatch.setAttribute('aria-label', `自訂花色 ${variant.color}`);
            const copy = document.createElement('span'); copy.className = 'variant-seed-copy';
            const name = document.createElement('strong'); name.textContent = variant.name;
            const details = document.createElement('small'); details.textContent = `${crop.name} · 種子 ${crop.seedCost} 🪙 · 生長約 ${crop.growTime / 1000} 秒 · 收成 ${getHarvestReward(crop)} 🪙`;
            copy.append(name, details);
            variantOption.append(swatch, copy);
            variantOption.addEventListener('click', () => { if (game.plots[index]?.crop === null && game.coins >= crop.seedCost) { dialog.close(); plant(index, cropIndex, variant.id); } });
            variantOptions.append(variantOption);
          });
          variantPanel.dataset.cropIndex = String(cropIndex);
          variantPanel.hidden = false;
          dialog.classList.add('has-variant-panel');
          variantTrigger.setAttribute('aria-expanded', 'true');
        });
        row.append(option, variantTrigger);
        options.append(row);
      });
      dialogContent.querySelector('.variant-picker-close').addEventListener('click', () => { variantPanel.hidden = true; dialog.classList.remove('has-variant-panel'); dialogContent.querySelectorAll('.seed-variant-trigger').forEach((button) => button.setAttribute('aria-expanded', 'false')); });
      dialogContent.querySelector('[data-delete-plot]')?.addEventListener('click', () => deletePlot(index));
      attachPlotModeSwitch(index);
      return;
    }
    const crop = getPlantedCrop(plot);
    const elapsed = growthElapsed(plot);
    const progress = Math.min(100, Math.floor((elapsed / crop.growTime) * 100));
    const ready = elapsed >= crop.growTime;
    const remaining = Math.max(0, Math.ceil((crop.growTime - elapsed) / 1000));
    const isRaining = window.skyEnvironment.getState(game).isRaining;
    const waterPending = hasPendingJob('water', index);
    const wateredLabel = plot.waterSource === 'rain' ? '雨水濕潤' : plot.waterSource === 'drone' ? '無人機已澆水' : '已澆水';
    const waterAction = !ready ? `<button class="action-button water dialog-primary" type="button" data-dialog-water ${isRaining || plot.watered || waterPending ? 'disabled' : ''}>${isRaining ? '陰雨中自然濕潤' : plot.watered ? wateredLabel : waterPending ? '等待澆水' : isDroneExcluded(plot) ? '手動澆水（30 秒，1.2 倍生長）' : '請無人機澆水（30 秒，1.2 倍生長）'}</button>` : '';
    const boostStatus = plot.watered ? `<p class="water-status">${plot.waterSource === 'rain' ? '雨水已補足澆水狀態' : Number.isFinite(plot.waterUntil) && plot.waterUntil > Date.now() ? `澆水加速中，還有 ${Math.ceil((plot.waterUntil - Date.now()) / 1000)} 秒` : '這株花已完成澆水加速'}</p>` : '';
    const deleteAction = game.plots.length > 1 ? `<button class="dialog-delete-plot" type="button" data-delete-plot ${hasDroneJobs() ? 'disabled' : ''}>${hasDroneJobs() ? '無人機工作時無法刪除' : '刪除這塊地'}</button>` : '';
    dialogContent.innerHTML = `${plotModeSettingMarkup(plot, index)}<div class="dialog-crop"><span>${ready ? flowerIconMarkup(crop) : crop.seedIcon}</span><div><strong>${crop.name}${ready ? ' 已成熟' : ' 正在生長'}</strong><p>${ready ? `預計收成可獲得 ${getHarvestReward(crop)} 枚金幣。` : `預計還需 ${remaining} 秒成熟。`}</p></div></div><div class="dialog-progress"><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><small>${progress}%</small></div>${ready ? '<button class="action-button harvest dialog-primary" type="button" data-dialog-harvest>收成並領取金幣</button>' : waterAction}${boostStatus}${deleteAction}`;
    dialogContent.querySelector('[data-dialog-harvest]')?.addEventListener('click', () => { dialog.close(); harvest(index); });
    dialogContent.querySelector('[data-dialog-water]')?.addEventListener('click', () => { dialog.close(); water(index); });
    dialogContent.querySelector('[data-delete-plot]')?.addEventListener('click', () => deletePlot(index));
    attachPlotModeSwitch(index);
  }
  function openPlotDialog(index) { if (!Number.isInteger(index) || index < 0 || index >= game.plots.length) return; selectPlot(index); dialogContext = { type: 'plot', index }; dialog.showModal(); renderFarmDialog(); }
  function openExpansionDialog() { dialogContext = { type: 'expansion' }; dialog.showModal(); renderFarmDialog(); }
  function jobLabel(job) {
    if (job.kind === 'plant') return `播種 ${crops[job.cropIndex]?.name || '花卉'} · 農地 ${job.index + 1}`;
    if (job.kind === 'harvest') return `收成 · 農地 ${job.index + 1}`;
    if (job.kind === 'water') return `澆水 · 農地 ${job.index + 1}`;
    return '擴建空中土地';
  }
  function renderJobQueue() {
    if (!jobStatus || !jobQueueDisplay) return;
    const expansionPending = [...activeJobs.values()].some((job) => job.kind === 'expand') || jobQueue.some((job) => job.kind === 'expand');
    expandButton?.setAttribute('aria-disabled', String(expansionPending));
    expandButton?.classList.toggle('is-blocked', expansionPending);
    expandButton.textContent = `自動地塊 · ${getLandCost()} 🪙`;
    expandButton?.setAttribute('aria-label', expansionPending ? '農地擴建中，請稍後' : `擴建空中土地，花費 ${getLandCost()} 枚金幣`);
    expandButton?.setAttribute('title', expansionPending ? '農地擴建中，請稍後' : '擴建空中土地');
    const waitingForCharge = jobQueue.length > 0 && game.drones.every((drone, index) => drone.deployed === false || activeJobs.has(index) || drone.battery < estimateJobBattery(jobQueue[0], index));
    jobStatus.textContent = activeJobs.size ? `工作中` : waitingForCharge ? '電量不足，工作排隊等待充電' : '無人機待命';
    renderDroneFleet();
    updateHudCollapse();
    jobQueueDisplay.replaceChildren();
    if (!jobQueue.length) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'job-queue-empty';
      emptyItem.textContent = activeJobs.size ? '目前工作已由無人機執行，沒有等待中的工作。' : '目前沒有等待中的工作。';
      jobQueueDisplay.append(emptyItem);
    }
    jobQueue.forEach((job, index) => {
      const item = document.createElement('li');
      item.innerHTML = `<span>${index + 1}. ${jobLabel(job)}</span><button type="button" data-cancel-job="${job.id}" aria-label="取消${jobLabel(job)}">取消</button>`;
      jobQueueDisplay.append(item);
    });
    jobQueueDisplay.querySelectorAll('[data-cancel-job]').forEach((button) => button.addEventListener('click', () => {
      const index = jobQueue.findIndex((job) => job.id === button.dataset.cancelJob);
      if (index >= 0) { const [removed] = jobQueue.splice(index, 1); renderJobQueue(); notify(`已取消等待中的${jobLabel(removed)}。`); }
    }));
  }
  function renderDroneFleet() {
    if (!droneFleetDisplay) return;
    droneFleetDisplay.replaceChildren();
    game.drones.forEach((drone, index) => {
      const row = document.createElement('div');
      row.className = 'drone-fleet-item';
      const label = document.createElement('span');
      const environment = window.skyEnvironment.getState(game);
      const status = activeJobs.has(index) ? '移動中' : drone.battery < 100 && environment.isDay && !environment.isRaining ? '充電中' : !drone.deployed ? '已收起' : '待命';
      label.textContent = `無人機 ${index + 1} · 電量 ${Math.floor(drone.battery)}% · ${status}`;
      label.setAttribute('aria-label', `無人機 ${index + 1}，電量 ${Math.floor(drone.battery)}%，${status}`);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = drone.deployed ? '收起來' : '部署';
      button.setAttribute('aria-label', `${drone.deployed ? '收起' : '部署'}無人機 ${index + 1}`);
      button.disabled = activeJobs.has(index);
      button.addEventListener('click', () => {
        if (activeJobs.has(index)) return notify('無人機正在工作，完成後才能收起。');
        drone.deployed = !drone.deployed;
        if (drone.deployed) {
          game.deploymentSequence += 1;
          drone.deploymentOrder = game.deploymentSequence;
        }
        save();
        updateHud();
        renderDroneFleet();
        notify(drone.deployed ? `無人機 ${index + 1} 已部署。` : `無人機 ${index + 1} 已收起。`);
        if (drone.deployed) processJobQueue();
      });
      row.append(label, button);
      droneFleetDisplay.append(row);
    });
  }
  function updateAutoModeButton() {
    if (!autoModeButton) return;
    autoModeButton.textContent = `自動模式：${game.autoMode ? '開' : '關'}`;
    autoModeButton.setAttribute('aria-pressed', String(game.autoMode));
  }
  function updateBuyDroneButton() {
    if (!buyDroneButton) return;
    const cost = getDroneCost();
    buyDroneButton.textContent = game.droneCount >= MAX_DRONES ? `無人機 ${game.droneCount}/${MAX_DRONES} 台` : `購買無人機 · ${cost} 🪙 (${game.droneCount}/${MAX_DRONES})`;
    buyDroneButton.disabled = game.droneCount >= MAX_DRONES || game.coins < cost;
    buyDroneButton.setAttribute('aria-label', game.droneCount >= MAX_DRONES ? `已達無人機上限 ${MAX_DRONES} 台` : `花費 ${cost} 金幣購買一台無人機`);
  }
  function setDronePanelOpen(open) {
    if (!droneJobsPanel || !dronePanelToggle) return;
    if (open) {
      ensureHudExpanded();
      setFarmPanelOpen(false);
      if (settingsPanel) settingsPanel.hidden = true;
      settingsToggle?.setAttribute('aria-expanded', 'false');
    }
    droneJobsPanel.classList.toggle('is-open', open);
    document.querySelector('.world-frame')?.classList.toggle('is-drone-panel-open', open);
    dronePanelToggle.setAttribute('aria-expanded', String(open));
    dronePanelToggle.setAttribute('aria-label', open ? '收合無人機面板' : '開啟無人機面板');
    dronePanelToggle.setAttribute('title', open ? '收合無人機面板' : '開啟無人機面板');
  }
  function refreshDronePanelTimeout() {
    if (droneJobsPanel?.classList.contains('is-open')) setDronePanelOpen(true);
  }

  function ensureHudExpanded() {
    if (!game.hudCollapsed) return;
    game.hudCollapsed = false;
    save();
    updateHudCollapse();
  }
  const menuWheel = document.querySelector('#garden-menu-wheel');
  const wheelActions = ['drone', 'farm', 'settings', 'catalog', 'collapse'];
  const wheelAngles = [-90, -18, 54, 126, 198];
  let wheelPointerId = null;
  let wheelOrigin = null;
  let wheelSelectedAction = null;
  function setFarmPanelOpen(open) {
    const panel = document.querySelector('#farm-management-panel');
    const toggle = document.querySelector('#farm-management-toggle');
    if (!panel || !toggle) return;
    if (open) {
      ensureHudExpanded();
      setDronePanelOpen(false);
      if (settingsPanel) settingsPanel.hidden = true;
      settingsToggle?.setAttribute('aria-expanded', 'false');
    }
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  function updateHudCollapse() {
    document.querySelector('.world-frame')?.classList.toggle('is-hud-collapsed', game.hudCollapsed);
    if (game.hudCollapsed) {
      const farmPanel = document.querySelector('#farm-management-panel');
      if (farmPanel) farmPanel.hidden = true;
      document.querySelector('#farm-management-toggle')?.setAttribute('aria-expanded', 'false');
      if (settingsPanel) settingsPanel.hidden = true;
      settingsToggle?.setAttribute('aria-expanded', 'false');
      setDronePanelOpen(false);
    }
    if (hudCollapsedSummary) { const environment = window.skyEnvironment.getState(game); hudCollapsedSummary.textContent = `${game.gardenName} · 🪙 ${game.coins} · 🌱 ${getAutomaticPlotCount()} · ${environment.isRaining ? '陰雨' : '晴朗'} · ${({ dawn: '清晨', day: '白天', dusk: '黃昏', night: '夜晚' })[environment.phase]} · ${jobStatus?.textContent || '無人機待命'}${persistenceWarning ? ' · 存檔需留意' : ''}`; }
    if (!hudToggle) return;
    hudToggle.textContent = game.hudCollapsed ? '🔽' : '🔼';
    hudToggle.setAttribute('aria-label', game.hudCollapsed ? '展開介面' : '收合介面');
    hudToggle.setAttribute('title', game.hudCollapsed ? '展開介面' : '收合介面');
    hudToggle.setAttribute('aria-expanded', String(!game.hudCollapsed));
  }
  function getAvatarCropIndex() {
    if (game.avatarMode === 'manual') return Number.isInteger(game.avatarCrop) && game.avatarCrop >= 0 && game.avatarCrop < crops.length ? game.avatarCrop : 0;
    const counts = Array(crops.length).fill(0);
    game.plots.forEach((plot) => { if (Number.isInteger(plot.crop) && plot.crop >= 0 && plot.crop < counts.length) counts[plot.crop] += 1; });
    return counts.reduce((best, count, index) => count > counts[best] ? index : best, 0);
  }
  function updateAvatarDisplay() {
    if (!gardenAvatar) return;
    const cropIndex = getAvatarCropIndex();
    const flower = crops[cropIndex] || crops[0];
    if (flower.image) {
      let image = gardenAvatar.querySelector('img');
      if (!image) {
        gardenAvatar.replaceChildren();
        image = document.createElement('img');
        image.className = 'garden-avatar-image';
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        image.width = 28;
        image.height = 28;
        image.style.imageRendering = 'pixelated';
        gardenAvatar.append(image);
      }
      if (image.getAttribute('src') !== flower.image) image.src = flower.image;
    } else if (gardenAvatar.querySelector('img') || gardenAvatar.textContent !== (flower.emoji || '🌼')) {
      gardenAvatar.textContent = flower.emoji || '🌼';
    }
    gardenAvatar.setAttribute('aria-label', `花園頭像：${flower.name}`);
    if (avatarFlowerLabel) avatarFlowerLabel.textContent = game.avatarMode === 'manual' ? '指定花種' : '花種清單（自動模式不可手動選擇）';
    if (avatarCurrentFlower) avatarCurrentFlower.textContent = game.avatarMode === 'manual' ? `目前使用：${flower.name}` : `目前自動選擇：${flower.name}`;
    avatarFlowerOptions?.querySelectorAll('[data-avatar-crop]').forEach((button) => {
      const optionIndex = Number(button.dataset.avatarCrop);
      const optionFlower = crops[optionIndex] || crops[0];
      const selected = optionIndex === cropIndex;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-auto-selected', selected && game.avatarMode !== 'manual');
      button.setAttribute('aria-label', game.avatarMode !== 'manual' && selected ? `${optionFlower.name}，目前自動選中的頭像` : optionFlower.name);
    });
  }
  function renderAvatarFlowerOptions() {
    if (avatarFlowerPicker) avatarFlowerPicker.hidden = false;
    if (!avatarFlowerOptions) return;
    avatarFlowerOptions.replaceChildren();
    const selectedCropIndex = getAvatarCropIndex();
    crops.forEach((flower, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'avatar-flower-option';
      button.dataset.avatarCrop = String(index);
      button.setAttribute('aria-label', game.avatarMode !== 'manual' && index === selectedCropIndex ? `${flower.name}，目前自動選中的頭像` : flower.name);
      button.setAttribute('aria-pressed', String(index === selectedCropIndex));
      button.classList.toggle('is-auto-selected', index === selectedCropIndex && game.avatarMode !== 'manual');
      button.disabled = game.avatarMode !== 'manual';
      if (flower.image) {
        const image = document.createElement('img');
        image.className = 'avatar-flower-image';
        image.src = flower.image;
        image.alt = '';
        image.width = 32;
        image.height = 32;
        image.decoding = 'async';
        image.style.imageRendering = 'pixelated';
        button.append(image);
      } else {
        const emoji = document.createElement('span');
        emoji.className = 'avatar-flower-emoji';
        emoji.textContent = flower.emoji || '🌼';
        button.append(emoji);
      }
      const name = document.createElement('span');
      name.className = 'avatar-flower-name';
      name.textContent = flower.name;
      button.append(name);
      avatarFlowerOptions.append(button);
    });
  }
  function initializeAvatarSettings() {
    if (!avatarModeSelect || !avatarFlowerOptions) { updateAvatarDisplay(); return; }
    avatarModeSelect.value = game.avatarMode;
    renderAvatarFlowerOptions();
    updateAvatarDisplay();
  }
  function updateGardenName() {
    gardenNameDisplay.textContent = game.gardenName;
    gardenNameDisplay.setAttribute('aria-label', `編輯花園名稱：${game.gardenName}`);
    document.title = `${game.gardenName}｜空中花園`;
    updateHudCollapse();
  }
  function hasPendingJob(kind, index) {
    return [...activeJobs.values()].some((job) => job.kind === kind && job.index === index) || jobQueue.some((job) => job.kind === kind && job.index === index);
  }
  function cancelMatureWaterJobs() {
    let changed = false;
    for (let index = jobQueue.length - 1; index >= 0; index -= 1) {
      const job = jobQueue[index];
      if (job.kind !== 'water') continue;
      const plot = game.plots[job.index];
      const crop = plot && plot.crop !== null ? crops[plot.crop] || crops[0] : null;
      if (crop && growthElapsed(plot) >= crop.growTime) {
        jobQueue.splice(index, 1);
        changed = true;
      }
    }
    for (const job of activeJobs.values()) {
      if (job.kind === 'water' && !job.committed && !job.cancelled) {
        const plot = game.plots[job.index];
        const crop = plot && plot.crop !== null ? crops[plot.crop] || crops[0] : null;
        if (crop && growthElapsed(plot) >= crop.growTime) {
          job.cancelled = true;
          changed = true;
        }
      }
    }
    if (changed) renderJobQueue();
  }
  function hasActivePlotJob(index) {
    return [...activeJobs.values()].some((job) => job.kind !== 'expand' && job.index === index);
  }
  function plotMode(plot) { return plot.grassOnly ? 'grass' : plot.manual ? 'manual' : 'auto'; }
  function isDroneExcluded(plot) { return Boolean(plot?.manual || plot?.grassOnly); }
  function plotModeSettingMarkup(plot, index) {
    const mode = plotMode(plot);
    if (mode === 'auto') return '';
    const labels = { manual: '手動', grass: '草地' };
    const descriptions = {
      manual: '無人機不會對此地塊執行作物工作。',
      grass: '草地不會種植新植物；成熟植物可保留在草地上。',
    };
    const active = hasActivePlotJob(index);
    const crop = plot.crop === null ? null : crops[plot.crop] || crops[0];
    const mature = Boolean(crop && growthElapsed(plot) >= crop.growTime);
    const canSwitch = !crop || mature;
    const next = mode === 'manual' ? '草地' : '手動';
    const modeHelp = crop && !mature
      ? '植物成熟前不能轉成草地，以免生長中的植物被保留在草地上。'
      : `${descriptions[mode]} 點擊切換至${next}。`;
    return `<div class="manual-plot-setting plot-mode-setting"><div><strong>地塊性質：${labels[mode]}</strong><small>${modeHelp}</small></div><button class="plot-mode-switch" type="button" data-plot-mode-switch data-mode="${mode}" aria-label="農地 ${index + 1} 地塊性質：${labels[mode]}，點擊切換至${next}" ${active || !canSwitch ? 'disabled' : ''}><span class="${mode === 'manual' ? 'is-current' : ''}">${mode === 'manual' ? '手動' : '草地'}</span><span aria-hidden="true">⇄</span><span class="${mode === 'grass' ? 'is-current' : ''}">${mode === 'grass' ? '草地' : '手動'}</span></button></div>${active ? '<p class="manual-plot-busy">無人機正在此地工作，工作結束後才能切換。</p>' : ''}`;
  }
  function setPlotMode(index) {
    const plot = game.plots[index];
    if (!plot) return;
    if (hasActivePlotJob(index)) { renderFarmDialog(); notify('無人機正在此地工作，工作結束後才能切換農地性質。'); return; }
    const oldMode = plotMode(plot);
    if (oldMode === 'auto') { notify('自動地塊不能轉換為手動地塊或草地。'); return; }
    const crop = plot.crop === null ? null : crops[plot.crop] || crops[0];
    const mature = Boolean(crop && growthElapsed(plot) >= crop.growTime);
    if (oldMode === 'manual' && crop && !mature) {
      notify('植物成熟後才能將手動地塊切換成草地。');
      return;
    }
    const newMode = oldMode === 'manual' ? 'grass' : 'manual';
    const changedPlot = { ...plot, manual: newMode !== 'auto', grassOnly: newMode === 'grass' };
    const changedPlots = game.plots.map((item, plotIndex) => plotIndex === index ? changedPlot : item);
    const deployedDocks = game.drones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition);
    if (!validStacking(changedPlots, deployedDocks)) {
      notify('上方有平台或其他地塊時，下層地塊必須維持草地性質。');
      renderFarmDialog(); return;
    }
    game.plots = changedPlots;
    if (newMode !== 'auto') {
      for (let queueIndex = jobQueue.length - 1; queueIndex >= 0; queueIndex -= 1) {
        const job = jobQueue[queueIndex];
        if (job.kind !== 'expand' && job.index === index) jobQueue.splice(queueIndex, 1);
      }
    }
    renderJobQueue();
    save(); render();
    if (dialog.open) renderFarmDialog();
    if (newMode === 'auto' && game.autoMode) planAutomaticJobs();
    const modeLabel = { auto: '自動農地', manual: '手動農地', grass: '草地地塊' }[newMode];
    notify(`地塊性質已切換為${modeLabel}。`);
  }
  function attachPlotModeSwitch(index) {
    dialogContent.querySelector('[data-plot-mode-switch]')?.addEventListener('click', () => setPlotMode(index));
  }
  function hasDroneJobs() { return Boolean(activeJobs.size || jobQueue.length); }
  function pendingExpansionJobs() {
    return [...activeJobs.values(), ...jobQueue].filter((job) => job.kind === 'expand' && job.position);
  }
  function planAutomaticJobs() {
    if (!game.autoMode) return;
    game.plots.forEach((plot, index) => {
      if (isDroneExcluded(plot) || plot.crop === null || hasPendingJob('harvest', index)) return;
      const crop = crops[plot.crop] || crops[0];
      if (growthElapsed(plot) >= crop.growTime) enqueueJob({ kind: 'harvest', index, automatic: true });
    });
    game.plots.forEach((plot, index) => {
      if (isDroneExcluded(plot) || window.skyEnvironment.getState(game).isRaining || plot.crop === null || plot.watered || hasPendingJob('water', index) || hasPendingJob('harvest', index)) return;
      const crop = crops[plot.crop] || crops[0];
      if (growthElapsed(plot) < crop.growTime) enqueueJob({ kind: 'water', index, automatic: true });
    });
    const reserved = () => [...activeJobs.values(), ...jobQueue].reduce((sum, job) => sum + (job?.kind === 'plant' ? (crops[job.cropIndex]?.seedCost || 0) : 0), 0);
    const eligibleCrops = crops.map((crop, cropIndex) => ({ crop, cropIndex }))
      .filter(({ cropIndex }) => game.autoCropSelection.includes(cropIndex))
      .filter(({ crop }) => crop.seedCost <= game.coins - reserved());
    game.plots.forEach((plot, index) => {
      if (isDroneExcluded(plot) || plot.crop !== null || hasPendingJob('plant', index)) return;
      const available = game.coins - reserved();
      const affordable = eligibleCrops.filter(({ crop }) => crop.seedCost <= available);
      const choice = affordable[Math.floor(Math.random() * affordable.length)];
      if (choice) enqueueJob({ kind: 'plant', index, cropIndex: choice.cropIndex, automatic: true });
    });
  }
  function completeJob(job) {
    if (job.kind === 'plant') {
      const plot = game.plots[job.index], crop = crops[job.cropIndex];
      const variant = job.variantId ? game.flowerVariants.find((item) => item.id === job.variantId) : null;
      if (!plot || isDroneExcluded(plot) || plot.crop !== null || !crop || game.coins < crop.seedCost) return notify('播種任務條件已改變，已略過。');
      if (job.variantId && (!variant || variant.cropIndex !== job.cropIndex)) return notify('花色變種資料已改變，播種任務已略過。');
      game.coins -= crop.seedCost; plot.crop = job.cropIndex; plot.variantId = variant?.id || null; plot.variantName = variant?.name || null; plot.variantColor = variant?.color || null; plot.plantedAt = Date.now(); plot.plantHeight = 0.9 + Math.random() * 0.2; plot.watered = false; plot.waterSource = null; plot.growthBonusMs = 0; save(); render(); if (!job.automatic) notify(`種下了${variant ? `${crop.name}・${variant.name}` : crop.name}，期待它長大吧！`); return;
    }
    if (job.kind === 'harvest') {
      const plot = game.plots[job.index]; if (!plot || isDroneExcluded(plot) || plot.crop === null) return notify('收成任務條件已改變，已略過。');
      const crop = getPlantedCrop(plot); if (growthElapsed(plot) < crop.growTime) return notify('作物尚未成熟，收成任務已略過。');
      const reward = getHarvestReward(crop); game.coins += reward; plot.crop = null; plot.variantId = null; plot.variantName = null; plot.variantColor = null; plot.plantedAt = null; plot.plantHeight = null; plot.watered = false; plot.waterSource = null; plot.growthBonusMs = 0; delete plot.waterStartedAt; delete plot.waterUntil; save(); render();
      if (job.automatic) {
        planAutomaticJobs();
        const replantIndex = jobQueue.findIndex((queued) => queued.kind === 'plant' && queued.index === job.index);
        if (replantIndex > 0) {
          const [replant] = jobQueue.splice(replantIndex, 1);
          jobQueue.unshift(replant);
          renderJobQueue();
        }
      }
      else notify(`收成了${crop.name}！獲得 ${reward} 金幣 ✨`);
      return;
    }
    if (job.kind === 'water') {
      const plot = game.plots[job.index];
      if (window.skyEnvironment.getState(game).isRaining) return;
      if (!plot || isDroneExcluded(plot) || plot.crop === null || plot.watered || growthElapsed(plot) >= (crops[plot.crop] || crops[0]).growTime) return;
      plot.watered = true; plot.waterSource = 'drone'; plot.waterWetnessStart = 1; plot.waterStartedAt = Date.now(); plot.waterUntil = plot.waterStartedAt + WATER_DURATION; save(); render(); if (!job.automatic) notify('澆水完成！這株花接下來 30 秒會以 1.2 倍速度生長。'); return;
    }
    const expansionCost = getLandCost();
    if (game.coins < expansionCost) return notify('擴建任務執行時金幣不足，已略過。');
    const position = job.position || (() => {
      const candidate = getNextPlotPosition(game.plots, game.drones.map((drone) => drone.dockPosition));
      return candidate ? { x: candidate[0], z: candidate[1] } : null;
    })();
    if (!position || game.plots.some((plot) => plot.x === position.x && plot.z === position.z)
      || game.drones.some((drone) => dockOverlapsPlot(drone.dockPosition, position))) {
      return notify('擴建位置已被占用，請移動坪台或農地後再試。');
    }
    const { x, z } = position;
    game.coins -= expansionCost; game.plots.push({ crop: null, plantedAt: null, manual: false, grassOnly: false, x, z, y: 0 }); save(); render(); notify('新島開墾完成！這片天空也是你的了 ☁️');
  }
  function processJobQueue() {
    updateBatteries();
    cancelMatureWaterJobs();
    for (let index = jobQueue.length - 1; index >= 0; index -= 1) {
      const job = jobQueue[index];
      if (job.kind !== 'expand' && isDroneExcluded(game.plots[job.index])) jobQueue.splice(index, 1);
    }
    const world = window.skyWorld;
    if (!world || !jobQueue.length) { renderJobQueue(); return; }
    const startIndex = nextDroneIndex;
    const candidateOrder = game.drones.map((drone, index) => ({ drone, index, rotation: (index - startIndex + game.drones.length) % game.drones.length }))
      .filter(({ drone, index }) => drone.deployed !== false && !activeJobs.has(index))
      .sort((a, b) => {
        const priority = (candidate) => candidate.drone.battery === 100 ? 0 : returningDrones.has(candidate.index) ? 1 : 2;
        const priorityDifference = priority(a) - priority(b);
        if (priorityDifference !== 0) return priorityDifference;
        if (priority(a) === 2 && a.drone.battery !== b.drone.battery) return b.drone.battery - a.drone.battery;
        return a.rotation - b.rotation;
      });
    for (const { index: droneIndex, drone } of candidateOrder) {
      if (!jobQueue.length) break;
      
      if (game.drones[droneIndex]?.deployed === false || activeJobs.has(droneIndex)) continue;
      const isEligibleJob = (job) => {
        if (game.drones[droneIndex].battery < estimateJobBattery(job, droneIndex)) return false;
        if ([...activeJobs.values()].some((active) => active.kind === 'expand')) return false;
        if (job.kind === 'expand' && activeJobs.size) return false;
        if (job.kind !== 'expand' && [...activeJobs.values()].some((active) => active.kind !== 'expand' && active.index === job.index)) return false;
        return true;
      };
      const previousPlotIndex = lastCompletedPlotByDrone.get(droneIndex);
      let queueIndex = previousPlotIndex === undefined ? -1 : jobQueue.findIndex((job) => job.kind !== 'expand' && job.index === previousPlotIndex && isEligibleJob(job));
      if (queueIndex < 0) queueIndex = jobQueue.findIndex(isEligibleJob);
      if (queueIndex < 0) continue;
      const [job] = jobQueue.splice(queueIndex, 1);
      returningDrones.delete(droneIndex);
      updateBatteries();
      activeJobs.set(droneIndex, job);
      const onWaterWorkStart = () => {
        const workingPlot = game.plots[job.index];
        if (job.kind !== 'water' || !workingPlot) return;
        workingPlot.waterVisualStartedAt = Date.now();
        updateHud();
      };
      nextDroneIndex = (droneIndex + 1) % game.drones.length;
      let finished = false;
      const commit = () => {
        if (job.committed || job.cancelled) return;
        job.committed = true;
        completeJob(job);
      };
      const finish = () => {
        if (finished || activeJobs.get(droneIndex) !== job) return;
        finished = true;
        const workingPlot = job.kind === 'water' ? game.plots[job.index] : null;
        if (workingPlot) delete workingPlot.waterVisualStartedAt;
        commit();
        updateBatteries();
        activeJobs.delete(droneIndex);
        if (job.kind !== 'expand') lastCompletedPlotByDrone.set(droneIndex, job.index);
        else lastCompletedPlotByDrone.delete(droneIndex);
        renderJobQueue();
        processJobQueue();
      };
      const shouldReturn = () => {
        returningDrones.add(droneIndex);
        return true;
      };
      const onReturnComplete = () => returningDrones.delete(droneIndex);
      if (job.kind === 'water') {
        const plot = game.plots[job.index];
        if (!plot || plot.crop === null || plot.watered || growthElapsed(plot) >= (crops[plot.crop] || crops[0]).growTime) {
          activeJobs.delete(droneIndex);
          continue;
        }
      }
      let started;
      if (job.kind === 'plant') started = world.animatePlant?.(job.index, commit, finish, shouldReturn, droneIndex, onReturnComplete);
      else if (job.kind === 'harvest') started = world.animateHarvest?.(job.index, commit, finish, shouldReturn, droneIndex, onReturnComplete);
      else if (job.kind === 'water') started = world.animateWater?.(job.index, commit, finish, shouldReturn, droneIndex, onReturnComplete, onWaterWorkStart);
      else started = world.animateExpansion?.(job.position, commit, finish, shouldReturn, droneIndex, onReturnComplete);
      if (started === undefined || started === false) finish();
    }
    renderJobQueue();
  }
  function enqueueJob(job) {
    job.id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    jobQueue.push(job); renderJobQueue(); processJobQueue();
  }
  function plant(index, cropIndex, variantId = null) {
    const plot = game.plots[index], crop = crops[cropIndex];
    if (!crop || !plot || plot.crop !== null) return;
    if (plot.grassOnly) return notify('草地地塊無法種植；請先關閉草地設定。');
    if (variantId && !game.flowerVariants.some((variant) => variant.id === variantId && variant.cropIndex === cropIndex)) return;
    if (game.coins < crop.seedCost) return notify(`${crop.name}種子需要 ${crop.seedCost} 枚金幣。`);
    if (plot.manual) {
      const variant = variantId ? game.flowerVariants.find((item) => item.id === variantId) : null;
      game.coins -= crop.seedCost; plot.crop = cropIndex; plot.variantId = variant?.id || null; plot.variantName = variant?.name || null; plot.variantColor = variant?.color || null; plot.plantedAt = Date.now(); plot.plantHeight = 0.9 + Math.random() * 0.2; plot.watered = false; plot.waterSource = null; plot.growthBonusMs = 0; save(); render(); notify(`已手動種下${variant ? `${crop.name}・${variant.name}` : crop.name}。`); return;
    }
    enqueueJob({ kind: 'plant', index, cropIndex, variantId });
  }
  function harvest(index) {
    const plot = game.plots[index]; if (!plot || plot.crop === null) return;
    const crop = crops[plot.crop] || crops[0]; if (growthElapsed(plot) < crop.growTime) return;
    if (isDroneExcluded(plot)) {
      const plantedCrop = getPlantedCrop(plot);
      const reward = getHarvestReward(crop); game.coins += reward; plot.crop = null; plot.variantId = null; plot.variantName = null; plot.variantColor = null; plot.plantedAt = null; plot.plantHeight = null; plot.watered = false; plot.growthBonusMs = 0; delete plot.waterStartedAt; delete plot.waterUntil; save(); render(); notify(`手動收成了${plantedCrop.name}！獲得 ${reward} 金幣 ✨`); return;
    }
    enqueueJob({ kind: 'harvest', index });
  }
  function water(index) {
    const plot = game.plots[index];
    if (window.skyEnvironment.getState(game).isRaining) return;
    if (!plot || plot.crop === null || plot.watered) return;
    const crop = crops[plot.crop] || crops[0];
    if (growthElapsed(plot) >= crop.growTime) return notify('花已成熟，可以直接收成。');
    if (hasPendingJob('water', index)) return;
    if (isDroneExcluded(plot)) { plot.watered = true; plot.waterSource = 'manual'; plot.waterWetnessStart = 1; plot.waterStartedAt = Date.now(); plot.waterUntil = plot.waterStartedAt + WATER_DURATION; save(); render(); notify('手動澆水完成！這株花接下來 30 秒會以 1.2 倍速度生長。'); return; }
    enqueueJob({ kind: 'water', index });
  }
  function deletePlot(index) {
    const plot = game.plots[index];
    if (hasDroneJobs()) return notify('無人機工作佇列未清空，暫時無法刪除地塊。');
    if (!plot || game.plots.length <= 1) return notify('至少要保留一塊空中土地。');
    const remainingPlots = game.plots.filter((_, plotIndex) => plotIndex !== index);
    const plantedCrop = plot.crop === null ? '' : `這塊地上的${getPlantedCrop(plot).name}也會一併移除。`;
    if (!window.confirm(`確定要刪除${getPlotLabel(index)}嗎？${plantedCrop}`)) return;
    game.plots = remainingPlots;
    activePlotIndex = Math.min(index, remainingPlots.length - 1);
    dialog.close();
    save();
    render();
    notify('農地已刪除。');
  }
  function render() {
    settleExpiredWaterBoosts();
    updateHud(); updateAutoModeButton(); updateHudCollapse(); renderDroneFleet(); plotSelector.replaceChildren();
    game.plots.forEach((plot, index) => {
      if (plot.manual === true) return;
      const automaticPlotNumber = game.plots.slice(0, index + 1).filter((item) => item.manual !== true).length;
      const crop = plot.crop === null ? null : getPlantedCrop(plot);
      const elapsed = crop ? growthElapsed(plot) : 0;
      const ready = crop && elapsed >= crop.growTime;
      const progress = crop ? Math.min(100, Math.floor(elapsed / crop.growTime * 100)) : 0;
      const remaining = crop ? Math.max(0, Math.ceil((crop.growTime - elapsed) / 1000)) : 0;
      const button = document.createElement('button');
      const rainWet = crop && window.skyEnvironment.getState(game).isRaining;
      const modeLabel = plotMode(plot) === 'grass' ? '草地' : plotMode(plot) === 'manual' ? '手動農地' : '自動農地';
      const state = `${modeLabel}，${!crop ? '空地' : `${crop.name}${rainWet ? '，陰雨濕潤' : ''}${ready ? '已成熟，可收成' : `生長中，${remaining} 秒後成熟，進度 ${progress}%`}`}`;
      button.className = 'world-plot-button';
      button.type = 'button';
      button.dataset.plotButton = index;
      button.setAttribute('aria-label', `${getPlotLabel(index)}，${state}。開啟操作`);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = `<span class="world-plot-number">${String(automaticPlotNumber).padStart(2, '0')}</span><span class="world-plot-icon" aria-hidden="true">${crop ? ready ? flowerIconMarkup(crop, 'flower-pixel-icon plot-pixel-icon') : crop.seedIcon : '＋'}</span><span class="world-plot-state">${plotMode(plot) === 'grass' ? '草地' : plotMode(plot) === 'manual' ? '手動' : !crop ? '空地' : rainWet ? '雨中濕潤' : ready ? '可收成' : `${remaining}s`}</span>${crop ? `<span class="world-plot-progress" aria-hidden="true"><span style="width:${progress}%"></span></span>` : ''}`;
      button.addEventListener('click', () => openPlotDialog(index));
      plotSelector.append(button);
    });
    if (dockIsSelected) {
      plotSelector.querySelectorAll('[data-plot-button]').forEach((button) => {
        button.classList.remove('is-selected');
        button.setAttribute('aria-pressed', 'false');
      });
    } else {
      selectPlot(Math.min(activePlotIndex, game.plots.length - 1));
    }
    if (dialogContext?.type === 'plot' && game.plots[dialogContext.index]?.crop !== null) renderFarmDialog();
  }
  function buyManualLand() {
    const cost = getLandCost();
    if (game.coins < cost) return notify(`金幣不足，購買下一塊手動地塊需要 ${cost} 枚金幣。`);
    const position = getNextPlotPosition(game.plots, game.drones.map((drone) => drone.dockPosition));
    if (!position) return notify('找不到不與坪台重疊的相鄰位置，請先移動坪台。');
    const [x, z] = position;
    game.coins -= cost;
    game.plots.push({ crop: null, plantedAt: null, manual: true, grassOnly: false, x, z, y: 0 });
    save(); render(); notify(`已購買手動地塊，扣除 ${cost} 金幣。`);
  }
  function buyLand() {
    const cost = getLandCost();
    if (game.coins < cost) return notify(`金幣不足，開墾下一塊地需要 ${cost} 枚金幣。`);
    const position = getNextPlotPosition(game.plots, game.drones.map((drone) => drone.dockPosition));
    if (!position) return notify('找不到不與坪台重疊的相鄰位置，請先移動坪台。');
    enqueueJob({ kind: 'expand', position: { x: position[0], z: position[1] } });
  }
  function buyDrone() {
    if (game.droneCount >= MAX_DRONES) return notify(`最多只能擁有 ${MAX_DRONES} 台無人機。`);
    const cost = getDroneCost();
    if (game.coins < cost) return notify(`購買下一台無人機需要 ${cost} 枚金幣。`);
    game.coins -= cost;
    game.droneCount += 1;
    game.deploymentSequence += 1;
    game.drones.push({ dockPosition: findDroneDock(game.plots, game.drones.map((drone) => drone.dockPosition)), deployed: true, deploymentOrder: game.deploymentSequence, battery: 100, batteryUpdatedAt: Date.now() });
    save();
    render();
    notify('新無人機與專屬停靠坪台已加入花園。');
  }
  document.querySelector('#farm-management-toggle')?.addEventListener('click', () => {
    const panel = document.querySelector('#farm-management-panel');
    if (!panel) return;
    setFarmPanelOpen(panel.hidden !== false);
  });
  document.querySelector('#farm-management-close')?.addEventListener('click', () => {
    const panel = document.querySelector('#farm-management-panel');
    if (panel) panel.hidden = true;
    document.querySelector('#farm-management-toggle')?.setAttribute('aria-expanded', 'false');
  });
  expandButton?.addEventListener('click', () => {
    const expansionPending = [...activeJobs.values()].some((job) => job.kind === 'expand') || jobQueue.some((job) => job.kind === 'expand');
    if (expansionPending) return notify('農地擴建中，請稍後');
    openExpansionDialog();
  });
  manualLandButton?.addEventListener('click', () => { dialogContext = { type: 'manual-expansion' }; dialog.showModal(); renderFarmDialog(); });
  buyDroneButton?.addEventListener('click', buyDrone);
  dronePanelToggle?.addEventListener('click', () => {
    setDronePanelOpen(!droneJobsPanel?.classList.contains('is-open'));
  });
  ['pointerdown', 'click', 'keydown', 'input', 'change', 'focusin'].forEach((eventName) => {
    droneJobsPanel?.addEventListener(eventName, refreshDronePanelTimeout);
  });
  hudToggle?.addEventListener('click', () => { game.hudCollapsed = !game.hudCollapsed; save(); updateHudCollapse(); });
  powerSaveToggle?.addEventListener('click', () => {
    const enabled = powerSaveToggle.getAttribute('aria-pressed') !== 'true';
    powerSaveToggle.setAttribute('aria-pressed', String(enabled));
    powerSaveToggle.textContent = `省電模式：${enabled ? '開' : '關'}`;
    window.skyWorld?.setPowerSaveMode?.(enabled);
    document.querySelector('.world-frame')?.classList.toggle('is-power-save', enabled);
    notify(enabled ? '省電模式已開啟：清空場景畫布並暫停 GPU 繪圖，遊戲邏輯持續運作。' : '省電模式已關閉：恢復場景繪圖。');
  });
  gardenAvatar?.addEventListener('click', () => { if (avatarDialog && !avatarDialog.open) avatarDialog.showModal(); });
  avatarDialog?.querySelector('[data-close-avatar-dialog]')?.addEventListener('click', () => avatarDialog.close());
  avatarDialog?.addEventListener('click', (event) => { if (event.target === avatarDialog) avatarDialog.close(); });
  avatarModeSelect?.addEventListener('change', () => {
    game.avatarMode = avatarModeSelect.value === 'manual' ? 'manual' : 'auto';
    renderAvatarFlowerOptions();
    save();
    updateAvatarDisplay();
    notify(game.avatarMode === 'manual' ? '已切換為自訂花卉頭像。' : '已切換為自動頭像，會依種植數量最多的花更新。');
  });
  avatarFlowerOptions?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-avatar-crop]');
    if (!button || button.disabled) return;
    const cropIndex = Number(button.dataset.avatarCrop);
    if (!Number.isInteger(cropIndex) || cropIndex < 0 || cropIndex >= crops.length) return;
    game.avatarCrop = cropIndex;
    game.avatarMode = 'manual';
    avatarModeSelect.value = 'manual';
    renderAvatarFlowerOptions();
    save();
    updateAvatarDisplay();
  });
  document.querySelectorAll('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => {
    const selected = button.dataset.settingsTab;
    document.querySelectorAll('[data-settings-tab]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== selected; });
  }));
  settingsToggle?.addEventListener('click', () => {
    const open = settingsPanel?.hidden !== false;
    if (open) {
      ensureHudExpanded();
      setDronePanelOpen(false);
      setFarmPanelOpen(false);
    }
    if (settingsPanel) settingsPanel.hidden = !open;
    settingsToggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', (event) => {
    if (settingsPanel?.hidden === false && !settingsPanel.contains(event.target) && !settingsToggle?.contains(event.target)) {
      settingsPanel.hidden = true;
      settingsToggle?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (droneJobsPanel?.classList.contains('is-open') && !droneJobsPanel.contains(target) && !dronePanelToggle?.contains(target)) {
      setDronePanelOpen(false);
    }
    const farmPanel = document.querySelector('#farm-management-panel');
    const farmToggle = document.querySelector('#farm-management-toggle');
    if (farmPanel?.hidden === false && !farmPanel.contains(target) && !farmToggle?.contains(target)) {
      setFarmPanelOpen(false);
    }
  });
  gardenNameDisplay?.addEventListener('click', () => { gardenNameInput.value = game.gardenName; gardenNameDisplay.hidden = true; gardenNameEditor.hidden = false; gardenNameInput.focus(); gardenNameInput.select(); });
  gardenNameInput?.addEventListener('input', () => {
    const name = gardenNameInput.value.trim();
    if (!name || name.length > 24 || name === game.gardenName) return;
    game.gardenName = name;
    save();
    updateGardenName();
  });
  gardenNameInput?.addEventListener('blur', () => {
    gardenNameInput.value = game.gardenName;
    gardenNameEditor.hidden = true;
    gardenNameDisplay.hidden = false;
  });
  gardenNameEditor?.addEventListener('submit', (event) => {
    event.preventDefault();
    gardenNameInput.blur();
  });
  resetProgressButton?.addEventListener('click', () => resetDialog?.showModal());
  resetDialog?.querySelectorAll('[data-cancel-reset]').forEach((button) => button.addEventListener('click', () => resetDialog.close()));
  confirmResetButton?.addEventListener('click', () => {
    try {
      isResetting = true;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(AUTO_CROP_KEY);
      localStorage.removeItem(FLOWER_VARIANTS_KEY);
      window.location.reload();
    } catch (_) {
      isResetting = false;
      notify('無法清除瀏覽器存檔，進度尚未重置。請檢查瀏覽器儲存權限。');
    }
  });
  autoModeButton?.addEventListener('click', () => {
    game.autoMode = !game.autoMode;
    if (!game.autoMode) {
      const cancelledCount = jobQueue.length;
      jobQueue.length = 0;
      save();
      updateAutoModeButton();
      renderJobQueue();
      notify(cancelledCount ? `自動模式已關閉，已取消佇列中的 ${cancelledCount} 項工作。` : '自動模式已關閉。');
      return;
    }
    save();
    updateAutoModeButton();
    notify('自動模式已開啟，無人機會自行播種、澆水及收成。');
    planAutomaticJobs();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== AUTO_CROP_KEY || event.newValue === null) return;
    try {
      const selection = JSON.parse(event.newValue);
      if (!Array.isArray(selection) || selection.some((index) => !Number.isInteger(index) || index < 0 || index >= crops.length)
        || new Set(selection).size !== selection.length) return;
      game.autoCropSelection = selection;
      if (game.autoMode) planAutomaticJobs();
      render();
    } catch (_) { /* Ignore malformed cross-tab preference updates. */ }
  });
  document.querySelector('[data-close-farm-dialog]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialogContext = null; });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  window.onSkyPlotSelect = selectPlot;
  window.onSkyPlotActivate = openPlotDialog;
  window.onSkyEmptySelect = () => {
    dockIsSelected = false;
    activePlotIndex = -1;
    plotSelector.querySelectorAll('[data-plot-button]').forEach((button) => {
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
    });
  };
  window.onSkyDockSelect = () => {
    dockIsSelected = true;
    plotSelector.querySelectorAll('[data-plot-button]').forEach((button) => {
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
    });
  };
  window.onSkyLandMove = (index, x, z) => {
    if (!Number.isInteger(index) || !Number.isInteger(x) || !Number.isInteger(z) || !game.plots[index]) return false;
    const movedPlots = game.plots.map((plot, plotIndex) => plotIndex === index ? { ...plot, x, z } : plot);
    if (pendingExpansionJobs().some((job) => job.position.x === x && job.position.z === z)) {
      notify('此位置已保留給擴建中的農地。');
      return false;
    }
    if (new Set(movedPlots.map((plot) => `${plot.x},${plot.z},${plot.y || 0}`)).size !== movedPlots.length) {
      notify('這個位置已經有土地，請選擇空格。');
      return false;
    }
    const deployedDocks = game.drones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition);
    if (!validStacking(movedPlots, deployedDocks)) {
      notify('堆疊位置有碰撞，或下層地塊不是草地；請調整地塊類型或高度。');
      return false;
    }
    game.plots = movedPlots;
    save();
    render();
    notify('土地位置已更新並儲存。');
    return true;
  };
  window.onSkyLandHeightChange = (index, y) => {
    if (!Number.isInteger(index) || !isHalfUnitHeight(y) || y < -8 || y > 8 || !game.plots[index]) { render(); return false; }
    const movedPlots = game.plots.map((plot, plotIndex) => plotIndex === index ? { ...plot, y } : plot);
    const deployedDocks = game.drones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition);
    if (!validStacking(movedPlots, deployedDocks)) { notify('這個高度會與其他物件碰撞，或讓非草地地塊位於堆疊下方。'); render(); return false; }
    game.plots = movedPlots; save(); render(); notify(`地塊高度已調整：${y} 個土地單位。`); return true;
  };
  window.onSkyDockMove = (x, z, droneIndex = 0) => {
    if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(droneIndex) || !game.drones[droneIndex]) return false;
    if (game.drones.some((drone, index) => index !== droneIndex && Math.hypot(drone.dockPosition.x - x, drone.dockPosition.z - z) < 0.85)) {
      notify('停靠坪台不能彼此重疊，請選擇其他空格。');
      return false;
    }
    if (pendingExpansionJobs().some((job) => dockOverlapsPlot({ x, z }, job.position))) {
      notify('此位置已保留給擴建中的農地，請選擇其他空格。');
      return false;
    }
    const movedDrones = game.drones.map((drone, index) => index === droneIndex ? { ...drone, dockPosition: { ...drone.dockPosition, x, z } } : drone);
    if (!validStacking(game.plots, movedDrones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition))) {
      notify('坪台位置會與地塊碰撞，或下層地塊不是草地；請調整高度或地塊類型。'); return false;
    }
    game.drones = movedDrones;
    if (droneIndex === 0) game.dockPosition = { ...game.drones[droneIndex].dockPosition };
    save();
    if (droneIndex === 0) window.skyWorld?.setDockPosition(game.dockPosition);
    else render();
    notify(`無人機 ${droneIndex + 1} 停靠平台位置已更新並儲存。`);
    return true;
  };
  window.onSkyDockHeightChange = (droneIndex, y) => {
    if (!Number.isInteger(droneIndex) || !Number.isInteger(y) || y < -8 || y > 8 || !game.drones[droneIndex]) { render(); return false; }
    const movedDrones = game.drones.map((drone, index) => index === droneIndex ? { ...drone, dockPosition: { ...drone.dockPosition, y } } : drone);
    if (!validStacking(game.plots, movedDrones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition))) { notify('這個高度會與地塊碰撞，或讓非草地地塊位於坪台下方。'); render(); return false; }
    game.drones = movedDrones;
    if (droneIndex === 0) game.dockPosition = { ...game.drones[droneIndex].dockPosition };
    save(); render(); notify(`坪台高度已調整：${y} 個土地單位。`); return true;
  };
  window.onSkyHeightEditMode = (kind, index, mode) => {
    if (kind === 'exit') { notify('已退出高度調整模式。'); return; }
    const objectName = kind === 'plot' ? `地塊 ${index + 1}` : `無人機 ${index + 1} 坪台`;
    const heightStep = kind === 'plot' ? '0.5' : '1';
    notify(mode === 'height' ? `${objectName}高度調整模式：上下拖曳，每格 ${heightStep} 個土地單位。` : `已進入${objectName}移動模式；再次短按可調整高度。`);
  };
  initializeAvatarSettings();
  render();
  updateGardenName();
  if (offlineReport && offlineReport.rawDuration >= 60_000) {
    const minutes = Math.floor(offlineReport.simulatedDuration / 60_000);
    const offlineTime = minutes < 60 ? `${minutes} 分鐘` : `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分鐘`;
    const cappedNote = offlineReport.capped ? `（自動作業上限：${offlineReport.droneCountAtDeparture * 3} 小時）` : '';
    if (offlineReport.automationEnabled) {
      const delta = offlineReport.coinsDelta >= 0 ? `淨增加 ${offlineReport.coinsDelta}` : `淨減少 ${Math.abs(offlineReport.coinsDelta)}`;
      notify(`離線自動模擬 ${offlineTime}${cappedNote}；${delta} 金幣。`);
    } else {
      notify(`離線 ${Math.floor(offlineReport.rawDuration / 60_000)} 分鐘；自動模式關閉，沒有離線自動生產${cappedNote ? '，已超過生產上限' : ''}。`);
    }
  }
  setInterval(() => {
    const now = Date.now();
    updateBatteries(now);
    updateEnvironmentDisplay(window.skyEnvironment.getState(game, now));
    window.skyWorld?.setDroneDocks(game.drones.map((drone) => ({ ...drone.dockPosition, deployed: drone.deployed, deploymentOrder: drone.deploymentOrder, battery: drone.battery })));
    renderDroneFleet();
    if (now - lastBatterySaveAt >= 10_000) { lastBatterySaveAt = now; save(); }
    if (game.plots.some((plot) => plot.crop !== null)) render();
    else renderJobQueue();
    planAutomaticJobs();
    processJobQueue();
  }, 1000);
})();

