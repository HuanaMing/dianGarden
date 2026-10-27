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
    attribute vec3 aNormal;
    attribute float aOpacity;
    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform vec3 uEyeDir;
    uniform vec3 uSunDir;
    uniform vec3 uAmbient;
    uniform vec3 uSunColor;
    uniform vec3 uDroneLightPos[8];
    uniform float uDroneLightStrength[8];
    uniform float uDroneSelfIllumination;
    varying vec3 vColor;
    varying float vOpacity;
    void main() {
      gl_Position = uProjection * uView * vec4(aPosition, 1.0);
      vec3 n = normalize(aNormal);
      if (dot(n, uEyeDir) < 0.0) n = -n;
      float ndl = max(dot(n, normalize(uSunDir)), 0.0);
      vec3 lighting = uAmbient + uSunColor * ndl;
      for (int i = 0; i < 8; i++) {
        vec3 toDroneLight = uDroneLightPos[i] - aPosition;
        float lightDistance = length(toDroneLight);
        if (lightDistance < 3.2 && uDroneLightStrength[i] > 0.0) {
          vec3 lightDirection = normalize(toDroneLight);
          float diffuse = max(dot(n, lightDirection), 0.0);
          float attenuation = 1.0 - smoothstep(0.35, 3.2, lightDistance);
          lighting += vec3(1.0, 0.82, 0.52) * diffuse * attenuation * uDroneLightStrength[i];
        }
      }
      // Keep drone bodies softly visible at night; this uniform is enabled only for the drone draw pass.
      lighting += vec3(1.0, 0.76, 0.46) * uDroneSelfIllumination;
      vColor = aColor * lighting;
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
    normal: gl.getAttribLocation(program, 'aNormal'),
    projection: gl.getUniformLocation(program, 'uProjection'),
    view: gl.getUniformLocation(program, 'uView'),
    eyeDir: gl.getUniformLocation(program, 'uEyeDir'),
    sunDir: gl.getUniformLocation(program, 'uSunDir'),
    ambient: gl.getUniformLocation(program, 'uAmbient'),
    sunColor: gl.getUniformLocation(program, 'uSunColor'),
    droneLightPos: gl.getUniformLocation(program, 'uDroneLightPos[0]'),
    droneLightStrength: gl.getUniformLocation(program, 'uDroneLightStrength[0]'),
    droneSelfIllumination: gl.getUniformLocation(program, 'uDroneSelfIllumination'),
  };
  const glowVertexSource = `
    attribute vec3 aPosition;
    attribute vec2 aUV;
    attribute float aOpacity;
    uniform mat4 uProjection;
    uniform mat4 uView;
    varying vec2 vUV;
    varying float vOpacity;
    void main() {
      gl_Position = uProjection * uView * vec4(aPosition, 1.0);
      vUV = aUV;
      vOpacity = aOpacity;
    }
  `;
  const glowFragmentSource = `
    precision highp float;
    uniform sampler2D uTex;
    uniform vec3 uTint;
    varying vec2 vUV;
    varying float vOpacity;
    void main() {
      vec4 texel = texture2D(uTex, vUV);
      gl_FragColor = vec4(texel.rgb * uTint * texel.a * vOpacity, texel.a * vOpacity);
    }
  `;
  let glowProgram = null;
  let glowTexture = null;
  let glowLocations = null;
  try {
    glowProgram = gl.createProgram();
    gl.attachShader(glowProgram, makeShader(gl.VERTEX_SHADER, glowVertexSource));
    gl.attachShader(glowProgram, makeShader(gl.FRAGMENT_SHADER, glowFragmentSource));
    gl.linkProgram(glowProgram);
    if (!gl.getProgramParameter(glowProgram, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(glowProgram) || 'glow program link failed');
    }
    glowLocations = {
      position: gl.getAttribLocation(glowProgram, 'aPosition'),
      uv: gl.getAttribLocation(glowProgram, 'aUV'),
      opacity: gl.getAttribLocation(glowProgram, 'aOpacity'),
      projection: gl.getUniformLocation(glowProgram, 'uProjection'),
      view: gl.getUniformLocation(glowProgram, 'uView'),
      texture: gl.getUniformLocation(glowProgram, 'uTex'),
      tint: gl.getUniformLocation(glowProgram, 'uTint'),
    };
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = textureCanvas.height = 128;
    const textureContext = textureCanvas.getContext('2d');
    if (!textureContext) throw new Error('glow texture canvas unavailable');
    const radius = textureCanvas.width / 2;
    // Build the glow alpha per pixel instead of relying on CanvasGradient's
    // color interpolation/premultiplication when the canvas becomes a WebGL texture.
    const imageData = textureContext.createImageData(textureCanvas.width, textureCanvas.height);
    const alphaStops = [[0, 1], [0.12, 0.55], [0.35, 0.14], [1, 0]];
    for (let y = 0; y < textureCanvas.height; y += 1) {
      for (let x = 0; x < textureCanvas.width; x += 1) {
        const distance = Math.hypot((x + 0.5 - radius) / radius, (y + 0.5 - radius) / radius);
        let alpha = 0;
        if (distance <= 1) {
          let stopIndex = 1;
          while (stopIndex < alphaStops.length - 1 && distance > alphaStops[stopIndex][0]) stopIndex += 1;
          const [start, startAlpha] = alphaStops[stopIndex - 1];
          const [end, endAlpha] = alphaStops[stopIndex];
          const t = (distance - start) / (end - start);
          alpha = startAlpha + (endAlpha - startAlpha) * t;
        }
        const offset = (y * textureCanvas.width + x) * 4;
        imageData.data[offset] = 255;
        imageData.data[offset + 1] = 255;
        imageData.data[offset + 2] = 255;
        imageData.data[offset + 3] = Math.round(alpha * 255);
      }
    }
    textureContext.putImageData(imageData, 0, 0);
    glowTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glowTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  } catch (error) {
    console.warn('Sun/moon glow disabled:', error);
    if (glowProgram) gl.deleteProgram(glowProgram);
    if (glowTexture) gl.deleteTexture(glowTexture);
    glowProgram = null;
    glowTexture = null;
    glowLocations = null;
  }

  const positionBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  const dronePositionBuffer = gl.createBuffer();
  const droneColorBuffer = gl.createBuffer();
  const effectPositionBuffer = gl.createBuffer();
  const effectColorBuffer = gl.createBuffer();
  const effectOpacityBuffer = gl.createBuffer();
  const skyPositionBuffer = gl.createBuffer();
  const skyColorBuffer = gl.createBuffer();
  const skyOpacityBuffer = gl.createBuffer();
  const skyNormalBuffer = gl.createBuffer();
  const normalBuffer = gl.createBuffer();
  const droneNormalBuffer = gl.createBuffer();
  const effectNormalBuffer = gl.createBuffer();
  // Keep the original scene buffer creation order stable for diagnostics and existing tests.
  const glowPositionBuffer = gl.createBuffer();
  const glowUVBuffer = gl.createBuffer();
  const glowOpacityBuffer = gl.createBuffer();
  const glowUVs = new Float32Array([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, glowUVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, glowUVs, gl.STATIC_DRAW);
  let vertexCount = 0;
  let droneVertexCount = 0;
  let effectVertexCount = 0;
  let skyVertexCount = 0;
  let skyGlowState = null;
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
  let environmentState = { phase: 'day', isDay: true, isRaining: false, rainBlend: 0, daylightProgress: 1, phaseProgress: 0, lightLevel: 1, sunflowerYaw: 0, worldTimeMs: 60_000 };
  let environmentBackground = '';
  const SKY_PALETTES = {
    day: ['#78c9f5', '#b8e5ff', '#e6f5ff'],
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
    return `linear-gradient(180deg, ${colors[0]} 0%, ${colors[1]} 78%, ${colors[2]} 100%)`;
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
  function getCameraPose() {
    return cameraMode === '2d'
      ? { mode: '2d', topDownHeight, targetX, targetZ, savedCameraPose: savedCameraPose && { ...savedCameraPose } }
      : { mode: '3d', yaw, pitch, distance, targetX, targetZ };
  }
  function restoreCameraPose(pose) {
    if (!pose || typeof pose !== 'object') return false;
    const finite = (value) => typeof value === 'number' && Number.isFinite(value);
    if (pose.mode === '2d' && finite(pose.topDownHeight) && finite(pose.targetX) && finite(pose.targetZ)) {
      const previous3d = pose.savedCameraPose;
      savedCameraPose = previous3d && finite(previous3d.yaw) && finite(previous3d.pitch) && finite(previous3d.distance)
        && finite(previous3d.targetX) && finite(previous3d.targetZ)
        ? { yaw: previous3d.yaw, pitch: Math.max(-70 * Math.PI / 180, Math.min(70 * Math.PI / 180, previous3d.pitch)), distance: Math.max(1.5, Math.min(24, previous3d.distance)), targetX: Math.max(-10000, Math.min(10000, previous3d.targetX)), targetZ: Math.max(-10000, Math.min(10000, previous3d.targetZ)) }
        : null;
      cameraMode = '2d';
      topDownHeight = Math.max(3, Math.min(50, pose.topDownHeight));
      targetX = Math.max(-10000, Math.min(10000, pose.targetX));
      targetZ = Math.max(-10000, Math.min(10000, pose.targetZ));
      cameraModeButton && (cameraModeButton.textContent = '返回 3D');
      cameraModeButton?.setAttribute('aria-pressed', 'true');
      return true;
    }
    if (pose.mode === '3d' && finite(pose.yaw) && finite(pose.pitch) && finite(pose.distance) && finite(pose.targetX) && finite(pose.targetZ)) {
      cameraMode = '3d';
      savedCameraPose = null;
      yaw = pose.yaw;
      pitch = Math.max(-70 * Math.PI / 180, Math.min(70 * Math.PI / 180, pose.pitch));
      distance = Math.max(1.5, Math.min(24, pose.distance));
      targetX = Math.max(-100, Math.min(100, pose.targetX));
      targetZ = Math.max(-100, Math.min(100, pose.targetZ));
      cameraModeButton && (cameraModeButton.textContent = '2D 模式');
      cameraModeButton?.setAttribute('aria-pressed', 'false');
      return true;
    }
    return false;
  }
  window.dianGardenCamera = Object.freeze({
    getState: getCameraPose,
    restore: restoreCameraPose,
  });
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
  function droneDebugLog(event, details = {}) {
    let enabled = false;
    try { enabled = localStorage.getItem('sky-garden-drone-debug-v1') === 'true'; } catch (_) {}
    if (enabled) console.warn('[花園無人機診斷]', { event, at: performance.now(), ...details });
  }

  const droneStates = Array.from({ length: 8 }, (_, index) => ({
    animation: null,
    phase: index === 0 ? 'idle' : 'docked',
    location: index === 0 ? [dockPosition.x, dockPosition.z] : [0, 0],
    y: DRONE_IDLE_Y,
    heading: 0,
  }));
  const dronePhaseTransitions = {
    docked: ['idle', 'outbound', 'working'],
    idle: ['docked', 'outbound', 'working'],
    outbound: ['working', 'returning', 'waiting_path', 'idle', 'docked'],
    working: ['outbound', 'returning', 'waiting_path', 'idle', 'docked'],
    returning: ['outbound', 'working', 'waiting_path', 'idle', 'docked'],
    waiting_path: ['returning', 'outbound', 'working', 'idle', 'docked'],
  };
  function setDronePhase(droneIndex, nextPhase, reason) {
    const state = droneStates[droneIndex];
    if (!state || state.phase === nextPhase) return Boolean(state);
    const previousPhase = state.phase || 'idle';
    if (!(dronePhaseTransitions[previousPhase] || []).includes(nextPhase)) {
      droneDebugLog('phase-transition-invalid', { droneIndex, previousPhase, nextPhase, reason });
      return false;
    }
    state.phase = nextPhase;
    droneDebugLog('phase-transition', { droneIndex, previousPhase, nextPhase, reason });
    return true;
  }
  let droneFrameTime = performance.now();

  const flowerModelRegistry = window.dianGardenFlowerModels;
  const { addFace, addTriangle, addOctahedron, addIcosahedron, addLeaf } = flowerModelRegistry.geometry;



  // Flower-specific geometry lives in src/model/ and is dispatched through the shared registry.
  function addFlowerModel(positions, colors, x, z, flowerIndex, stage, heightMultiplier = 1, customColor = null, rotation = 0) {
    const modelPositions = [];
    const modelColors = [];
    addFlowerGeometry(modelPositions, modelColors, x, z, flowerIndex, stage, customColor);
    const angle = Number.isFinite(rotation) ? rotation : 0;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    for (let i = 0; i < modelPositions.length; i += 3) {
      const offsetX = modelPositions[i] - x;
      const offsetZ = modelPositions[i + 2] - z;
      // Rotate every vertex around the root so seeds, stems, leaves, and blooms share one heading.
      positions.push(
        x + offsetX * cosine + offsetZ * sine,
        0.055 + (modelPositions[i + 1] - 0.055) * heightMultiplier,
        z - offsetX * sine + offsetZ * cosine,
      );
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
    hasPlotBelow(positions, index) {
      const source = positions?.[index];
      if (!source || !Array.isArray(positions)) return false;
      const epsilon = 1e-8;
      const sourceY = source.y || 0;
      // Any lower tile in the same vertical column blocks extension, regardless of distance or tile type.
      return positions.some((candidate, candidateIndex) => candidateIndex !== index && candidate
        && Math.abs(candidate.x - source.x) <= epsilon && Math.abs(candidate.z - source.z) <= epsilon
        && (candidate.y || 0) < sourceY - epsilon);
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
    const rampLogic = window.dianGardenGrassRampLogic;
    const hasPlotBelow = rampLogic.hasPlotBelow(plotPositions, index);
    const groupBottomY = rampLogic.getConnectedGroupBottomY(plotPositions, index, TILE, 0.5);
    // Every tile keeps its original 0.5-unit side thickness; only the bottom-most tile extends to the group base.
    const localBottomY = Math.min(y, ...edges.flatMap((edge) => edge.points.map((point) => point.y))) - 0.5;
    const bottomY = hasPlotBelow ? localBottomY : Math.min(localBottomY, groupBottomY);
    edges.forEach((edge) => {
      const first = edge.points[0], second = edge.points[1];
      const firstBottom = [first.x, bottomY, first.z], secondBottom = [second.x, bottomY, second.z];
      addTriangle(positions, colors, firstBottom, secondBottom, second.top, edge.color);
      addTriangle(positions, colors, firstBottom, second.top, first.top, edge.color);
    });
    if (!hasPlotBelow) {
      addBox(positions, colors, x - half, bottomY - 0.01, z - half, x + half, bottomY, z + half, {
        top: [0.4, 0.28, 0.24], front: [0.4, 0.28, 0.24], right: [0.4, 0.28, 0.24], back: [0.4, 0.28, 0.24], left: [0.4, 0.28, 0.24], bottom: [0.4, 0.28, 0.24],
      });
    }
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

  function addDrone(positions, colors, x, y, z, wingPhase, heading, battery = 100) {
    const firstVertex = positions.length;
    const body = { top: [0.58, 0.48, 0.31], front: [0.38, 0.33, 0.23], right: [0.31, 0.37, 0.27], back: [0.46, 0.38, 0.26], left: [0.34, 0.4, 0.29], bottom: [0.23, 0.27, 0.2] };
    const trim = { top: [0.7, 0.59, 0.39], front: [0.52, 0.43, 0.31], right: [0.44, 0.48, 0.33], back: [0.58, 0.48, 0.33], left: [0.46, 0.49, 0.35], bottom: [0.3, 0.33, 0.24] };
    const wood = [0.55, 0.39, 0.24], woodLight = [0.72, 0.56, 0.36];
    const glass = [0.67, 0.82, 0.67], leaf = [0.35, 0.62, 0.37], flower = [0.94, 0.88, 0.72];
    addBox(positions, colors, x - 0.105, y - 0.075, z - 0.085, x + 0.105, y + 0.075, z + 0.085, body);
    // Existing landing skids remain unchanged.
    addBox(positions, colors, x - 0.115, y - 0.105, z - 0.07, x + 0.115, y - 0.087, z - 0.045, trim);
    addBox(positions, colors, x - 0.115, y - 0.105, z + 0.045, x + 0.115, y - 0.087, z + 0.07, trim);
    addBox(positions, colors, x - 0.07, y - 0.09, z - 0.057, x - 0.052, y - 0.045, z - 0.04, trim);
    addBox(positions, colors, x + 0.052, y - 0.09, z - 0.057, x + 0.07, y - 0.045, z - 0.04, trim);
    addBox(positions, colors, x - 0.07, y - 0.09, z + 0.04, x - 0.052, y - 0.045, z + 0.057, trim);
    addBox(positions, colors, x + 0.052, y - 0.09, z + 0.04, x + 0.07, y - 0.045, z + 0.057, trim);

    // Two square botanical-glass wings. Each panel is built in the XY plane and
    // rotated around its own shoulder so the outer edge flaps vertically like a bird's wing.
    const flap = Math.sin(wingPhase * Math.PI * 4) * 0.48; // 2 complete beats per second
    const makeWing = (side) => {
      const rootX = x + side * 0.092, rootY = y + 0.055, rootZ = z;
      const start = positions.length;
      const inner = side > 0 ? rootX : rootX - 0.012;
      const outer = side > 0 ? rootX + 0.245 : rootX - 0.245;
      const low = rootY - 0.105, high = rootY + 0.105;
      // Fine wooden perimeter and central muntins.
      addBox(positions, colors, Math.min(inner, outer), low, rootZ - 0.009, Math.max(inner, outer), low + 0.012, rootZ + 0.009, { top: woodLight, front: wood, right: wood, back: woodLight, left: wood, bottom: wood });
      addBox(positions, colors, Math.min(inner, outer), high - 0.012, rootZ - 0.009, Math.max(inner, outer), high, rootZ + 0.009, { top: woodLight, front: wood, right: wood, back: woodLight, left: wood, bottom: wood });
      addBox(positions, colors, Math.min(inner, outer), low, rootZ - 0.009, Math.min(inner, outer) + 0.012, high, rootZ + 0.009, { top: woodLight, front: wood, right: wood, back: woodLight, left: wood, bottom: wood });
      addBox(positions, colors, Math.max(inner, outer) - 0.012, low, rootZ - 0.009, Math.max(inner, outer), high, rootZ + 0.009, { top: woodLight, front: wood, right: wood, back: woodLight, left: wood, bottom: wood });
      addBox(positions, colors, Math.min(inner, outer) + 0.085, low + 0.012, rootZ - 0.004, Math.min(inner, outer) + 0.091, high - 0.012, rootZ + 0.004, { top: woodLight, front: wood, right: wood, back: woodLight, left: wood, bottom: wood });
      addBox(positions, colors, Math.min(inner, outer) + 0.16, low + 0.012, rootZ - 0.004, Math.min(inner, outer) + 0.166, high - 0.012, rootZ + 0.004, { top: woodLight, front: wood, right: wood, back: woodLight, left: wood, bottom: wood });
      // Pale green glass is deliberately low-contrast to read as translucent in the stylized WebGL palette.
      const panelX0 = Math.min(inner, outer) + 0.014, panelX1 = Math.max(inner, outer) - 0.014;
      const panelY0 = low + 0.014, panelY1 = high - 0.014, panelZ = rootZ;
      addTriangle(positions, colors, [panelX0, panelY0, panelZ], [panelX1, panelY0, panelZ], [panelX1, panelY1, panelZ], glass);
      addTriangle(positions, colors, [panelX0, panelY0, panelZ], [panelX1, panelY1, panelZ], [panelX0, panelY1, panelZ], glass);
      // Simple leaf sprigs and pale blossoms on the glass.
      for (let sprig = 0; sprig < 3; sprig += 1) {
        const sx = panelX0 + 0.025 + sprig * 0.068;
        const sy = panelY0 + 0.035 + (sprig % 2) * 0.045;
        addTriangle(positions, colors, [sx, sy, panelZ + 0.003], [sx + side * 0.028, sy + 0.012, panelZ + 0.003], [sx + side * 0.012, sy + 0.03, panelZ + 0.003], leaf);
        addTriangle(positions, colors, [sx + 0.02, sy + 0.035, panelZ + 0.004], [sx + 0.035, sy + 0.055, panelZ + 0.004], [sx + 0.045, sy + 0.035, panelZ + 0.004], flower);
      }
      // Rotate every wing vertex around the shoulder, then the whole drone's heading.
      const angle = side * flap;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      for (let vertex = start; vertex < positions.length; vertex += 3) {
        const dx = positions[vertex] - rootX, dy = positions[vertex + 1] - rootY;
        positions[vertex] = rootX + dx * cosine - dy * sine;
        positions[vertex + 1] = rootY + dx * sine + dy * cosine;
      }
    };
    // Vine-wrapped shoulder struts bridge the cube to each moving wing.
    for (const side of [-1, 1]) {
      const rootX = x + side * 0.092;
      addBox(positions, colors, Math.min(x + side * 0.035, rootX), y + 0.035, z - 0.018, Math.max(x + side * 0.035, rootX) + 0.006, y + 0.055, z + 0.018, trim);
      addOctahedron(positions, colors, rootX, y + 0.055, z + 0.006, 0.018, 0.014, 0.014, leaf);
      makeWing(side);
    }
    addOctahedron(positions, colors, x, y + 0.006, z + 0.087, 0.035, 0.026, 0.015, getDroneBatteryColor(battery));
    const cosine = Math.cos(heading), sine = Math.sin(heading);
    for (let vertex = firstVertex; vertex < positions.length; vertex += 3) {
      const localX = positions[vertex] - x, localZ = positions[vertex + 2] - z;
      positions[vertex] = x + localX * cosine + localZ * sine;
      positions[vertex + 2] = z - localX * sine + localZ * cosine;
    }
  }

  // 巡航高度只在水平移動期間預約；任務結束後不保留，下一趟重新計算。
  const droneCruiseHeights = Array(8).fill(null);

  function distanceToSegment(x, z, start, goal) {
    const dx = goal[0] - start[0], dz = goal[1] - start[1];
    const lengthSquared = dx * dx + dz * dz;
    const ratio = lengthSquared > 1e-8
      ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (z - start[1]) * dz) / lengthSquared))
      : 0;
    return Math.hypot(x - (start[0] + dx * ratio), z - (start[1] + dz * ratio));
  }

  function getCruiseHeight(start, goal, droneIndex, targetPlotIndex) {
    let obstacleTop = -Infinity;
    for (let index = 0; index < landCount; index += 1) {
      if (index === targetPlotIndex) continue;
      const [x, z] = getPlotPosition(index);
      // 土地／草地以地塊外緣判斷；植物另以株位及模型高度判斷。
      if (distanceToSegment(x, z, start, goal) <= TILE * 0.71) {
        obstacleTop = Math.max(obstacleTop, getPlotHeight(index) + 0.12);
      }
      const plot = plotStates[index];
      const plants = plot?.manual === true && Array.isArray(plot.plants)
        ? plot.plants
        : plot && Number.isInteger(plot.crop) && Number.isFinite(plot.plantedAt) ? [plot] : [];
      plants.forEach((plant, plantIndex) => {
        if (!Number.isInteger(plant.crop)) return;
        const normalized = plot?.manual === true ? manualPlantCoordinate(plant.positionIndex || plantIndex + 1) : { x: 0.5, z: 0.5 };
        const plantX = x + (normalized.x - 0.5) * 0.9;
        const plantZ = z + (normalized.z - 0.5) * 0.9;
        if (distanceToSegment(plantX, plantZ, start, goal) > 0.24) return;
        const modelHeight = window.flowerCatalog?.[plant.crop]?.height || 0.5;
        const plantHeight = Number.isFinite(plant.plantHeight) ? plant.plantHeight : 1;
        obstacleTop = Math.max(obstacleTop, getPlotHeight(index) + modelHeight * plantHeight + 0.18);
      });
    }

    const clearance = 0.18;
    let height = Math.max(DRONE_TRANSIT_Y, Number.isFinite(obstacleTop) ? obstacleTop + clearance : DRONE_TRANSIT_Y);
    const reserved = droneCruiseHeights
      .filter((value, index) => index !== droneIndex && Number.isFinite(value))
      .sort((a, b) => a - b);
    while (reserved.some((value) => Math.abs(value - height) < DRONE_LANE_SPACING * 0.75)) {
      height += DRONE_LANE_SPACING;
    }
    return height;
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
    const endpointPlotIndex = (point) => plotPositions.findIndex((plot) => plot
      && Math.abs(point[0] - plot.x) <= TILE * 0.5
      && Math.abs(point[1] - plot.z) <= TILE * 0.5);
    const startPlotIndex = endpointPlotIndex(start);
    const goalPlotIndex = endpointPlotIndex(goal);
    // Side walls extend from each tile's rim down to the connected group's bottom.
    // Treat each wall-bounded tile footprint as a horizontal route obstacle, except
    // the start/destination tiles so a drone can leave and arrive at its own platform.
    const landObstacles = plotPositions.map((plot, index) => ({ x: plot.x, z: plot.z, index }))
      .filter(({ index }) => index !== startPlotIndex && index !== goalPlotIndex);
    const blocked = (point) => key(point) !== key(startGrid) && key(point) !== key(goalGrid)
      && (obstacles.some(([x, z]) => Math.hypot(point[0] * step - x, point[1] * step - z) < 0.62)
        || landObstacles.some(({ x, z }) => Math.abs(point[0] * step - x) < TILE * 0.5 + 0.12
          && Math.abs(point[1] * step - z) < TILE * 0.5 + 0.12));
    const minX = Math.floor((Math.min(startGrid[0], goalGrid[0]) * step - 3) / step);
    const maxX = Math.ceil((Math.max(startGrid[0], goalGrid[0]) * step + 3) / step);
    const minZ = Math.floor((Math.min(startGrid[1], goalGrid[1]) * step - 3) / step);
    const maxZ = Math.ceil((Math.max(startGrid[1], goalGrid[1]) * step + 3) / step);
    const heuristic = (point) => Math.hypot(goalGrid[0] - point[0], goalGrid[1] - point[1]);
    const open = [];
    const pushOpen = (node) => {
      open.push(node);
      let index = open.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (open[parent].score <= open[index].score) break;
        [open[parent], open[index]] = [open[index], open[parent]];
        index = parent;
      }
    };
    const popOpen = () => {
      const first = open[0];
      const last = open.pop();
      if (open.length) {
        open[0] = last;
        let index = 0;
        while (true) {
          const left = index * 2 + 1, right = left + 1;
          let smallest = index;
          if (left < open.length && open[left].score < open[smallest].score) smallest = left;
          if (right < open.length && open[right].score < open[smallest].score) smallest = right;
          if (smallest === index) break;
          [open[index], open[smallest]] = [open[smallest], open[index]];
          index = smallest;
        }
      }
      return first;
    };
    pushOpen({ point: startGrid, cost: 0, score: heuristic(startGrid) });
    const cameFrom = new Map();
    const costs = new Map([[key(startGrid), 0]]);
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let visited = 0;
    while (open.length && visited < 6000) {
      const current = popOpen().point;
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
        pushOpen({ point: next, cost: nextCost, score: nextCost + heuristic(next) });
      }
    }
    droneDebugLog('route-failed', { droneIndex, start: start.slice(), goal: goal.slice(), visited, droneObstacles: obstacles.length, landObstacles: landObstacles.length, fallback: 'none' });
    // A straight segment may cross land or other drones; callers must wait and retry instead.
    return null;
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
    const deferredCallbacks = [];
    const deferCallback = (callback) => { if (typeof callback === 'function') deferredCallbacks.push(callback); };
    const positions = [];
    const colors = [];
    const effectPositions = [];
    const effectColors = [];
    const effectOpacitySpans = [];
    const effectNow = Date.now();
    if (environmentState.isRaining) {
      const rainPalette = { top: [0.48, 0.69, 0.76], front: [0.36, 0.57, 0.65], right: [0.32, 0.52, 0.61], back: [0.42, 0.63, 0.7], left: [0.36, 0.57, 0.65], bottom: [0.28, 0.46, 0.54] };
      // Keep every raindrop inside a vertical cylinder of radius 3 centered on the camera.
      const rainEye = cameraMode === '2d'
        ? [targetX, topDownHeight, targetZ]
        : [
          targetX + Math.sin(yaw) * Math.cos(pitch) * distance,
          Math.sin(pitch) * distance,
          targetZ + Math.cos(yaw) * Math.cos(pitch) * distance,
        ];
      const rainRadius = 3;
      for (let drop = 0; drop < 72; drop += 1) {
        const fall = (time * 0.0014 + drop * 0.137) % 1;
        const angle = drop * 2.399963229728653 + time * 0.0004;
        const radius = rainRadius * Math.sqrt((drop * 0.61803398875) % 1);
        const x = rainEye[0] + Math.cos(angle) * radius;
        const z = rainEye[2] + Math.sin(angle) * radius;
        const rainTop = rainEye[1] + 10;
        const rainBottom = rainEye[1] - 10;
        const y = rainTop - fall * (rainTop - rainBottom);
        const dropLength = 0.22;
        const dropWidth = 0.0035;
        addBox(effectPositions, effectColors, x, y - dropLength, z, x + dropWidth, y, z + dropWidth, rainPalette);
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
        setDronePhase(index, droneDocks[index]?.deployed === false ? 'docked' : 'idle', 'idle-frame');
        return { x: idleX, y: DRONE_IDLE_Y + getDockHeight(index) + Math.sin(time * 0.0022 + index * 1.7) * DRONE_IDLE_BOB, z: idleZ, elapsed: null, workProgress: 0, completing: false };
      }
      const animation = state.animation;
      if (animation.routeBlocked && animation.returning === true && animation.pendingDock
        && animation.elapsed - (animation.lastRouteRetryElapsed ?? -Infinity) >= 500) {
        animation.lastRouteRetryElapsed = animation.elapsed;
        const pendingDock = animation.pendingDock;
        const retryRoute = findDroneRoute(state.location, [pendingDock.x, pendingDock.z], index);
        if (retryRoute) {
          animation.idlePosition = { x: pendingDock.x, z: pendingDock.z };
          animation.returnRoute = retryRoute;
          animation.returnReplan = { elapsed: animation.elapsed, start: state.location.slice(), startY: state.y };
          animation.routeBlocked = false;
          animation.pendingDock = null;
          setDronePhase(index, 'returning', 'return-route-recovered');
          droneDebugLog('return-replan-recovered', { droneIndex: index, location: state.location.slice(), dock: pendingDock });
        }
      }
      if (animation.routeBlocked && animation.returning === true) {
        setDronePhase(index, 'waiting_path', 'return-route-blocked');
        return { x: state.location[0], y: state.y, z: state.location[1], elapsed: animation.elapsed + delta, workProgress: 0, workComplete: false, completing: false, returnStart: animation.elapsed };
      }
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
      animation.climbDuration = climbDuration;
      animation.horizontalDuration = horizontalDuration;
      const returnReplan = animation.returning === true ? animation.returnReplan : null;
      const returnClimbStartY = returnReplan ? returnReplan.startY : workY;
      const returnClimbDuration = durationForDistance(Math.abs(laneY - returnClimbStartY));
      const returnDistance = routeLength(animation.returnRoute);
      const returnHorizontalDuration = durationForDistance(returnDistance);
      const returnDescentDuration = durationForDistance(Math.abs(laneY - idleY));
      const returnDuration = returnClimbDuration + returnHorizontalDuration + returnDescentDuration;
      const workReturnStart = outboundDuration + hoverDuration;
      const returnStart = returnReplan ? returnReplan.elapsed : workReturnStart;
      if (animation.routeBlocked && animation.returning === true) setDronePhase(index, 'waiting_path', 'return-route-blocked');
      else if (animation.returning === true || elapsed >= returnStart) setDronePhase(index, 'returning', 'return-segment');
      else if (elapsed < outboundDuration) setDronePhase(index, 'outbound', 'outbound-segment');
      else setDronePhase(index, 'working', 'work-segment');
      let x, y, z, workProgress = 0;
      if (returnReplan && elapsed >= returnStart) {
        const returnElapsed = Math.min(returnDuration, elapsed - returnStart);
        if (returnElapsed < returnClimbDuration) {
          const progress = returnClimbDuration ? returnElapsed / returnClimbDuration : 1;
          [x, z] = returnReplan.start;
          y = returnClimbStartY + (laneY - returnClimbStartY) * progress;
        } else if (returnElapsed < returnClimbDuration + returnHorizontalDuration) {
          const progress = returnHorizontalDuration
            ? (returnElapsed - returnClimbDuration) / returnHorizontalDuration : 1;
          [x, z] = sampleRoute(animation.returnRoute, progress);
          y = laneY;
        } else {
          const progress = returnDescentDuration
            ? (returnElapsed - returnClimbDuration - returnHorizontalDuration) / returnDescentDuration : 1;
          x = idleX; z = idleZ;
          y = laneY + (idleY - laneY) * progress;
        }
      } else if (elapsed < climbDuration) {
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
        if (!animation.departed) { animation.departed = true; deferCallback(animation.onDeparture); }
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
      const workComplete = elapsed >= workReturnStart;
      const completing = animation.workCompleted === true && elapsed >= returnStart + returnDuration;
      if (completing) { x = idleX; y = idleY; z = idleZ; }
      return { x, y, z, elapsed, workProgress, workComplete, completing, returnStart: workReturnStart };
    });

    for (let index = 0; index < droneCount; index += 1) {
      const state = droneStates[index];
      const candidate = proposals[index];
      const animation = state.animation;
      const previousX = state.location[0], previousZ = state.location[1];
      const movementDistance = Math.hypot(candidate.x - previousX, candidate.z - previousZ);
      if (movementDistance > 0.75) {
        droneDebugLog('position-jump', { droneIndex: index, from: [previousX, previousZ], to: [candidate.x, candidate.z], distance: movementDistance, kind: animation?.kind ?? null, elapsed: candidate.elapsed, returning: animation?.returning ?? null, target: animation?.target ?? null });
      }
      state.location = [candidate.x, candidate.z];
      state.y = candidate.y;
      if (animation) {
        animation.elapsed = candidate.elapsed;
        const outboundHorizontalEnd = animation.climbDuration + animation.horizontalDuration;
        if (!animation.cruiseReleased && candidate.elapsed >= outboundHorizontalEnd) {
          animation.cruiseReleased = true;
          if (droneCruiseHeights[index] === animation.laneY) droneCruiseHeights[index] = null;
        }
      }
      if (Math.hypot(candidate.x - previousX, candidate.z - previousZ) > 0.0001) state.heading = Math.atan2(candidate.x - previousX, candidate.z - previousZ);
      if (droneDocks[index]?.deployed !== false) addDrone(positions, colors, candidate.x, candidate.y, candidate.z, time / 1000, state.heading, droneDocks[index]?.battery ?? 100);
      if (animation && candidate.workProgress > 0) {
        if (!animation.workStarted) {
          animation.workStarted = true;
          deferCallback(animation.onWorkStart);
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
        if (!animation.departed) { animation.departed = true; deferCallback(animation.onDeparture); }
        state.lastCompletedPlotIndex = Number.isInteger(animation.targetPlotIndex) ? animation.targetPlotIndex : null;
        // Keep the completed-work animation as the position owner while callbacks run.
        // render() may synchronously call setDroneDocks(); a null animation would make it snap
        // the drone back to its dock before the next same-plot job can take over.
        const onComplete = animation.onComplete;
        animation.onComplete = null;
        droneDebugLog('work-complete-handoff', { droneIndex: index, kind: animation.kind, location: state.location.slice(), target: animation.target.slice(), elapsed: candidate.elapsed, returning: animation.returning ?? null, positionOwnerRetained: state.animation === animation });
        deferCallback(() => {
          onComplete?.();
          droneDebugLog('work-complete-handoff-result', { droneIndex: index, kind: animation.kind, activeKind: state.animation?.kind ?? null, location: state.location.slice(), previousAnimationRetained: state.animation === animation, nextAnimationStarted: state.animation !== animation });
        });
      } else if (animation && candidate.completing && state.animation === animation) {
        state.animation = null;
        setDronePhase(index, droneDocks[index]?.deployed === false ? 'docked' : 'idle', 'return-complete');
        const onReturnComplete = animation.onReturnComplete;
        animation.onReturnComplete = null;
        deferCallback(onReturnComplete);
      }
    }
    droneVertexCount = positions.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, dronePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, droneColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, droneNormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, calculateFaceNormals(positions), gl.DYNAMIC_DRAW);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, effectNormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, calculateFaceNormals(effectPositions), gl.DYNAMIC_DRAW);
    // Run lifecycle callbacks only after every drone has applied its proposal for this frame.
    // A callback may synchronously dispatch a job and replace another drone's animation;
    // deferring prevents that drone from receiving a proposal computed for its old animation.
    for (const callback of deferredCallbacks) callback();
  }

  const SKY_SPHERE_RADIUS = 10;
  function uploadSky(time) {
    if (galleryMode) { skyVertexCount = 0; return; }
    const positions = [];
    const colors = [];
    const opacities = [];
    const addCloudLobe = (x, y, z, rx, ry, rz, color) => {
      const start = positions.length / 3;
      addOctahedron(positions, colors, x, y, z, rx, ry, rz, color);
      // Geometry colors have baked-in 0.78 lower-face shading. Lift that shade to 0.92
      // so clouds remain softly dimensional without strong dark/light patches.
      for (let vertex = start; vertex < positions.length / 3; vertex += 1) {
        const faceIndex = Math.floor((vertex - start) / 3) % 8;
        if (faceIndex < 4) continue;
        const colorOffset = vertex * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          colors[colorOffset + channel] = Math.min(1, colors[colorOffset + channel] / 0.78 * 0.92);
        }
      }
    };
    const addCloud = (x, y, z, scale = 1) => {
      const start = positions.length / 3;
      const daylight = environmentState.phase === 'night' ? 0 : Math.max(0, Math.min(1, environmentState.daylightProgress));
      // At night, keep clouds almost imperceptible; daytime cloud softness remains unchanged.
      const cloudBrightness = 0.008 + daylight * 0.992;
      const cloudColor = (environmentState.isRaining ? [0.62, 0.72, 0.76] : [0.86, 0.93, 0.96])
        .map((channel) => channel * cloudBrightness);
      addCloudLobe(x, y, z, 0.96 * scale, 0.24 * scale, 0.96 * scale, cloudColor);
      addCloudLobe(x - 0.42 * scale, y + 0.08 * scale, z + 0.36 * scale, 0.68 * scale, 0.3 * scale, 0.68 * scale, cloudColor.map((channel) => Math.min(1, channel * 1.04)));
      addCloudLobe(x + 0.38 * scale, y + 0.02 * scale, z - 0.4 * scale, 0.7 * scale, 0.27 * scale, 0.7 * scale, cloudColor.map((channel) => channel * 0.96));
      const cloudOpacity = (environmentState.isRaining ? 0.36 : 0.42) * (0.03 + daylight * 0.97);
      for (let i = start; i < positions.length / 3; i += 1) opacities.push(cloudOpacity);
    };
    function normalize3(v) {
      const length = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / length, v[1] / length, v[2] / length];
    }
    function cross3(a, b) {
      return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function billboardBasis(dir) {
      const f = normalize3(dir);
      const upHint = Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
      const right = normalize3(cross3(upHint, f));
      const up = cross3(f, right);
      return [right, up];
    }
    function addBillboardOctahedron(P, C, center, right, up, forward, rx, ry, rz, color) {
      const local = [
        [0, ry, 0], [0, -ry, 0], [rx, 0, 0], [-rx, 0, 0], [0, 0, -rz], [0, 0, rz],
      ];
      const faces = [
        [0, 4, 2], [0, 2, 5], [0, 5, 3], [0, 3, 4],
        [1, 2, 4], [1, 5, 2], [1, 3, 5], [1, 4, 3],
      ];
      const transform = ([x, y, z]) => [
        center[0] + right[0] * x + up[0] * y + forward[0] * z,
        center[1] + right[1] * x + up[1] * y + forward[1] * z,
        center[2] + right[2] * x + up[2] * y + forward[2] * z,
      ];
      for (let i = 0; i < faces.length; i += 1) {
        const shade = i < 4 ? 1 : 0.95;
        const points = faces[i].map((index) => transform(local[index]));
        addTriangle(P, C, points[0], points[1], points[2], color.map((channel) => channel * shade));
      }
    }
    function addSun(P, C, dir, warm) {
      const f = normalize3(dir);
      const [x, y, z] = f.map((value) => value * SKY_SPHERE_RADIUS);
      const saturatedCore = [1, 0.78, 0.42].map((value, index) => value + ([1, 0.55, 0.2][index] - value) * warm);
      const luminance = saturatedCore[0] * 0.2126 + saturatedCore[1] * 0.7152 + saturatedCore[2] * 0.0722;
      const core = saturatedCore.map((value) => luminance + (value - luminance) * 0.8);
      // Refine the icosahedron three times: 20 faces become 1,280 (64x).
      const coreVertices = [
        [-1,1.618,0],[1,1.618,0],[-1,-1.618,0],[1,-1.618,0],[0,-1,1.618],[0,1,1.618],[0,-1,-1.618],[0,1,-1.618],
        [1.618,0,-1],[1.618,0,1],[-1.618,0,-1],[-1.618,0,1],
      ].map(normalize3);
      let coreFaces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
      for (let level = 0; level < 3; level += 1) {
        const midpointCache = new Map();
        const midpoint = (a, b) => {
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (midpointCache.has(key)) return midpointCache.get(key);
          const point = normalize3(coreVertices[a].map((value, axis) => (value + coreVertices[b][axis]) * 0.5));
          const index = coreVertices.length;
          coreVertices.push(point);
          midpointCache.set(key, index);
          return index;
        };
        const refinedFaces = [];
        for (const [a, b, c] of coreFaces) {
          const ab = midpoint(a, b);
          const bc = midpoint(b, c);
          const ca = midpoint(c, a);
          refinedFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        coreFaces = refinedFaces;
      }
      for (const face of coreFaces) {
        const tri = face.map((index) => coreVertices[index].map((value, axis) => [x, y, z][axis] + value * 0.55));
        addTriangle(P, C, tri[0], tri[1], tri[2], core);
      }
      const [right, up] = billboardBasis(f);
      // Twelve short rays share one direction-derived billboard basis.
      for (let i = 0; i < 12; i += 1) {
        const angle = i / 12 * Math.PI * 2;
        const rx = Math.cos(angle), ry = Math.sin(angle);
        const radial = normalize3([right[0] * rx + up[0] * ry, right[1] * rx + up[1] * ry, right[2] * rx + up[2] * ry]);
        const tangent = normalize3([-right[0] * ry + up[0] * rx, -right[1] * ry + up[1] * rx, -right[2] * ry + up[2] * rx]);
        const center = [x + radial[0] * 0.95, y + radial[1] * 0.95, z + radial[2] * 0.95];
        // Local Y points radially outward; local X follows the narrow tangent axis.
        addBillboardOctahedron(P, C, center, tangent, radial, f, 0.08, 0.3, 0.08, core.map((value) => value * 0.95));
      }
    }
    // Each cloud stores angular coordinates on the sky sphere, not a fixed world-space offset.
    // Scales are reduced in proportion to the old offset distance to preserve apparent size.
    const elapsed = time * 0.001;
    const clouds = [
      { azimuth: -2.311, elevation: -0.368, speed: 0.14, phase: 0.2, scale: 0.45 },
      { azimuth: -2.601, elevation: 0.051, speed: 0.18, phase: 1.1, scale: 0.57 },
      { azimuth: -2.834, elevation: -0.372, speed: 0.12, phase: 2.2, scale: 0.73 },
      { azimuth: 3.065, elevation: 0.096, speed: 0.16, phase: 3.3, scale: 0.74 },
      { azimuth: 2.639, elevation: -0.449, speed: 0.2, phase: 4.4, scale: 0.63 },
      { azimuth: 2.423, elevation: 0.031, speed: 0.13, phase: 5.1, scale: 0.58 },
      { azimuth: 1.951, elevation: 0.074, speed: 0.17, phase: 0.8, scale: 0.63 },
      { azimuth: -1.816, elevation: 0.020, speed: 0.15, phase: 2.7, scale: 0.77 },
      { azimuth: -1.272, elevation: -0.352, speed: 0.19, phase: 4, scale: 1.07 },
      { azimuth: -0.223, elevation: -0.341, speed: 0.14, phase: 5.5, scale: 1.46 },
      { azimuth: 0.423, elevation: 0.136, speed: 0.16, phase: 1.6, scale: 0.90 },
      { azimuth: 0.927, elevation: -0.119, speed: 0.12, phase: 3.8, scale: 0.71 },
      { azimuth: -0.835, elevation: -0.324, speed: 0.18, phase: 5.9, scale: 0.55 },
      { azimuth: -0.359, elevation: -0.267, speed: 0.13, phase: 2.9, scale: 0.73 },
      { azimuth: 0.236, elevation: -0.371, speed: 0.2, phase: 0.5, scale: 0.62 },
      { azimuth: 0.664, elevation: -0.203, speed: 0.15, phase: 4.8, scale: 0.62 },
    ];
    for (const cloud of clouds) {
      // A small angular drift preserves the old slow, gentle motion on the sphere.
      const azimuth = cloud.azimuth + Math.sin(elapsed * cloud.speed + cloud.phase) * 0.048;
      const horizontalRadius = Math.cos(cloud.elevation) * SKY_SPHERE_RADIUS;
      const x = Math.sin(azimuth) * horizontalRadius;
      const y = Math.sin(cloud.elevation) * SKY_SPHERE_RADIUS;
      const z = Math.cos(azimuth) * horizontalRadius;
      addCloud(x, y, z, cloud.scale);
    }
    const cycle = window.skyEnvironment?.DAY_CYCLE_MS || 16 * 60_000;
    const cycleTime = ((environmentState.worldTimeMs % cycle) + cycle) % cycle;
    // The sun completes one full orbit per day/night cycle and stays visible in all weather and phases.
    const orbitProgress = cycleTime / cycle;
    // Align the orbital high point with solar noon (the midpoint of the 10-minute daytime span)
    // and the low point 8 minutes later at midnight in the 16-minute day/night cycle.
    const solarNoonProgress = (5 * 60_000) / cycle;
    const solarPhaseAngle = (orbitProgress - solarNoonProgress) * Math.PI * 2;
    const azimuth = solarPhaseAngle + Math.PI / 2;
    // Sun visibility follows dawn 0→80%, daytime 80→100→80%, dusk 80→0%, then stays off at night.
    const cycleMinute = cycleTime / 60_000;
    const interpolateVisibility = (start, end, progress) =>
      start + (end - start) * Math.max(0, Math.min(1, progress));
    let timeVisibility;
    if (cycleMinute < 1) {
      timeVisibility = interpolateVisibility(0, 0.8, cycleMinute);
    } else if (cycleMinute < 5) {
      timeVisibility = interpolateVisibility(0.8, 1, (cycleMinute - 1) / 4);
    } else if (cycleMinute < 10) {
      timeVisibility = interpolateVisibility(1, 0.8, (cycleMinute - 5) / 5);
    } else if (cycleMinute < 11) {
      timeVisibility = interpolateVisibility(0.8, 0, cycleMinute - 10);
    } else {
      timeVisibility = 0;
    }
    // Preserve the existing rain fade: visibility gradually falls to 50% during rain.
    const rainVisibility = 1 - 0.5 * environmentState.rainBlend;
    const sunVisibility = timeVisibility * rainVisibility;
    // Tilt the orbital plane 15 degrees from the horizontal equatorial plane.
    // This produces a true great circle: elevation varies smoothly from -15 to +15 degrees.
    const orbitTilt = Math.PI / 12;
    const sunDirection = [Math.sin(azimuth) * Math.cos(orbitTilt), Math.sin(azimuth) * Math.sin(orbitTilt), Math.cos(azimuth)];
    // Keep the sun's daytime orange RGB color at every phase; time and rain only affect opacity.
    const warmth = 1;
    const sunStart = positions.length / 3;
    addSun(positions, colors, sunDirection, warmth);
    for (let i = sunStart; i < positions.length / 3; i += 1) opacities.push(sunVisibility);

    const moonDirection = sunDirection.map((value) => -value);
    const moonCenter = moonDirection.map((value) => value * SKY_SPHERE_RADIUS);
    const [moonRight, moonUp] = billboardBasis(moonDirection);
    // Rain also attenuates moonlight: (100% - sun visibility) × rain visibility.
    const moonOpacity = Math.max(0, 1 - sunVisibility) * rainVisibility;
    // Keep one moon phase for each complete in-game day/night cycle.
    const moonLightStep = ((Math.floor(environmentState.worldTimeMs / cycle) % 8) + 8) % 8;
    const phaseAngle = moonLightStep * Math.PI / 4;
    const moonIllumination = Math.max(0, Math.min(1, (1 + Math.cos(phaseAngle)) * 0.5));
    skyGlowState = {
      sunCenter: sunDirection.map((value) => value * SKY_SPHERE_RADIUS),
      sunOpacity: Math.max(0, Math.min(1, sunVisibility)),
      moonCenter,
      moonOpacity: Math.max(0, Math.min(1, moonOpacity)),
      moonGlowFactor: 0.12 + 0.88 * Math.pow(moonIllumination, 0.72),
    };
    const moonViewDirection = moonDirection.map((value) => -value);
    const phaseLightDirection = normalize3(moonViewDirection.map((value, axis) =>
      value * Math.cos(phaseAngle) + moonRight[axis] * Math.sin(phaseAngle)));
    // Interpolate opacity per sphere vertex instead of assigning a hard on/off value per triangle.
    // This keeps the terminator smooth and avoids direction-dependent faceting.
    const vertexMoonOpacity = (point) => {
      const normal = normalize3(point.map((value, axis) => value - moonCenter[axis]));
      const lightDot = normal.reduce((sum, value, axis) => sum + value * phaseLightDirection[axis], 0);
      const viewDot = normal.reduce((sum, value, axis) => sum + value * moonViewDirection[axis], 0);
      const smoothVisibility = (dot) => {
        const t = Math.max(0, Math.min(1, dot / 0.12));
        return t * t * (3 - 2 * t);
      };
      return moonOpacity * smoothVisibility(lightDot) * smoothVisibility(viewDot);
    };
    function addStar(P, C, dir, size, color) {
      const [x, y, z] = dir.map((v) => v * SKY_SPHERE_RADIUS);
      const [r, u] = billboardBasis(dir);
      const pts = [[0, 1], [0.22, 0.22], [1, 0], [0.22, -0.22], [0, -1], [-0.22, -0.22], [-1, 0], [-0.22, 0.22]];
      const v = pts.map(([a, b]) => [
        x + (r[0] * a * 0.7 + u[0] * b) * size,
        y + (r[1] * a * 0.7 + u[1] * b) * size,
        z + (r[2] * a * 0.7 + u[2] * b) * size,
      ]);
      for (let i = 0; i < 8; i += 1) addTriangle(P, C, [x, y, z], v[i], v[(i + 1) % 8], color);
    }
    const addMoonIcosphere = (center, radius, color) => {
      const vertices = [
        [-1,1.618,0],[1,1.618,0],[-1,-1.618,0],[1,-1.618,0],[0,-1,1.618],[0,1,1.618],[0,-1,-1.618],[0,1,-1.618],
        [1.618,0,-1],[1.618,0,1],[-1.618,0,-1],[-1.618,0,1],
      ].map(normalize3);
      let faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
      // Three icosphere subdivision rounds turn 20 faces into 1,280 (64x).
      for (let level = 0; level < 3; level += 1) {
        const midpointCache = new Map();
        const midpoint = (a, b) => {
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (midpointCache.has(key)) return midpointCache.get(key);
          const point = normalize3(vertices[a].map((value, axis) => (value + vertices[b][axis]) * 0.5));
          const index = vertices.length;
          vertices.push(point);
          midpointCache.set(key, index);
          return index;
        };
        const refinedFaces = [];
        for (const [a, b, c] of faces) {
          const ab = midpoint(a, b);
          const bc = midpoint(b, c);
          const ca = midpoint(c, a);
          refinedFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        faces = refinedFaces;
      }
      for (const face of faces) {
        const tri = face.map((index) => vertices[index].map((value, axis) => center[axis] + value * radius));
        addTriangle(positions, colors, tri[0], tri[1], tri[2], color);
        opacities.push(
          vertexMoonOpacity(tri[0]),
          vertexMoonOpacity(tri[1]),
          vertexMoonOpacity(tri[2]),
        );
      }
    };
    addMoonIcosphere(moonCenter, 0.46, [0.96,0.94,0.82]);

    // Fixed deterministic star field; each star twinkles with its own 3–5 second cycle.
    const starCount = 84;
    const starMinElevation = -15 * Math.PI / 180;
    const starMaxElevation = 70 * Math.PI / 180;
    for (let index = 0; index < starCount; index += 1) {
      // Deterministic equal-step sampling over the allowed elevation range.
      // Y is the vertical axis; azimuth still covers the full 360 degrees.
      const elevation = starMinElevation
        + (starMaxElevation - starMinElevation) * ((index + 0.5) / starCount);
      const angle = index * 2.399963229728653;
      const horizontal = Math.cos(elevation);
      const dir = [Math.cos(angle) * horizontal, Math.sin(elevation), Math.sin(angle) * horizontal];
      const seed = (Math.sin(index * 127.1 + 311.7) * 43758.5453) % 1;
      const phase = (seed < 0 ? seed + 1 : seed) * Math.PI * 2;
      const periodMs = 3000 + ((Math.sin(index * 74.7 + 19.3) * 43758.5453 % 1 + 1) % 1) * 2000;
      const twinkle = 0.5 - 0.5 * Math.cos((time / periodMs) * Math.PI * 2 + phase);
      const starOpacity = moonOpacity * twinkle;
      const firstVertex = positions.length / 3;
      const starSize = 0.035 + ((Math.sin(index * 31.7 + 4.2) * 43758.5453 % 1 + 1) % 1) * 0.045;
      const colorShift = ((Math.sin(index * 18.2 + 7.1) * 43758.5453 % 1 + 1) % 1) * 0.12;
      addStar(positions, colors, dir, starSize, [0.78 + colorShift, 0.84 + colorShift, 1]);
      for (let vertex = firstVertex; vertex < positions.length / 3; vertex += 1) opacities.push(starOpacity);
    }

    skyVertexCount = positions.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, skyPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyOpacityBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(opacities), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyNormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, calculateFaceNormals(positions), gl.DYNAMIC_DRAW);
  }

  function calculateFaceNormals(positions) {
    const normals = new Float32Array(positions.length);
    for (let i = 0; i + 8 < positions.length; i += 9) {
      const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
      const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
      const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const offset = i + vertex * 3;
        normals[offset] = nx; normals[offset + 1] = ny; normals[offset + 2] = nz;
      }
    }
    return normals;
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
          Number.isFinite(plant.plantHeight) ? plant.plantHeight : 1, plant.customColor,
          Number.isFinite(plant.rotation) ? plant.rotation : 0);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, calculateFaceNormals(positions), gl.STATIC_DRAW);
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
    // Orbit around the world origin plus the current horizontal camera-pan offset.
    // The camera is allowed to pass below the ground when looking upward.
    const orbitCenter = [targetX, 0, targetZ];
    const horizontal = Math.cos(pitch) * distance;
    const eye = [orbitCenter[0] + Math.sin(yaw) * horizontal, orbitCenter[1] + Math.sin(pitch) * distance, orbitCenter[2] + Math.cos(yaw) * horizontal];
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
  function drawSunMoonGlow(skyView, eye, viewCenter) {
    if (!glowProgram || !glowTexture || !glowLocations || !skyGlowState || galleryMode) return;
    const normalize = (vector) => {
      const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
      return vector.map((value) => value / length);
    };
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const forward = normalize(viewCenter.map((value, axis) => value - eye[axis]));
    const upHint = cameraMode === '2d' ? [0, 0, -1] : [0, 1, 0];
    const right = normalize(cross(forward, upHint));
    const up = normalize(cross(right, forward));
    const targets = [
      { center: skyGlowState.sunCenter, size: 3.8, tint: [1.0, 0.68, 0.30], opacity: skyGlowState.sunOpacity * 0.72 },
      { center: skyGlowState.moonCenter, size: 3.8, tint: [0.72, 0.84, 1.0], opacity: skyGlowState.moonOpacity * skyGlowState.moonGlowFactor * 0.58 },
    ];
    gl.useProgram(glowProgram);
    gl.uniformMatrix4fv(glowLocations.projection, false, currentProjection);
    gl.uniformMatrix4fv(glowLocations.view, false, skyView);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glowTexture);
    gl.uniform1i(glowLocations.texture, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, glowUVBuffer);
    gl.enableVertexAttribArray(glowLocations.uv);
    gl.vertexAttribPointer(glowLocations.uv, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    // Premultiplied-alpha RGB: add directly so alpha is not applied twice.
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const target of targets) {
      const opacity = Math.max(0, Math.min(1, target.opacity));
      if (opacity <= 0.001) continue;
      const half = target.size * 0.5;
      const corners = [
        [-1, -1], [1, -1], [1, 1],
        [-1, -1], [1, 1], [-1, 1],
      ];
      const vertices = [];
      for (const [x, y] of corners) {
        vertices.push(
          target.center[0] + right[0] * x * half + up[0] * y * half,
          target.center[1] + right[1] * x * half + up[1] * y * half,
          target.center[2] + right[2] * x * half + up[2] * y * half,
        );
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, glowPositionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(glowLocations.position);
      gl.vertexAttribPointer(glowLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, glowOpacityBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(6).fill(opacity), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(glowLocations.opacity);
      gl.vertexAttribPointer(glowLocations.opacity, 1, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(glowLocations.tint, new Float32Array(target.tint));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(glowLocations.uv);
    gl.disableVertexAttribArray(glowLocations.opacity);
    gl.disableVertexAttribArray(glowLocations.position);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  function drawDroneGlows() {
    if (!glowProgram || !glowTexture || !glowLocations || galleryMode) return;
    const normalize = (vector) => {
      const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
      return vector.map((value) => value / length);
    };
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const forward = normalize([
      currentView[2], currentView[6], currentView[10],
    ]);
    const upHint = cameraMode === '2d' ? [0, 0, -1] : [0, 1, 0];
    const right = normalize(cross(forward, upHint));
    const up = normalize(cross(right, forward));
    const daylight = Math.max(0, Math.min(1, environmentState.daylightProgress));
    const nightFactor = 1 - daylight;
    const targets = [];
    for (let index = 0; index < droneCount; index += 1) {
      const state = droneStates[index];
      if (!state || droneDocks[index]?.deployed === false) continue;
      const batteryFactor = Math.max(0.45, Math.min(1, (droneDocks[index]?.battery ?? 100) / 100));
      targets.push({
        center: [state.location[0], state.y + 0.035, state.location[1]],
        size: 0.72,
        tint: [1.0, 0.68, 0.30],
        opacity: (0.11 + nightFactor * 0.24) * batteryFactor,
      });
    }
    if (!targets.length) return;
    gl.useProgram(glowProgram);
    gl.uniformMatrix4fv(glowLocations.projection, false, currentProjection);
    gl.uniformMatrix4fv(glowLocations.view, false, currentView);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glowTexture);
    gl.uniform1i(glowLocations.texture, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, glowUVBuffer);
    gl.enableVertexAttribArray(glowLocations.uv);
    gl.vertexAttribPointer(glowLocations.uv, 2, gl.FLOAT, false, 0, 0);
    // Keep depth testing enabled so nearby terrain can naturally occlude the glow.
    gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const target of targets) {
      const half = target.size * 0.5;
      const corners = [
        [-1, -1], [1, -1], [1, 1],
        [-1, -1], [1, 1], [-1, 1],
      ];
      const vertices = [];
      for (const [x, y] of corners) {
        vertices.push(
          target.center[0] + right[0] * x * half + up[0] * y * half,
          target.center[1] + right[1] * x * half + up[1] * y * half,
          target.center[2] + right[2] * x * half + up[2] * y * half,
        );
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, glowPositionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(glowLocations.position);
      gl.vertexAttribPointer(glowLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, glowOpacityBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(6).fill(target.opacity), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(glowLocations.opacity);
      gl.vertexAttribPointer(glowLocations.opacity, 1, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(glowLocations.tint, new Float32Array(target.tint));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(glowLocations.uv);
    gl.disableVertexAttribArray(glowLocations.opacity);
    gl.disableVertexAttribArray(glowLocations.position);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.enableVertexAttribArray(locations.normal);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(locations.opacity);
    gl.vertexAttrib1f(locations.opacity, 1);
    // Orbit around the world origin plus the current horizontal camera-pan offset.
    // Always aim at that external pivot; passing below ground is intentionally allowed.
    const orbitCenter = [targetX, 0, targetZ];
    const horizontal = Math.cos(pitch) * distance;
    const eye = cameraMode === '2d' ? [targetX, topDownHeight, targetZ] : [
      orbitCenter[0] + Math.sin(yaw) * horizontal,
      orbitCenter[1] + Math.sin(pitch) * distance,
      orbitCenter[2] + Math.cos(yaw) * horizontal,
    ];
    const viewCenter = cameraMode === '2d' ? [targetX, 0, targetZ] : orbitCenter;
    currentProjection = perspective(Math.PI / 4, canvas.width / Math.max(canvas.height, 1), 0.1, 100);
    currentView = cameraMode === '2d' ? lookAt(eye, viewCenter, [0, 0, -1]) : lookAt(eye, viewCenter, [0, 1, 0]);
    gl.uniformMatrix4fv(locations.projection, false, currentProjection);
    gl.uniformMatrix4fv(locations.view, false, currentView);
    uploadSky(time);
    const eyeLength = Math.hypot(eye[0] - targetX, eye[1], eye[2] - targetZ) || 1;
    gl.uniform3f(locations.eyeDir, (eye[0] - targetX) / eyeLength, eye[1] / eyeLength, (eye[2] - targetZ) / eyeLength);
    const daylight = Math.max(0, Math.min(1, environmentState.daylightProgress));
    const rainDim = environmentState.rainBlend * 0.2;
    // Keep plant colors saturated and soft: favor fill light over hard directional contrast.
    const ambient = 0.12 + daylight * 0.44 - rainDim * 0.1;
    const sunStrength = daylight * (environmentState.isRaining ? 0.3 : 0.42);
    let sunR = sunStrength, sunG = sunStrength, sunB = sunStrength;
    if (environmentState.phase === 'dawn' || environmentState.phase === 'dusk') {
      sunG *= 0.82; sunB *= 0.62;
    } else if (environmentState.isRaining) {
      sunR *= 0.72; sunG *= 0.82;
    }
    gl.uniform3f(locations.sunDir, -0.42, 0.82, 0.38);
    gl.uniform3f(locations.ambient, ambient, ambient * (environmentState.phase === 'night' ? 0.86 : 1), ambient * (environmentState.phase === 'night' ? 1.12 : 1));
    gl.uniform3f(locations.sunColor, sunR, sunG, sunB);
    const nightFactor = Math.max(0, 1 - daylight);
    const droneLightPositions = [];
    const droneLightStrengths = [];
    for (let index = 0; index < 8; index += 1) {
      const state = droneStates[index];
      const dock = droneDocks[index];
      const deployed = index < droneCount && dock?.deployed !== false;
      const batteryFactor = Math.max(0, Math.min(1, (dock?.battery ?? 100) / 35));
      const active = deployed && state;
      const lightPosition = active
        ? [state.location[0], state.y + 0.155, state.location[1]]
        : [0, -100, 0];
      droneLightPositions.push(...lightPosition);
      // A small warm pool of light, visible only at night and softened by battery level.
      droneLightStrengths.push(active ? nightFactor * 0.34 * batteryFactor : 0);
    }
    gl.uniform3fv(locations.droneLightPos, new Float32Array(droneLightPositions));
    gl.uniform1fv(locations.droneLightStrength, new Float32Array(droneLightStrengths));
    gl.uniform1f(locations.droneSelfIllumination, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyPositionBuffer);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyColorBuffer);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyNormalBuffer);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
    const cycleLength = window.skyEnvironment?.DAY_CYCLE_MS || 16 * 60_000;
    const cyclePosition = ((environmentState.worldTimeMs % cycleLength) + cycleLength) % cycleLength / cycleLength;
    gl.bindBuffer(gl.ARRAY_BUFFER, skyOpacityBuffer);
    gl.enableVertexAttribArray(locations.opacity);
    gl.vertexAttribPointer(locations.opacity, 1, gl.FLOAT, false, 0, 0);
    const skyView = new Float32Array(currentView);
    skyView[12] = 0;
    skyView[13] = 0;
    skyView[14] = 0;
    gl.uniformMatrix4fv(locations.view, false, skyView);
    // Clouds and the sun use near-uniform sky lighting, avoiding strong face-to-face contrast.
    gl.uniform3f(locations.ambient, 0.88, 0.88, 0.88);
    gl.uniform3f(locations.sunColor, 0.12, 0.12, 0.12);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, skyVertexCount);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    drawSunMoonGlow(skyView, eye, viewCenter);
    gl.useProgram(program);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enableVertexAttribArray(locations.position);
    gl.enableVertexAttribArray(locations.color);
    gl.enableVertexAttribArray(locations.normal);
    gl.uniform3f(locations.ambient, ambient, ambient * (environmentState.phase === 'night' ? 0.86 : 1), ambient * (environmentState.phase === 'night' ? 1.12 : 1));
    gl.uniform3f(locations.sunColor, sunR, sunG, sunB);
    gl.uniformMatrix4fv(locations.view, false, currentView);
    gl.disableVertexAttribArray(locations.opacity);
    gl.vertexAttrib1f(locations.opacity, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectPositionBuffer);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectColorBuffer);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectNormalBuffer);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, effectOpacityBuffer);
    gl.enableVertexAttribArray(locations.opacity);
    gl.vertexAttribPointer(locations.opacity, 1, gl.FLOAT, false, 0, 0);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, effectVertexCount);
    gl.depthMask(true);
    gl.disableVertexAttribArray(locations.opacity);
    gl.vertexAttrib1f(locations.opacity, 1);
    drawDroneGlows();
    gl.useProgram(program);
    gl.uniformMatrix4fv(locations.projection, false, currentProjection);
    gl.uniformMatrix4fv(locations.view, false, currentView);
    gl.enableVertexAttribArray(locations.position);
    gl.enableVertexAttribArray(locations.color);
    gl.enableVertexAttribArray(locations.normal);
    gl.bindBuffer(gl.ARRAY_BUFFER, dronePositionBuffer);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, droneColorBuffer);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, droneNormalBuffer);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
    gl.uniform1f(locations.droneSelfIllumination, nightFactor * 0.624);
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
        pitch = Math.max(-70 * Math.PI / 180, Math.min(70 * Math.PI / 180, pitch + deltaY * 0.006));
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
    const outboundRoute = findDroneRoute(start, target, droneIndex);
    const returnRoute = findDroneRoute(target, returnGoal, droneIndex);
    if (!outboundRoute || !returnRoute) {
      const keepReturning = Boolean(state.animation?.workCompleted && state.animation.returning === true);
      droneDebugLog('animation-route-failed', { droneIndex, kind, start, target, outboundRouteFound: Boolean(outboundRoute), returnRouteFound: Boolean(returnRoute), currentAnimation: state.animation?.kind ?? null, keepReturning });
      return keepReturning ? 'waiting_path_returning' : 'waiting_path';
    }
    const laneY = getCruiseHeight(continueAtTarget ? target : start, continueAtTarget ? [idlePosition.x, idlePosition.z] : target, droneIndex, options.targetPlotIndex);
    if (!continueAtTarget) droneCruiseHeights[droneIndex] = laneY;
    state.animation = {
      kind, target, start, startY: state.y, continueAtTarget,
      idleY, workY: Number.isFinite(options.workY) ? options.workY : DRONE_WORK_Y,
      targetPlotIndex: options.targetPlotIndex,
      idlePosition, elapsed: 0, returning: undefined, departed: false,
      laneY,
      outboundRoute,
      returnRoute,
      cruiseReleased: continueAtTarget,
      ...options,
    };
    setDronePhase(droneIndex, continueAtTarget ? 'working' : 'outbound', 'animation-start');
    droneDebugLog('animation-start', { droneIndex, kind, from: start, target: target.slice(), continueAtTarget, outboundWaypoints: outboundRoute.length, returnWaypoints: returnRoute.length });
    return true;
  }
  window.skyWorld = {
    getDroneHeading(droneIndex = 0) {
      return Number.isInteger(droneIndex) ? droneStates[droneIndex]?.heading ?? 0 : 0;
    },
    getDronePhase(droneIndex = 0) {
      return Number.isInteger(droneIndex) ? droneStates[droneIndex]?.phase ?? 'docked' : 'docked';
    },
    getDronePosition(droneIndex = 0) {
      const state = Number.isInteger(droneIndex) ? droneStates[droneIndex] : null;
      if (!state) return null;
      return {
        x: state.location[0], y: state.y, z: state.location[1],
        phase: state.phase || 'idle',
        animationKind: state.animation?.kind || null,
        returning: state.animation?.returning === true,
      };
    },
    cancelDroneAnimation(droneIndex, onReturnComplete) {
      if (!Number.isInteger(droneIndex) || droneIndex < 0 || droneIndex >= droneCount) return false;
      const state = droneStates[droneIndex];
      const animation = state?.animation;
      if (!state || !animation) return false;
      const start = state.location.slice();
      const dock = droneDocks[droneIndex] || dockPosition;
      const pendingDock = { x: dock.x, z: dock.z, y: dock.y || 0 };
      const route = findDroneRoute(start, [dock.x, dock.z], droneIndex);
      animation.target = start.slice();
      animation.start = start.slice();
      animation.startY = state.y;
      animation.targetPlotIndex = undefined;
      animation.hoverDuration = 0;
      animation.elapsed = 0;
      animation.returning = true;
      animation.workCompleted = true;
      animation.workProgress = 0;
      animation.outboundRoute = [start.slice()];
      animation.returnRoute = route || [];
      animation.returnReplan = { elapsed: 0, start: start.slice(), startY: state.y };
      animation.routeBlocked = !route;
      animation.pendingDock = route ? null : pendingDock;
      animation.lastRouteRetryElapsed = route ? undefined : 0;
      animation.idlePosition = { x: dock.x, z: dock.z };
      animation.idleY = DRONE_IDLE_Y + (dock.y || 0);
      animation.onDeparture = null;
      animation.onWorkStart = null;
      animation.onComplete = null;
      animation.onReturnComplete = onReturnComplete || null;
      animation.shouldReturn = () => true;
      setDronePhase(droneIndex, route ? 'returning' : 'waiting_path', 'work-cancelled-return');
      droneDebugLog('animation-cancelled-return', { droneIndex, kind: animation.kind, location: start, dock: pendingDock, routeFound: Boolean(route) });
      return true;
    },
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
        crop: plot.crop, plantedAt: plot.plantedAt, plantHeight: plot.plantHeight, rotation: plot.rotation, customColor: plot.customColor,
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
        worldTimeMs: Number.isFinite(state.worldTimeMs) ? state.worldTimeMs : environmentState.worldTimeMs,
      };
      frame.classList.toggle('is-raining', rainBlend > 0);
      frame.style.setProperty('--rain-blend', String(rainBlend));
      for (const phase of ['dawn', 'day', 'dusk', 'night']) frame.classList.toggle(`is-${phase}`, environmentState.phase === phase);
      const background = getSkyGradient(environmentState);
      if (background !== environmentBackground) {
        frame.style.background = background;
        environmentBackground = background;
      }
      canvas.style.filter = 'brightness(1)';
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
        if (!animation) {
          droneStates[index].location = [dock.x, dock.z];
          setDronePhase(index, dock.deployed === false ? 'docked' : 'idle', 'dock-sync');
        } else if (dockPositionsChanged[index]) {
          // Battery/deployment updates arrive frequently; they must not replace an in-flight route.
          const newDock = { x: dock.x, z: dock.z, y: dock.y || 0 };
          if (animation.returning === true) {
            // Replan from the drone's actual current position and restart only the return segment's clock.
            const newRoute = findDroneRoute(droneStates[index].location, [dock.x, dock.z], index);
            if (newRoute) {
              animation.idlePosition = { x: dock.x, z: dock.z };
              animation.returnRoute = newRoute;
              animation.returnReplan = {
                elapsed: animation.elapsed,
                start: droneStates[index].location.slice(),
                startY: droneStates[index].y,
              };
              animation.routeBlocked = false;
              animation.pendingDock = null;
            } else {
              animation.routeBlocked = true;
              animation.pendingDock = newDock;
              droneDebugLog('return-replan-failed', { droneIndex: index, location: droneStates[index].location.slice(), dock: newDock });
            }
          } else if (animation.returning !== false) {
            // A dock moved during outbound travel/work: aim the not-yet-started return route at its new position.
            const newRoute = findDroneRoute(animation.target, [dock.x, dock.z], index);
            if (newRoute) {
              animation.idlePosition = { x: dock.x, z: dock.z };
              animation.returnRoute = newRoute;
              animation.routeBlocked = false;
              animation.pendingDock = null;
            } else {
              animation.routeBlocked = true;
              animation.pendingDock = newDock;
              droneDebugLog('return-replan-failed', { droneIndex: index, location: droneStates[index].location.slice(), dock: newDock });
            }
          }
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
