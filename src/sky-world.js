(() => {
  const canvas = document.querySelector('#sky-canvas');
  const frame = canvas?.closest('.world-frame');
  const galleryMode = canvas?.dataset.mode === 'gallery';
  const message = document.querySelector('#world-message');
  if (!canvas || !frame) return;

  const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
  if (!gl) {
    message.textContent = '此瀏覽器無法啟用 WebGL，請使用場景內的農地快捷按鈕繼續遊玩。';
    message.classList.add('error');
    return;
  }

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    attribute float aOpacity;
    uniform mat4 uProjection;
    uniform mat4 uView;
    varying vec3 vColor;
    varying float vOpacity;
    void main() {
      gl_Position = uProjection * uView * vec4(aPosition, 1.0);
      vColor = aColor;
      vOpacity = aOpacity;
    }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec3 vColor;
    varying float vOpacity;
    void main() { gl_FragColor = vec4(vColor, vOpacity); }
  `;

  function makeShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(reason || 'shader compile failed');
    }
    return shader;
  }

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, makeShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, makeShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (error) {
    message.textContent = '空島場景載入失敗，請使用場景內的農地快捷按鈕繼續遊玩。';
    message.classList.add('error');
    console.error('WebGL setup failed:', error);
    return;
  }

  const locations = {
    position: gl.getAttribLocation(program, 'aPosition'),
    color: gl.getAttribLocation(program, 'aColor'),
    opacity: gl.getAttribLocation(program, 'aOpacity'),
    projection: gl.getUniformLocation(program, 'uProjection'),
    view: gl.getUniformLocation(program, 'uView'),
  };
  const positionBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  const dronePositionBuffer = gl.createBuffer();
  const droneColorBuffer = gl.createBuffer();
  const effectPositionBuffer = gl.createBuffer();
  const effectColorBuffer = gl.createBuffer();
  const effectOpacityBuffer = gl.createBuffer();
  let vertexCount = 0;
  let droneVertexCount = 0;
  let effectVertexCount = 0;
  let landCount = galleryMode ? 1 : 3;
  let plotPositions = galleryMode ? [{ x: 0, z: 0, y: 0 }] : [{ x: -1, z: 0, y: 0 }, { x: 0, z: 0, y: 0 }, { x: 1, z: 0, y: 0 }];
  let galleryFlowerIndex = 0;
  let plotStates = galleryMode ? [{ crop: 0, plantedAt: 0, elapsed: 1, growTime: 1, plantHeight: 1 }] : [];
  // A planted crop may only advance visually until its planting identity changes.
  // This prevents transient stale growth snapshots from swapping a mature flower back to a seed.
  const plotVisualStages = new Map();
  function getPlotVisualStage(plot, index) {
    if (!plot || !Number.isInteger(plot.crop) || !Number.isFinite(plot.plantedAt)) {
      plotVisualStages.delete(index);
      return 0;
    }
    const identity = `${plot.crop}:${plot.plantedAt}`;
    const elapsed = Number.isFinite(plot.elapsed) ? Math.max(0, plot.elapsed) : Math.max(0, Date.now() - plot.plantedAt);
    const growTime = Number.isFinite(plot.growTime) && plot.growTime > 0 ? plot.growTime : 15_000;
    const progress = Math.min(1, elapsed / growTime);
    let stage = progress >= 1 ? 2 : progress >= 0.28 ? 1 : 0;
    const previous = plotVisualStages.get(index);
    if (previous?.identity === identity) stage = Math.max(stage, previous.stage);
    plotVisualStages.set(index, { identity, stage });
    return stage;
  }
  function manualPlantCoordinate(positionIndex) {
    const index = Number.isSafeInteger(positionIndex) && positionIndex >= 1 ? positionIndex : 1;
    if (index === 1) return { x: 0.5, z: 0.5 };
    const noiseFor = (value) => {
      const raw = Math.sin(value * 127.1 + 311.7) * 43758.5453;
      return raw - Math.floor(raw);
    };
    const noise = noiseFor(index);
    const angle = (index - 1) * 2.399963229728653 + (noise - 0.5) * 0.92;
    const radius = Math.min(0.74, 0.19 * Math.sqrt(index - 1));
    const x = 0.5 + Math.cos(angle) * radius + (noiseFor(index + 37) - 0.5) * 0.065;
    const z = 0.5 + Math.sin(angle) * radius + (noiseFor(index + 91) - 0.5) * 0.065;
    return {
      x: Math.max(-0.25, Math.min(1.25, x)),
      z: Math.max(-0.25, Math.min(1.25, z)),
    };
  }
  window.dianGardenManualPlantPlacement = Object.freeze({
    getPosition(positionIndex) { return manualPlantCoordinate(positionIndex); },
  });
  let environmentState = { phase: 'day', isDay: true, isRaining: false, rainBlend: 0, daylightProgress: 1, phaseProgress: 0, lightLevel: 1, sunflowerYaw: 0 };
  let environmentBackground = '';
  const SKY_PALETTES = {
    day: ['#c9ecfa', '#e6f6f5', '#f2f8e9'],
    night: ['#14263d', '#273b54', '#526175'],
    warm: ['#e3bfa7', '#eadac8', '#e5e3d5'],
    rainDay: ['#a8c5d0', '#c9dada', '#d8e2d1'],
    rainNight: ['#233749', '#344959', '#586875'],
  };
  function mixSkyColor(from, to, amount) {
    const t = Math.max(0, Math.min(1, amount));
    const parse = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    const a = parse(from), b = parse(to);
    return '#' + a.map((value, index) => Math.round(value + (b[index] - value) * t).toString(16).padStart(2, '0')).join('');
  }
  function getSkyGradient(state) {
    const daylight = Math.max(0, Math.min(1, Number.isFinite(state.daylightProgress) ? state.daylightProgress : (state.lightLevel - 0.18) / 0.82));
    const phaseProgress = Math.max(0, Math.min(1, Number.isFinite(state.phaseProgress) ? state.phaseProgress : 0));
    const warmth = state.phase === 'dawn' || state.phase === 'dusk' ? 0.28 * 4 * phaseProgress * (1 - phaseProgress) : 0;
    const rainBlend = Math.max(0, Math.min(1, Number.isFinite(state.rainBlend) ? state.rainBlend : (state.isRaining ? 1 : 0)));
    const colors = SKY_PALETTES.night.map((night, index) => {
      const dayColor = SKY_PALETTES.day[index];
      const base = mixSkyColor(night, dayColor, daylight);
      const warmed = mixSkyColor(base, SKY_PALETTES.warm[index], warmth);
      const rainy = mixSkyColor(SKY_PALETTES.rainNight[index], SKY_PALETTES.rainDay[index], daylight);
      return mixSkyColor(warmed, rainy, rainBlend);
    });
    return `linear-gradient(180deg, ${colors[0]} 0%, ${colors[1]} 64%, ${colors[2]} 100%)`;
  }
  let rainStartedAt = null;
  let lastSoilTransitionUploadAt = 0;
  let selectedPlotIndex = null;
  let yaw = 0.78;
  let pitch = galleryMode ? 0.72 : 0.54;
  let distance = galleryMode ? 9.5 : 6.6;
  let topDownHeight = 12;
  let targetX = 0;
  let targetZ = 0;
  let cameraMode = '3d';
  let savedCameraPose = null;
  const touchPoints = new Map();
  const activePointerFeedback = new Map();
  let pinchActive = false;
  let suppressTouchTap = false;
  let rotateHoldGesture = false;
  let emptyTouchRotateTimer = null;
  const touchFeedbackLayer = document.createElement('div');
  touchFeedbackLayer.className = 'touch-feedback-layer';
  frame.append(touchFeedbackLayer);
  function feedbackPoint(event) {
    const rect = frame.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function makeHoldRing(x, y) {
    const ring = document.createElement('div');
    ring.className = 'touch-hold-ring';
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    const wreath = document.createElement('img');
    wreath.className = 'touch-hold-wreath';
    wreath.src = 'assets/wreath.webp';
    wreath.alt = '';
    wreath.draggable = false;
    wreath.setAttribute('aria-hidden', 'true');
    ring.append(wreath);
    touchFeedbackLayer.append(ring);
    return ring;
  }
  function beginPointerFeedback(event) {
    const point = feedbackPoint(event);
    const state = { startX: event.clientX, startY: event.clientY, moved: false, ring: null, revealTimer: null };
    // The progress animation begins on pointerdown; only its visibility is delayed.
    state.ring = makeHoldRing(point.x, point.y);
    activePointerFeedback.set(event.pointerId, state);
    state.revealTimer = setTimeout(() => {
      if (activePointerFeedback.get(event.pointerId) === state && !state.moved) state.ring?.classList.add('is-visible');
    }, 200);
  }
  function removePointerHoldRing(state) {
    if (!state) return;
    clearTimeout(state.revealTimer);
    state.revealTimer = null;
    state.ring?.remove();
    state.ring = null;
  }
  function updatePointerFeedback(event) {
    const state = activePointerFeedback.get(event.pointerId);
    if (!state || state.moved || Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 5) return;
    state.moved = true;
    removePointerHoldRing(state);
  }
  function clearPointerHoldRings() {
    for (const state of activePointerFeedback.values()) removePointerHoldRing(state);
  }
  function endPointerFeedback(event) {
    const state = activePointerFeedback.get(event.pointerId);
    removePointerHoldRing(state);
    activePointerFeedback.delete(event.pointerId);
    const point = feedbackPoint(event);
    const dot = document.createElement('span');
    dot.className = 'touch-feedback-dot';
    dot.style.left = `${point.x}px`; dot.style.top = `${point.y}px`;
    touchFeedbackLayer.append(dot);
    setTimeout(() => dot.remove(), 500);
  }
  function cancelPointerFeedback(event) {
    const state = activePointerFeedback.get(event.pointerId);
    removePointerHoldRing(state);
    activePointerFeedback.delete(event.pointerId);
  }
  let pinchStartDistance = 0;
  let pinchStartZoom = 0;
  function currentZoom() { return cameraMode === '2d' ? topDownHeight : distance; }
  function applyZoom(value) {
    if (cameraMode === '2d') topDownHeight = Math.max(3, Math.min(50, value));
    else distance = Math.max(1.5, Math.min(24, value));
  }
  const cameraModeButton = document.querySelector('#camera-mode');
  cameraModeButton?.addEventListener('click', () => {
    if (cameraMode === '3d') {
      savedCameraPose = { yaw, pitch, distance, targetX, targetZ };
      cameraMode = '2d';
      cameraModeButton.textContent = '返回 3D';
      cameraModeButton.setAttribute('aria-pressed', 'true');
    } else {
      cameraMode = '3d';
      if (savedCameraPose) ({ yaw, pitch, distance, targetX, targetZ } = savedCameraPose);
      cameraModeButton.textContent = '2D 模式';
      cameraModeButton.setAttribute('aria-pressed', 'false');
    }
  });
  let dragging = false;
  let pointerMoved = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let dragPlotIndex = null;
  let dragOffset = [0, 0];
  let dragPreview = null;
  let pointerPlotIndex = null;
  let plotPressIndex = null;
  let plotPressReady = false;
  let plotWasInMoveModeAtPointerDown = false;
  let plotPressTimer = null;
  let dockPosition = { x: 0, z: 1.55 };
  let heightEdit = null;
  let heightDrag = null;
  let droneDocks = [dockPosition];
  let dockPreview = null;
  let dockSelected = false;
  let dockHitAtPointer = null;
  let dragDock = false;
  let dockDragOffset = [0, 0];
  let dockPressTimer = null;
  let dockPressReady = false;
  let dockWasInMoveModeAtPointerDown = false;
  const keys = new Set();
  const TILE = 1;
  const DRONE_IDLE_Y = 1.5;
  const DRONE_WORK_Y = 1.18;
  const DRONE_TRANSIT_Y = 2.0;
  const DRONE_LANE_SPACING = 0.62;
  const DRONE_SPEED = 1.0;
  const DRONE_IDLE_BOB = 0.012;
  let currentProjection = null;
  let currentView = null;
  let droneCount = galleryMode ? 0 : 1;
  const droneStates = Array.from({ length: 8 }, (_, index) => ({
    animation: null,
    location: index === 0 ? [dockPosition.x, dockPosition.z] : [0, 0],
    y: DRONE_IDLE_Y,
    heading: 0,
  }));
  let droneFrameTime = performance.now();

  const flowerModelRegistry = window.dianGardenFlowerModels;
  const { addFace, addTriangle, addOctahedron, addIcosahedron, addLeaf } = flowerModelRegistry.geometry;



  // Flower-specific geometry lives in src/model/ and is dispatched through the shared registry.
  function addFlowerModel(positions, colors, x, z, flowerIndex, stage, heightMultiplier = 1, customColor = null) {
    const modelPositions = [];
    const modelColors = [];
    addFlowerGeometry(modelPositions, modelColors, x, z, flowerIndex, stage, customColor);
    for (let i = 0; i < modelPositions.length; i += 3) {
      positions.push(modelPositions[i], 0.055 + (modelPositions[i + 1] - 0.055) * heightMultiplier, modelPositions[i + 2]);
      colors.push(modelColors[i], modelColors[i + 1], modelColors[i + 2]);
    }
  }

  function addFlowerGeometry(positions, colors, x, z, flowerIndex, stage, customColor = null) {
    const flowerHeadColors = [
      [0.98, 0.72, 0.12], [0.54, 0.39, 0.78], [0.93, 0.94, 0.84], [0.545, 0.063, 0.157],
      [0.91, 0.36, 0.34], [0.88, 0.48, 0.58], [0.94, 0.7, 0.2], [0.44, 0.59, 0.88],
      [0.57, 0.42, 0.75], [0.83, 0.38, 0.55], [0.85, 0.16, 0.28],
    ];
    const flowerHeights = window.flowerCatalog.map((flower) => flower.height);
    const seedColors = [[0.54, 0.38, 0.2], [0.49, 0.38, 0.29], [0.58, 0.52, 0.35], [0.58, 0.33, 0.28]];
    const customHeadColor = /^#[0-9a-f]{6}$/i.test(customColor || '')
      ? [1, 3, 5].map((offset) => Number.parseInt(customColor.slice(offset, offset + 2), 16) / 255)
      : null;
    const headColor = customHeadColor || flowerHeadColors[flowerIndex] || flowerHeadColors[0];
    if (stage === 0) {
      addOctahedron(positions, colors, x, 0.11, z, 0.065, 0.055, 0.065,
        (flowerIndex === 10 ? [0.43, 0.19, 0.18] : seedColors[flowerIndex] || seedColors[0]));
      return;
    }

    // The tile is one world unit wide. Keep the existing catalog-based plant heights.
    const matureHeight = flowerHeights[flowerIndex] || flowerHeights[0];
    const height = stage === 1 ? matureHeight * 0.31 : matureHeight;
    const model = flowerModelRegistry.get(flowerIndex);
    const stemModel = model?.stem || null;
    if (stemModel) {
      stemModel(positions, colors, x, z, height, stage);
      if (stage === 1) return;
    } else {
      const stemWidth = flowerIndex === 2 ? 0.018 : 0.028;
      const stemColor = [0.3, 0.53, 0.27];
      addBox(positions, colors, x - stemWidth / 2, 0.055, z - stemWidth / 2,
        x + stemWidth / 2, 0.055 + height, z + stemWidth / 2, {
          top: [0.36, 0.59, 0.3], front: [0.28, 0.47, 0.25], right: [0.25, 0.42, 0.22],
          back: [0.32, 0.52, 0.27], left: stemColor, bottom: [0.22, 0.38, 0.2],
        });
    }

    if (stage === 1) {
      if (!stemModel) {
        addLeaf(positions, colors, x, 0.11, z, [-0.75, 0.52, -0.15], 0.12, [0.34, 0.62, 0.29]);
        addLeaf(positions, colors, x, 0.12, z, [0.66, 0.54, 0.2], 0.12, [0.38, 0.66, 0.31]);
      }
      return;
    }

    if (model?.bloom) {
      model.bloom({ positions, colors, x, z, height, headColor, environmentState, stemModel, stage });
      return;
    }

    const bloomY = 0.055 + height;
    if (!stemModel) {
      addLeaf(positions, colors, x, 0.22, z, [-0.82, 0.38, -0.12], 0.22, [0.31, 0.58, 0.3]);
      addLeaf(positions, colors, x, 0.32, z, [0.74, 0.34, 0.16], 0.21, [0.37, 0.64, 0.33]);
    }
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = petal / 5 * Math.PI * 2;
      addOctahedron(positions, colors, x + Math.cos(angle) * 0.055, bloomY,
        z + Math.sin(angle) * 0.055, 0.06, 0.055, 0.06,
        petal % 2 ? headColor.map((channel) => Math.min(1, channel * 0.9)) : headColor);
    }
    addOctahedron(positions, colors, x, bloomY + 0.035, z, 0.05, 0.065, 0.05, headColor);
  }

  function addBox(positions, colors, x1, y1, z1, x2, y2, z2, palette) {
    const a = [x1, y1, z1], b = [x2, y1, z1], c = [x2, y1, z2], d = [x1, y1, z2];
    const e = [x1, y2, z1], f = [x2, y2, z1], g = [x2, y2, z2], h = [x1, y2, z2];
    addFace(positions, colors, [e, h, g, f], palette.top);
    addFace(positions, colors, [a, b, f, e], palette.front);
    addFace(positions, colors, [b, c, g, f], palette.right);
    addFace(positions, colors, [c, d, h, g], palette.back);
    addFace(positions, colors, [d, a, e, h], palette.left);
    addFace(positions, colors, [a, d, c, b], palette.bottom);
  }

  function addGrassTexture(positions, colors, x, z, half, y, baseColor = [0.43, 0.68, 0.39], surfaceHeightAt = null) {
    const random = (index, salt) => {
      const value = Math.sin(x * 127.1 + z * 311.7 + index * 74.7 + salt * 19.19) * 43758.5453;
      return value - Math.floor(value);
    };
    for (let patch = 0; patch < 18; patch += 1) {
      const centerX = x + (random(patch, 1) * 2 - 1) * half * 0.94;
      const centerZ = z + (random(patch, 2) * 2 - 1) * half * 0.94;
      const radiusX = 0.035 + random(patch, 3) * 0.038;
      const radiusZ = 0.025 + random(patch, 4) * 0.032;
      const colorScale = 0.94 + random(patch, 5) * 0.19;
      const color = baseColor.map((channel) => Math.min(1, channel * colorScale));
      const points = [];
      for (let edge = 0; edge < 6; edge += 1) {
        const angle = edge / 6 * Math.PI * 2;
        const wobble = 0.78 + random(patch, edge + 6) * 0.38;
        const pointX = centerX + Math.cos(angle) * radiusX * wobble;
        const pointZ = centerZ + Math.sin(angle) * radiusZ * wobble;
        points.push([pointX, (surfaceHeightAt ? surfaceHeightAt(pointX, pointZ) : y) + 0.0015, pointZ]);
      }
      const center = [centerX, (surfaceHeightAt ? surfaceHeightAt(centerX, centerZ) : y) + 0.0015, centerZ];
      for (let edge = 0; edge < points.length; edge += 1) {
        addTriangle(positions, colors, center, points[edge], points[(edge + 1) % points.length], color);
      }
    }
  }

  function addSlopedSoilBed(positions, colors, x, z, bed, surfaceHeightAt, palette) {
    const half = bed / 2, bottomOffset = 0.001, thickness = 0.055;
    const corners = [
      [x - half, z - half], [x + half, z - half],
      [x + half, z + half], [x - half, z + half],
    ].map(([px, pz]) => ({ x: px, z: pz, baseY: surfaceHeightAt(px, pz) + bottomOffset }));
    const top = corners.map(point => [point.x, point.baseY + thickness, point.z]);
    const bottom = corners.map(point => [point.x, point.baseY, point.z]);
    // Anchor the bed's center to the same center height used by the tile surface.
    // Averaging the inner corners can drift away from the actual center on asymmetric ramps.
    const centerY = surfaceHeightAt(x, z) + bottomOffset + thickness;
    const center = [x, centerY, z];
    for (let i = 0; i < 4; i += 1) {
      const next = (i + 1) % 4;
      addTriangle(positions, colors, top[i], top[next], center, palette.top);
      addTriangle(positions, colors, bottom[i], bottom[next], top[next], palette.front);
      addTriangle(positions, colors, bottom[i], top[next], top[i], palette.front);
    }
    return centerY;
  }

  function addSoilTexture(positions, colors, x, z, bed, y, wet, surfaceHeightAt = null) {
    const marks = [
      [-0.17, -0.13, 0.065, -0.35, 0.008, 0],
      [0.08, -0.16, 0.052, 0.62, 0.007, 1],
      [0.17, -0.035, 0.07, -0.18, 0.009, 0],
      [-0.1, 0.035, 0.058, 0.82, 0.008, 1],
      [0.035, 0.14, 0.068, -0.52, 0.007, 0],
      [-0.19, 0.17, 0.045, 0.22, 0.006, 1],
      [0.19, 0.18, 0.038, -0.7, 0.006, 0],
    ];
    const palette = wet
      ? [[0.32, 0.22, 0.17], [0.47, 0.32, 0.24]]
      : [[0.49, 0.32, 0.22], [0.73, 0.51, 0.37]];
    const limit = bed * 0.5 - 0.025;
    // Rotate the deterministic soil-mark pattern per tile to avoid identical repeated rows.
    const seed = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    const rotation = (seed - Math.floor(seed)) * Math.PI * 2;
    const cosRotation = Math.cos(rotation), sinRotation = Math.sin(rotation);
    for (const [offsetX, offsetZ, length, angle, width, shade] of marks) {
      const variedX = offsetX * cosRotation - offsetZ * sinRotation;
      const variedZ = offsetX * sinRotation + offsetZ * cosRotation;
      const cx = x + Math.max(-limit, Math.min(limit, variedX));
      const cz = z + Math.max(-limit, Math.min(limit, variedZ));
      const variedAngle = angle + rotation;
      const dx = Math.cos(variedAngle) * length * 0.5, dz = Math.sin(variedAngle) * length * 0.5;
      const px = -Math.sin(variedAngle) * width * 0.5, pz = Math.cos(variedAngle) * width * 0.5;
      const textureY = (px, pz) => surfaceHeightAt ? surfaceHeightAt(px, pz) + 0.057 : y;
      const ax = cx - dx + px, az = cz - dz + pz;
      const bx = cx + dx + px, bz = cz + dz + pz;
      const dxp = cx - dx - px, dzp = cz - dz - pz;
      const ex = cx + dx - px, ez = cz + dz - pz;
      const a = [ax, textureY(ax, az), az];
      const b = [bx, textureY(bx, bz), bz];
      const d = [dxp, textureY(dxp, dzp), dzp];
      const e = [ex, textureY(ex, ez), ez];
      addTriangle(positions, colors, a, b, e, palette[shade]);
      addTriangle(positions, colors, a, e, d, palette[shade]);
    }
  }

  function getPlotPosition(index, count = landCount) {
    if (dragPreview?.index === index) return [dragPreview.x, dragPreview.z];
    const position = plotPositions[index];
    if (position) return [position.x, position.z];
    return [index - Math.max(0, count - 1), 0];
  }

  function getPlotHeight(index) { return plotPositions[index]?.y || 0; }
  window.dianGardenGrassRampLogic = Object.freeze({
    getConnections(positions, states, index, tileSize = 1, maxHeightDifference = 0.5) {
      const sides = { north: null, east: null, south: null, west: null };
      if (!Array.isArray(positions) || !Number.isInteger(index) || !positions[index]) return sides;
      const source = positions[index], sourceY = source.y || 0, epsilon = 1e-8;
      positions.forEach((position, neighborIndex) => {
        if (neighborIndex === index || !position) return;
        const dx = position.x - source.x, dz = position.z - source.z;
        const side = Math.abs(dx) <= epsilon && Math.abs(dz + tileSize) <= epsilon ? 'north'
          : Math.abs(dx - tileSize) <= epsilon && Math.abs(dz) <= epsilon ? 'east'
          : Math.abs(dx) <= epsilon && Math.abs(dz - tileSize) <= epsilon ? 'south'
          : Math.abs(dx + tileSize) <= epsilon && Math.abs(dz) <= epsilon ? 'west' : null;
        if (!side) return;
        const neighborY = position.y || 0, heightDifference = neighborY - sourceY;
        if (Math.abs(heightDifference) > maxHeightDifference + epsilon) return;
        const bothGrass = states[index]?.grassOnly === true && states[neighborIndex]?.grassOnly === true;
        const edgeHeight = bothGrass ? (sourceY + neighborY) / 2 : neighborY;
        sides[side] = { index: neighborIndex, y: neighborY, edgeHeight, heightDifference };
      });
      return sides;
    },
    getConnectedGroupBottomY(positions, index, tileSize = 1, maxHeightDifference = 0.5) {
      if (!Array.isArray(positions) || !Number.isInteger(index) || !positions[index]) return 0;
      const epsilon = 1e-8;
      const connected = new Set([index]);
      const queue = [index];
      while (queue.length) {
        const currentIndex = queue.shift();
        const current = positions[currentIndex];
        positions.forEach((candidate, candidateIndex) => {
          if (!candidate || connected.has(candidateIndex)) return;
          const dx = Math.abs(candidate.x - current.x);
          const dz = Math.abs(candidate.z - current.z);
          const dy = Math.abs((candidate.y || 0) - (current.y || 0));
          const horizontalTouch = ((Math.abs(dx - tileSize) <= epsilon && dz <= epsilon)
            || (Math.abs(dz - tileSize) <= epsilon && dx <= epsilon))
            && dy <= maxHeightDifference + epsilon;
          const verticalTouch = dx <= epsilon && dz <= epsilon && dy > epsilon
            && dy <= maxHeightDifference + epsilon;
          if (!horizontalTouch && !verticalTouch) return;
          connected.add(candidateIndex);
          queue.push(candidateIndex);
        });
      }
      let lowestY = Infinity;
      connected.forEach((plotIndex) => { lowestY = Math.min(lowestY, positions[plotIndex].y || 0); });
      return Number.isFinite(lowestY) ? lowestY - tileSize * 0.5 : 0;
    },
    hasPlotDirectlyBelow(positions, index, tileSize = 1) {
      const source = positions?.[index];
      if (!source || !Array.isArray(positions)) return false;
      const epsilon = 1e-8;
      return positions.some((candidate, candidateIndex) => candidateIndex !== index && candidate
        && Math.abs(candidate.x - source.x) <= epsilon && Math.abs(candidate.z - source.z) <= epsilon
        && Math.abs((source.y || 0) - (candidate.y || 0) - tileSize * 0.5) <= epsilon);
    },
    getPlantBaseHeight(surfaceHeightAt, x, z, grassOnly) {
      const groundHeight = surfaceHeightAt(x, z);
      // addFlowerModel's local geometry baseline is y=0.055. Offset its origin so
      // the visible root meets the ground on grass or the raised soil-bed top on farms.
      return grassOnly ? groundHeight - 0.055 : groundHeight + 0.001;
    },
    getSharedCornerHeight(positions, states, index, cornerX, cornerZ, tileSize = 1, maxHeightDifference = 0.5) {
      const source = positions?.[index];
      if (!source || !Array.isArray(positions)) return 0;
      const half = tileSize / 2, epsilon = 1e-8;
      const touching = [];
      positions.forEach((position, plotIndex) => {
        if (!position) return;
        if (Math.abs(Math.abs(position.x - cornerX) - half) > epsilon
          || Math.abs(Math.abs(position.z - cornerZ) - half) > epsilon) return;
        touching.push({ index: plotIndex, x: position.x, z: position.z, y: position.y || 0, grass: states?.[plotIndex]?.grassOnly === true });
      });
      const sourceNode = touching.find((plot) => plot.index === index);
      if (!sourceNode) return source.y || 0;
      const connected = new Set([index]);
      const queue = [sourceNode];
      while (queue.length) {
        const current = queue.shift();
        for (const candidate of touching) {
          if (connected.has(candidate.index)) continue;
          const dx = Math.abs(candidate.x - current.x), dz = Math.abs(candidate.z - current.z);
          const cardinallyAdjacent = (Math.abs(dx - tileSize) <= epsilon && dz <= epsilon)
            || (Math.abs(dz - tileSize) <= epsilon && dx <= epsilon);
          if (!cardinallyAdjacent || Math.abs(candidate.y - current.y) > maxHeightDifference + epsilon) continue;
          connected.add(candidate.index);
          queue.push(candidate);
        }
      }
      const group = touching.filter((plot) => connected.has(plot.index));
      // Every connected tile, grass or farm, uses the same shared vertex height.
      // This lets farm blocks slope too while keeping mixed grass/farm seams aligned.
      const heights = group.map((plot) => plot.y);
      return heights.reduce((sum, height) => sum + height, 0) / heights.length;
    },
  });
  function addGrassRamp(positions, colors, index, x, z, half, y) {
    const corners = [
      { x: x - half, z: z - half, side: [0.55, 0.39, 0.28], u: 0, v: 0 },
      { x: x + half, z: z - half, side: [0.48, 0.33, 0.25], u: 1, v: 0 },
      { x: x + half, z: z + half, side: [0.57, 0.4, 0.29], u: 1, v: 1 },
      { x: x - half, z: z + half, side: [0.5, 0.35, 0.26], u: 0, v: 1 },
    ].map((corner) => {
      const cornerY = window.dianGardenGrassRampLogic.getSharedCornerHeight(plotPositions, plotStates, index, corner.x, corner.z, TILE, 0.5);
      return { ...corner, y: cornerY, top: [corner.x, cornerY, corner.z] };
    });
    const edges = [
      { side: 'north', indices: [0, 1], color: corners[0].side },
      { side: 'east', indices: [1, 2], color: corners[1].side },
      { side: 'south', indices: [2, 3], color: corners[2].side },
      { side: 'west', indices: [3, 0], color: corners[3].side },
    ].map((edge) => ({ ...edge, points: edge.indices.map((cornerIndex) => corners[cornerIndex]) }));
    const center = { x, z, y, u: 0.5, v: 0.5, top: [x, y, z] };
    const localBottomY = Math.min(y, ...edges.flatMap((edge) => edge.points.map((point) => point.y))) - 0.5;
    const rampLogic = window.dianGardenGrassRampLogic;
    const hasPlotBelow = rampLogic.hasPlotDirectlyBelow(plotPositions, index, TILE);
    const groupBottomY = rampLogic.getConnectedGroupBottomY(plotPositions, index, TILE, 0.5);
    const bottomY = hasPlotBelow ? localBottomY : Math.min(localBottomY, groupBottomY);
    // Farm plots must not expose green turf around or above the raised soil bed.
    const topColor = [0.43, 0.68, 0.39];
    edges.forEach((edge) => addTriangle(positions, colors, edge.points[0].top, edge.points[1].top, center.top, topColor));
    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
      const previousEdge = edges[(cornerIndex + 3) % 4], nextEdge = edges[cornerIndex];
      const previousPoint = previousEdge.points[1], nextPoint = nextEdge.points[0];
      if (Math.abs(previousPoint.y - nextPoint.y) > 1e-8) {
        addTriangle(positions, colors, previousPoint.top, nextPoint.top, center.top, topColor);
      }
    }
    edges.forEach((edge) => {
      const first = edge.points[0], second = edge.points[1];
      const firstBottom = [first.x, bottomY, first.z], secondBottom = [second.x, bottomY, second.z];
      addTriangle(positions, colors, firstBottom, secondBottom, second.top, edge.color);
      addTriangle(positions, colors, firstBottom, second.top, first.top, edge.color);
    })
    addBox(positions, colors, x - half, bottomY - 0.01, z - half, x + half, bottomY, z + half, {
      top: [0.4, 0.28, 0.24], front: [0.4, 0.28, 0.24], right: [0.4, 0.28, 0.24], back: [0.4, 0.28, 0.24], left: [0.4, 0.28, 0.24], bottom: [0.4, 0.28, 0.24],
    });
    const toUnit = (px, pz) => [(px - (x - half)) / (half * 2), (pz - (z - half)) / (half * 2)];
    const triangleHeight = (px, pz, a, b, c) => {
      const [u, v] = toUnit(px, pz);
      const denominator = (b.u - c.u) * (a.v - c.v) + (c.v - b.v) * (a.u - c.u);
      const wa = ((b.u - c.u) * (v - c.v) + (c.v - b.v) * (u - c.u)) / denominator;
      const wb = ((c.u - a.u) * (v - c.v) + (a.v - c.v) * (u - c.u)) / denominator;
      return wa * a.y + wb * b.y + (1 - wa - wb) * c.y;
    };
    const edgeTriangles = edges.map((edge) => ({ side: edge.side, a: edge.points[0], b: edge.points[1], c: center }));
    const surfaceHeightAt = (px, pz) => {
      const [u, v] = toUnit(px, pz);
      let side;
      if (v <= u && v <= 1 - u) side = 'north';
      else if (u >= v && u >= 1 - v) side = 'east';
      else if (v >= u && v >= 1 - u) side = 'south';
      else side = 'west';
      const triangle = edgeTriangles.find((item) => item.side === side);
      return triangleHeight(px, pz, triangle.a, triangle.b, triangle.c);
    };
    return surfaceHeightAt;
  }
  function getDockHeight(index = 0) {
    const position = dockPreview?.index === index ? dockPreview : index === 0 ? dockPosition : (droneDocks[index] || dockPosition);
    return position.y || 0;
  }

  function getDockPosition(index = 0) {
    const position = dockPreview?.index === index
      ? dockPreview
      : index === 0 ? dockPosition : (droneDocks[index] || dockPosition);
    return [position.x, position.z];
  }

  function getDroneBatteryColor(battery) {
    const charge = Math.max(0, Math.min(1, battery / 100));
    const lowCharge = [0.82, 0.3, 0.27], fullCharge = [0.38, 0.69, 0.43];
    return lowCharge.map((channel, index) => channel + (fullCharge[index] - channel) * charge);
  }

  function addDrone(positions, colors, x, y, z, rotorAngle, heading, battery = 100) {
    const firstVertex = positions.length;
    const body = { top: [0.58, 0.48, 0.31], front: [0.38, 0.33, 0.23], right: [0.31, 0.37, 0.27], back: [0.46, 0.38, 0.26], left: [0.34, 0.4, 0.29], bottom: [0.23, 0.27, 0.2] };
    const trim = { top: [0.7, 0.59, 0.39], front: [0.52, 0.43, 0.31], right: [0.44, 0.48, 0.33], back: [0.58, 0.48, 0.33], left: [0.46, 0.49, 0.35], bottom: [0.3, 0.33, 0.24] };
    const rotor = { top: [0.78, 0.69, 0.5], front: [0.53, 0.46, 0.34], right: [0.44, 0.4, 0.3], back: [0.62, 0.53, 0.38], left: [0.47, 0.42, 0.31], bottom: [0.35, 0.33, 0.25] };
    addBox(positions, colors, x - 0.105, y - 0.075, z - 0.085, x + 0.105, y + 0.075, z + 0.085, body);
    // A pair of low skids gives the single-rotor craft a stable landing stance.
    addBox(positions, colors, x - 0.115, y - 0.105, z - 0.07, x + 0.115, y - 0.087, z - 0.045, trim);
    addBox(positions, colors, x - 0.115, y - 0.105, z + 0.045, x + 0.115, y - 0.087, z + 0.07, trim);
    addBox(positions, colors, x - 0.07, y - 0.09, z - 0.057, x - 0.052, y - 0.045, z - 0.04, trim);
    addBox(positions, colors, x + 0.052, y - 0.09, z - 0.057, x + 0.07, y - 0.045, z - 0.04, trim);
    addBox(positions, colors, x - 0.07, y - 0.09, z + 0.04, x - 0.052, y - 0.045, z + 0.057, trim);
    addBox(positions, colors, x + 0.052, y - 0.09, z + 0.04, x + 0.07, y - 0.045, z + 0.057, trim);
    addBox(positions, colors, x - 0.026, y + 0.075, z - 0.026, x + 0.026, y + 0.15, z + 0.026, trim);

    // One two-blade rotor above the cabin; rotate its single shared axis.
    const halfLength = 0.19, halfWidth = 0.018;
    const dx = Math.cos(rotorAngle) * halfLength, dz = Math.sin(rotorAngle) * halfLength;
    const px = -Math.sin(rotorAngle) * halfWidth, pz = Math.cos(rotorAngle) * halfWidth;
    const bladeCorners = [
      [x - dx - px, y + 0.155, z - dz - pz], [x + dx - px, y + 0.155, z + dz - pz],
      [x + dx + px, y + 0.155, z + dz + pz], [x - dx + px, y + 0.155, z - dz + pz],
    ];
    addTriangle(positions, colors, bladeCorners[0], bladeCorners[1], bladeCorners[2], [0.71, 0.61, 0.43]);
    addTriangle(positions, colors, bladeCorners[0], bladeCorners[2], bladeCorners[3], [0.71, 0.61, 0.43]);
    addOctahedron(positions, colors, x, y + 0.006, z + 0.087, 0.035, 0.026, 0.015, getDroneBatteryColor(battery));
    const cosine = Math.cos(heading), sine = Math.sin(heading);
    for (let vertex = firstVertex; vertex < positions.length; vertex += 3) {
      const localX = positions[vertex] - x, localZ = positions[vertex + 2] - z;
      positions[vertex] = x + localX * cosine + localZ * sine;
      positions[vertex + 2] = z - localX * sine + localZ * cosine;
    }
  }

  function routeLength(route) {
    return route.slice(1).reduce((length, point, index) => length + Math.hypot(point[0] - route[index][0], point[1] - route[index][1]), 0);
  }

  function findDroneRoute(start, goal, droneIndex) {
    const step = 0.5;
    const toGrid = (point) => [Math.round(point[0] / step), Math.round(point[1] / step)];
    const startGrid = toGrid(start), goalGrid = toGrid(goal);
    const key = (point) => `${point[0]},${point[1]}`;
    const obstacles = droneStates.map((state, index) => ({ state, index }))
      .filter(({ state, index }) => index !== droneIndex && index < droneCount && droneDocks[index]?.deployed !== false)
      .map(({ state }) => state.location.slice());
    const blocked = (point) => key(point) !== key(startGrid) && key(point) !== key(goalGrid)
      && obstacles.some(([x, z]) => Math.hypot(point[0] * step - x, point[1] * step - z) < 0.62);
    const minX = Math.floor((Math.min(startGrid[0], goalGrid[0]) * step - 3) / step);
    const maxX = Math.ceil((Math.max(startGrid[0], goalGrid[0]) * step + 3) / step);
    const minZ = Math.floor((Math.min(startGrid[1], goalGrid[1]) * step - 3) / step);
    const maxZ = Math.ceil((Math.max(startGrid[1], goalGrid[1]) * step + 3) / step);
    const heuristic = (point) => Math.hypot(goalGrid[0] - point[0], goalGrid[1] - point[1]);
    const open = [{ point: startGrid, cost: 0, score: heuristic(startGrid) }];
    const cameFrom = new Map();
    const costs = new Map([[key(startGrid), 0]]);
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let visited = 0;
    while (open.length && visited < 6000) {
      open.sort((a, b) => a.score - b.score);
      const current = open.shift().point;
      if (key(current) === key(goalGrid)) {
        const path = [current];
        let cursor = key(current);
        while (cameFrom.has(cursor)) { cursor = cameFrom.get(cursor); path.push(cursor.split(',').map(Number)); }
        path.reverse();
        return [start, ...path.slice(1, -1).map(([x, z]) => [x * step, z * step]), goal];
      }
      visited += 1;
      const currentCost = costs.get(key(current));
      for (const [dx, dz] of directions) {
        const next = [current[0] + dx, current[1] + dz];
        if (next[0] < minX || next[0] > maxX || next[1] < minZ || next[1] > maxZ || blocked(next)) continue;
        if (dx && dz && (blocked([current[0] + dx, current[1]]) || blocked([current[0], current[1] + dz]))) continue;
        const nextKey = key(next), nextCost = currentCost + (dx && dz ? Math.SQRT2 : 1);
        if (nextCost >= (costs.get(nextKey) ?? Infinity)) continue;
        costs.set(nextKey, nextCost);
        cameFrom.set(nextKey, key(current));
        open.push({ point: next, cost: nextCost, score: nextCost + heuristic(next) });
      }
    }
    return [start, goal];
  }

  function sampleRoute(route, progress) {
    const total = routeLength(route);
    let remaining = total * Math.max(0, Math.min(1, progress));
    for (let index = 1; index < route.length; index += 1) {
      const from = route[index - 1], to = route[index];
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (remaining <= length || index === route.length - 1) {
        const ratio = length ? Math.min(1, remaining / length) : 1;
        return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
      }
      remaining -= length;
    }
    return route[route.length - 1].slice();
  }

  function updateDroneFrame(time) {
    const positions = [];
    const colors = [];
    const effectPositions = [];
    const effectColors = [];
    const effectOpacitySpans = [];
    const effectNow = Date.now();
    if (environmentState.isRaining) {
      const rainPalette = { top: [0.48, 0.69, 0.76], front: [0.36, 0.57, 0.65], right: [0.32, 0.52, 0.61], back: [0.42, 0.63, 0.7], left: [0.36, 0.57, 0.65], bottom: [0.28, 0.46, 0.54] };
      for (let drop = 0; drop < 44; drop += 1) {
        const fall = (time * 0.0028 + drop * 0.137) % 1;
        const x = Math.sin(drop * 14.31) * 3.1 + Math.sin(time * 0.0004 + drop) * 0.12;
        const z = Math.cos(drop * 7.17) * 2.4;
        const y = 4.1 - fall * 4.4;
        addBox(effectPositions, effectColors, x, y - 0.22, z, x + 0.012, y, z + 0.012, rainPalette);
      }
    }
    plotStates.forEach((plot, index) => {
      if (environmentState.isRaining || !Number.isInteger(plot?.crop) || !Number.isFinite(plot.waterUntil) || plot.waterUntil <= effectNow) return;
      const [plantX, plantZ] = getPlotPosition(index);
      const plantY = getPlotHeight(index);
      for (let particle = 0; particle < 5; particle += 1) {
        const angle = particle * 2.399 + index;
        const radius = 0.16 + (particle % 2) * 0.07;
        const px = plantX + Math.cos(angle) * radius;
        const pz = plantZ + Math.sin(angle) * radius;
        const py = plantY + 0.16 + (particle % 3) * 0.075;
        const size = 0.022;
        const cycle = (time * 0.0001166666666667 + particle * 0.21 + index * 0.13) * Math.PI * 2;
        const opacity = 0.08 + (0.92 * (1 - Math.cos(cycle)) * 0.5);
        const firstVertex = effectPositions.length / 3;
        addOctahedron(effectPositions, effectColors, px, py, pz, size, size * 1.6, size, [0.47, 0.78, 0.72]);
        effectOpacitySpans.push({ first: firstVertex, last: effectPositions.length / 3, opacity });
      }
    });
    const delta = Math.min(16, Math.max(0, time - droneFrameTime));
    droneFrameTime = time;
    const proposals = droneStates.map((state, index) => {
      if (!state.animation) {
      const [idleX, idleZ] = getDockPosition(index);
        return { x: idleX, y: DRONE_IDLE_Y + getDockHeight(index) + Math.sin(time * 0.0022 + index * 1.7) * DRONE_IDLE_BOB, z: idleZ, elapsed: null, workProgress: 0, completing: false };
      }
      const animation = state.animation;
      let elapsed = animation.elapsed + delta;
      const laneY = Number.isFinite(animation.laneY) ? animation.laneY : DRONE_TRANSIT_Y;
      const idleY = Number.isFinite(animation.idleY) ? animation.idleY : DRONE_IDLE_Y;
      const workY = Number.isFinite(animation.workY) ? animation.workY : DRONE_WORK_Y;
      const { target, start, startY, hoverDuration } = animation;
      const [startX, startZ] = start;
      const [targetX, targetZ] = target;
      const idleX = animation.idlePosition.x, idleZ = animation.idlePosition.z;
      const durationForDistance = (distance) => distance / DRONE_SPEED * 1000;
      const continueAtTarget = animation.continueAtTarget === true;
      const climbDuration = continueAtTarget ? 0 : durationForDistance(Math.abs(laneY - startY));
      const outboundDistance = continueAtTarget ? 0 : routeLength(animation.outboundRoute);
      const horizontalDuration = continueAtTarget ? 0 : durationForDistance(outboundDistance);
      const descentDuration = continueAtTarget ? durationForDistance(Math.abs(startY - workY)) : durationForDistance(Math.abs(laneY - workY));
      const outboundDuration = climbDuration + horizontalDuration + descentDuration;
      const returnClimbDuration = durationForDistance(Math.abs(laneY - workY));
      const returnDistance = routeLength(animation.returnRoute);
      const returnHorizontalDuration = durationForDistance(returnDistance);
      const returnDescentDuration = durationForDistance(Math.abs(laneY - idleY));
      const returnDuration = returnClimbDuration + returnHorizontalDuration + returnDescentDuration;
      const returnStart = outboundDuration + hoverDuration;
      let x, y, z, workProgress = 0;
      if (elapsed < climbDuration) {
        x = startX; z = startZ;
        y = startY + (laneY - startY) * (elapsed / climbDuration);
      } else if (elapsed < climbDuration + horizontalDuration) {
        const progress = (elapsed - climbDuration) / horizontalDuration;
        [x, z] = sampleRoute(animation.outboundRoute, progress);
        y = laneY;
      } else if (elapsed < outboundDuration) {
        const descentProgress = (elapsed - climbDuration - horizontalDuration) / descentDuration;
        x = targetX; z = targetZ;
        const approachStartY = continueAtTarget ? startY : laneY;
        y = approachStartY + (workY - approachStartY) * descentProgress;
      } else if (elapsed < returnStart) {
        workProgress = Math.min(1, (elapsed - outboundDuration) / hoverDuration);
        x = targetX; y = workY; z = targetZ;
      } else {
        if (animation.returning === undefined) animation.returning = animation.shouldReturn?.() !== false;
        if (!animation.departed) { animation.departed = true; animation.onDeparture?.(); }
        if (animation.returning === false) {
          x = targetX; y = workY; z = targetZ;
        } else {
          const returnElapsed = Math.min(returnDuration, elapsed - returnStart);
          if (returnElapsed < returnClimbDuration) {
            const progress = returnElapsed / returnClimbDuration;
            x = targetX; z = targetZ;
            y = workY + (laneY - workY) * progress;
          } else if (returnElapsed < returnClimbDuration + returnHorizontalDuration) {
            const progress = (returnElapsed - returnClimbDuration) / returnHorizontalDuration;
            [x, z] = sampleRoute(animation.returnRoute, progress);
            y = laneY;
          } else {
            const progress = (returnElapsed - returnClimbDuration - returnHorizontalDuration) / returnDescentDuration;
            x = idleX; z = idleZ;
            y = laneY + (idleY - laneY) * progress;
          }
        }
      }
      const workComplete = elapsed >= returnStart;
      const completing = animation.workCompleted === true && elapsed >= returnStart + returnDuration;
      if (completing) { x = idleX; y = idleY; z = idleZ; }
      return { x, y, z, elapsed, workProgress, workComplete, completing, returnStart };
    });

    for (let index = 0; index < droneCount; index += 1) {
      const state = droneStates[index];
      const candidate = proposals[index];
      const animation = state.animation;
      const previousX = state.location[0], previousZ = state.location[1];
      state.location = [candidate.x, candidate.z];
      state.y = candidate.y;
      if (animation) animation.elapsed = candidate.elapsed;
      if (Math.hypot(candidate.x - previousX, candidate.z - previousZ) > 0.0001) state.heading = Math.atan2(candidate.x - previousX, candidate.z - previousZ);
      if (droneDocks[index]?.deployed !== false) addDrone(positions, colors, candidate.x, candidate.y, candidate.z, time * (animation ? 0.04 : 0.012), state.heading, droneDocks[index]?.battery ?? 100);
      if (animation && candidate.workProgress > 0) {
        if (!animation.workStarted) {
          animation.workStarted = true;
          animation.onWorkStart?.();
        }
        const [targetX, targetZ] = animation.target;
          const targetY = Number.isInteger(animation.targetPlotIndex) ? getPlotHeight(animation.targetPlotIndex) : 0;
        if (animation.kind === 'expand') {
          const half = TILE * 0.5 * candidate.workProgress;
          addBox(effectPositions, effectColors, targetX - half, -0.5, targetZ - half, targetX + half, 0, targetZ + half, {
            top: [0.43, 0.68, 0.39], front: [0.57, 0.37, 0.27], right: [0.48, 0.31, 0.25], back: [0.58, 0.39, 0.28], left: [0.51, 0.33, 0.25], bottom: [0.4, 0.28, 0.24],
          });
          const bed = half * 0.66;
          if (bed > 0.01) addBox(effectPositions, effectColors, targetX - bed / 2, 0.001, targetZ - bed / 2, targetX + bed / 2, 0.055, targetZ + bed / 2, {
            top: [0.66, 0.45, 0.31], front: [0.57, 0.38, 0.28], right: [0.53, 0.35, 0.27], back: [0.6, 0.4, 0.29], left: [0.56, 0.37, 0.27], bottom: [0.5, 0.34, 0.26],
          });
        } else if (animation.kind === 'water') {
          for (let drop = 0; drop < 6; drop += 1) {
            const phase = (candidate.workProgress * 2.6 + drop / 6) % 1;
            const dropY = targetY + 1.06 - phase * 0.98;
            const offsetX = ((drop % 3) - 1) * 0.055;
            const offsetZ = (Math.floor(drop / 3) ? 1 : -1) * 0.035;
            addOctahedron(effectPositions, effectColors, targetX + offsetX, dropY, targetZ + offsetZ, 0.018, 0.035, 0.018, [0.34, 0.72, 0.89]);
          }
          const splash = 0.075 + Math.abs(Math.sin(time * 0.014)) * 0.045;
          addOctahedron(effectPositions, effectColors, targetX, targetY + 0.065, targetZ, splash, 0.014, splash * 0.72, [0.3, 0.66, 0.78]);
        } else {
          const pulse = Math.max(0, Math.sin(time * 0.018)) * 0.07;
          addOctahedron(effectPositions, effectColors, targetX, targetY + 0.16 + pulse, targetZ, 0.025 + pulse, 0.035 + pulse, 0.025 + pulse, [0.76, 0.87, 0.45]);
        }
      }
      if (animation && candidate.workComplete && !animation.workCompleted && state.animation === animation) {
        animation.workCompleted = true;
        animation.returning = animation.shouldReturn?.() !== false;
        if (!animation.departed) { animation.departed = true; animation.onDeparture?.(); }
        state.lastCompletedPlotIndex = Number.isInteger(animation.targetPlotIndex) ? animation.targetPlotIndex : null;
        state.animation = null;
        const onComplete = animation.onComplete;
        animation.onComplete = null;
        onComplete?.();
        if (state.animation === null) {
          animation.elapsed = Math.max(candidate.elapsed, candidate.returnStart);
          state.animation = animation;
        }
      } else if (animation && candidate.completing && state.animation === animation) {
        state.animation = null;
        const onReturnComplete = animation.onReturnComplete;
        animation.onReturnComplete = null;
        onReturnComplete?.();
      }
    }
    droneVertexCount = positions.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, dronePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, droneColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    effectVertexCount = effectPositions.length / 3;
    const effectOpacities = new Float32Array(effectVertexCount).fill(1);
    for (const span of effectOpacitySpans) {
      for (let vertex = span.first; vertex < span.last; vertex += 1) effectOpacities[vertex] = span.opacity;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, effectOpacityBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, effectOpacities, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(effectPositions), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(effectColors), gl.DYNAMIC_DRAW);
  }

  function uploadWorld(time = performance.now()) {
    const positions = [];
    const colors = [];
    const [dockX, dockZ] = getDockPosition(0);
    const dockHeight = 1.3 + getDockHeight(0);
    const dockBase = dockSelected
      ? { top: [0.66, 0.58, 0.42], front: [0.46, 0.4, 0.3], right: [0.42, 0.46, 0.34], back: [0.54, 0.46, 0.32], left: [0.44, 0.47, 0.35], bottom: [0.3, 0.32, 0.25] }
      : { top: [0.48, 0.46, 0.36], front: [0.34, 0.33, 0.28], right: [0.3, 0.34, 0.28], back: [0.39, 0.37, 0.3], left: [0.34, 0.35, 0.3], bottom: [0.25, 0.27, 0.23] };
    const dockMark = { top: [0.79, 0.66, 0.43], front: [0.62, 0.5, 0.34], right: [0.57, 0.48, 0.34], back: [0.68, 0.55, 0.37], left: [0.61, 0.5, 0.35], bottom: [0.48, 0.4, 0.3] };
    if (droneCount > 0 && droneDocks[0]?.deployed !== false) {
      addBox(positions, colors, dockX - 0.34, dockHeight, dockZ - 0.3, dockX + 0.34, dockHeight + 0.055, dockZ + 0.3, dockBase);
      addBox(positions, colors, dockX - 0.25, dockHeight + 0.056, dockZ - 0.21, dockX + 0.25, dockHeight + 0.066, dockZ - 0.18, dockMark);
      addBox(positions, colors, dockX - 0.25, dockHeight + 0.056, dockZ + 0.18, dockX + 0.25, dockHeight + 0.066, dockZ + 0.21, dockMark);
      addBox(positions, colors, dockX - 0.25, dockHeight + 0.056, dockZ - 0.18, dockX - 0.22, dockHeight + 0.066, dockZ + 0.18, dockMark);
      addBox(positions, colors, dockX + 0.22, dockHeight + 0.056, dockZ - 0.18, dockX + 0.25, dockHeight + 0.066, dockZ + 0.18, dockMark);
      addBox(positions, colors, dockX - 0.035, dockHeight + 0.056, dockZ - 0.12, dockX + 0.035, dockHeight + 0.066, dockZ + 0.12, dockMark);
      addBox(positions, colors, dockX - 0.12, dockHeight + 0.056, dockZ - 0.035, dockX + 0.12, dockHeight + 0.066, dockZ + 0.035, dockMark);
    }
    for (let index = 1; index < droneCount; index += 1) {
      if (droneDocks[index]?.deployed === false) continue;
      const [x, z] = getDockPosition(index);
      const platformY = 1.3 + getDockHeight(index);
      addBox(positions, colors, x - 0.34, platformY, z - 0.3, x + 0.34, platformY + 0.055, z + 0.3, dockBase);
      addBox(positions, colors, x - 0.25, platformY + 0.056, z - 0.21, x + 0.25, platformY + 0.066, z - 0.18, dockMark);
      addBox(positions, colors, x - 0.25, platformY + 0.056, z + 0.18, x + 0.25, platformY + 0.066, z + 0.21, dockMark);
      addBox(positions, colors, x - 0.25, platformY + 0.056, z - 0.18, x - 0.22, platformY + 0.066, z + 0.18, dockMark);
      addBox(positions, colors, x + 0.22, platformY + 0.056, z - 0.18, x + 0.25, platformY + 0.066, z + 0.18, dockMark);
      addBox(positions, colors, x - 0.035, platformY + 0.056, z - 0.12, x + 0.035, platformY + 0.066, z + 0.12, dockMark);
      addBox(positions, colors, x - 0.12, platformY + 0.056, z - 0.035, x + 0.12, platformY + 0.066, z + 0.035, dockMark);
    }
    if (dockPreview) {
      const [previewX, previewZ] = getDockPosition(dockPreview.index);
      const half = TILE * 0.5;
      const edge = 0.045;
      const y = 0.062;
      const projection = { top: [0.42, 0.78, 0.62], front: [0.33, 0.62, 0.48], right: [0.28, 0.56, 0.43], back: [0.36, 0.67, 0.51], left: [0.3, 0.59, 0.45], bottom: [0.25, 0.48, 0.38] };
      addBox(positions, colors, previewX - half, y, previewZ - half, previewX + half, y + 0.018, previewZ - half + edge, projection);
      addBox(positions, colors, previewX - half, y, previewZ + half - edge, previewX + half, y + 0.018, previewZ + half, projection);
      addBox(positions, colors, previewX - half, y, previewZ - half + edge, previewX - half + edge, y + 0.018, previewZ + half - edge, projection);
      addBox(positions, colors, previewX + half - edge, y, previewZ - half + edge, previewX + half, y + 0.018, previewZ + half - edge, projection);
      const arrowY = 1.46;
      const arrow = { top: [0.35, 0.8, 0.66], front: [0.27, 0.65, 0.53], right: [0.23, 0.57, 0.46], back: [0.31, 0.72, 0.59], left: [0.25, 0.61, 0.49], bottom: [0.2, 0.5, 0.4] };
      const tip = [0.19, 0.75, 0.58];
      addBox(positions, colors, previewX - 0.34, arrowY, previewZ - 0.025, previewX + 0.34, arrowY + 0.025, previewZ + 0.025, arrow);
      addTriangle(positions, colors, [previewX - 0.49, arrowY + 0.026, previewZ], [previewX - 0.27, arrowY + 0.026, previewZ - 0.11], [previewX - 0.27, arrowY + 0.026, previewZ + 0.11], tip);
      addTriangle(positions, colors, [previewX + 0.49, arrowY + 0.026, previewZ], [previewX + 0.27, arrowY + 0.026, previewZ + 0.11], [previewX + 0.27, arrowY + 0.026, previewZ - 0.11], tip);
      addBox(positions, colors, previewX - 0.025, arrowY + 0.035, previewZ - 0.34, previewX + 0.025, arrowY + 0.06, previewZ + 0.34, arrow);
      addTriangle(positions, colors, [previewX, arrowY + 0.061, previewZ - 0.49], [previewX - 0.11, arrowY + 0.061, previewZ - 0.27], [previewX + 0.11, arrowY + 0.061, previewZ - 0.27], tip);
      addTriangle(positions, colors, [previewX, arrowY + 0.061, previewZ + 0.49], [previewX + 0.11, arrowY + 0.061, previewZ + 0.27], [previewX - 0.11, arrowY + 0.061, previewZ + 0.27], tip);
    }
    for (let i = 0; i < landCount; i += 1) {
      const [x, z] = getPlotPosition(i);
      const plotY = getPlotHeight(i);
      const half = TILE / 2;
      const plot = plotStates[i];
      const rainWet = environmentState.isRaining;
      const postWaterWet = Number.isFinite(plot?.waterUntil) && plot.waterUntil > Date.now();
      // Rain tints soil immediately; its post-rain waterUntil animation remains a separate state.
      const soilNow = Date.now();
      const rainWetness = rainWet ? Math.min(1, Math.max(0, (soilNow - (rainStartedAt ?? soilNow)) / 1680)) : 0;
      const postWaterProgress = postWaterWet ? Math.min(1, Math.max(0, (soilNow - plot.waterStartedAt) / Math.max(1, plot.waterUntil - plot.waterStartedAt))) : 1;
      const waterStartWetness = Number.isFinite(plot?.waterWetnessStart) ? plot.waterWetnessStart : 1;
      const dryingWetness = postWaterWet ? waterStartWetness * (1 - postWaterProgress) : 0;
      const wateringWetness = Number.isFinite(plot?.waterVisualStartedAt) ? Math.min(1, Math.max(0, (soilNow - plot.waterVisualStartedAt) / 1680)) : 0;
      const wetness = Math.max(rainWetness, dryingWetness, wateringWetness);
      const wet = wetness > 0.001;
      const surfaceHeightAt = addGrassRamp(positions, colors, i, x, z, half, plotY);
      const plantBaseY = window.dianGardenGrassRampLogic.getPlantBaseHeight(surfaceHeightAt, x, z, plot?.grassOnly === true);
      addGrassTexture(positions, colors, x, z, half, plotY, [0.43, 0.68, 0.39], surfaceHeightAt);
      const bed = TILE * 0.66;
      const drySoil = { top: [0.66, 0.45, 0.31], front: [0.57, 0.38, 0.28], right: [0.53, 0.35, 0.27], back: [0.6, 0.4, 0.29], left: [0.56, 0.37, 0.27], bottom: [0.5, 0.34, 0.26] };
      const wetSoil = { top: [0.43, 0.29, 0.2], front: [0.39, 0.26, 0.19], right: [0.36, 0.24, 0.18], back: [0.41, 0.27, 0.2], left: [0.38, 0.25, 0.19], bottom: [0.34, 0.23, 0.18] };
      const soilPalette = Object.fromEntries(Object.keys(drySoil).map((face) => [face, drySoil[face].map((channel, channelIndex) => channel + (wetSoil[face][channelIndex] - channel) * wetness)]));
      if (!plot?.grassOnly) {
        const soilBedCenterY = addSlopedSoilBed(positions, colors, x, z, bed, surfaceHeightAt, soilPalette);
        addSoilTexture(positions, colors, x, z, bed, soilBedCenterY, wetness > 0.5, surfaceHeightAt);
      }
      // 手動農地以插在草地邊緣的空白告示牌辨識，避免干擾花株與耕作區。
      if (plot?.manual === true && !plot?.grassOnly) {
        const signX = x + half * 0.73;
        const signZ = z + half * 0.72;
        const groundY = plotY + 0.004;
        const signGeometryStart = positions.length;
        const signAngle = Math.PI / 6;
        const signCos = Math.cos(signAngle);
        const signSin = Math.sin(signAngle);
        const postWidth = 0.025;
        const postHeight = 0.205;
        const post = {
          top: [0.48, 0.32, 0.2], front: [0.36, 0.23, 0.15],
          right: [0.31, 0.2, 0.13], back: [0.42, 0.27, 0.17],
          left: [0.39, 0.25, 0.16], bottom: [0.28, 0.18, 0.12],
        };
        const boardWidth = 0.19;
        const boardHeight = 0.125;
        const boardDepth = 0.022;
        const boardBottom = groundY + postHeight * 0.48;
        // 細木柱插入草地，牌面使用無文字的淺奶油色木板。
        addBox(
          positions, colors,
          signX - postWidth / 2, groundY, signZ - postWidth / 2,
          signX + postWidth / 2, groundY + postHeight, signZ + postWidth / 2,
          post,
        );
        const board = {
          top: [0.94, 0.84, 0.64], front: [0.91, 0.79, 0.57],
          right: [0.77, 0.62, 0.42], back: [0.86, 0.73, 0.53],
          left: [0.82, 0.67, 0.47], bottom: [0.72, 0.57, 0.39],
        };
        addBox(
          positions, colors,
          signX - boardWidth / 2, boardBottom, signZ - boardDepth / 2,
          signX + boardWidth / 2, boardBottom + boardHeight, signZ + boardDepth / 2,
          board,
        );
        // 將整塊告示牌（木柱與牌面）繞垂直軸旋轉 30 度。
        for (let vertex = signGeometryStart; vertex < positions.length; vertex += 3) {
          const dx = positions[vertex] - signX;
          const dz = positions[vertex + 2] - signZ;
          positions[vertex] = signX + dx * signCos + dz * signSin;
          positions[vertex + 2] = signZ - dx * signSin + dz * signCos;
        }
      }
      if (i === selectedPlotIndex) {
        const edge = 0.035;
        const frameHalf = half + 0.08;
        const y = plotY + 0.064;
        const gold = { top: [1, 0.85, 0.38], front: [0.91, 0.69, 0.25], right: [0.86, 0.63, 0.22], back: [0.96, 0.77, 0.3], left: [0.9, 0.67, 0.23], bottom: [0.8, 0.57, 0.2] };
        addBox(positions, colors, x - frameHalf, y, z - frameHalf, x + frameHalf, y + 0.018, z - frameHalf + edge, gold);
        addBox(positions, colors, x - frameHalf, y, z + frameHalf - edge, x + frameHalf, y + 0.018, z + frameHalf, gold);
        addBox(positions, colors, x - frameHalf, y, z - frameHalf + edge, x - frameHalf + edge, y + 0.018, z + frameHalf - edge, gold);
        addBox(positions, colors, x + frameHalf - edge, y, z - frameHalf + edge, x + frameHalf, y + 0.018, z + frameHalf - edge, gold);
      }
      const plants = plot?.manual === true && Array.isArray(plot.plants)
        ? plot.plants
        : plot && Number.isInteger(plot.crop) && Number.isFinite(plot.plantedAt) ? [plot] : [];
      plants.forEach((plant, plantIndex) => {
        if (!Number.isInteger(plant.crop) || !Number.isFinite(plant.plantedAt)) return;
        const normalized = plot?.manual === true ? manualPlantCoordinate(plant.positionIndex || plantIndex + 1) : { x: 0.5, z: 0.5 };
        const plantX = x + (normalized.x - 0.5) * 0.9;
        const plantZ = z + (normalized.z - 0.5) * 0.9;
        const stageKey = plot?.manual === true ? `manual:${i}:${plant.positionIndex || plantIndex + 1}` : i;
        const stage = getPlotVisualStage(plant, stageKey);
        const flowerVertexStart = positions.length;
        addFlowerModel(positions, colors, plantX, plantZ, plant.crop, stage,
          Number.isFinite(plant.plantHeight) ? plant.plantHeight : 1, plant.customColor);
        for (let vertex = flowerVertexStart + 1; vertex < positions.length; vertex += 3) positions[vertex] += plantBaseY;
      });
    }
    if (heightEdit) {
      let arrowX, arrowZ, arrowBaseY;
      if (heightEdit.kind === 'plot' && Number.isInteger(heightEdit.index) && heightEdit.index < landCount) {
        [arrowX, arrowZ] = getPlotPosition(heightEdit.index);
        arrowBaseY = getPlotHeight(heightEdit.index);
      } else if (heightEdit.kind === 'dock' && Number.isInteger(heightEdit.index)) {
        [arrowX, arrowZ] = getDockPosition(heightEdit.index);
        arrowBaseY = 1.366 + getDockHeight(heightEdit.index);
      }
      if (Number.isFinite(arrowX) && Number.isFinite(arrowZ) && Number.isFinite(arrowBaseY)) {
        const x = arrowX + 0.34, z = arrowZ + 0.34;
        if (heightEdit.mode === 'height') {
          const bottom = arrowBaseY + 0.12, top = arrowBaseY + 0.92;
          const shaft = { top: [0.24, 0.88, 0.76], front: [0.14, 0.68, 0.59], right: [0.12, 0.61, 0.53], back: [0.18, 0.76, 0.66], left: [0.13, 0.65, 0.56], bottom: [0.1, 0.52, 0.45] };
          const tip = [0.32, 0.98, 0.82];
          addBox(positions, colors, x - 0.025, bottom + 0.12, z - 0.025, x + 0.025, top - 0.12, z + 0.025, shaft);
          addTriangle(positions, colors, [x, top, z], [x - 0.13, top - 0.18, z], [x + 0.13, top - 0.18, z], tip);
          addTriangle(positions, colors, [x, bottom, z], [x + 0.13, bottom + 0.18, z], [x - 0.13, bottom + 0.18, z], tip);
        } else {
          const y = arrowBaseY + 0.82;
          const shaft = { top: [0.98, 0.78, 0.3], front: [0.86, 0.62, 0.2], right: [0.82, 0.58, 0.18], back: [0.92, 0.69, 0.23], left: [0.84, 0.6, 0.19], bottom: [0.75, 0.5, 0.16] };
          const tip = [1, 0.86, 0.38];
          addBox(positions, colors, x - 0.22, y, z - 0.025, x + 0.22, y + 0.025, z + 0.025, shaft);
          addTriangle(positions, colors, [x - 0.34, y + 0.026, z], [x - 0.19, y + 0.026, z - 0.1], [x - 0.19, y + 0.026, z + 0.1], tip);
          addTriangle(positions, colors, [x + 0.34, y + 0.026, z], [x + 0.19, y + 0.026, z + 0.1], [x + 0.19, y + 0.026, z - 0.1], tip);
          addBox(positions, colors, x - 0.025, y + 0.035, z - 0.22, x + 0.025, y + 0.06, z + 0.22, shaft);
          addTriangle(positions, colors, [x, y + 0.061, z - 0.34], [x - 0.1, y + 0.061, z - 0.19], [x + 0.1, y + 0.061, z - 0.19], tip);
          addTriangle(positions, colors, [x, y + 0.061, z + 0.34], [x + 0.1, y + 0.061, z + 0.19], [x - 0.1, y + 0.061, z + 0.19], tip);
        }
      }
    }
    vertexCount = positions.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * range, -1,
      0, 0, near * far * 2 * range, 0,
    ]);
  }

  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length; zy /= length; zz /= length;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length; xy /= length; xz /= length;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
    ]);
  }

  function projectPoint(point) {
    if (!currentProjection || !currentView) return null;
    const [x, y, z] = point;
    const viewX = currentView[0] * x + currentView[4] * y + currentView[8] * z + currentView[12];
    const viewY = currentView[1] * x + currentView[5] * y + currentView[9] * z + currentView[13];
    const viewZ = currentView[2] * x + currentView[6] * y + currentView[10] * z + currentView[14];
    const viewW = currentView[3] * x + currentView[7] * y + currentView[11] * z + currentView[15];
    const clipX = currentProjection[0] * viewX + currentProjection[4] * viewY + currentProjection[8] * viewZ + currentProjection[12] * viewW;
    const clipY = currentProjection[1] * viewX + currentProjection[5] * viewY + currentProjection[9] * viewZ + currentProjection[13] * viewW;
    const clipZ = currentProjection[2] * viewX + currentProjection[6] * viewY + currentProjection[10] * viewZ + currentProjection[14] * viewW;
    const clipW = currentProjection[3] * viewX + currentProjection[7] * viewY + currentProjection[11] * viewZ + currentProjection[15] * viewW;
    if (clipW <= 0) return null;
    return {
      x: (clipX / clipW * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - (clipY / clipW * 0.5 + 0.5)) * canvas.clientHeight,
      depth: clipZ / clipW,
    };
  }

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const a = polygon[i], b = polygon[j];
      const crosses = (a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function findPlotAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const xAtCanvas = clientX - rect.left;
    const yAtCanvas = clientY - rect.top;
    const candidates = [];
    for (let index = 0; index < landCount; index += 1) {
      const [x, z] = getPlotPosition(index);
      const half = TILE / 2;
      const polygon = [
      projectPoint([x - half, getPlotHeight(index) + 0.08, z - half]), projectPoint([x + half, getPlotHeight(index) + 0.08, z - half]),
      projectPoint([x + half, getPlotHeight(index) + 0.08, z + half]), projectPoint([x - half, getPlotHeight(index) + 0.08, z + half]),
      ];
      if (polygon.some((point) => !point) || !pointInPolygon(xAtCanvas, yAtCanvas, polygon)) continue;
      candidates.push({ index, depth: polygon.reduce((sum, point) => sum + point.depth, 0) / polygon.length });
    }
    candidates.sort((a, b) => a.depth - b.depth);
    return candidates.length ? candidates[0].index : null;
  }

  function findDockAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const xAtCanvas = (clientX - rect.left) * canvas.clientWidth / Math.max(rect.width, 1);
    const yAtCanvas = (clientY - rect.top) * canvas.clientHeight / Math.max(rect.height, 1);
    // Only the platform's top face is interactive; the drone, platform sides,
    // and nearby empty space must not accidentally select the dock.
    for (let index = droneCount - 1; index >= 0; index -= 1) {
      if (droneDocks[index]?.deployed === false) continue;
      const [dockX, dockZ] = getDockPosition(index);
      const platformY = 1.366 + getDockHeight(index);
      const polygon = [
        projectPoint([dockX - 0.34, platformY, dockZ - 0.3]),
        projectPoint([dockX + 0.34, platformY, dockZ - 0.3]),
        projectPoint([dockX + 0.34, platformY, dockZ + 0.3]),
        projectPoint([dockX - 0.34, platformY, dockZ + 0.3]),
      ];
      if (polygon.every(Boolean) && pointInPolygon(xAtCanvas, yAtCanvas, polygon)) return index;
    }
    return null;
  }

  function screenToGround(clientX, clientY, groundY = 0.08) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const tangent = Math.tan(Math.PI / 8);
    const aspect = rect.width / Math.max(rect.height, 1);
    if (cameraMode === '2d') {
      const ray = [nx * aspect * tangent, -1, -ny * tangent];
      const distanceToGround = (groundY - topDownHeight) / ray[1];
      return [targetX + ray[0] * distanceToGround, targetZ + ray[2] * distanceToGround];
    }
    const forward = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const cameraUp = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
    const ray = [
      forward[0] + right[0] * nx * aspect * tangent + cameraUp[0] * ny * tangent,
      forward[1] + cameraUp[1] * ny * tangent,
      forward[2] + right[2] * nx * aspect * tangent + cameraUp[2] * ny * tangent,
    ];
    const horizontal = Math.cos(pitch) * distance;
    const eye = [targetX + Math.sin(yaw) * horizontal, Math.sin(pitch) * distance, targetZ + Math.cos(yaw) * horizontal];
    if (Math.abs(ray[1]) < 0.0001) return null;
    const distanceToGround = (groundY - eye[1]) / ray[1];
    if (distanceToGround < 0) return null;
    return [eye[0] + ray[0] * distanceToGround, eye[2] + ray[2] * distanceToGround];
  }

  function pickPlot(clientX, clientY) {
    const index = findPlotAt(clientX, clientY);
    if (index !== null) {
      if (index === selectedPlotIndex) window.onSkyPlotActivate?.(index);
      else window.onSkyPlotSelect?.(index);
      return;
    }
    dockSelected = false;
    selectedPlotIndex = null;
    window.skyWorld?.setSelectedPlot(null);
    window.onSkyEmptySelect?.();
    uploadWorld();
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  }

  function moveCamera(delta) {
    if (heightEdit?.kind === 'plot') return;
    if (cameraMode === '2d') {
      const speed = Math.min(delta * 0.0035 * (topDownHeight / 12), 0.08);
      if (keys.has('w')) targetZ -= speed;
      if (keys.has('s')) targetZ += speed;
      if (keys.has('a')) targetX -= speed;
      if (keys.has('d')) targetX += speed;
      return;
    }
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const speed = Math.min(delta * 0.0035, 0.04);
    if (keys.has('w')) { targetX += forwardX * speed; targetZ += forwardZ * speed; }
    if (keys.has('s')) { targetX -= forwardX * speed; targetZ -= forwardZ * speed; }
    if (keys.has('a')) { targetX -= rightX * speed; targetZ -= rightZ * speed; }
    if (keys.has('d')) { targetX += rightX * speed; targetZ += rightZ * speed; }
  }

  let previousTime = 0;
  let powerSaveMode = false;
  const renderingPauseReasons = new Set(galleryMode ? [] : ['startup']);
  function isRenderingPaused() { return powerSaveMode || renderingPauseReasons.size > 0; }
  function setRenderingPaused(reason, paused) {
    if (typeof reason !== 'string' || !reason.trim()) return;
    if (paused) renderingPauseReasons.add(reason);
    else renderingPauseReasons.delete(reason);
    if (isRenderingPaused()) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    } else {
      previousTime = 0;
      uploadWorld();
    }
  }
  function draw(time) {
    if (isRenderingPaused()) {
      previousTime = time;
      setTimeout(() => requestAnimationFrame(draw), 250);
      return;
    }
    const delta = previousTime ? time - previousTime : 16;
    previousTime = time;
    moveCamera(delta);
    resize();
    if (time - lastSoilTransitionUploadAt >= 80 && (environmentState.isRaining || plotStates.some((plot) => Number.isFinite(plot.waterVisualStartedAt) || (Number.isFinite(plot.waterStartedAt) && Number.isFinite(plot.waterUntil) && plot.waterUntil > Date.now())))) {
      lastSoilTransitionUploadAt = time;
      uploadWorld(time);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    updateDroneFrame(time);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(locations.color);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(locations.opacity);
    gl.vertexAttrib1f(locations.opacity, 1);
    const horizontal = Math.cos(pitch) * distance;
    const eye = cameraMode === '2d' ? [targetX, topDownHeight, targetZ] : [targetX + Math.sin(yaw) * horizontal, Math.sin(pitch) * distance, targetZ + Math.cos(yaw) * horizontal];
    currentProjection = perspective(Math.PI / 4, canvas.width / Math.max(canvas.height, 1), 0.1, 100);
    currentView = cameraMode === '2d' ? lookAt(eye, [targetX, 0, targetZ], [0, 0, -1]) : lookAt(eye, [targetX, 0, targetZ], [0, 1, 0]);
    gl.uniformMatrix4fv(locations.projection, false, currentProjection);
    gl.uniformMatrix4fv(locations.view, false, currentView);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectPositionBuffer);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectColorBuffer);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectOpacityBuffer);
    gl.enableVertexAttribArray(locations.opacity);
    gl.vertexAttribPointer(locations.opacity, 1, gl.FLOAT, false, 0, 0);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, effectVertexCount);
    gl.depthMask(true);
    gl.disableVertexAttribArray(locations.opacity);
    gl.vertexAttrib1f(locations.opacity, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, dronePositionBuffer);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, droneColorBuffer);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, droneVertexCount);
    requestAnimationFrame(draw);
  }

  window.addEventListener('garden-menu-wheel-open', (event) => {
    const pointerId = event.detail?.pointerId;
    if (pointerId === undefined) return;
    clearTimeout(emptyTouchRotateTimer);
    clearTimeout(plotPressTimer);
    clearTimeout(dockPressTimer);
    dragging = false;
    rotateHoldGesture = false;
    pointerMoved = true;
    clearPointerHoldRings();
    activePointerFeedback.delete(pointerId);
    touchPoints.delete(pointerId);
  });
  window.addEventListener('garden-camera-rotate-start', (event) => {
    dragging = true; rotateHoldGesture = true; pointerMoved = true;
    lastPointerX = event.detail?.clientX ?? lastPointerX;
    lastPointerY = event.detail?.clientY ?? lastPointerY;
  });
  window.addEventListener('garden-camera-rotate-end', () => { rotateHoldGesture = false; });
  canvas.addEventListener('pointerdown', (event) => {
    beginPointerFeedback(event);
    plotWasInMoveModeAtPointerDown = false;
    dockWasInMoveModeAtPointerDown = false;
    if (event.pointerType === 'touch') {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size === 2) {
        clearTimeout(emptyTouchRotateTimer);
        rotateHoldGesture = false;
        clearPointerHoldRings();
        pinchActive = true;
        suppressTouchTap = true;
        const points = [...touchPoints.values()];
        pinchStartDistance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
        pinchStartZoom = currentZoom();
        clearTimeout(plotPressTimer);
        clearTimeout(dockPressTimer);
        dragging = false;
        dragPlotIndex = null;
        dragPreview = null;
        dragDock = false;
        dockHitAtPointer = null;
        heightDrag = null;
        plotPressIndex = null;
        pointerPlotIndex = null;
        dockPreview = null;
        uploadWorld();
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      if (suppressTouchTap) {
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    clearTimeout(plotPressTimer);
    clearTimeout(emptyTouchRotateTimer);
    rotateHoldGesture = false;
    dragging = true;
    pointerMoved = false;
    dragPreview = null;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    dockHitAtPointer = findDockAt(event.clientX, event.clientY);
    dragDock = false;
    dockPressReady = false;
    dockPreview = null;
    if (dockHitAtPointer !== null) {
      const pressedDock = dockHitAtPointer;
      if (heightEdit?.kind === 'dock' && heightEdit.index === pressedDock && heightEdit.mode === 'height') {
        const [x, z] = getDockPosition(pressedDock); const baseY = 1.36 + getDockHeight(pressedDock);
        const low = projectPoint([x, baseY, z]), high = projectPoint([x, baseY + 1, z]);
        heightDrag = { kind: 'dock', index: pressedDock, startY: event.clientY, original: getDockHeight(pressedDock), pixelStep: low && high ? Math.max(1, Math.abs(high.y - low.y)) : 48 };
      } else if (heightEdit?.kind === 'dock' && heightEdit.index === pressedDock && heightEdit.mode === 'move') {
        dockWasInMoveModeAtPointerDown = true;
        dockPressReady = true;
        dragDock = true;
        const worldPoint = screenToGround(pointerStartX, pointerStartY, 1.36 + getDockHeight(pressedDock));
        const [dockX, dockZ] = getDockPosition(pressedDock);
        dockDragOffset = worldPoint ? [dockX - worldPoint[0], dockZ - worldPoint[1]] : [0, 0];
        dockPreview = { index: pressedDock, x: dockX, z: dockZ, y: getDockHeight(pressedDock) };
        uploadWorld();
      } else dockPressTimer = setTimeout(() => {
        if (!dragging || dockHitAtPointer !== pressedDock) return;
        dragDock = dockPressReady = true;
        const worldPoint = screenToGround(pointerStartX, pointerStartY, 1.36 + getDockHeight(pressedDock));
        const [dockX, dockZ] = getDockPosition(pressedDock);
        dockDragOffset = worldPoint ? [dockX - worldPoint[0], dockZ - worldPoint[1]] : [0, 0];
        dockPreview = { index: pressedDock, x: dockX, z: dockZ, y: getDockHeight(pressedDock) };
        uploadWorld();
      }, 500);
    }
    pointerPlotIndex = galleryMode || dockHitAtPointer !== null ? null : findPlotAt(event.clientX, event.clientY);
    plotPressIndex = pointerPlotIndex;
    plotPressReady = false;
    dragPlotIndex = null;
    if (plotPressIndex !== null) {
      const pressedPlot = plotPressIndex;
      if (heightEdit?.kind === 'plot' && heightEdit.index === pressedPlot && heightEdit.mode === 'height') {
        const [x, z] = getPlotPosition(pressedPlot); const baseY = getPlotHeight(pressedPlot) + 0.08;
        const low = projectPoint([x, baseY, z]), high = projectPoint([x, baseY + 0.5, z]);
        heightDrag = { kind: 'plot', index: pressedPlot, startY: event.clientY, original: getPlotHeight(pressedPlot), pixelStep: low && high ? Math.max(1, Math.abs(high.y - low.y)) : 48 };
      } else if (heightEdit?.kind === 'plot' && heightEdit.index === pressedPlot && heightEdit.mode === 'move') {
        plotWasInMoveModeAtPointerDown = true;
        plotPressReady = true;
        dragPlotIndex = pressedPlot;
        const worldPoint = screenToGround(pointerStartX, pointerStartY, getPlotHeight(pressedPlot) + 0.08);
        const [plotX, plotZ] = getPlotPosition(pressedPlot);
        dragOffset = worldPoint ? [plotX - worldPoint[0], plotZ - worldPoint[1]] : [0, 0];
        dragPreview = { index: pressedPlot, x: plotX, z: plotZ };
        uploadWorld();
      } else plotPressTimer = setTimeout(() => {
        if (!dragging || plotPressIndex !== pressedPlot) return;
        plotPressReady = true;
        dragPlotIndex = pressedPlot;
        window.onSkyPlotSelect?.(pressedPlot);
        selectedPlotIndex = pressedPlot;
        const worldPoint = screenToGround(pointerStartX, pointerStartY, getPlotHeight(pressedPlot) + 0.08);
        const [plotX, plotZ] = getPlotPosition(pressedPlot);
        dragOffset = worldPoint ? [plotX - worldPoint[0], plotZ - worldPoint[1]] : [0, 0];
        dragPreview = { index: pressedPlot, x: plotX, z: plotZ };
        uploadWorld();
      }, 500);
    }
    if (pointerPlotIndex === null && dockHitAtPointer === null) {
      rotateHoldGesture = false;
      const pressPointerId = event.pointerId;
      const isTouchPointer = event.pointerType === 'touch';
      emptyTouchRotateTimer = setTimeout(() => {
        const singleTouchStillHeld = !isTouchPointer || (touchPoints.has(pressPointerId) && touchPoints.size === 1);
        if (!dragging || !singleTouchStillHeld || pointerMoved
          || pointerPlotIndex !== null || dockHitAtPointer !== null) return;
        if (galleryMode) {
          // In the encyclopedia, hold first, then drag to rotate the flower preview.
          // Do not open the garden's radial menu or start rotation before the hold threshold.
          rotateHoldGesture = true;
          pointerMoved = true;
          lastPointerX = pointerStartX;
          lastPointerY = pointerStartY;
          canvas.dataset.rotateHoldActive = 'true';
          clearPointerHoldRings();
          return;
        }
        window.gardenMenuWheel?.openAt?.(pointerStartX, pointerStartY, pressPointerId);
      }, 500);
    }
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    updatePointerFeedback(event);
    if (event.pointerType === 'touch' && touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchActive && touchPoints.size >= 2) {
        const points = [...touchPoints.values()];
        const span = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
        applyZoom(pinchStartZoom * pinchStartDistance / span);
        return;
      }
      if (suppressTouchTap) return;
    }
    if (!dragging) return;
    if (!pointerMoved && Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) < 5) return;
    pointerMoved = true;
    if (!rotateHoldGesture) clearTimeout(emptyTouchRotateTimer);
    if (heightDrag) {
      const stepCount = Math.round((heightDrag.startY - event.clientY) / heightDrag.pixelStep);
      const value = heightDrag.kind === 'plot'
        ? (Math.round(heightDrag.original * 2) + stepCount) / 2
        : heightDrag.original + stepCount;
      if (heightDrag.kind === 'plot') {
        plotPositions[heightDrag.index] = { ...plotPositions[heightDrag.index], y: value };
      } else {
        const target = heightDrag.index === 0 ? dockPosition : droneDocks[heightDrag.index];
        if (target) target.y = value;
      }
      uploadWorld();
      lastPointerX = event.clientX; lastPointerY = event.clientY;
      return;
    }
    if (dockHitAtPointer !== null && !dragDock) {
      clearTimeout(dockPressTimer);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      return;
    }
    if (plotPressIndex !== null && !plotPressReady) {
      clearTimeout(plotPressTimer);
      plotPressIndex = null;
    }
    if (dragDock) {
      const worldPoint = screenToGround(event.clientX, event.clientY, 1.36 + getDockHeight(dockHitAtPointer));
      if (worldPoint) {
        dockPreview = { ...dockPreview, index: dockHitAtPointer, x: Math.round(worldPoint[0] + dockDragOffset[0]), z: Math.round(worldPoint[1] + dockDragOffset[1]) };
        uploadWorld();
      }
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      return;
    }
    if (dockHitAtPointer !== null) {
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      return;
    }
    if (dragPlotIndex !== null) {
      const worldPoint = screenToGround(event.clientX, event.clientY, getPlotHeight(dragPlotIndex) + 0.08);
      if (worldPoint) {
        dragPreview = { index: dragPlotIndex, x: Math.round(worldPoint[0] + dragOffset[0]), z: Math.round(worldPoint[1] + dragOffset[1]) };
        uploadWorld();
      }
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      return;
    }
    const deltaX = event.clientX - lastPointerX;
    const deltaY = event.clientY - lastPointerY;
    if (rotateHoldGesture) {
      if (cameraMode !== '2d') {
        yaw -= deltaX * 0.008;
        pitch = Math.max(0.18, Math.min(1.28, pitch + deltaY * 0.006));
      }
    } else if (cameraMode === '2d') {
      const panScale = topDownHeight / 12 * 0.012;
      targetX -= deltaX * panScale;
      targetZ -= deltaY * panScale;
    } else {
      const forwardX = -Math.sin(yaw);
      const forwardZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const panScale = 0.008;
      targetX -= rightX * deltaX * panScale - forwardX * deltaY * panScale;
      targetZ -= rightZ * deltaX * panScale - forwardZ * deltaY * panScale;
    }
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    endPointerFeedback(event);
    if (event.pointerType === 'touch') touchPoints.delete(event.pointerId);
    if (galleryMode && canvas.dataset.rotateHoldActive === 'true') {
      delete canvas.dataset.rotateHoldActive;
      rotateHoldGesture = false;
    }
    if (suppressTouchTap) {
      clearTimeout(emptyTouchRotateTimer);
      rotateHoldGesture = false;
      pinchActive = false;
      dragging = false;
      clearTimeout(plotPressTimer);
      clearTimeout(dockPressTimer);
      dragPlotIndex = null;
      dragPreview = null;
      dragDock = false;
      dockHitAtPointer = null;
      dockPreview = null;
      pointerPlotIndex = null;
      plotPressIndex = null;
      plotPressReady = false;
      dockPressReady = false;
      dockWasInMoveModeAtPointerDown = false;
      heightDrag = null;
      if (touchPoints.size === 0) suppressTouchTap = false;
      uploadWorld();
      return;
    }
    dragging = false;
    clearTimeout(plotPressTimer);
    clearTimeout(dockPressTimer);
    const heldWithoutDragging = plotPressReady && plotPressIndex !== null && !pointerMoved && !plotWasInMoveModeAtPointerDown;
    if (dockHitAtPointer !== null) {
      if (heightDrag?.kind === 'dock' && pointerMoved) {
        const accepted = window.onSkyDockHeightChange?.(heightDrag.index, getDockHeight(heightDrag.index));
        heightEdit = { kind: 'dock', index: heightDrag.index, mode: 'height' };
        if (!accepted) uploadWorld();
      } else if (dragDock && dockPressReady && pointerMoved && dockPreview) {
        const preview = dockPreview;
        const accepted = window.onSkyDockMove?.(preview.x, preview.z, preview.index);
        heightEdit = { kind: 'dock', index: preview.index, mode: 'move' };
        dockPreview = null;
        if (!accepted) uploadWorld();
      }
      // Match plot behavior: a long press enters move mode; a short press on the selected object toggles modes.
      if (dockPressReady && !pointerMoved && !dockWasInMoveModeAtPointerDown) {
        heightEdit = { kind: 'dock', index: dockHitAtPointer, mode: 'move' };
        window.onSkyHeightEditMode?.('dock', dockHitAtPointer, 'move');
      } else if (!pointerMoved && heightEdit?.kind === 'dock' && heightEdit.index === dockHitAtPointer) {
        heightEdit.mode = heightEdit.mode === 'height' ? 'move' : 'height';
        window.onSkyHeightEditMode?.('dock', dockHitAtPointer, heightEdit.mode);
      }
      if (!pointerMoved && !dockPressReady && heightEdit && (heightEdit.kind !== 'dock' || heightEdit.index !== dockHitAtPointer)) {
        heightEdit = null; window.onSkyHeightEditMode?.('exit');
      }
      dockSelected = true;
      selectedPlotIndex = null;
      window.skyWorld?.setSelectedPlot(null);
      window.onSkyDockSelect?.(dockHitAtPointer);
      uploadWorld();
    } else if (heightDrag?.kind === 'plot' && pointerMoved) {
      const accepted = window.onSkyLandHeightChange?.(heightDrag.index, getPlotHeight(heightDrag.index));
      heightEdit = { kind: 'plot', index: heightDrag.index, mode: 'height' };
      if (!accepted) uploadWorld();
    } else if (dragPlotIndex !== null && pointerMoved && dragPreview) {
      const preview = dragPreview;
      const accepted = window.onSkyLandMove?.(preview.index, preview.x, preview.z);
      heightEdit = { kind: 'plot', index: preview.index, mode: 'move' };
      dragPreview = null;
      if (!accepted) uploadWorld();
      dockSelected = false;
    } else if (heldWithoutDragging) {
      heightEdit = { kind: 'plot', index: plotPressIndex, mode: 'move' };
      window.onSkyHeightEditMode?.('plot', plotPressIndex, 'move');
    } else if (!pointerMoved && heightEdit?.kind === 'plot' && heightEdit.index === plotPressIndex) {
      heightEdit.mode = heightEdit.mode === 'height' ? 'move' : 'height';
      window.onSkyHeightEditMode?.('plot', plotPressIndex, heightEdit.mode);
    } else if (!pointerMoved) {
      if (heightEdit) window.onSkyHeightEditMode?.('exit');
      heightEdit = null;
      dockSelected = false;
      pickPlot(event.clientX, event.clientY);
      uploadWorld();
    }
    dragPlotIndex = null;
    heightDrag = null;
    dragDock = false;
    dockHitAtPointer = null;
    pointerPlotIndex = null;
    plotPressIndex = null;
    plotPressReady = false;
    dockPressReady = false;
    dockWasInMoveModeAtPointerDown = false;
    dockPreview = null;
    dragPreview = null;
    clearTimeout(emptyTouchRotateTimer);
    rotateHoldGesture = false;
    uploadWorld();
  });
  canvas.addEventListener('pointercancel', (event) => { cancelPointerFeedback(event); if (event.pointerType === 'touch') touchPoints.delete(event.pointerId); if (touchPoints.size === 0) { pinchActive = false; suppressTouchTap = false; } clearTimeout(emptyTouchRotateTimer); rotateHoldGesture = false; clearTimeout(plotPressTimer); clearTimeout(dockPressTimer); dragging = false; dragPlotIndex = null; dragPreview = null; dragDock = false; dockHitAtPointer = null; dockPreview = null; pointerPlotIndex = null; plotPressIndex = null; plotPressReady = false; dockPressReady = false; dockWasInMoveModeAtPointerDown = false; uploadWorld(); });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (cameraMode === '2d') topDownHeight = Math.max(3, Math.min(50, topDownHeight + event.deltaY * 0.02));
    else distance = Math.max(1.5, Math.min(24, distance + event.deltaY * 0.004));
  }, { passive: false });
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (!['w', 'a', 's', 'd'].includes(key) || galleryMode) return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (heightEdit?.kind === 'plot') {
      event.preventDefault();
      if (event.repeat || !Number.isInteger(heightEdit.index) || heightEdit.index < 0 || heightEdit.index >= landCount) return;
      const index = heightEdit.index;
      if (heightEdit.mode === 'move') {
        const [x, z] = getPlotPosition(index);
        const offsets = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
        const [dx, dz] = offsets[key];
        window.onSkyLandMove?.(index, x + dx, z + dz);
      } else if (key === 'w' || key === 's') {
        const nextHeight = getPlotHeight(index) + (key === 'w' ? 0.5 : -0.5);
        window.onSkyLandHeightChange?.(index, Math.round(nextHeight * 2) / 2);
      }
      return;
    }
    if (!event.repeat) keys.add(key);
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  uploadWorld();
  frame.classList.add('is-ready');
  function startDroneAnimation(droneIndex, kind, target, options) {
    if (!Number.isInteger(droneIndex) || droneIndex < 0 || droneIndex >= droneCount || droneDocks[droneIndex]?.deployed === false) return false;
    const state = droneStates[droneIndex];
    if (state.animation && !(state.animation.workCompleted && state.animation.returning === true)) return false;
    const dock = droneDocks[droneIndex] || dockPosition;
    const idlePosition = { x: dock.x, z: dock.z };
    const idleY = DRONE_IDLE_Y + (dock.y || 0);
    const start = state.location.slice();
    const continueAtTarget = Number.isInteger(options.targetPlotIndex)
      && state.lastCompletedPlotIndex === options.targetPlotIndex
      && Math.hypot(start[0] - target[0], start[1] - target[1]) < 0.0001;
    const returnGoal = [idlePosition.x, idlePosition.z];
    state.animation = {
      kind, target, start, startY: state.y, continueAtTarget,
      idleY, workY: Number.isFinite(options.workY) ? options.workY : DRONE_WORK_Y,
      targetPlotIndex: options.targetPlotIndex,
      idlePosition, elapsed: 0, returning: undefined, departed: false,
      laneY: DRONE_TRANSIT_Y + droneIndex * DRONE_LANE_SPACING,
      outboundRoute: findDroneRoute(start, target, droneIndex),
      returnRoute: findDroneRoute(target, returnGoal, droneIndex),
      ...options,
    };
    return true;
  }
  window.skyWorld = {
    animatePlant(index, onDeparture, onComplete, shouldReturn, droneIndex = 0, onReturnComplete) {
      if (!Number.isInteger(index) || index < 0 || index >= landCount) return false;
      const [targetX, targetZ] = getPlotPosition(index);
      return startDroneAnimation(droneIndex, 'plant', [targetX, targetZ], { hoverDuration: 500, targetPlotIndex: index, workY: 0.14 + getPlotHeight(index), onDeparture, onComplete, shouldReturn, onReturnComplete });
    },
    animateHarvest(index, onDeparture, onComplete, shouldReturn, droneIndex = 0, onReturnComplete) {
      if (!Number.isInteger(index) || index < 0 || index >= landCount) return false;
      const [targetX, targetZ] = getPlotPosition(index);
      const plot = plotStates[index];
      const flowerHeight = window.flowerCatalog?.[plot?.crop]?.height || 0.5;
      const plantHeight = Number.isFinite(plot?.plantHeight) ? plot.plantHeight : 1;
      const harvestY = getPlotHeight(index) + flowerHeight * plantHeight + 0.12;
      return startDroneAnimation(droneIndex, 'harvest', [targetX, targetZ], { hoverDuration: 500, targetPlotIndex: index, workY: harvestY, onDeparture, onComplete, shouldReturn, onReturnComplete });
    },
    animateWater(index, onDeparture, onComplete, shouldReturn, droneIndex = 0, onReturnComplete, onWorkStart) {
      if (!Number.isInteger(index) || index < 0 || index >= landCount) return false;
      const [targetX, targetZ] = getPlotPosition(index);
      return startDroneAnimation(droneIndex, 'water', [targetX, targetZ], { hoverDuration: 1680, targetPlotIndex: index, workY: DRONE_WORK_Y + getPlotHeight(index), onDeparture, onComplete, shouldReturn, onReturnComplete, onWorkStart });
    },
    animateExpansion(position, onDeparture, onComplete, shouldReturn, droneIndex = 0, onReturnComplete) {
      const fallback = getPlotPosition(landCount, landCount + 1);
      const targetX = Number.isInteger(position?.x) ? position.x : fallback[0];
      const targetZ = Number.isInteger(position?.z) ? position.z : fallback[1];
      return startDroneAnimation(droneIndex, 'expand', [targetX, targetZ], { hoverDuration: 700, onDeparture, onComplete, shouldReturn, onReturnComplete });
    },
    setPlotPositions(positions) {
      if (!Array.isArray(positions) || !positions.length || positions.some((position) => !Number.isInteger(position.x) || !Number.isInteger(position.z) || (position.y !== undefined && (!Number.isFinite(position.y) || Math.abs(position.y * 2 - Math.round(position.y * 2)) > 1e-8)))) return;
      const changed = positions.length !== plotPositions.length || positions.some((position, index) => position.x !== plotPositions[index]?.x || position.z !== plotPositions[index]?.z || (position.y || 0) !== (plotPositions[index]?.y || 0));
      if (!changed) return;
      plotPositions = positions.map(({ x, z, y = 0 }) => ({ x, z, y }));
      landCount = plotPositions.length;
      uploadWorld();
    },
    setPowerSaveMode(enabled) {
      const next = Boolean(enabled);
      if (powerSaveMode === next) return;
      powerSaveMode = next;
      if (isRenderingPaused()) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      } else {
        previousTime = 0;
        uploadWorld();
      }
    },
    setRenderingPaused,
    setLandCount(count) {
      if (Number.isFinite(count) && count > 0 && count !== landCount) {
        landCount = count;
        uploadWorld();
      }
    },
    setPlots(plots) {
      if (!Array.isArray(plots)) return;
      plotStates = plots.map((plot) => ({
        crop: plot.crop, plantedAt: plot.plantedAt, plantHeight: plot.plantHeight, customColor: plot.customColor,
        elapsed: plot.elapsed, growTime: plot.growTime, waterStartedAt: plot.waterStartedAt, waterUntil: plot.waterUntil,
        waterWetnessStart: plot.waterWetnessStart, waterVisualStartedAt: plot.waterVisualStartedAt,
        manual: plot.manual === true, grassOnly: plot.grassOnly === true,
        plants: Array.isArray(plot.plants) ? plot.plants.map((plant) => ({ ...plant })) : undefined,
      }));
      uploadWorld();
    },
    setEnvironment(state) {
      if (!state || typeof state.isRaining !== 'boolean') return;
      const rainChanged = environmentState.isRaining !== state.isRaining;
      if (rainChanged) rainStartedAt = state.isRaining ? Date.now() : null;
      const phaseChanged = environmentState.phase !== state.phase;
      const cycle = window.skyEnvironment?.DAY_CYCLE_MS || 16 * 60_000;
      const cycleTime = Number.isFinite(state.worldTimeMs) ? ((state.worldTimeMs % cycle) + cycle) % cycle : 0;
      const daylightProgress = Number.isFinite(state.daylightProgress)
        ? state.daylightProgress
        : Math.max(0, Math.min(1, (Number.isFinite(state.lightLevel) ? state.lightLevel : 1) - 0.18) / 0.82);
      const sunflowerProgress = Math.min(1, cycleTime / (10 * 60_000));
      const sunflowerYaw = cycleTime <= 10 * 60_000 ? 0.08 * (1 - Math.cos(sunflowerProgress * Math.PI * 2)) / 2 : 0;
      const sunflowerTurnChanged = Math.abs(sunflowerYaw - environmentState.sunflowerYaw) >= 0.0005;
      const rainBlend = Number.isFinite(state.rainBlend) ? Math.max(0, Math.min(1, state.rainBlend)) : (state.isRaining ? 1 : 0);
      environmentState = {
        phase: state.phase || 'day',
        isDay: state.isDay === true,
        isRaining: state.isRaining,
        rainBlend,
        daylightProgress,
        phaseProgress: Number.isFinite(state.phaseProgress) ? state.phaseProgress : 0,
        lightLevel: Number.isFinite(state.lightLevel) ? state.lightLevel : 1,
        sunflowerYaw,
      };
      frame.classList.toggle('is-raining', rainBlend > 0);
      frame.style.setProperty('--rain-blend', String(rainBlend));
      for (const phase of ['dawn', 'day', 'dusk', 'night']) frame.classList.toggle(`is-${phase}`, environmentState.phase === phase);
      const background = getSkyGradient(environmentState);
      if (background !== environmentBackground) {
        frame.style.background = background;
        environmentBackground = background;
      }
      canvas.style.filter = `brightness(${0.84 + environmentState.lightLevel * 0.16})`;
      // Keep gameplay rain state separate from its five-second visual blend.
      if (rainChanged || phaseChanged || sunflowerTurnChanged) uploadWorld();
    },
    selectGalleryFlower(index, customColor = null) {
      if (!galleryMode || !Number.isInteger(index) || index < 0 || index >= window.flowerCatalog.length) return false;
      galleryFlowerIndex = index;
      plotStates = [{ crop: galleryFlowerIndex, plantedAt: 0, elapsed: 1, growTime: 1, plantHeight: 1, customColor }];
      uploadWorld();
      return true;
    },
    setSelectedPlot(index) {
      if (index === null && selectedPlotIndex !== null) {
        selectedPlotIndex = null;
        uploadWorld();
        return;
      }
      if (!Number.isInteger(index) || index < 0 || index >= landCount || selectedPlotIndex === index) return;
      selectedPlotIndex = index;
      dockSelected = false;
      uploadWorld();
    },
    setDockPosition(position) {
      if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return;
      if (position.x === dockPosition.x && position.z === dockPosition.z && (position.y || 0) === (dockPosition.y || 0)) return;
      dockPosition = { x: position.x, z: position.z, y: position.y || 0 };
      if (droneDocks.length) droneDocks[0] = dockPosition;
      if (!droneStates[0].animation) droneStates[0].location = [dockPosition.x, dockPosition.z];
      uploadWorld();
    },
    setDroneCount(count) {
      if (!Number.isInteger(count) || count < 1 || count > 8 || count === droneCount) return;
      droneCount = count;
    },
    setDroneDocks(docks) {
      if (!Array.isArray(docks) || !docks.length || docks.some((dock) => !Number.isFinite(dock?.x) || !Number.isFinite(dock?.z))) return;
      const unchanged = docks.length === droneDocks.length && docks.every((dock, index) => dock.x === droneDocks[index]?.x && dock.z === droneDocks[index]?.z && (dock.y || 0) === (droneDocks[index]?.y || 0) && (dock.deployed !== false) === (droneDocks[index]?.deployed !== false) && dock.deploymentOrder === droneDocks[index]?.deploymentOrder && Math.abs((dock.battery ?? 100) - (droneDocks[index]?.battery ?? 100)) < 0.001);
      if (unchanged) return;
      const dockPositionsChanged = docks.map((dock, index) => {
        const previous = droneDocks[index];
        return !previous || Math.abs(dock.x - previous.x) > 0.0001 || Math.abs(dock.z - previous.z) > 0.0001;
      });
      droneDocks = docks.map(({ x, z, y = 0, deployed, deploymentOrder, battery }) => ({ x, z, y, deployed: deployed !== false, deploymentOrder, battery: Math.max(0, Math.min(100, battery ?? 100)) }));
      droneDocks[0] = { ...droneDocks[0], ...dockPosition };
      droneDocks.forEach((dock, index) => {
        const animation = droneStates[index]?.animation;
        if (!animation) droneStates[index].location = [dock.x, dock.z];
        else if (dockPositionsChanged[index]) {
          // Battery/deployment updates arrive frequently; they must not replace an in-flight route.
          animation.idlePosition = { x: dock.x, z: dock.z };
          if (animation.returning) animation.returnRoute = findDroneRoute(animation.target, [dock.x, dock.z], index);
        }
      });
      uploadWorld();
    },
  };
  requestAnimationFrame(draw);
})();


(() => {
  const wheel = document.querySelector('#garden-menu-wheel');
  const frame = document.querySelector('.world-frame');
  if (!wheel || !frame) return;
  const actions = ['drone', 'farm', 'settings', 'catalog', 'collapse', 'rotate'];
  const selectionAngles = [-90, -30, 30, 90, 150, 210];
  const labels = { drone: '#drone-panel-toggle', farm: '#farm-management-toggle', settings: '#settings-toggle', catalog: '.encyclopedia-link', collapse: '#hud-toggle' };
  let pointerId = null, rotationPointerId = null, origin = null, selected = null, rotationActive = false;
  function closeWheel() {
    wheel.hidden = true; wheel.classList.remove('is-active');
    wheel.querySelectorAll('button').forEach((button) => button.classList.remove('is-selected'));
    pointerId = null; origin = null; selected = null;
  }
  function setRotationActive(enabled, event = null) {
    rotationActive = enabled;
    const button = wheel.querySelector('[data-wheel-action="rotate"]');
    if (button) {
      button.classList.toggle('is-mode-active', enabled);
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', enabled ? '旋轉中，放開即可退出' : '旋轉');
    }
    window.dispatchEvent(new CustomEvent(enabled ? 'garden-camera-rotate-start' : 'garden-camera-rotate-end', {
      detail: { pointerId: rotationPointerId, clientX: event?.clientX, clientY: event?.clientY },
    }));
  }
  function chooseAt(x, y) {
    if (!origin) return;
    const dx = x - origin.x, dy = y - origin.y;
    if (Math.hypot(dx, dy) < 22) selected = null;
    else {
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      let best = 0, distance = Infinity;
      selectionAngles.forEach((center, index) => {
        const delta = Math.abs(((angle - center + 540) % 360) - 180);
        if (delta < distance) { distance = delta; best = index; }
      });
      selected = actions[best];
    }
    wheel.querySelectorAll('[data-wheel-action]').forEach((button) => button.classList.toggle('is-selected', button.dataset.wheelAction === selected));
  }
  function runAction(action) {
    closeWheel();
    if (action === 'rotate') return;
    document.querySelector(labels[action] || '')?.click();
  }
  wheel.querySelectorAll('[data-wheel-action]').forEach((button, index) => {
    button.style.setProperty('--wheel-angle', `${index * 60}deg`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => runAction(button.dataset.wheelAction));
  });
  wheel.querySelectorAll('[data-wheel-icon]').forEach((icon) => {
    const index = actions.indexOf(icon.dataset.wheelIcon);
    if (index >= 0) icon.style.setProperty('--wheel-angle', `${index * 60}deg`);
  });
  window.gardenMenuWheel = {
    isOpen: () => !wheel.hidden,
    openAt(clientX, clientY, id) {
      if (!wheel.hidden || document.querySelector('dialog[open]')) return false;
      const rect = frame.getBoundingClientRect(), margin = 116;
      wheel.style.left = `${Math.max(margin, Math.min(rect.width - margin, clientX - rect.left))}px`;
      wheel.style.top = `${Math.max(margin, Math.min(rect.height - margin, clientY - rect.top))}px`;
      const collapseItem = wheel.querySelector('[data-wheel-action="collapse"]');
      const collapseIcon = wheel.querySelector('[data-wheel-icon="collapse"] img');
      const isCollapsed = document.querySelector('#hud-toggle')?.getAttribute('aria-expanded') === 'false';
      if (collapseItem) {
        collapseItem.setAttribute('aria-label', isCollapsed ? '展開介面' : '收合介面');
      }
      if (collapseIcon) {
        collapseIcon.src = isCollapsed ? 'assets/btn/展開.png' : 'assets/btn/收合.png';
      }
      wheel.hidden = false; wheel.classList.add('is-active');
      pointerId = id; origin = { x: clientX, y: clientY }; selected = null;
      window.dispatchEvent(new CustomEvent('garden-menu-wheel-open', { detail: { pointerId: id } }));
      return true;
    },
  };
  document.addEventListener('pointermove', (event) => {
    if (rotationActive && event.pointerId === rotationPointerId) return;
    if (wheel.hidden || event.pointerId !== pointerId) return;
    event.preventDefault(); chooseAt(event.clientX, event.clientY);
    if (selected === 'rotate') {
      rotationPointerId = event.pointerId; closeWheel(); setRotationActive(true, event); return;
    }
    event.stopPropagation();
  }, true);
  document.addEventListener('pointerup', (event) => {
    if (rotationActive && event.pointerId === rotationPointerId) {
      setRotationActive(false, event); rotationPointerId = null; return;
    }
    if (wheel.hidden || event.pointerId !== pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const action = selected; closeWheel(); if (action) runAction(action);
  }, true);
  document.addEventListener('pointercancel', (event) => {
    if (rotationActive && event.pointerId === rotationPointerId) {
      setRotationActive(false, event); rotationPointerId = null; return;
    }
    if (wheel.hidden || event.pointerId !== pointerId) return;
    event.stopPropagation(); closeWheel();
  }, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !wheel.hidden) closeWheel(); });
})();
