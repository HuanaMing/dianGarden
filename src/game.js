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
    return { coins: STARTING_COINS, cropCatalogVersion: CROP_CATALOG_VERSION, gardenName: '花明摸魚花園', avatarMode: 'auto', avatarCrop: 0, hudCollapsed: false, autoMode: false, autoCropSelection: [0], flowerVariants: [], displayFlower: null, worldTimeMs: 60_000, worldTimeAnchor: Date.now(), lastObservedRaining: false, droneCount: 1, deploymentSequence: 1, drones: [{ dockPosition, deployed: true, deploymentOrder: 1, battery: 100, batteryUpdatedAt: Date.now() }], lastOnlineAt: null, lastOfflineReturnAt: null, dockPosition, plots };
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
      && (plot.rotation === undefined || (Number.isFinite(plot.rotation) && plot.rotation >= -Math.PI && plot.rotation <= Math.PI))
      && (plot.variantId === undefined || plot.variantId === null || flowerVariants.some((variant) => variant.id === plot.variantId && variant.cropIndex === plot.crop))
      && (plot.crop !== null || plot.variantId === undefined || plot.variantId === null)
      && ((plot.waterStartedAt === undefined && plot.waterUntil === undefined)
        || (Number.isFinite(plot.waterStartedAt) && Number.isFinite(plot.waterUntil) && plot.waterUntil > plot.waterStartedAt && plot.watered === true))
      && (plot.crop === null
      ? plot.plantedAt === null || plot.plantedAt === undefined
      : Number.isInteger(plot.crop) && plot.crop >= 0 && plot.crop < crops.length && Number.isFinite(plot.plantedAt) && plot.plantedAt >= 0)
      && (plot.capacityLevel === undefined || (Number.isSafeInteger(plot.capacityLevel) && plot.capacityLevel >= 1))
      && (plot.nextPlantPosition === undefined || (Number.isSafeInteger(plot.nextPlantPosition) && plot.nextPlantPosition >= 1))
      && (plot.plants === undefined || (plot.manual === true && Array.isArray(plot.plants) 
        && plot.plants.every((plant) => plant && Number.isInteger(plant.crop) && plant.crop >= 0 && plant.crop < crops.length
          && Number.isFinite(plant.plantedAt) && plant.plantedAt >= 0
          && (plant.positionIndex === undefined || (Number.isSafeInteger(plant.positionIndex) && plant.positionIndex >= 1))
          && (plant.plantHeight === undefined || (Number.isFinite(plant.plantHeight) && plant.plantHeight >= 0.9 && plant.plantHeight <= 1.1))
          && (plant.rotation === undefined || (Number.isFinite(plant.rotation) && plant.rotation >= -Math.PI && plant.rotation <= Math.PI))
          && (plant.watered === undefined || typeof plant.watered === 'boolean')
          && (plant.waterSource === undefined || plant.waterSource === null || ['rain', 'drone', 'manual'].includes(plant.waterSource))
          && (plant.growthBonusMs === undefined || (Number.isFinite(plant.growthBonusMs) && plant.growthBonusMs >= 0))
          && (plant.variantId === undefined || plant.variantId === null || flowerVariants.some((variant) => variant.id === plant.variantId && variant.cropIndex === plant.crop))
          && ((plant.waterStartedAt === undefined && plant.waterUntil === undefined)
            || (Number.isFinite(plant.waterStartedAt) && Number.isFinite(plant.waterUntil) && plant.waterUntil > plant.waterStartedAt && plant.watered === true))))));
  }
  let migratedLegacyManualPlants = false;
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
    const plots = saved.plots.map((plot, index) => {
      const manual = plot.manual === true;
      const legacyPlants = plot.crop === null ? [] : [{
        crop: plot.crop, plantedAt: plot.plantedAt, plantHeight: plot.plantHeight, rotation: plot.rotation,
        variantId: plot.variantId, variantName: plot.variantName, variantColor: plot.variantColor,
        watered: plot.watered, waterSource: plot.waterSource, waterWetnessStart: plot.waterWetnessStart,
        waterStartedAt: plot.waterStartedAt, waterUntil: plot.waterUntil, growthBonusMs: plot.growthBonusMs,
      }];
      if (manual && !Array.isArray(plot.plants) && plot.crop !== null) migratedLegacyManualPlants = true;
      const plants = manual ? (Array.isArray(plot.plants) ? plot.plants : legacyPlants).map((plant, plantIndex) => ({
        ...plant,
        positionIndex: Number.isSafeInteger(plant.positionIndex) && plant.positionIndex >= 1 ? plant.positionIndex : plantIndex + 1,
        plantHeight: Number.isFinite(plant.plantHeight) ? plant.plantHeight : 1,
        rotation: Number.isFinite(plant.rotation) ? plant.rotation : 0,
        watered: plant.watered === true,
        waterSource: plant.waterSource || null,
        growthBonusMs: Number.isFinite(plant.growthBonusMs) ? plant.growthBonusMs : 0,
      })) : undefined;
      const maxPositionIndex = plants?.reduce((max, plant) => Math.max(max, plant.positionIndex), 0) || 0;
      return {
        ...plot,
        manual,
        grassOnly: plot.grassOnly === true,
        x: Number.isInteger(plot.x) ? plot.x : legacyPositions[index].x,
        z: Number.isInteger(plot.z) ? plot.z : legacyPositions[index].z,
        y: isHalfUnitHeight(plot.y) ? plot.y : 0,
        plantedAt: plot.crop === null ? null : plot.plantedAt,
        plantHeight: plot.crop === null ? null : Number.isFinite(plot.plantHeight) ? plot.plantHeight : 1,
        rotation: Number.isFinite(plot.rotation) ? plot.rotation : 0,
        plants,
        capacityLevel: manual && Number.isSafeInteger(plot.capacityLevel) && plot.capacityLevel >= 1 ? plot.capacityLevel : 1,
        nextPlantPosition: manual ? Math.max(maxPositionIndex + 1, Number.isSafeInteger(plot.nextPlantPosition) && plot.nextPlantPosition >= 1 ? plot.nextPlantPosition : 1) : undefined,
      };
    });
    const dockPosition = saved.dockPosition ? { ...saved.dockPosition, y: Number.isInteger(saved.dockPosition.y) ? saved.dockPosition.y : 0 } : { x: 0, z: 1.55, y: 0 };
    const { drones, deploymentSequence } = normalizeDrones(saved, plots, dockPosition);
    // Older saves can contain stacked land or raised docks from before grass support was enforced.
    // Preserve their coordinates and adapt the lower plots to the new surface rule on load.
    const deployedDocks = drones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition);
    plots.forEach((plot) => { if (plotHasSupportAbove(plot, plots, deployedDocks)) plot.grassOnly = true; });
    return { ...saved, displayFlower: saved.displayFlower && Number.isInteger(saved.displayFlower.cropIndex) && saved.displayFlower.cropIndex >= 0 && saved.displayFlower.cropIndex < crops.length ? saved.displayFlower : null, cropCatalogVersion: CROP_CATALOG_VERSION, gardenName: saved.gardenName || '花明摸魚花園', avatarMode: saved.avatarMode === 'manual' ? 'manual' : 'auto', avatarCrop: Number.isInteger(saved.avatarCrop) && saved.avatarCrop >= 0 && saved.avatarCrop < crops.length ? saved.avatarCrop : 0, hudCollapsed: saved.hudCollapsed === true, autoMode: saved.autoMode === true, autoCropSelection: Array.isArray(saved.autoCropSelection) ? saved.autoCropSelection : [0], flowerVariants, worldTimeMs: Number.isFinite(saved.worldTimeMs) ? saved.worldTimeMs : 60_000, worldTimeAnchor: Number.isFinite(saved.worldTimeAnchor) ? saved.worldTimeAnchor : Date.now(), lastObservedRaining: typeof saved.lastObservedRaining === 'boolean' ? saved.lastObservedRaining : window.skyEnvironment.getState(saved).isRaining, droneCount: drones.length, deploymentSequence, drones, dockPosition, plots };
  }
  if (window.diangardenCloudReady) {
    // Startup is explicitly gated by cloud-save.js: only a resolved login flow or guest choice may start the game.
    await window.diangardenCloudReady;
  }
  const game = loadGame();
  window.dianGardenDisplayFlower = game.displayFlower || null;
  if (game.cameraPose && window.dianGardenCamera?.restore) window.dianGardenCamera.restore(game.cameraPose);
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
  const PLANT_STATE_FIELDS = ['crop', 'plantedAt', 'plantHeight', 'rotation', 'variantId', 'variantName', 'variantColor', 'watered', 'waterSource', 'waterWetnessStart', 'waterStartedAt', 'waterUntil', 'growthBonusMs', 'waterVisualStartedAt'];
  function getPlotPlants(plot) {
    if (!plot) return [];
    if (plot.manual === true && Array.isArray(plot.plants)) return plot.plants;
    return plot.crop === null || plot.crop === undefined ? [] : [plot];
  }
  function getPlantState(plot, plantIndex = 0) {
    if (!plot) return null;
    if (plot.manual === true && Array.isArray(plot.plants)) return plot.plants[plantIndex] || null;
    return plantIndex === 0 && plot.crop !== null && plot.crop !== undefined ? plot : null;
  }
  function syncManualPrimary(plot) {
    if (!plot || plot.manual !== true) return;
    const first = Array.isArray(plot.plants) ? plot.plants[0] : null;
    const defaults = { crop: null, plantedAt: null, plantHeight: null, rotation: 0, variantId: null, variantName: null, variantColor: null, watered: false, waterSource: null, waterWetnessStart: null, growthBonusMs: 0, waterVisualStartedAt: null };
    for (const field of PLANT_STATE_FIELDS) {
      if (field === 'waterStartedAt' || field === 'waterUntil') {
        if (Number.isFinite(first?.[field])) plot[field] = first[field];
        else delete plot[field];
      } else plot[field] = first && first[field] !== undefined ? first[field] : defaults[field] ?? null;
    }
  }
  function getPlotCapacity(plot) {
    return plot?.manual === true && Number.isSafeInteger(plot.capacityLevel) && plot.capacityLevel >= 1 ? plot.capacityLevel : 1;
  }
  function getManualPlotUpgradeCost(plot) {
    return Math.round(40 * getPlotCapacity(plot) ** 1.4);
  }
  function manualUpgradePanelMarkup(plot) {
    if (plot?.manual !== true || plot.grassOnly === true) return '';
    const level = getPlotCapacity(plot);
    const nextLevel = level + 1;
    const safeNextLevel = Number.isSafeInteger(nextLevel);
    const cost = getManualPlotUpgradeCost(plot);
    const canAfford = Number.isFinite(cost) && cost >= 0 && game.coins >= cost;
    const detail = safeNextLevel
      ? `升級至 ${nextLevel} 株 · ${cost} 金幣`
      : '容量已超出目前存檔可安全表示的範圍';
    const label = safeNextLevel ? `升級容量 · ${cost} 🪙` : '容量無法再增加';
    return `<section class="manual-upgrade-panel"><div class="manual-upgrade-copy"><strong>目前容量：${level} 株</strong><small>${detail}</small></div><button class="action-button manual-upgrade-button" type="button" data-upgrade-manual-plot ${!safeNextLevel || !canAfford ? 'disabled' : ''}>${label}</button></section>`;
  }
  function upgradeManualPlot(index) {
    const plot = game.plots[index];
    if (!plot || plot.manual !== true || plot.grassOnly === true) return;
    const currentLevel = getPlotCapacity(plot);
    const nextLevel = currentLevel + 1;
    if (!Number.isSafeInteger(nextLevel)) return notify('此容量已超出目前存檔可安全表示的範圍。');
    const cost = getManualPlotUpgradeCost(plot);
    if (!Number.isFinite(cost) || cost < 0) return notify('無法計算這次升級費用。');
    if (game.coins < cost) return notify(`升級需要 ${cost} 枚金幣，你目前有 ${game.coins} 枚。`);
    game.coins -= cost;
    plot.capacityLevel = nextLevel;
    save();
    render();
    if (dialog.open && dialogContext?.type === 'plot' && dialogContext.index === index) renderFarmDialog();
    notify(`手動地塊容量已升級至 ${nextLevel} 株，花費 ${cost} 金幣。`);
  }
  function attachManualPlotUpgrade(index) {
    dialogContent.querySelector('[data-upgrade-manual-plot]')?.addEventListener('click', () => upgradeManualPlot(index));
  }
  function getPlantedCrop(plot, plantIndex = 0) {
    const plant = getPlantState(plot, plantIndex);
    const base = crops[plant?.crop] || crops[0];
    const variant = game.flowerVariants.find((item) => item.id === plant?.variantId);
    const variantName = variant?.name || plant?.variantName;
    const variantColor = variant?.color || plant?.variantColor;
    return variantName && variantColor
      ? { ...base, name: `${base.name}・${variantName}`, customColor: variantColor }
      : base;
  }
  game.plots.forEach(syncManualPrimary);
  function simulateOfflineProgress(state, now = Date.now()) {
    return window.gardenEconomy.simulateOfflineProgress(state, now, crops, window.skyEnvironment);
  }
  const offlineReport = simulateOfflineProgress(game);
  const plotSelector = document.querySelector('#plot-selector');
  const farmTabManual = document.querySelector('#farm-tab-manual');
  const farmTabAuto = document.querySelector('#farm-tab-auto');
  let activeFarmTab = 'auto';
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
  let continuousPlotModeActive = false;
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
  let selectedManualPlotIndex = null;
  const selectedManualPlantPositions = new Set();
  dialog.addEventListener('close', () => {
    selectedManualPlotIndex = null;
    selectedManualPlantPositions.clear();
  });
  let activePlotIndex = -1;
  let dockIsSelected = false;
  let isResetting = false;
  const activeJobs = new Map();
  const returningDrones = new Set();
  const harvestReturnRequired = new Set();
  const lastCompletedPlotByDrone = new Map();
  let nextDroneIndex = 0;
  const jobQueue = [];
  function collectPendingExpansionJobs() {
    const seen = new Set();
    return [...activeJobs.values(), ...jobQueue]
      .filter((job) => job.kind === 'expand' && job.position && job.resultCommitted !== true)
      .filter((job) => {
        const position = job.position;
        const y = isHalfUnitHeight(position.y) ? position.y : 0;
        if (game.plots.some((plot) => plot.x === position.x && plot.z === position.z && plotY(plot) === y)) return false;
        const key = `${position.x},${position.z},${y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((job) => ({
        id: String(job.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        position: { x: job.position.x, z: job.position.z, y: isHalfUnitHeight(job.position.y) ? job.position.y : 0 },
        manual: job.manual === true,
        batchId: typeof job.batchId === 'string' ? job.batchId : null,
        createdAt: Number.isFinite(job.createdAt) ? job.createdAt : Date.now(),
      }));
  }
  if (Array.isArray(game.pendingPlotExpansions)) {
    const restored = game.pendingPlotExpansions.slice(0, 200).filter((entry) =>
      entry && entry.position && Number.isInteger(entry.position.x) && Number.isInteger(entry.position.z)
      && (!('y' in entry.position) || (isHalfUnitHeight(entry.position.y) && entry.position.y >= -8 && entry.position.y <= 8))
      && (entry.manual === undefined || typeof entry.manual === 'boolean')
      && (entry.batchId === undefined || entry.batchId === null || (typeof entry.batchId === 'string' && entry.batchId.length <= 100)));
    restored.forEach((entry) => {
      const position = { x: entry.position.x, z: entry.position.z, y: isHalfUnitHeight(entry.position.y) ? entry.position.y : 0 };
      if (game.plots.some((plot) => plot.x === position.x && plot.z === position.z && plotY(plot) === position.y)) return;
      jobQueue.push({
        kind: 'expand', id: typeof entry.id === 'string' && entry.id.length <= 120 ? entry.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        position, manual: entry.manual === true, batchId: typeof entry.batchId === 'string' ? entry.batchId : null,
        status: 'queued', createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
      });
    });
  }
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
      const cameraPose = window.dianGardenCamera?.getState?.();
      if (cameraPose) game.cameraPose = cameraPose;
      game.pendingPlotExpansions = collectPendingExpansionJobs();
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
  let lastCameraPoseSnapshot = JSON.stringify(game.cameraPose || null);
  window.setInterval(() => {
    if (skipSaveOnExit || isResetting || !persistenceAvailable) return;
    const currentPose = window.dianGardenCamera?.getState?.();
    if (!currentPose) return;
    const snapshot = JSON.stringify(currentPose);
    if (snapshot !== lastCameraPoseSnapshot && save()) lastCameraPoseSnapshot = JSON.stringify(game.cameraPose || currentPose);
  }, 1200);
  if (migratedLegacyManualPlants) save();
  if (offlineReport) save();
  window.addEventListener('pagehide', () => { if (!isResetting && !skipSaveOnExit) save(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !isResetting && !skipSaveOnExit) save(); });
  function growthElapsed(plot, now = Date.now(), plantIndex = 0) {
    const plant = getPlantState(plot, plantIndex);
    if (!plant || plant.crop === null || !Number.isFinite(plant.plantedAt)) return 0;
    let elapsed = Math.max(0, now - plant.plantedAt) + (plant.growthBonusMs || 0);
    if (Number.isFinite(plant.waterStartedAt) && Number.isFinite(plant.waterUntil)) {
      const boostedDuration = Math.max(0, Math.min(now, plant.waterUntil) - plant.waterStartedAt);
      elapsed += boostedDuration * (WATER_GROWTH_RATE - 1);
    }
    return elapsed;
  }
  function settleExpiredWaterBoosts(now = Date.now()) {
    let changed = false;
    game.plots.forEach((plot) => {
      const plants = getPlotPlants(plot);
      plants.forEach((plant) => {
        if (!Number.isFinite(plant.waterStartedAt) || !Number.isFinite(plant.waterUntil) || now < plant.waterUntil) return;
        plant.growthBonusMs = (plant.growthBonusMs || 0) + (plant.waterUntil - plant.waterStartedAt) * (WATER_GROWTH_RATE - 1);
        delete plant.waterStartedAt; delete plant.waterUntil; changed = true;
      });
      if (plot.manual === true) syncManualPrimary(plot);
    });
    if (changed) save();
  }
  function applyRainMoisture(now = Date.now(), wetnessStart = 1) {
    game.plots.forEach((plot) => {
      const plants = getPlotPlants(plot);
      plants.forEach((plant) => {
        if (Number.isFinite(plant.waterStartedAt) && Number.isFinite(plant.waterUntil)) {
          const boostedDuration = Math.max(0, Math.min(now, plant.waterUntil) - plant.waterStartedAt);
          plant.growthBonusMs = (plant.growthBonusMs || 0) + boostedDuration * (WATER_GROWTH_RATE - 1);
        }
        plant.watered = true;
        plant.waterSource = 'rain';
        plant.waterWetnessStart = Math.max(0, Math.min(1, wetnessStart));
        plant.waterStartedAt = now;
        plant.waterUntil = now + WATER_DURATION;
      });
      if (plot.manual === true) syncManualPrimary(plot);
    });
    cancelRainWaterJobs();
  }
  function updateHud() {
    coinsDisplay.textContent = game.coins; updateSaveStatus(); updateAvatarDisplay();
    if (manualLandButton) { manualLandButton.textContent = `手動地塊 · ${getLandCost()} 🪙`; manualLandButton.setAttribute('aria-label', `購買手動地塊，花費 ${getLandCost()} 金幣`); }
    const environment = window.skyEnvironment.getState(game);
    updateEnvironmentDisplay(environment);
    window.skyWorld?.setPlotPositions(game.plots.map(({ x, z, y }) => ({ x, z, y })));
    window.skyWorld?.setLandCount(game.plots.length);
    window.skyWorld?.setPendingPlotPreviews(jobQueue
      .filter((job) => job.kind === 'expand' && job.position)
      .map((job) => ({ ...job.position, manual: job.manual === true })));
    window.skyWorld?.setDockPosition(game.dockPosition);
    window.skyWorld?.setDroneCount(game.droneCount);
    window.skyWorld?.setDroneDocks(game.drones.map((drone) => ({ ...drone.dockPosition, deployed: drone.deployed, deploymentOrder: drone.deploymentOrder, battery: drone.battery })));
    updateBuyDroneButton();
    const now = Date.now();
    window.skyWorld?.setPlots(game.plots.map((plot) => ({
      ...plot,
      customColor: plot.crop === null ? null : getPlantedCrop(plot).customColor,
      elapsed: growthElapsed(plot, now),
      growTime: crops[plot.crop]?.growTime ?? crops[0].growTime,
      plants: plot.manual === true ? getPlotPlants(plot).map((plant, plantIndex) => ({
        ...plant,
        elapsed: growthElapsed(plot, now, plantIndex),
        growTime: crops[plant.crop]?.growTime ?? crops[0].growTime,
        customColor: getPlantedCrop(plot, plantIndex).customColor,
      })) : undefined,
    })));
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
    const targetTab = game.plots[index].manual === true ? 'manual' : 'auto';
    if (activeFarmTab !== targetTab) {
      activeFarmTab = targetTab;
      syncFarmManagementTabs();
      render();
      return;
    }
    plotSelector.querySelectorAll('[data-plot-button]').forEach((button) => {
      const selected = Number(button.dataset.plotButton) === index;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    window.skyWorld?.setSelectedPlot(index);
  }
  function renderManualPlotDialog(index, plot) {
    const plants = getPlotPlants(plot);
    const capacity = getPlotCapacity(plot);
    if (selectedManualPlotIndex !== index) {
      selectedManualPlotIndex = index;
      selectedManualPlantPositions.clear();
    }
    const validPositions = new Set(plants.map((plant, plantIndex) => plant.positionIndex || plantIndex + 1));
    for (const position of selectedManualPlantPositions) {
      if (!validPositions.has(position)) selectedManualPlantPositions.delete(position);
    }
    dialogTitle.textContent = getPlotLabel(index);
    dialog.classList.add('has-seed-picker');
    const deleteAction = game.plots.length > 1
      ? `<button class="dialog-delete-plot" type="button" data-delete-plot ${hasDroneJobs() ? 'disabled' : ''}>${hasDroneJobs() ? '無人機工作時無法刪除' : '刪除這塊地'}</button>`
      : '';
    dialogContent.innerHTML = `${plotModeSettingMarkup(plot, index)}${manualUpgradePanelMarkup(plot)}
      <div class="manual-plant-list" role="group" aria-label="選擇要收成的花株" data-manual-plant-list></div>
      <button class="action-button harvest manual-harvest-selected" type="button" data-harvest-selected>收成</button>
      <p class="manual-seed-heading">${plants.length < capacity ? '選擇要再種下的花種' : '目前種植名額已滿'}</p>
      <div class="seed-options" data-manual-seed-options></div>${deleteAction}`;
    const list = dialogContent.querySelector('[data-manual-plant-list]');
    if (plants.length === 0) list.textContent = '尚未種植花株。';
    plants.forEach((plant, plantIndex) => {
      const crop = getPlantedCrop(plot, plantIndex);
      const ready = growthElapsed(plot, Date.now(), plantIndex) >= crop.growTime;
      const positionIndex = plant.positionIndex || plantIndex + 1;
      const selected = selectedManualPlantPositions.has(positionIndex);
      const choice = document.createElement('button');
      choice.className = `manual-plant-choice${selected ? ' is-selected' : ''}`;
      choice.type = 'button';
      choice.dataset.manualPlantPosition = String(positionIndex);
      choice.setAttribute('aria-pressed', String(selected));
      choice.setAttribute('aria-label', `第 ${positionIndex} 株 ${crop.name}，${ready ? '已成熟' : '尚未成熟'}，${selected ? '已選取' : '未選取'}`);
      choice.title = `第 ${positionIndex} 株 · ${crop.name}${ready ? '（已成熟）' : '（尚未成熟）'}`;
      choice.innerHTML = flowerIconMarkup(crops[plant.crop] || crops[0], 'flower-pixel-icon manual-plant-pixel-icon');
      choice.addEventListener('click', () => {
        if (selectedManualPlantPositions.has(positionIndex)) selectedManualPlantPositions.delete(positionIndex);
        else selectedManualPlantPositions.add(positionIndex);
        renderFarmDialog();
      });
      list.append(choice);
    });
    dialogContent.querySelector('[data-harvest-selected]').addEventListener('click', () => harvestSelectedManualPlants(index));
    const options = dialogContent.querySelector('[data-manual-seed-options]');
    if (plants.length < capacity && !plot.grassOnly) {
      crops.forEach((crop, cropIndex) => {
        const option = document.createElement('button');
        option.className = 'seed-option';
        option.type = 'button';
        option.disabled = game.coins < crop.seedCost;
        option.innerHTML = `<span class="seed-option-icon">${flowerIconMarkup(crop, 'flower-pixel-icon seed-pixel-icon')}</span><span class="seed-option-copy"><strong>${crop.name}</strong><small>種子 ${crop.seedCost} 🪙 · 生長約 ${crop.growTime / 1000} 秒</small></span>`;
        option.addEventListener('click', () => {
          plant(index, cropIndex);
          if (dialog.open) renderFarmDialog();
        });
        options.append(option);
        game.flowerVariants.filter((variant) => variant.cropIndex === cropIndex).forEach((variant) => {
          const variantOption = document.createElement('button');
          variantOption.className = 'variant-seed-option';
          variantOption.type = 'button';
          variantOption.disabled = game.coins < crop.seedCost;
          const swatch = document.createElement('span');
          swatch.className = 'variant-seed-swatch';
          swatch.style.backgroundColor = variant.color;
          const copy = document.createElement('span');
          copy.className = 'variant-seed-copy';
          const name = document.createElement('strong');
          name.textContent = `${crop.name}・${variant.name}`;
          const details = document.createElement('small');
          details.textContent = `種子 ${crop.seedCost} 🪙`;
          copy.append(name, details);
          variantOption.append(swatch, copy);
          variantOption.addEventListener('click', () => {
            plant(index, cropIndex, variant.id);
            if (dialog.open) renderFarmDialog();
          });
          options.append(variantOption);
        });
      });
    } else if (plot.grassOnly) {
      options.textContent = '純草地無法種植。';
    } else {
      options.textContent = '升級這塊手動地塊即可增加種植名額。';
    }
    dialogContent.querySelector('[data-delete-plot]')?.addEventListener('click', () => deletePlot(index));
    attachPlotModeSwitch(index);
    attachManualPlotUpgrade(index);
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
    if (plot.manual === true && getPlotPlants(plot).length > 0) {
      renderManualPlotDialog(index, plot);
      return;
    }
    if (plot.crop === null) {
      dialog.classList.add('has-seed-picker');
      const deleteAction = game.plots.length > 1 ? `<button class="dialog-delete-plot" type="button" data-delete-plot ${hasDroneJobs() ? 'disabled' : ''}>${hasDroneJobs() ? '無人機工作時無法刪除' : '刪除這塊地'}</button>` : '';
      dialogContent.innerHTML = `${plotModeSettingMarkup(plot, index)}${manualUpgradePanelMarkup(plot)}<p class="seed-dialog-description">${plot.grassOnly ? '草地地塊無法種植；切換地塊性質後即可播種。' : `選擇要種下的花種。你目前有 ${game.coins} 枚金幣。`}</p><div class="seed-picker-layout"><div class="seed-picker-main"><div class="seed-options"></div></div><aside class="variant-picker-panel" id="variant-picker-panel" hidden><div class="variant-picker-heading"><h3 id="variant-picker-title">選擇花種變種</h3><button class="variant-picker-close" type="button" aria-label="關閉變種選單">×</button></div><div class="variant-seed-options" id="variant-seed-options"></div></aside></div>${deleteAction}`;
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
      attachManualPlotUpgrade(index);
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
    return job.manual ? '開墾手動地塊' : '擴建空中土地';
  }
  function renderJobQueue() {
    if (!jobStatus || !jobQueueDisplay) return;
    // Keep the translucent world preview synchronized with expansion jobs still waiting in the queue.
    window.skyWorld?.setPendingPlotPreviews(jobQueue
      .filter((job) => job.kind === 'expand' && job.position)
      .map((job) => ({ ...job.position, manual: job.manual === true })));
    // 擴建任務允許排隊；已有擴建任務時，也不能鎖住兩種購買入口。
    // 位置、金額與容量會在派工／連續建置流程中再次驗證。
    expandButton?.setAttribute('aria-disabled', 'false');
    expandButton?.classList.remove('is-blocked');
    if (expandButton) expandButton.disabled = false;
    if (manualLandButton) manualLandButton.disabled = false;
    expandButton.textContent = `自動地塊 · ${getLandCost()} 🪙`;
    expandButton?.setAttribute('aria-label', `購買自動地塊，花費 ${getLandCost()} 枚金幣`);
    expandButton?.setAttribute('title', '購買自動地塊');
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
    const displayEntries = [];
    const batches = new Map();
    jobQueue.forEach((job) => {
      if (job.kind === 'expand' && job.batchId) {
        let entry = batches.get(job.batchId);
        if (!entry) {
          entry = { batchId: job.batchId, jobs: [], firstIndex: displayEntries.length };
          batches.set(job.batchId, entry);
          displayEntries.push(entry);
        }
        entry.jobs.push(job);
      } else displayEntries.push({ job });
    });
    displayEntries.forEach((entry, index) => {
      const item = document.createElement('li');
      if (entry.batchId) {
        const first = entry.jobs[0];
        const typeLabel = first.manual ? '手動地塊' : '自動地塊';
        item.innerHTML = `<span>${index + 1}. 連續開墾 · ${entry.jobs.length} 格（${typeLabel}，高度 ${first.position.y || 0}）</span><button type="button" data-cancel-batch="${entry.batchId}" aria-label="取消這組連續開墾的剩餘 ${entry.jobs.length} 格">取消</button>`;
      } else {
        const job = entry.job;
        item.innerHTML = `<span>${index + 1}. ${jobLabel(job)}</span><button type="button" data-cancel-job="${job.id}" aria-label="取消${jobLabel(job)}">取消</button>`;
      }
      jobQueueDisplay.append(item);
    });
    jobQueueDisplay.querySelectorAll('[data-cancel-job]').forEach((button) => button.addEventListener('click', () => {
      const index = jobQueue.findIndex((job) => job.id === button.dataset.cancelJob);
      if (index >= 0) { const [removed] = jobQueue.splice(index, 1); removed.cancelled = true; removed.status = 'cancelled'; removed.finishedAt = Date.now(); save(); renderJobQueue(); notify(`已取消等待中的${jobLabel(removed)}。`); }
    }));
    jobQueueDisplay.querySelectorAll('[data-cancel-batch]').forEach((button) => button.addEventListener('click', () => {
      const batchId = button.dataset.cancelBatch;
      const removed = jobQueue.filter((job) => job.batchId === batchId);
      for (let index = jobQueue.length - 1; index >= 0; index -= 1) if (jobQueue[index].batchId === batchId) {
        const [job] = jobQueue.splice(index, 1); job.cancelled = true; job.status = 'cancelled'; job.finishedAt = Date.now();
      }
      if (removed.length) { save(); renderJobQueue(); notify(`已取消這組連續開墾剩餘的 ${removed.length} 格。`); }
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
  function syncFarmManagementTabs() {
    const manualSelected = activeFarmTab === 'manual';
    farmTabManual?.setAttribute('aria-selected', String(manualSelected));
    farmTabManual?.setAttribute('tabindex', manualSelected ? '0' : '-1');
    farmTabAuto?.setAttribute('aria-selected', String(!manualSelected));
    farmTabAuto?.setAttribute('tabindex', manualSelected ? '-1' : '0');
    plotSelector?.setAttribute('aria-labelledby', manualSelected ? 'farm-tab-manual' : 'farm-tab-auto');
  }
  function setFarmManagementTab(tab) {
    if (tab !== 'manual' && tab !== 'auto') return;
    activeFarmTab = tab;
    const firstMatchingIndex = game.plots.findIndex(plot => tab === 'manual' ? plot.manual === true : plot.manual !== true);
    if (firstMatchingIndex >= 0) activePlotIndex = firstMatchingIndex;
    syncFarmManagementTabs();
    render();
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
    const hudToggleIcon = hudToggle.querySelector('img');
    if (hudToggleIcon) hudToggleIcon.src = game.hudCollapsed ? 'assets/btn/展開.png' : 'assets/btn/收合.png';
    hudToggle.setAttribute('aria-label', game.hudCollapsed ? '展開介面' : '收合介面');
    hudToggle.setAttribute('title', game.hudCollapsed ? '展開介面' : '收合介面');
    hudToggle.setAttribute('aria-expanded', String(!game.hudCollapsed));
  }
  function getAvatarCropIndex() {
    if (game.avatarMode === 'manual') return Number.isInteger(game.avatarCrop) && game.avatarCrop >= 0 && game.avatarCrop < crops.length ? game.avatarCrop : 0;
    const counts = Array(crops.length).fill(0);
    game.plots.forEach((plot) => getPlotPlants(plot).forEach((plant) => {
      if (Number.isInteger(plant.crop) && plant.crop >= 0 && plant.crop < counts.length) counts[plant.crop] += 1;
    }));
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
  function cancelRainWaterJobs() {
    let changed = false;
    for (let index = jobQueue.length - 1; index >= 0; index -= 1) {
      const job = jobQueue[index];
      if (job.kind !== 'water') continue;
      jobQueue.splice(index, 1);
      job.cancelled = true;
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      job.cancellationReason = 'rain_moisture';
      changed = true;
    }
    for (const job of activeJobs.values()) {
      if (job.kind !== 'water' || job.resultCommitted === true || job.cancelled) continue;
      job.cancelled = true;
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      job.cancellationReason = 'rain_moisture';
      job.cancelAnimation?.();
      changed = true;
    }
    if (changed) renderJobQueue();
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
        job.cancelled = true;
        job.status = 'cancelled';
        job.finishedAt = Date.now();
        changed = true;
      }
    }
    for (const job of activeJobs.values()) {
      if (job.kind === 'water' && !job.committed && !job.cancelled) {
        const plot = game.plots[job.index];
        const crop = plot && plot.crop !== null ? crops[plot.crop] || crops[0] : null;
        if (crop && growthElapsed(plot) >= crop.growTime) {
          job.cancelled = true;
          job.status = 'cancelled';
          job.finishedAt = Date.now();
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
    const plotPlants = getPlotPlants(plot);
    const crop = plot.crop === null ? null : crops[plot.crop] || crops[0];
    const mature = plotPlants.length === 0 || plotPlants.every((plant, plantIndex) => {
      const plantCrop = crops[plant.crop] || crops[0];
      return growthElapsed(plot, Date.now(), plantIndex) >= plantCrop.growTime;
    });
    const canSwitch = plotPlants.length === 0 || mature;
    const next = mode === 'manual' ? '草地' : '手動';
    const modeHelp = plotPlants.length > 0 && !mature
      ? '所有花株成熟前不能轉換地塊性質，以免未成熟花株被保留在草地上。'
      : `${descriptions[mode]} 點擊切換至${next}。`;
    return `<div class="manual-plot-setting plot-mode-setting"><div><strong>地塊性質：${labels[mode]}</strong><small>${modeHelp}</small></div><button class="plot-mode-switch" type="button" data-plot-mode-switch data-mode="${mode}" aria-label="農地 ${index + 1} 地塊性質：${labels[mode]}，點擊切換至${next}" ${active || !canSwitch ? 'disabled' : ''}><span class="${mode === 'manual' ? 'is-current' : ''}">${mode === 'manual' ? '手動' : '草地'}</span><span aria-hidden="true">⇄</span><span class="${mode === 'grass' ? 'is-current' : ''}">${mode === 'grass' ? '草地' : '手動'}</span></button></div>${active ? '<p class="manual-plot-busy">無人機正在此地工作，工作結束後才能切換。</p>' : ''}`;
  }
  function setPlotMode(index) {
    const plot = game.plots[index];
    if (!plot) return;
    if (hasActivePlotJob(index)) { renderFarmDialog(); notify('無人機正在此地工作，工作結束後才能切換農地性質。'); return; }
    const oldMode = plotMode(plot);
    if (oldMode === 'auto') { notify('自動地塊不能轉換為手動地塊或草地。'); return; }
    const plotPlants = getPlotPlants(plot);
    const mature = plotPlants.length === 0 || plotPlants.every((plant, plantIndex) => {
      const crop = crops[plant.crop] || crops[0];
      return growthElapsed(plot, Date.now(), plantIndex) >= crop.growTime;
    });
    if (oldMode === 'manual' && plotPlants.length > 0 && !mature) {
      notify('所有花株成熟後才能將手動地塊切換成草地。');
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
      if (!plot || isDroneExcluded(plot) || plot.crop !== null || !crop || game.coins < crop.seedCost) {
        notify('播種任務條件已改變，已略過。');
        return false;
      }
      if (job.variantId && (!variant || variant.cropIndex !== job.cropIndex)) {
        notify('花色變種資料已改變，播種任務已略過。');
        return false;
      }
      const droneHeading = window.skyWorld?.getDroneHeading?.(job.droneIndex);
      const rotation = Number.isFinite(droneHeading) ? Math.max(-Math.PI, Math.min(Math.PI, droneHeading)) : 0;
      game.coins -= crop.seedCost; plot.crop = job.cropIndex; plot.variantId = variant?.id || null; plot.variantName = variant?.name || null; plot.variantColor = variant?.color || null; plot.plantedAt = Date.now(); plot.plantHeight = 0.9 + Math.random() * 0.2; plot.rotation = rotation; plot.watered = false; plot.waterSource = null; plot.growthBonusMs = 0; save(); render(); if (!job.automatic) notify(`種下了${variant ? `${crop.name}・${variant.name}` : crop.name}，期待它長大吧！`);
      return true;
    }
    if (job.kind === 'harvest') {
      const plot = game.plots[job.index];
      if (!plot || isDroneExcluded(plot) || plot.crop === null) {
        notify('收成任務條件已改變，已略過。');
        return false;
      }
      const crop = getPlantedCrop(plot); if (growthElapsed(plot) < crop.growTime) {
        notify('作物尚未成熟，收成任務已略過。');
        return false;
      }
      const reward = getHarvestReward(crop); game.coins += reward;
      game.displayFlower = { cropIndex: plot.crop, color: plot.variantColor || null };
      window.dianGardenDisplayFlower = game.displayFlower;
      plot.crop = null; plot.variantId = null; plot.variantName = null; plot.variantColor = null; plot.plantedAt = null; plot.plantHeight = null; plot.rotation = 0; plot.watered = false; plot.waterSource = null; plot.growthBonusMs = 0; delete plot.waterStartedAt; delete plot.waterUntil; save(); render();
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
      return true;
    }
    if (job.kind === 'water') {
      const plot = game.plots[job.index];
      if (window.skyEnvironment.getState(game).isRaining) return false;
      if (!plot || isDroneExcluded(plot) || plot.crop === null || plot.watered || growthElapsed(plot) >= (crops[plot.crop] || crops[0]).growTime) return false;
      plot.watered = true; plot.waterSource = 'drone'; plot.waterWetnessStart = 1; plot.waterStartedAt = Date.now(); plot.waterUntil = plot.waterStartedAt + WATER_DURATION; save(); render(); if (!job.automatic) notify('澆水完成！這株花接下來 30 秒會以 1.2 倍速度生長。');
      return true;
    }
    const position = job.position || (() => {
      const candidate = getNextPlotPosition(game.plots, game.drones.map((drone) => drone.dockPosition));
      return candidate ? { x: candidate[0], z: candidate[1], y: 0 } : null;
    })();
    const y = isHalfUnitHeight(position?.y) ? position.y : 0;
    const candidatePlot = position && { crop: null, plantedAt: null, manual: job.manual === true, grassOnly: false, x: position.x, z: position.z, y };
    const deployedDocks = game.drones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition);
    if (!position || !Number.isInteger(position.x) || !Number.isInteger(position.z)
      || game.plots.some((plot) => plot.x === position.x && plot.z === position.z && plotY(plot) === y)
      || !validStacking([...game.plots, candidatePlot], deployedDocks)) {
      notify('擴建位置已被占用或與其他地塊／坪台衝突，這格已略過。');
      return false;
    }
    const expansionCost = getLandCost();
    if (game.coins < expansionCost) {
      notify('擴建任務執行時金幣不足，這格已略過。');
      return false;
    }
    game.coins -= expansionCost;
    game.plots.push(candidatePlot);
    save(); render();
    notify(job.manual ? '手動地塊開墾完成！這片天空也是你的了 ☁️' : '新島開墾完成！這片天空也是你的了 ☁️');
    return true;
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
        // A drone returning from a plot should keep that plot's next queued task,
        // even if another drone happens to have a full battery.
        const priority = (candidate) => returningDrones.has(candidate.index) ? 0 : candidate.drone.battery === 100 ? 1 : 2;
        const priorityDifference = priority(a) - priority(b);
        if (priorityDifference !== 0) return priorityDifference;
        if (priority(a) === 2 && a.drone.battery !== b.drone.battery) return b.drone.battery - a.drone.battery;
        return a.rotation - b.rotation;
      });
    for (const { index: droneIndex, drone } of candidateOrder) {
      if (!jobQueue.length) break;
      
      if (game.drones[droneIndex]?.deployed === false || activeJobs.has(droneIndex)) continue;
      const isEligibleJob = (job) => {
        if (Array.isArray(job.failedDroneIndices) && job.failedDroneIndices.includes(droneIndex)) return false;
        if (Number.isFinite(job.retryAfter) && job.retryAfter > Date.now()) return false;
        // 擴建只在下方的優先選取階段優先；若擴建因無安全路徑／電量不足而無法執行，
        // 不可讓佇列中仍存在的擴建任務永久封鎖其他可執行任務。
        if (job.kind === 'harvest' && harvestReturnRequired.has(droneIndex)) return false;
        if (game.drones[droneIndex].battery < estimateJobBattery(job, droneIndex)) return false;
        if ([...activeJobs.values()].some((active) => active.kind === 'expand')) return false;
        if (job.kind === 'expand' && activeJobs.size) return false;
        if (job.kind !== 'expand' && [...activeJobs.values()].some((active) => active.kind !== 'expand' && active.index === job.index)) return false;
        return true;
      };
      const previousPlotIndex = lastCompletedPlotByDrone.get(droneIndex);
      let queueIndex = jobQueue.findIndex((job) => job.kind === 'expand' && isEligibleJob(job));
      if (queueIndex < 0 && previousPlotIndex !== undefined) queueIndex = jobQueue.findIndex((job) => job.kind !== 'expand' && job.index === previousPlotIndex && isEligibleJob(job));
      if (queueIndex < 0) queueIndex = jobQueue.findIndex(isEligibleJob);
      if (queueIndex < 0) continue;
      const [job] = jobQueue.splice(queueIndex, 1);
      job.status = 'assigned';
      job.assignedAt = Date.now();
      job.droneIndex = droneIndex;
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
        if (job.resultAttempted || job.cancelled || job.status === 'cancelled' || job.status === 'succeeded' || job.status === 'failed') return;
        job.resultAttempted = true;
        job.committed = true;
        job.droneIndex = droneIndex;
        job.resultCommitted = completeJob(job) === true;
        if (job.kind === 'harvest' && job.resultCommitted) harvestReturnRequired.add(droneIndex);
        job.status = job.resultCommitted ? 'result_committed' : 'failed';
        if (!job.resultCommitted) job.failureReason = 'result_validation_failed';
        job.resultCommittedAt = job.resultCommitted ? Date.now() : null;
      };
      const finish = () => {
        if (finished || activeJobs.get(droneIndex) !== job) return;
        finished = true;
        const workingPlot = job.kind === 'water' ? game.plots[job.index] : null;
        if (workingPlot) delete workingPlot.waterVisualStartedAt;
        commit();
        if (job.cancelled || job.status === 'cancelled') job.status = 'cancelled';
        else if (job.resultCommitted) job.status = 'succeeded';
        else job.status = 'failed';
        job.finishedAt = Date.now();
        updateBatteries();
        activeJobs.delete(droneIndex);
        if (job.kind !== 'expand') lastCompletedPlotByDrone.set(droneIndex, job.index);
        else lastCompletedPlotByDrone.delete(droneIndex);
        save();
        renderJobQueue();
        processJobQueue();
      };
      const shouldReturn = () => {
        returningDrones.add(droneIndex);
        return true;
      };
      const onReturnComplete = () => {
        returningDrones.delete(droneIndex);
        harvestReturnRequired.delete(droneIndex);
      };
      job.cancelAnimation = () => {
        const cancelled = world.cancelDroneAnimation?.(droneIndex, () => {
          returningDrones.delete(droneIndex);
          harvestReturnRequired.delete(droneIndex);
          finish();
        }) === true;
        if (cancelled) returningDrones.add(droneIndex);
        else returningDrones.delete(droneIndex);
        return cancelled;
      };
      if (job.kind === 'water') {
        const plot = game.plots[job.index];
        if (!plot || plot.crop === null || plot.watered || growthElapsed(plot) >= (crops[plot.crop] || crops[0]).growTime) {
          job.cancelled = true;
          job.status = 'cancelled';
          job.finishedAt = Date.now();
          activeJobs.delete(droneIndex);
          continue;
        }
      }
      let started;
      if (job.kind === 'plant') started = world.animatePlant?.(job.index, commit, finish, shouldReturn, droneIndex, onReturnComplete);
      else if (job.kind === 'harvest') started = world.animateHarvest?.(job.index, commit, finish, shouldReturn, droneIndex, onReturnComplete);
      else if (job.kind === 'water') started = world.animateWater?.(job.index, commit, finish, shouldReturn, droneIndex, onReturnComplete, onWaterWorkStart);
      else started = world.animateExpansion?.(job.position, commit, finish, shouldReturn, droneIndex, onReturnComplete);
      if (started === 'waiting_path' || started === 'waiting_path_returning') {
        activeJobs.delete(droneIndex);
        job.status = 'queued';
        job.droneIndex = null;
        job.attempts = (job.attempts || 0) + 1;
        job.lastError = 'no_safe_route';
        job.lastAttemptAt = Date.now();
        job.failedDroneIndices = Array.isArray(job.failedDroneIndices) ? job.failedDroneIndices : [];
        if (!job.failedDroneIndices.includes(droneIndex)) job.failedDroneIndices.push(droneIndex);
        const deployedDroneIndices = game.drones.map((candidate, candidateIndex) => candidate.deployed === false ? -1 : candidateIndex).filter((candidateIndex) => candidateIndex >= 0);
        if (deployedDroneIndices.length && deployedDroneIndices.every((candidateIndex) => job.failedDroneIndices.includes(candidateIndex))) {
          job.failedDroneIndices = [];
          job.retryAfter = Date.now() + 5000;
        }
        jobQueue.unshift(job);
        if (started === 'waiting_path_returning') returningDrones.add(droneIndex);
        continue;
      }
      if (started === true && job.status === 'assigned') {
        job.failedDroneIndices = [];
        job.retryAfter = null;
        job.status = 'running';
        job.startedAt = Date.now();
      }
      if (started === undefined || started === false) finish();
    }
    renderJobQueue();
  }
  function enqueueJob(job) {
    job.id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    job.status = 'queued';
    job.createdAt = Date.now();
    if (job.kind === 'expand') {
      const firstNonExpansion = jobQueue.findIndex((queued) => queued.kind !== 'expand');
      if (firstNonExpansion < 0) jobQueue.push(job);
      else jobQueue.splice(firstNonExpansion, 0, job);
    } else jobQueue.push(job);
    const savedImmediately = job.kind === 'expand' ? save() : true;
    renderJobQueue();
    processJobQueue();
    return savedImmediately;
  }
  function plant(index, cropIndex, variantId = null) {
    const plot = game.plots[index], crop = crops[cropIndex];
    if (!crop || !plot) return;
    if (plot.grassOnly) return notify('草地地塊無法種植；請先關閉草地設定。');
    if (variantId && !game.flowerVariants.some((variant) => variant.id === variantId && variant.cropIndex === cropIndex)) return;
    if (game.coins < crop.seedCost) return notify(`${crop.name}種子需要 ${crop.seedCost} 枚金幣。`);
    if (plot.manual) {
      const plants = getPlotPlants(plot);
      if (plants.length >= getPlotCapacity(plot)) return notify(`這塊手動地塊已種滿 ${getPlotCapacity(plot)} 株，請先收成或升級容量。`);
      const variant = variantId ? game.flowerVariants.find((item) => item.id === variantId) : null;
      const positionIndex = Number.isSafeInteger(plot.nextPlantPosition) && plot.nextPlantPosition >= 1 ? plot.nextPlantPosition : Math.max(1, ...plants.map((plant) => (plant.positionIndex || 0) + 1));
      const plantState = {
        crop: cropIndex, variantId: variant?.id || null, variantName: variant?.name || null, variantColor: variant?.color || null,
        plantedAt: Date.now(), plantHeight: 0.9 + Math.random() * 0.2, rotation: 0, positionIndex,
        watered: false, waterSource: null, waterWetnessStart: null, growthBonusMs: 0,
      };
      plot.plants = [...plants, plantState];
      plot.nextPlantPosition = positionIndex + 1;
      game.coins -= crop.seedCost;
      syncManualPrimary(plot);
      save(); render();
      if (dialog.open && dialogContext?.type === 'plot' && dialogContext.index === index) renderFarmDialog();
      notify(`已手動種下${variant ? `${crop.name}・${variant.name}` : crop.name}。`);
      return;
    }
    if (plot.crop !== null) return;
    enqueueJob({ kind: 'plant', index, cropIndex, variantId });
  }
  function harvestSelectedManualPlants(index) {
    const plot = game.plots[index];
    if (!plot || plot.manual !== true) return;
    if (selectedManualPlotIndex !== index || selectedManualPlantPositions.size === 0) {
      notify('選取花種以收成');
      return;
    }
    const plants = getPlotPlants(plot);
    const readyPositions = new Set();
    let reward = 0;
    let latestHarvestedPlant = null;
    plants.forEach((plant, plantIndex) => {
      const positionIndex = plant.positionIndex || plantIndex + 1;
      if (!selectedManualPlantPositions.has(positionIndex)) return;
      const crop = crops[plant.crop] || crops[0];
      if (growthElapsed(plot, Date.now(), plantIndex) < crop.growTime) return;
      readyPositions.add(positionIndex);
      latestHarvestedPlant = plant;
      reward += getHarvestReward(getPlantedCrop(plot, plantIndex));
    });
    if (readyPositions.size === 0) {
      notify('選取的花株尚未成熟。');
      return;
    }
    plot.plants = plants.filter((plant, plantIndex) => !readyPositions.has(plant.positionIndex || plantIndex + 1));
    for (const positionIndex of readyPositions) selectedManualPlantPositions.delete(positionIndex);
    game.coins += reward;
    game.displayFlower = {
      cropIndex: latestHarvestedPlant.crop,
      color: latestHarvestedPlant.variantColor || null,
    };
    window.dianGardenDisplayFlower = game.displayFlower;
    syncManualPrimary(plot);
    save();
    render();
    if (dialog.open && dialogContext?.type === 'plot' && dialogContext.index === index) renderFarmDialog();
    notify(`收成了 ${readyPositions.size} 株花，獲得 ${reward} 金幣 ✨`);
  }
  function harvest(index, plantIndex = 0) {
    const plot = game.plots[index];
    const plant = getPlantState(plot, plantIndex);
    if (!plot || !plant) return;
    const crop = crops[plant.crop] || crops[0];
    if (growthElapsed(plot, Date.now(), plantIndex) < crop.growTime) return;
    if (isDroneExcluded(plot)) {
      const plantedCrop = getPlantedCrop(plot, plantIndex);
      const reward = getHarvestReward(crop); game.coins += reward;
      game.displayFlower = { cropIndex: plant.crop, color: plant.variantColor || null };
      window.dianGardenDisplayFlower = game.displayFlower;
      if (plot.manual === true) {
        plot.plants.splice(plantIndex, 1);
        syncManualPrimary(plot);
      } else {
        plot.crop = null; plot.variantId = null; plot.variantName = null; plot.variantColor = null;
        plot.plantedAt = null; plot.plantHeight = null; plot.watered = false; plot.waterSource = null;
        plot.growthBonusMs = 0; delete plot.waterStartedAt; delete plot.waterUntil;
      }
      save(); render();
      if (dialog.open && dialogContext?.type === 'plot' && dialogContext.index === index) renderFarmDialog();
      notify(`手動收成了${plantedCrop.name}！獲得 ${reward} 金幣 ✨`); return;
    }
    enqueueJob({ kind: 'harvest', index });
  }
  function water(index, plantIndex = 0) {
    const plot = game.plots[index];
    const plant = getPlantState(plot, plantIndex);
    if (window.skyEnvironment.getState(game).isRaining) return;
    if (!plot || !plant || plant.watered) return;
    const crop = crops[plant.crop] || crops[0];
    if (growthElapsed(plot, Date.now(), plantIndex) >= crop.growTime) return notify('花已成熟，可以直接收成。');
    if (hasPendingJob('water', index)) return;
    if (isDroneExcluded(plot)) {
      plant.watered = true; plant.waterSource = 'manual'; plant.waterWetnessStart = 1;
      plant.waterStartedAt = Date.now(); plant.waterUntil = plant.waterStartedAt + WATER_DURATION;
      if (plot.manual === true) syncManualPrimary(plot);
      save(); render();
      if (dialog.open && dialogContext?.type === 'plot' && dialogContext.index === index) renderFarmDialog();
      notify('手動澆水完成！這株花接下來 30 秒會以 1.2 倍速度生長。'); return;
    }
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
    updateHud(); updateAutoModeButton(); updateHudCollapse(); renderDroneFleet(); syncFarmManagementTabs(); plotSelector.replaceChildren();
    game.plots.forEach((plot, index) => {
      const isManualPlot = plot.manual === true;
      if ((activeFarmTab === 'manual') !== isManualPlot) return;
      const plotNumber = game.plots.slice(0, index + 1).filter((item) => activeFarmTab === 'manual' ? item.manual === true : item.manual !== true).length;
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
      const plotLabel = activeFarmTab === 'manual' ? `手動地塊 ${plotNumber}` : `自動地塊 ${plotNumber}`;
      button.setAttribute('aria-label', `${plotLabel}，${state}。開啟操作`);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = `<span class="world-plot-number">${String(plotNumber).padStart(2, '0')}</span><span class="world-plot-icon" aria-hidden="true">${crop ? ready ? flowerIconMarkup(crop, 'flower-pixel-icon plot-pixel-icon') : crop.seedIcon : '＋'}</span><span class="world-plot-state">${plotMode(plot) === 'grass' ? '草地' : plotMode(plot) === 'manual' ? '手動' : !crop ? '空地' : rainWet ? '雨中濕潤' : ready ? '可收成' : `${remaining}s`}</span>${crop ? `<span class="world-plot-progress" aria-hidden="true"><span style="width:${progress}%"></span></span>` : ''}`;
      button.addEventListener('click', () => openPlotDialog(index));
      plotSelector.append(button);
    });
    if (!plotSelector.querySelector('[data-plot-button]')) {
      const emptyState = document.createElement('p');
      emptyState.className = 'farm-empty-state';
      emptyState.textContent = activeFarmTab === 'manual' ? '目前沒有手動地塊，可使用下方按鈕購買。' : '目前沒有自動地塊。';
      plotSelector.append(emptyState);
    }
    if (dockIsSelected) {
      plotSelector.querySelectorAll('[data-plot-button]').forEach((button) => {
        button.classList.remove('is-selected');
        button.setAttribute('aria-pressed', 'false');
      });
    } else {
      const activePlot = game.plots[activePlotIndex];
      const activePlotMatchesTab = activePlot && (activeFarmTab === 'manual' ? activePlot.manual === true : activePlot.manual !== true);
      if (activePlotMatchesTab) selectPlot(activePlotIndex);
      else if (activePlotIndex >= 0) {
        const firstVisiblePlotIndex = game.plots.findIndex(plot => activeFarmTab === 'manual' ? plot.manual === true : plot.manual !== true);
        if (firstVisiblePlotIndex >= 0) selectPlot(firstVisiblePlotIndex);
        else window.skyWorld?.setSelectedPlot(null);
      } else {
        window.skyWorld?.setSelectedPlot(null);
      }
    }
    if (dialogContext?.type === 'plot' && game.plots[dialogContext.index]?.crop !== null) renderFarmDialog();
  }
  function buyManualLand() {
    const cost = getLandCost();
    if (game.coins < cost) return notify(`金幣不足，購買下一塊手動地塊需要 ${cost} 枚金幣。`);
    const reservedPlots = [...game.plots, ...pendingExpansionJobs().map((job) => ({ x: job.position.x, z: job.position.z }))];
    const position = getNextPlotPosition(reservedPlots, game.drones.map((drone) => drone.dockPosition));
    if (!position) return notify('找不到不與坪台重疊的相鄰位置，請先移動坪台。');
    const savedImmediately = enqueueJob({ kind: 'expand', manual: true, position: { x: position[0], z: position[1], y: 0 } });
    notify(savedImmediately
      ? '手動地塊已加入無人機最高優先開墾佇列並立即儲存。'
      : '手動地塊已加入開墾佇列，但存檔失敗，重新整理可能會遺失未完成任務。');
  }
  function buyLand() {
    const cost = getLandCost();
    if (game.coins < cost) return notify(`金幣不足，開墾下一塊地需要 ${cost} 枚金幣。`);
    const reservedPlots = [...game.plots, ...pendingExpansionJobs().map((job) => ({ x: job.position.x, z: job.position.z }))];
    const position = getNextPlotPosition(reservedPlots, game.drones.map((drone) => drone.dockPosition));
    if (!position) return notify('找不到不與坪台重疊的相鄰位置，請先移動坪台。');
    const savedImmediately = enqueueJob({ kind: 'expand', manual: false, position: { x: position[0], z: position[1], y: 0 } });
    if (!savedImmediately) notify('自動地塊已加入開墾佇列，但存檔失敗，重新整理可能會遺失未完成任務。');
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
  let continuousPlotPathReady = false;
  let continuousPlotManual = false;
  let continuousPlotHeight = 0;
  function updateContinuousPlotMode(active) {
    continuousPlotModeActive = Boolean(active);
    const farmPanel = document.querySelector('#farm-management-panel');
    farmPanel?.classList.toggle('is-continuous-placement', continuousPlotModeActive);
    if (continuousPlotModeActive && farmPanel) {
      farmPanel.hidden = true;
      document.querySelector('#farm-management-toggle')?.setAttribute('aria-expanded', 'false');
    }
    continuousPlotPathReady = false;
    window.skyWorld?.setContinuousPlotHeightSelection?.({ active: false });
    window.skyWorld?.setContinuousPlotPlacement?.({ active: false });
    if (!continuousPlotModeActive) window.skyWorld?.endContinuousPlotMode?.();
    save();
  }
  function beginContinuousHeightSelection(manual) {
    if (!continuousPlotModeActive) return false;
    continuousPlotManual = manual === true;
    continuousPlotHeight = 0;
    const selection = window.skyWorld?.setContinuousPlotHeightSelection?.({
      active: true, height: continuousPlotHeight, manual: continuousPlotManual,
    });
    if (!selection) return false;
    notify('拖曳半透明起點方塊調整位置與高度，再按 O 確認或 X 重新調整。');
    return true;
  }
  window.onSkyContinuousPlotPreviewChange = ({ positions = [], height = continuousPlotHeight, manual = continuousPlotManual, anchor = false } = {}) => {
    if (!continuousPlotModeActive) return '';
    if (anchor) return '起點預估 1 格 · ' + window.gardenEconomy.getLandCost(window.gardenEconomy.getAutomaticPlotCount(game.plots)).toLocaleString() + ' 金幣';
    const unique = [...new Map(positions.map((cell) => [`${cell.x},${cell.z}`, cell])).values()];
    let automaticCount = window.gardenEconomy.getAutomaticPlotCount(game.plots);
    const price = unique.reduce((sum) => {
      const cost = window.gardenEconomy.getLandCost(automaticCount);
      if (!manual) automaticCount += 1;
      return sum + cost;
    }, 0);
    return `預估 ${unique.length} 格 · ${price.toLocaleString()} 金幣`;
  };
  window.onSkyContinuousPlotAction = (action, data = {}) => {
    if (!continuousPlotModeActive) return false;
    if (action === 'placement-cancel') {
      updateContinuousPlotMode(false);
      notify('已結束連續開墾規劃，預覽地塊已移除。');
      return true;
    }
    if (action === 'anchor-adjust') {
      notify('拖曳起點方塊調整水平位置；上下拖曳可調整高度。');
      return true;
    }
    if (action === 'anchor-confirm') {
      if (!Number.isInteger(data.x) || !Number.isInteger(data.z) || !isHalfUnitHeight(data.height)) return false;
      continuousPlotHeight = Math.max(-8, Math.min(8, data.height));
      continuousPlotManual = data.manual === true;
      continuousPlotPathReady = true;
      window.skyWorld?.setContinuousPlotHeightSelection?.({ active: false });
      window.skyWorld?.setContinuousPlotPlacement?.({ active: true, height: continuousPlotHeight, manual: continuousPlotManual, start: { x: data.x, z: data.z } });
      notify('起點已確認；拖曳預覽地塊，放開後用 O 建立或 X 取消。');
      return true;
    }
    if (action === 'path-cancel') {
      const first = Array.isArray(data.positions) && data.positions.length ? data.positions[0] : { x: 0, z: 0 };
      window.skyWorld?.setContinuousPlotPlacement?.({ active: false });
      window.skyWorld?.setContinuousPlotHeightSelection?.({ active: true, x: first.x, z: first.z, height: continuousPlotHeight, manual: continuousPlotManual });
      continuousPlotPathReady = false;
      notify('這次滑動已取消；重新確認起點後即可再試一次。');
      return true;
    }
    if (action === 'path-confirm') return window.onSkyContinuousPlotPath?.(data.positions, data.height);
    return false;
  };
  window.onSkyContinuousPlotPath = (positions, height) => {
    if (!continuousPlotModeActive || !continuousPlotPathReady) return false;
    if (!Array.isArray(positions) || !positions.length || !isHalfUnitHeight(height) || height < -8 || height > 8) {
      notify('沒有取得有效路徑，請重新點擊地塊擴建按鈕再試一次。');
      updateContinuousPlotMode(false);
      return false;
    }
    const manual = continuousPlotManual;
    const batchId = `continuous-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const plannedPlots = game.plots.map((plot) => ({ ...plot }));
    const occupied = new Set(plannedPlots.map((plot) => `${plot.x},${plot.z},${plotY(plot)}`));
    const pendingExpansions = pendingExpansionJobs().filter((job) => job.resultCommitted !== true
      && !game.plots.some((plot) => plot.x === job.position.x && plot.z === job.position.z && plotY(plot) === (isHalfUnitHeight(job.position.y) ? job.position.y : 0)));
    const validationPlots = [...plannedPlots, ...pendingExpansions.map((job) => ({
      crop: null, plantedAt: null, manual: job.manual === true, grassOnly: false,
      x: job.position.x, z: job.position.z, y: isHalfUnitHeight(job.position.y) ? job.position.y : 0,
    }))];
    const reserved = new Set(pendingExpansions.map((job) => `${job.position.x},${job.position.z},${isHalfUnitHeight(job.position.y) ? job.position.y : 0}`));
    const reservedPlantCoins = [...activeJobs.values(), ...jobQueue].reduce((sum, job) => sum + (job.resultCommitted !== true && job.kind === 'plant' ? (crops[job.cropIndex]?.seedCost || 0) : 0), 0);
    let projectedAutoCount = window.gardenEconomy.getAutomaticPlotCount(plannedPlots);
    let availableCoins = game.coins - reservedPlantCoins;
    for (const job of pendingExpansions) {
      availableCoins -= window.gardenEconomy.getLandCost(projectedAutoCount);
      if (job.manual !== true) projectedAutoCount += 1;
    }
    const accepted = [];
    let skippedInvalid = 0;
    let skippedForFunds = 0;
    let skippedForCapacity = 0;
    const docks = game.drones.filter((drone) => drone.deployed !== false).map((drone) => drone.dockPosition);
    for (const cell of positions.slice(0, 120)) {
      if (!Number.isInteger(cell.x) || !Number.isInteger(cell.z)) { skippedInvalid += 1; continue; }
      const key = `${cell.x},${cell.z},${height}`;
      if (occupied.has(key) || reserved.has(key)) { skippedInvalid += 1; continue; }
      const candidate = { crop: null, plantedAt: null, manual, grassOnly: false, x: cell.x, z: cell.z, y: height };
      if (!validStacking([...validationPlots, candidate], docks)) { skippedInvalid += 1; continue; }
      if (pendingExpansions.length + accepted.length >= 200) { skippedForCapacity += 1; continue; }
      const cost = window.gardenEconomy.getLandCost(projectedAutoCount);
      if (availableCoins < cost) { skippedForFunds += 1; continue; }
      availableCoins -= cost;
      if (!manual) projectedAutoCount += 1;
      plannedPlots.push(candidate);
      validationPlots.push(candidate);
      occupied.add(key);
      reserved.add(key);
      accepted.push({
        kind: 'expand', manual, position: { x: cell.x, z: cell.z, y: height },
        batchId, createdAt: Date.now(), status: 'queued',
      });
    }
    if (!accepted.length) {
      const reasons = [];
      if (skippedInvalid) reasons.push(`無效位置 ${skippedInvalid} 格`);
      if (skippedForFunds) reasons.push(`金幣不足 ${skippedForFunds} 格`);
      if (skippedForCapacity) reasons.push(`待辦佇列上限 200 格，略過 ${skippedForCapacity} 格`);
      notify(`沒有加入開墾任務：${reasons.join('；') || '沒有可開墾的空格'}。請重新點擊地塊擴建按鈕再試一次。`);
      updateContinuousPlotMode(false);
      return false;
    }
    accepted.forEach((job) => { job.id = `${Date.now()}-${Math.random().toString(36).slice(2)}`; });
    const firstNonExpansion = jobQueue.findIndex((queued) => queued.kind !== 'expand');
    if (firstNonExpansion < 0) jobQueue.push(...accepted);
    else jobQueue.splice(firstNonExpansion, 0, ...accepted);
    const savedImmediately = save();
    renderJobQueue();
    processJobQueue();
    const skippedSummary = [
      skippedInvalid ? `無效位置 ${skippedInvalid} 格` : '',
      skippedForFunds ? `金幣不足 ${skippedForFunds} 格` : '',
      skippedForCapacity ? `佇列上限略過 ${skippedForCapacity} 格` : '',
    ].filter(Boolean).join('；');
    notify(`已加入開墾任務：${accepted.length} 格${skippedSummary ? `；${skippedSummary}` : ''}${savedImmediately ? '；任務已立即儲存。' : '；但存檔失敗，重新整理可能會遺失未完成任務。'}`);
    updateContinuousPlotMode(false);
    return true;
  };
  farmTabManual?.addEventListener('click', () => setFarmManagementTab('manual'));
  farmTabAuto?.addEventListener('click', () => setFarmManagementTab('auto'));
  syncFarmManagementTabs();
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
    if (continuousPlotModeActive) return notify('目前正在選擇開墾路徑，請先確認或取消這次操作。');
    updateContinuousPlotMode(true);
    if (!beginContinuousHeightSelection(false)) updateContinuousPlotMode(false);
  });
  manualLandButton?.addEventListener('click', () => {
    if (continuousPlotModeActive) return notify('目前正在選擇開墾路徑，請先確認或取消這次操作。');
    updateContinuousPlotMode(true);
    if (!beginContinuousHeightSelection(true)) updateContinuousPlotMode(false);
  });
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
    if (target instanceof Node && document.querySelector('dialog[open]')?.contains(target)) return;
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
  confirmResetButton?.addEventListener('click', async () => {
    if (confirmResetButton.disabled) return;
    confirmResetButton.disabled = true;
    try {
      // For signed-in gardens, delete the account's cloud save before removing
      // the local copy. If cloud deletion fails, keep the only known progress.
      if (typeof window.diangardenResetCloudSave === 'function') {
        await window.diangardenResetCloudSave();
      }
      isResetting = true;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(AUTO_CROP_KEY);
      localStorage.removeItem(FLOWER_VARIANTS_KEY);
      if (!IS_GUEST_GARDEN) localStorage.removeItem('sky-garden-cloud-sync-v1');
      resetDialog?.close();
      window.location.reload();
    } catch (_) {
      isResetting = false;
      confirmResetButton.disabled = false;
      notify('無法確認雲端或本機存檔已清除；原有進度已保留，請檢查登入狀態與網路後重試。');
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
    window.skyWorld?.setSelectedPlot(null);
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
  // The startup pause stays active until the chosen garden is loaded and the first UI/world sync is complete.
  window.skyWorld?.setRenderingPaused?.('startup', false);
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

