(() => {
  const LAND_BASE_COST = 75;
  const LAND_EARLY_GROWTH = 0.2;
  const LAND_EARLY_EXPONENT = 1.8;
  const LAND_EARLY_STAGE_END = 8;
  const LAND_MID_STAGE_END = 20;
  const LAND_EARLY_START_MULTIPLIER = 1.9;
  const LAND_EARLY_END_MULTIPLIER = 1.3;
  const LAND_MID_GROWTH = 0.14;
  const LAND_MID_EXPONENT = 1.5;
  const LAND_LATE_GROWTH = 0.08;
  const LAND_LATE_EXPONENT = 1.5;
  const DRONE_BASE_COST = 300;
  const DRONE_GROWTH = 0.15;
  const DRONE_EXPONENT = 1.5;
  const MAX_DRONES = 8;
  const OFFLINE_HOURS_PER_DRONE = 3;
  const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000;
  const WATER_DURATION = 30_000;
  const WATER_GROWTH_RATE = 1.2;
  const BATTERY_DRAIN_PER_SECOND = 0.32;
  const BATTERY_CHARGE_PER_SECOND = 0.44;
  const MIN_JOB_BATTERY = 8;
  const DAY_CYCLE_MS = 16 * 60 * 1000;
  const RAIN_CYCLE_MS = 10 * 60 * 1000;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function getBaseLandCost(plotCount) {
    const count = Math.max(3, Number.isFinite(plotCount) ? plotCount : 3);
    const earlyCost = LAND_BASE_COST * (1 + LAND_EARLY_GROWTH * Math.max(0, count - 3)) ** LAND_EARLY_EXPONENT;
    if (count <= 10) return Math.min(Number.MAX_SAFE_INTEGER, Math.round(earlyCost));
    const costAtSplit = LAND_BASE_COST * (1 + LAND_EARLY_GROWTH * (10 - 3)) ** LAND_EARLY_EXPONENT;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.round(costAtSplit * (1 + 0.03 * (count - 10)) ** 1.2));
  }
  function getLandCost(plotCount) {
    const count = Math.max(3, Number.isFinite(plotCount) ? plotCount : 3);
    if (count <= LAND_EARLY_STAGE_END) {
      const progress = (count - 3) / (LAND_EARLY_STAGE_END - 3);
      const multiplier = LAND_EARLY_START_MULTIPLIER + (LAND_EARLY_END_MULTIPLIER - LAND_EARLY_START_MULTIPLIER) * Math.sqrt(progress);
      return Math.min(Number.MAX_SAFE_INTEGER, Math.round(getBaseLandCost(count) * multiplier));
    }
    const costAtEight = getBaseLandCost(LAND_EARLY_STAGE_END) * LAND_EARLY_END_MULTIPLIER;
    if (count <= LAND_MID_STAGE_END) {
      return Math.min(Number.MAX_SAFE_INTEGER, Math.round(costAtEight * (1 + LAND_MID_GROWTH * (count - LAND_EARLY_STAGE_END)) ** LAND_MID_EXPONENT));
    }
    const costAtTwenty = costAtEight * (1 + LAND_MID_GROWTH * (LAND_MID_STAGE_END - LAND_EARLY_STAGE_END)) ** LAND_MID_EXPONENT;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.round(costAtTwenty * (1 + LAND_LATE_GROWTH * (count - LAND_MID_STAGE_END)) ** LAND_LATE_EXPONENT));
  }
  function getDroneCost(droneCount) {
    const count = clamp(Number.isInteger(droneCount) ? droneCount : 1, 1, MAX_DRONES);
    return Math.min(Number.MAX_SAFE_INTEGER, Math.round(DRONE_BASE_COST * (1 + DRONE_GROWTH * (count - 1)) ** DRONE_EXPONENT));
  }
  function getAutomaticPlotCount(plots) {
    return Array.isArray(plots) ? plots.filter((plot) => plot && plot.manual !== true).length : 0;
  }
  function getPlantablePlotCount(plots) {
    return Array.isArray(plots) ? plots.filter((plot) => plot && plot.grassOnly !== true).length : 0;
  }
  function getProfitMultiplier(plantablePlotCount) {
    return Math.min(3.5, 1 + 0.08 * Math.max(0, plantablePlotCount - 3));
  }
  function getHarvestReward(crop, plantablePlotCount) {
    if (!crop) return 0;
    const seedCost = Math.max(0, Number(crop.seedCost) || 0);
    const baseProfit = Math.max(0, (Number(crop.harvestReward) || 0) - seedCost);
    return seedCost + Math.round(baseProfit * getProfitMultiplier(plantablePlotCount));
  }
  function simulateOfflineProgress(state, now, crops, environment) {
    const departureAt = Number.isFinite(state.lastOnlineAt) ? state.lastOnlineAt : now;
    const rawDuration = Math.max(0, now - departureAt);
    const coinsBefore = state.coins;
    const droneCountAtDeparture = clamp(
      Number.isInteger(state.droneCount) ? state.droneCount : (state.drones?.length || 1),
      1,
      MAX_DRONES,
    );
    const simulatedDuration = state.autoMode === true
      ? Math.min(rawDuration, droneCountAtDeparture * OFFLINE_HOURS_PER_DRONE * 60 * 60 * 1000, MAX_OFFLINE_MS)
      : 0;
    const simulationEnd = departureAt + simulatedDuration;
    const worldTimeAt = (time) => {
      const savedTime = Number.isFinite(state.worldTimeMs) ? state.worldTimeMs : 60_000;
      const anchor = Number.isFinite(state.worldTimeAnchor) ? state.worldTimeAnchor : departureAt;
      return savedTime + Math.max(0, time - anchor);
    };
    const weatherAt = (time) => environment.getState({
      worldTimeMs: Number.isFinite(state.worldTimeMs) ? state.worldTimeMs : 60_000,
      worldTimeAnchor: Number.isFinite(state.worldTimeAnchor) ? state.worldTimeAnchor : departureAt,
    }, time);
    const plantsFor = (plot) => {
      if (!plot) return [];
      if (plot.manual === true && Array.isArray(plot.plants)) return plot.plants;
      return plot.crop === null || plot.crop === undefined ? [] : [plot];
    };
    const syncPrimaryPlant = (plot) => {
      if (plot?.manual !== true) return;
      const first = Array.isArray(plot.plants) ? plot.plants[0] : null;
      const fields = ['crop', 'plantedAt', 'plantHeight', 'variantId', 'variantName', 'variantColor', 'watered', 'waterSource', 'waterWetnessStart', 'growthBonusMs'];
      const defaults = { crop: null, plantedAt: null, plantHeight: null, variantId: null, variantName: null, variantColor: null, watered: false, waterSource: null, waterWetnessStart: null, growthBonusMs: 0 };
      fields.forEach((field) => { plot[field] = first && first[field] !== undefined ? first[field] : defaults[field]; });
      ['waterStartedAt', 'waterUntil'].forEach((field) => {
        if (Number.isFinite(first?.[field])) plot[field] = first[field];
        else delete plot[field];
      });
    };
    const growthElapsed = (plot, time) => {
      if (!plot || plot.crop === null || !Number.isFinite(plot.plantedAt)) return 0;
      let elapsed = Math.max(0, time - plot.plantedAt) + (plot.growthBonusMs || 0);
      if (Number.isFinite(plot.waterStartedAt) && Number.isFinite(plot.waterUntil)) {
        elapsed += Math.max(0, Math.min(time, plot.waterUntil) - plot.waterStartedAt) * (WATER_GROWTH_RATE - 1);
      }
      return elapsed;
    };
    const settleWater = (plot, time) => {
      plantsFor(plot).forEach((plant) => {
        if (!Number.isFinite(plant.waterStartedAt) || !Number.isFinite(plant.waterUntil) || time < plant.waterUntil) return;
        plant.growthBonusMs = (plant.growthBonusMs || 0) + Math.max(0, plant.waterUntil - plant.waterStartedAt) * (WATER_GROWTH_RATE - 1);
        delete plant.waterStartedAt;
        delete plant.waterUntil;
      });
      syncPrimaryPlant(plot);
    };
    const clearCrop = (plot) => {
      plot.crop = null; plot.plantedAt = null; plot.plantHeight = null;
      plot.variantId = null; plot.variantName = null; plot.variantColor = null;
      plot.watered = false; plot.waterSource = null; plot.growthBonusMs = 0;
      delete plot.waterStartedAt; delete plot.waterUntil;
    };
    const excluded = (plot) => !plot || plot.manual === true || plot.grassOnly === true;
    const hasJob = (queue, drones, kind, index) =>
      queue.some((job) => job.kind === kind && job.index === index)
      || drones.some((drone) => drone.job && drone.job.kind === kind && drone.job.index === index);
    const autoSelection = Array.isArray(state.autoCropSelection) ? state.autoCropSelection : [0];
    let randomSeed = Math.floor(departureAt) >>> 0;
    const random = () => {
      randomSeed = (1664525 * randomSeed + 1013904223) >>> 0;
      return randomSeed / 4294967296;
    };
    const queue = [];
    const drones = (Array.isArray(state.drones) ? state.drones : []).map((drone, index) => ({
      index,
      deployed: drone.deployed !== false,
      dockPosition: drone.dockPosition || { x: 0, z: 1.55, y: 0 },
      battery: clamp(Number.isFinite(drone.battery) ? drone.battery : 100, 0, 100),
      batteryUpdatedAt: departureAt,
      job: null,
      lastPlotIndex: null,
    })).slice(0, droneCountAtDeparture);
    while (drones.length < droneCountAtDeparture) {
      drones.push({ index: drones.length, deployed: true, dockPosition: { x: 0, z: 1.55, y: 0 }, battery: 100, batteryUpdatedAt: departureAt, job: null, lastPlotIndex: null });
    }
    const commitJob = (job, time) => {
      const plot = state.plots[job.index];
      if (!plot || excluded(plot)) return;
      if (job.kind === 'plant') {
        const crop = crops[job.cropIndex];
        if (plot.crop !== null || !crop || state.coins < crop.seedCost) return;
        state.coins -= crop.seedCost;
        plot.crop = job.cropIndex; plot.plantedAt = time; plot.plantHeight = 1;
        plot.variantId = null; plot.variantName = null; plot.variantColor = null;
        plot.watered = false; plot.waterSource = null; plot.growthBonusMs = 0;
        delete plot.waterStartedAt; delete plot.waterUntil;
      } else if (job.kind === 'harvest') {
        if (plot.crop === null) return;
        const crop = crops[plot.crop];
        if (!crop || growthElapsed(plot, time) < crop.growTime) return;
        state.coins += getHarvestReward(crop, getPlantablePlotCount(state.plots));
        clearCrop(plot);
      } else if (job.kind === 'water') {
        const crop = crops[plot.crop];
        if (!crop || plot.crop === null || plot.watered || weatherAt(time).isRaining || growthElapsed(plot, time) >= crop.growTime) return;
        plot.watered = true; plot.waterSource = 'drone'; plot.waterWetnessStart = 1;
        plot.waterStartedAt = time; plot.waterUntil = time + WATER_DURATION;
      }
    };
    const planJobs = (time) => {
      if (state.autoMode !== true) return;
      const raining = weatherAt(time).isRaining;
      state.plots.forEach((plot, index) => {
        if (excluded(plot) || plot.crop === null || hasJob(queue, drones, 'harvest', index)) return;
        const crop = crops[plot.crop];
        if (crop && growthElapsed(plot, time) >= crop.growTime) queue.push({ kind: 'harvest', index, automatic: true });
      });
      state.plots.forEach((plot, index) => {
        if (excluded(plot) || raining || plot.crop === null || plot.watered
          || hasJob(queue, drones, 'water', index) || hasJob(queue, drones, 'harvest', index)) return;
        const crop = crops[plot.crop];
        if (crop && growthElapsed(plot, time) < crop.growTime) queue.push({ kind: 'water', index, automatic: true });
      });
      const reserved = () => queue.reduce((sum, job) => sum + (job.kind === 'plant' ? (crops[job.cropIndex]?.seedCost || 0) : 0), 0)
        + drones.reduce((sum, drone) => sum + (drone.job?.kind === 'plant' ? (crops[drone.job.cropIndex]?.seedCost || 0) : 0), 0);
      state.plots.forEach((plot, index) => {
        if (excluded(plot) || plot.crop !== null || hasJob(queue, drones, 'plant', index)) return;
        const affordable = autoSelection.map((cropIndex) => ({ cropIndex, crop: crops[cropIndex] }))
          .filter(({ crop }) => crop && crop.seedCost <= state.coins - reserved());
        if (affordable.length) {
          const choice = affordable[Math.floor(random() * affordable.length)];
          queue.push({ kind: 'plant', index, cropIndex: choice.cropIndex, automatic: true });
        }
      });
    };
    const jobTiming = (job, drone, time) => {
      const plot = state.plots[job.index];
      const target = plot || { x: 0, z: 0, y: 0 };
      const start = drone.dockPosition;
      const distance = Math.hypot((target.x || 0) - (start.x || 0), (target.z || 0) - (start.z || 0));
      const laneY = 2 + drone.index * 0.28;
      const idleY = 1.5 + (start.y || 0);
      const workY = job.kind === 'water' ? 1.18 + (target.y || 0)
        : job.kind === 'harvest' ? (crops[plot.crop]?.height || 0.5) * (plot.plantHeight || 1) + (target.y || 0) + 0.12
          : 0.14 + (target.y || 0);
      const hoverSeconds = job.kind === 'water' ? 1.68 : job.kind === 'expand' ? 0.7 : 0.5;
      const outbound = Math.abs(laneY - idleY) + distance + Math.abs(laneY - workY);
      const returning = Math.abs(laneY - workY) + distance + Math.abs(laneY - idleY);
      const estimatedBattery = Math.max(MIN_JOB_BATTERY, (distance * 3 + 8) * BATTERY_DRAIN_PER_SECOND + 3);
      return { startAt: time, commitAt: time + (outbound + hoverSeconds) * 1000, finishAt: time + (outbound + hoverSeconds + returning) * 1000, estimatedBattery };
    };
    const updateBatteries = (time, previousTime) => {
      const seconds = Math.max(0, time - previousTime) / 1000;
      if (!seconds) return;
      const weather = weatherAt((time + previousTime) / 2);
      drones.forEach((drone) => {
        if (drone.job) drone.battery -= seconds * BATTERY_DRAIN_PER_SECOND;
        if (weather.isDay && !weather.isRaining) drone.battery += seconds * BATTERY_CHARGE_PER_SECOND;
        drone.battery = clamp(drone.battery, 0, 100);
        drone.batteryUpdatedAt = time;
      });
    };
    const dispatch = (time) => {
      const available = drones.filter((drone) => drone.deployed && !drone.job)
        .sort((a, b) => (b.battery === 100 ? 1 : 0) - (a.battery === 100 ? 1 : 0) || b.battery - a.battery || a.index - b.index);
      for (const drone of available) {
        let queueIndex = -1;
        for (let index = 0; index < queue.length; index += 1) {
          const job = queue[index];
          const plot = state.plots[job.index];
          if (job.kind !== 'plant' && (!plot || plot.crop === null)) continue;
          const distance = plot ? Math.hypot((plot.x || 0) - (drone.dockPosition.x || 0), (plot.z || 0) - (drone.dockPosition.z || 0)) : 0;
          const required = Math.max(MIN_JOB_BATTERY, (distance * 3 + 8) * BATTERY_DRAIN_PER_SECOND + 3);
          if (drone.battery < required) continue;
          if (drones.some((other) => other.job && other.job.kind !== 'expand' && other.job.index === job.index)) continue;
          queueIndex = index; break;
        }
        if (queueIndex < 0) continue;
        const [job] = queue.splice(queueIndex, 1);
        const timing = jobTiming(job, drone, time);
        if (drone.battery < timing.estimatedBattery) { queue.unshift(job); continue; }
        drone.job = { ...job, ...timing, committed: false };
      }
    };
    const applyRain = (time) => {
      state.plots.forEach((plot) => {
        plantsFor(plot).forEach((plant) => {
          if (Number.isFinite(plant.waterStartedAt) && Number.isFinite(plant.waterUntil)) {
            plant.growthBonusMs = (plant.growthBonusMs || 0) + Math.max(0, Math.min(time, plant.waterUntil) - plant.waterStartedAt) * (WATER_GROWTH_RATE - 1);
          }
          plant.watered = true; plant.waterSource = 'rain'; plant.waterWetnessStart = 1;
          plant.waterStartedAt = time; plant.waterUntil = time + WATER_DURATION;
        });
        syncPrimaryPlant(plot);
      });
    };
    let time = departureAt;
    let previousWeather = weatherAt(time);
    let previousTime = time;
    if (state.lastObservedRaining === true && !previousWeather.isRaining) applyRain(departureAt);
    if (state.autoMode === true && simulatedDuration > 0) {
      while (time <= simulationEnd) {
        for (let index = queue.length - 1; index >= 0; index -= 1) {
          const job = queue[index];
          const plot = state.plots[job.index];
          if (!plot || excluded(plot) || (job.kind === 'water' && (plot.crop === null || plot.watered || growthElapsed(plot, time) >= (crops[plot.crop]?.growTime || 0)))) queue.splice(index, 1);
        }
        const weather = weatherAt(time);
        if (previousWeather.isRaining && !weather.isRaining) applyRain(time);
        state.plots.forEach((plot) => settleWater(plot, time));
        updateBatteries(time, previousTime);
        drones.forEach((drone) => {
          const job = drone.job;
          if (!job) return;
          if (!job.committed && job.commitAt <= time) {
            job.committed = true;
            commitJob(job, job.commitAt);
          }
          if (job.finishAt <= time) {
            if (!job.committed) { job.committed = true; commitJob(job, job.commitAt); }
            drone.lastPlotIndex = job.index;
            drone.job = null;
          }
        });
        if (time < simulationEnd) {
          planJobs(time);
          dispatch(time);
        }
        previousWeather = weather;
        previousTime = time;
        if (time >= simulationEnd) break;
        time = Math.min(time + 1000, simulationEnd);
      }
    }
    // Finish battery accounting at the exact simulation boundary; unfinished jobs stop when the budget ends.
    if (state.autoMode === true && simulatedDuration > 0 && previousTime < simulationEnd) {
      updateBatteries(simulationEnd, previousTime);
      drones.forEach((drone) => {
        const job = drone.job;
        if (job && !job.committed && job.commitAt <= simulationEnd) {
          job.committed = true;
          commitJob(job, job.commitAt);
        }
        drone.job = null;
      });
    }
    // Natural weather and growth continue after the automated-work budget is exhausted.
    if (rawDuration > simulatedDuration) {
      const startWorld = worldTimeAt(simulationEnd);
      const phase = ((startWorld % RAIN_CYCLE_MS) + RAIN_CYCLE_MS) % RAIN_CYCLE_MS;
      const nextRainDelay = phase === 0 ? RAIN_CYCLE_MS : RAIN_CYCLE_MS - phase;
      const nextRainAt = simulationEnd + nextRainDelay;
      if (nextRainAt <= now) {
        state.plots.forEach((plot) => {
          plantsFor(plot).forEach((plant) => {
            if (plant.watered === true) return;
            if (Number.isFinite(plant.waterStartedAt) && Number.isFinite(plant.waterUntil)) {
              plant.growthBonusMs = (plant.growthBonusMs || 0) + Math.max(0, Math.min(nextRainAt, plant.waterUntil) - plant.waterStartedAt) * (WATER_GROWTH_RATE - 1);
            }
            plant.watered = true; plant.waterSource = 'rain';
            plant.waterStartedAt = nextRainAt; plant.waterUntil = nextRainAt + WATER_DURATION;
          });
          syncPrimaryPlant(plot);
        });
      }
    }
    state.plots.forEach((plot) => settleWater(plot, now));
    const endWorldTime = worldTimeAt(now);
    state.worldTimeMs = endWorldTime;
    state.worldTimeAnchor = now;
    state.lastObservedRaining = weatherAt(now).isRaining;
    // Once automated simulation stops, idle drones can still charge in dry daylight.
    const chargeStart = simulationEnd;
    drones.forEach((simDrone) => {
      let chargeTime = chargeStart;
      while (simDrone.battery < 100 && chargeTime < now) {
        const next = Math.min(now, chargeTime + 1000);
        const weather = weatherAt((chargeTime + next) / 2);
        if (weather.isDay && !weather.isRaining) simDrone.battery = Math.min(100, simDrone.battery + ((next - chargeTime) / 1000) * BATTERY_CHARGE_PER_SECOND);
        chargeTime = next;
        if (chargeTime - chargeStart > 20 * 60 * 1000) break;
      }
      const savedDrone = state.drones[simDrone.index];
      if (savedDrone) { savedDrone.battery = simDrone.battery; savedDrone.batteryUpdatedAt = now; }
    });
    state.lastOfflineReturnAt = now;
    state.lastOnlineAt = now;
    if (rawDuration <= 0) return null;
    return {
      departureAt, returnAt: now, rawDuration, simulatedDuration,
      automationEnabled: state.autoMode === true,
      droneCountAtDeparture,
      capped: state.autoMode === true && rawDuration > simulatedDuration,
      coinsBefore, coinsAfter: state.coins, coinsDelta: state.coins - coinsBefore,
    };
  }
  window.gardenEconomy = {
    getLandCost,
    getDroneCost,
    getAutomaticPlotCount,
    getPlantablePlotCount,
    getProfitMultiplier,
    getHarvestReward,
    simulateOfflineProgress,
    OFFLINE_HOURS_PER_DRONE,
    MAX_OFFLINE_MS,
  };
})();
