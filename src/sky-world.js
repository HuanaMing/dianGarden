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
    uniform mat4 uProjection;
    uniform mat4 uView;
    varying vec3 vColor;
    void main() {
      gl_Position = uProjection * uView * vec4(aPosition, 1.0);
      vColor = aColor;
    }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec3 vColor;
    void main() { gl_FragColor = vec4(vColor, 1.0); }
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
    projection: gl.getUniformLocation(program, 'uProjection'),
    view: gl.getUniformLocation(program, 'uView'),
  };
  const positionBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  const dronePositionBuffer = gl.createBuffer();
  const droneColorBuffer = gl.createBuffer();
  const effectPositionBuffer = gl.createBuffer();
  const effectColorBuffer = gl.createBuffer();
  let vertexCount = 0;
  let droneVertexCount = 0;
  let effectVertexCount = 0;
  let landCount = galleryMode ? 1 : 3;
  let plotPositions = galleryMode ? [{ x: 0, z: 0, y: 0 }] : [{ x: -1, z: 0, y: 0 }, { x: 0, z: 0, y: 0 }, { x: 1, z: 0, y: 0 }];
  let galleryFlowerIndex = 0;
  let plotStates = galleryMode ? [{ crop: 0, plantedAt: 0, elapsed: 1, growTime: 1, plantHeight: 1 }] : [];
  let environmentState = { phase: 'day', isDay: true, isRaining: false, lightLevel: 1, sunflowerYaw: 0 };
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
  let pinchActive = false;
  let suppressTouchTap = false;
  let lastEmptyTouchAt = 0;
  let rotateTouchGesture = false;
  let pinchStartDistance = 0;
  let pinchStartZoom = 0;
  function currentZoom() { return cameraMode === '2d' ? topDownHeight : distance; }
  function applyZoom(value) {
    if (cameraMode === '2d') topDownHeight = Math.max(5, Math.min(30, value));
    else distance = Math.max(3, Math.min(12, value));
  }
  function zoomBy(direction) {
    applyZoom(currentZoom() + direction * (cameraMode === '2d' ? -1.4 : -0.65));
  }
  document.querySelector('#zoom-in')?.addEventListener('click', () => zoomBy(1));
  document.querySelector('#zoom-out')?.addEventListener('click', () => zoomBy(-1));
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
  const keys = new Set();
  const TILE = 1;
  const DRONE_IDLE_Y = 1.5;
  const DRONE_WORK_Y = 1.18;
  const DRONE_TRANSIT_Y = 2.0;
  const DRONE_LANE_SPACING = 0.62;
  const DRONE_SPEED = 1.0;
  const DRONE_IDLE_BOB = 0.012;
  const DRONE_ROTOR_RADIUS = 0.19;
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

  function hasDroneAnimations() {
    return droneStates.some((state) => state.animation !== null);
  }

  function addFace(positions, colors, corners, color) {
    const shade = [1, 0.88, 0.78, 0.88];
    const order = [0, 1, 2, 0, 2, 3];
    for (const index of order) {
      positions.push(...corners[index]);
      colors.push(color[0] * shade[index], color[1] * shade[index], color[2] * shade[index]);
    }
  }

  function addTriangle(positions, colors, a, b, c, color) {
    for (const point of [a, b, c]) {
      positions.push(...point);
      colors.push(...color);
    }
  }

  function addOctahedron(positions, colors, x, y, z, rx, ry, rz, color) {
    const top = [x, y + ry, z];
    const bottom = [x, y - ry, z];
    const east = [x + rx, y, z];
    const west = [x - rx, y, z];
    const north = [x, y, z - rz];
    const south = [x, y, z + rz];
    const faces = [
      [top, north, east], [top, east, south], [top, south, west], [top, west, north],
      [bottom, east, north], [bottom, south, east], [bottom, west, south], [bottom, north, west],
    ];
    for (let i = 0; i < faces.length; i += 1) {
      const shade = i < 4 ? 1 : 0.78;
      addTriangle(positions, colors, ...faces[i], color.map((channel) => channel * shade));
    }
  }

  function addLeaf(positions, colors, x, y, z, direction, length, color) {
    const start = [x, y, z];
    const tip = [x + direction[0] * length, y + direction[1] * length, z + direction[2] * length];
    const side = [-direction[2] * 0.045, 0.018, direction[0] * 0.045];
    const left = [tip[0] + side[0], tip[1] + side[1], tip[2] + side[2]];
    const right = [tip[0] - side[0], tip[1] - side[1], tip[2] - side[2]];
    addTriangle(positions, colors, start, left, tip, color);
    addTriangle(positions, colors, start, tip, right, color.map((channel) => channel * 0.88));
  }

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
      [0.98, 0.72, 0.12], [0.54, 0.39, 0.78], [0.93, 0.94, 0.84], [0.86, 0.22, 0.34],
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
      addOctahedron(positions, colors, x, 0.13, z, 0.065, 0.055, 0.065, (flowerIndex === 10 ? [0.43, 0.19, 0.18] : seedColors[flowerIndex] || seedColors[0]));
      return;
    }

    // The tile is one world unit wide. Heights keep a sunflower tallest,
    // rose medium-sized, and hyacinth/lily-of-the-valley compact.
    const matureHeight = flowerHeights[flowerIndex] || flowerHeights[0];
    const height = stage === 1 ? matureHeight * 0.31 : matureHeight;
    const stemWidth = flowerIndex === 2 ? 0.018 : 0.028;
    const stemColor = [0.3, 0.53, 0.27];
    addBox(positions, colors, x - stemWidth / 2, 0.055, z - stemWidth / 2, x + stemWidth / 2, 0.055 + height, z + stemWidth / 2, {
      top: [0.36, 0.59, 0.3], front: [0.28, 0.47, 0.25], right: [0.25, 0.42, 0.22],
      back: [0.32, 0.52, 0.27], left: stemColor, bottom: [0.22, 0.38, 0.2],
    });

    if (stage === 1) {
      addLeaf(positions, colors, x, 0.11, z, [-0.75, 0.52, -0.15], 0.12, [0.34, 0.62, 0.29]);
      addLeaf(positions, colors, x, 0.12, z, [0.66, 0.54, 0.2], 0.12, [0.38, 0.66, 0.31]);
      return;
    }

    if (flowerIndex >= 4) {
      addLeaf(positions, colors, x, 0.13, z, [-0.76, 0.34, -0.18], flowerIndex === 7 ? 0.24 : 0.18, [0.34, 0.6, 0.29]);
      addLeaf(positions, colors, x, 0.2, z, [0.72, 0.36, 0.16], flowerIndex === 7 ? 0.22 : 0.17, [0.39, 0.64, 0.31]);
      const bloomY = 0.055 + height;
      if (flowerIndex === 4) {
        // Tulip: six overlapping tepals rise into a shallow, open cup.
        for (let tepal = 0; tepal < 6; tepal += 1) {
          const angle0 = tepal / 6 * Math.PI * 2;
          const angle1 = (tepal + 1) / 6 * Math.PI * 2;
          const middle = (angle0 + angle1) / 2;
          const baseY = bloomY - 0.035;
          const rimY = bloomY + (tepal % 2 ? 0.092 : 0.108);
          const base0 = [x + Math.cos(angle0) * 0.036, baseY, z + Math.sin(angle0) * 0.036];
          const base1 = [x + Math.cos(angle1) * 0.036, baseY, z + Math.sin(angle1) * 0.036];
          const rim0 = [x + Math.cos(angle0) * 0.085, rimY, z + Math.sin(angle0) * 0.085];
          const rim1 = [x + Math.cos(angle1) * 0.085, rimY, z + Math.sin(angle1) * 0.085];
          const shade = tepal % 2 ? 0.95 : 1.06;
          const tepalColor = headColor.map((channel) => Math.min(1, channel * shade));
          addTriangle(positions, colors, base0, rim0, rim1, tepalColor);
          addTriangle(positions, colors, base0, rim1, base1, tepalColor.map((channel) => channel * 0.96));
          const rib = [x + Math.cos(middle) * 0.062, bloomY + 0.035, z + Math.sin(middle) * 0.062];
          addTriangle(positions, colors, base0, rib, rim0, tepalColor.map((channel) => Math.min(1, channel * 1.04)));
        }
        addOctahedron(positions, colors, x, bloomY + 0.006, z, 0.023, 0.02, 0.023, [0.88, 0.67, 0.27]);
      } else if (flowerIndex === 5) {
        // Carnation: layered fan-shaped petals with a scalloped, fringed rim.
        const tiers = [
          { count: 12, inner: 0.018, outer: 0.14, y: bloomY - 0.018, width: 0.042, crown: 0.075 },
          { count: 11, inner: 0.014, outer: 0.112, y: bloomY + 0.012, width: 0.038, crown: 0.069 },
          { count: 9, inner: 0.009, outer: 0.075, y: bloomY + 0.039, width: 0.031, crown: 0.06 },
        ];
        for (let tier = 0; tier < tiers.length; tier += 1) {
          const shape = tiers[tier];
          for (let petal = 0; petal < shape.count; petal += 1) {
            const angle = petal / shape.count * Math.PI * 2 + tier * 0.24;
            const radial = [Math.cos(angle), Math.sin(angle)];
            const tangent = [-radial[1], radial[0]];
            const rootY = shape.y - shape.crown * 0.38;
            const root = [x + radial[0] * shape.inner, rootY, z + radial[1] * shape.inner];
            const innerLeft = [root[0] + tangent[0] * shape.width * 0.34, shape.y + shape.crown * 0.22, root[2] + tangent[1] * shape.width * 0.34];
            const innerRight = [root[0] - tangent[0] * shape.width * 0.34, shape.y + shape.crown * 0.22, root[2] - tangent[1] * shape.width * 0.34];
            const peaks = [-1, 0, 1].map((edge) => {
              const distance = shape.outer * (edge === 0 ? 1 : edge < 0 ? 0.83 : 0.9);
              const spread = edge * shape.width * 0.44;
              const height = shape.crown * (edge === 0 ? 0.78 : 0.62);
              return [x + radial[0] * distance + tangent[0] * spread, shape.y + height,
                z + radial[1] * distance + tangent[1] * spread];
            });
            const petalColor = (petal + tier) % 3 === 0
              ? headColor.map((channel) => Math.min(1, channel * 1.1))
              : (petal + tier) % 3 === 1 ? headColor.map((channel) => channel * 0.94) : headColor;
            addTriangle(positions, colors, root, innerLeft, peaks[0], petalColor);
            addTriangle(positions, colors, root, peaks[0], peaks[1], petalColor);
            addTriangle(positions, colors, root, peaks[1], peaks[2], petalColor.map((channel) => channel * 0.97));
            addTriangle(positions, colors, root, peaks[2], innerRight, petalColor);
          }
        }
        addOctahedron(positions, colors, x, bloomY + 0.035, z, 0.039, 0.044, 0.039, headColor);
      } else if (flowerIndex === 6) {
        // Chrysanthemum: several ranks of slender rays around a floret disk.
        const rayLayers = [
          { count: 24, inner: 0.035, outer: 0.17, y: bloomY - 0.01, width: 0.019, crown: 0.075 },
          { count: 19, inner: 0.032, outer: 0.132, y: bloomY + 0.018, width: 0.018, crown: 0.068 },
        ];
        for (let layer = 0; layer < rayLayers.length; layer += 1) {
          const shape = rayLayers[layer];
          for (let ray = 0; ray < shape.count; ray += 1) {
            const angle = ray / shape.count * Math.PI * 2 + layer * 0.12;
            const radial = [Math.cos(angle), Math.sin(angle)];
            const tangent = [-radial[1], radial[0]];
            const root = [x + radial[0] * shape.inner, shape.y - 0.018, z + radial[1] * shape.inner];
            const tip = [x + radial[0] * shape.outer, shape.y + (ray % 4 === 0 ? 0.025 : 0.017), z + radial[1] * shape.outer];
            const middleRadius = shape.inner + (shape.outer - shape.inner) * 0.58;
            const ridge = [x + radial[0] * middleRadius, shape.y + shape.crown, z + radial[1] * middleRadius];
            const left = [x + radial[0] * middleRadius + tangent[0] * shape.width, shape.y + shape.crown * 0.62,
              z + radial[1] * middleRadius + tangent[1] * shape.width];
            const right = [x + radial[0] * middleRadius - tangent[0] * shape.width, shape.y + shape.crown * 0.62,
              z + radial[1] * middleRadius - tangent[1] * shape.width];
            const petalColor = ray % 4 === 0 ? headColor.map((channel) => Math.min(1, channel * 1.08)) : headColor;
            addTriangle(positions, colors, root, left, ridge, petalColor.map((channel) => channel * 0.94));
            addTriangle(positions, colors, left, tip, ridge, petalColor);
            addTriangle(positions, colors, root, ridge, right, petalColor);
            addTriangle(positions, colors, ridge, tip, right, petalColor.map((channel) => channel * 0.95));
          }
        }
        const diskCount = 32;
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        for (let floret = 0; floret < diskCount; floret += 1) {
          const radius = 0.052 * Math.sqrt((floret + 0.5) / diskCount);
          const angle = floret * goldenAngle;
          addOctahedron(positions, colors, x + Math.cos(angle) * radius, bloomY + 0.025, z + Math.sin(angle) * radius,
            0.012, 0.014, 0.012, floret % 3 ? [0.77, 0.48, 0.17] : [0.9, 0.65, 0.23]);
        }
      } else if (flowerIndex === 7) {
        // Hydrangea: a rounded mophead built from four-sepal florets.
        const floretCount = 24;
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        for (let bloom = 0; bloom < floretCount; bloom += 1) {
          const vertical = 1 - 2 * (bloom + 0.5) / floretCount;
          const ring = Math.sqrt(1 - vertical * vertical);
          const angle = bloom * goldenAngle;
          const normal = [ring * Math.cos(angle), vertical, ring * Math.sin(angle)];
          const center = [x + normal[0] * 0.135, bloomY + normal[1] * 0.135, z + normal[2] * 0.135];
          const tangent = [-Math.sin(angle), 0, Math.cos(angle)];
          const bitangent = [
            normal[1] * tangent[2] - normal[2] * tangent[1],
            normal[2] * tangent[0] - normal[0] * tangent[2],
            normal[0] * tangent[1] - normal[1] * tangent[0],
          ];
          const petalColor = bloom % 3 === 0
            ? headColor.map((channel) => Math.min(1, channel * 1.1))
            : bloom % 3 === 1 ? headColor.map((channel) => channel * 0.93) : headColor;
          const petalRadius = 0.036;
          for (let petal = 0; petal < 4; petal += 1) {
            const petalAngle = petal * Math.PI / 2;
            const sideAngle = petalAngle + Math.PI / 2;
            const petalCenter = [
              center[0] + (tangent[0] * Math.cos(petalAngle) + bitangent[0] * Math.sin(petalAngle)) * 0.02,
              center[1] + (tangent[1] * Math.cos(petalAngle) + bitangent[1] * Math.sin(petalAngle)) * 0.02,
              center[2] + (tangent[2] * Math.cos(petalAngle) + bitangent[2] * Math.sin(petalAngle)) * 0.02,
            ];
            const sideOffset = petalRadius * 0.62;
            const side = [
              (tangent[0] * Math.cos(sideAngle) + bitangent[0] * Math.sin(sideAngle)) * sideOffset,
              (tangent[1] * Math.cos(sideAngle) + bitangent[1] * Math.sin(sideAngle)) * sideOffset,
              (tangent[2] * Math.cos(sideAngle) + bitangent[2] * Math.sin(sideAngle)) * sideOffset,
            ];
            const tip = [
              petalCenter[0] + (tangent[0] * Math.cos(petalAngle) + bitangent[0] * Math.sin(petalAngle)) * petalRadius,
              petalCenter[1] + (tangent[1] * Math.cos(petalAngle) + bitangent[1] * Math.sin(petalAngle)) * petalRadius,
              petalCenter[2] + (tangent[2] * Math.cos(petalAngle) + bitangent[2] * Math.sin(petalAngle)) * petalRadius,
            ];
            const left = [petalCenter[0] + side[0], petalCenter[1] + side[1], petalCenter[2] + side[2]];
            const right = [petalCenter[0] - side[0], petalCenter[1] - side[1], petalCenter[2] - side[2]];
            addTriangle(positions, colors, petalCenter, left, tip, petalColor);
            addTriangle(positions, colors, petalCenter, tip, right, petalColor);
          }
          addOctahedron(positions, colors, ...center, 0.009, 0.009, 0.009, [0.95, 0.83, 0.46]);
        }
      } else if (flowerIndex === 8) {
        // Lavender: whorls of tiny two-lipped florets on a tapered spike.
        const whorlCount = 7;
        for (let whorl = 0; whorl < whorlCount; whorl += 1) {
          const progress = whorl / (whorlCount - 1);
          const flowerCount = whorl < 2 ? 4 : 5;
          const whorlY = 0.055 + height * (0.52 + progress * 0.43);
          const whorlRadius = 0.043 * (1 - progress * 0.34);
          for (let flower = 0; flower < flowerCount; flower += 1) {
            const angle = flower / flowerCount * Math.PI * 2 + whorl * 0.48;
            const radial = [Math.cos(angle), Math.sin(angle)];
            const cx = x + radial[0] * whorlRadius;
            const cz = z + radial[1] * whorlRadius;
            const cy = whorlY + (flower % 2 ? 0.006 : -0.004);
            const shade = (flower + whorl) % 3 === 0 ? 1.1 : (flower + whorl) % 3 === 1 ? 0.94 : 1;
            const floretColor = headColor.map((channel) => Math.min(1, channel * shade));
            addOctahedron(positions, colors, cx, cy, cz, 0.018, 0.024, 0.018, floretColor);
            addOctahedron(positions, colors, cx + radial[0] * 0.018, cy + 0.018, cz + radial[1] * 0.018,
              0.014, 0.016, 0.014, floretColor);
            addOctahedron(positions, colors, cx - radial[0] * 0.012, cy + 0.013, cz - radial[1] * 0.012,
              0.013, 0.014, 0.013, floretColor.map((channel) => channel * 0.92));
            const bract = [0.35, 0.52, 0.3];
            addTriangle(positions, colors,
              [cx - radial[0] * 0.016, cy - 0.017, cz - radial[1] * 0.016],
              [cx + radial[0] * 0.014, cy - 0.012, cz + radial[1] * 0.014],
              [cx - radial[0] * 0.03, cy - 0.036, cz - radial[1] * 0.03], bract);
          }
        }
      } else if (flowerIndex === 10) {
        // Red spider lily: six five-petal florets arranged at the face centers
        // of a vertex-up regular dodecahedron. Their normals are the vertices
        // of the dual icosahedron after one triangular face is rotated upward.
        // The six mid-height faces are exactly 60 degrees apart in azimuth;
        // their slight height changes come from the geometry, not a manual offset.
        const faceNormals = [
          [0.974418, 0.187592, 0.123767],
          [0.380023, -0.187592, 0.905755],
          [-0.594395, 0.187592, 0.781987],
          [-0.974418, -0.187592, -0.123767],
          [-0.380023, 0.187592, -0.905755],
          [0.594395, -0.187592, -0.781987],
        ];
        // Pull the six floret centers closer to the main stem and enlarge
        // each bloom so the head reads as a dense, connected cluster.
        const clusterRadius = 0.045;
        const petalScale = 1.35;
        const filamentScale = 0.90;

        for (let bloom = 0; bloom < faceNormals.length; bloom += 1) {
          const normal = faceNormals[bloom];
          const reference = Math.abs(normal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
          const cross = (a, b) => [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
          ];
          const normalize = (v) => {
            const length = Math.hypot(v[0], v[1], v[2]) || 1;
            return v.map((component) => component / length);
          };
          const right = normalize(cross(reference, normal));
          const forward = normalize(cross(normal, right));
          // Pull each center inward from its face-center direction toward the main stem.
          const cx = x + normal[0] * clusterRadius;
          const cy = bloomY + normal[1] * clusterRadius;
          const cz = z + normal[2] * clusterRadius;
          const localPoint = (lx, ly, lz) => [
            cx + right[0] * lx + normal[0] * ly + forward[0] * lz,
            cy + right[1] * lx + normal[1] * ly + forward[1] * lz,
            cz + right[2] * lx + normal[2] * ly + forward[2] * lz,
          ];
          const petalPoint = (radius, side, axial, angle) => {
            const tangentX = -Math.sin(angle);
            const tangentZ = Math.cos(angle);
            const localX = (Math.cos(angle) * radius + tangentX * side) * petalScale;
            const localZ = (Math.sin(angle) * radius + tangentZ * side) * petalScale;
            return localPoint(localX, axial * petalScale, localZ);
          };
          const bloomColor = bloom % 3 === 0
            ? headColor.map((channel) => Math.min(1, channel * 1.1))
            : bloom % 3 === 1 ? headColor.map((channel) => channel * 0.92) : headColor;

          // Five narrow petals per small flower, each with a curled-back tip.
          for (let petal = 0; petal < 5; petal += 1) {
            const angle = petal / 5 * Math.PI * 2 + bloom * 0.17;
            const root = petalPoint(0.006, 0, -0.012, angle);
            const left = petalPoint(0.04, -0.014, 0.006, angle);
            const rightEdge = petalPoint(0.04, 0.014, 0.006, angle);
            const ridge = petalPoint(0.073, 0, 0.026, angle);
            const outerLeft = petalPoint(0.105, -0.008, 0.008, angle);
            const outerRight = petalPoint(0.105, 0.008, 0.008, angle);
            const curledTip = petalPoint(0.079, 0, -0.026, angle);
            addTriangle(positions, colors, root, left, ridge, bloomColor.map((channel) => channel * 0.92));
            addTriangle(positions, colors, root, ridge, rightEdge, bloomColor);
            addTriangle(positions, colors, ridge, outerLeft, curledTip, bloomColor);
            addTriangle(positions, colors, ridge, curledTip, outerRight, bloomColor.map((channel) => channel * 0.94));
          }
          addOctahedron(positions, colors, cx, cy, cz, 0.009, 0.009, 0.009, bloomColor);

          // Three stamens per small flower: 120-degree azimuth spacing plus
          // distinct local elevations give each group a true 3D radial spread.
          for (let filament = 0; filament < 3; filament += 1) {
            const angle = filament / 3 * Math.PI * 2 + bloom * 0.23 + 0.11;
            const tangentX = -Math.sin(angle);
            const tangentZ = Math.cos(angle);
            const radialX = Math.cos(angle);
            const radialZ = Math.sin(angle);
            const path = [
              { radius: 0.012, height: 0.022 + filament * 0.003 },
              { radius: 0.047, height: 0.007 + ((filament + 1) % 3) * 0.004 },
              { radius: 0.087, height: 0.032 + filament * 0.004 },
              { radius: 0.145, height: 0.076 + filament * 0.007 },
            ];
            const stalkColor = filament === 1 ? [0.98, 0.62, 0.58] : [0.91, 0.35, 0.43];
            for (let segment = 0; segment < path.length - 1; segment += 1) {
              const from = path[segment];
              const to = path[segment + 1];
              const widthStart = 0.003 * (1 - segment * 0.12);
              const widthEnd = widthStart * 0.78;
              const pointAt = (node, sideWidth) => localPoint(
                (radialX * node.radius + tangentX * sideWidth) * filamentScale,
                node.height * filamentScale,
                (radialZ * node.radius + tangentZ * sideWidth) * filamentScale,
              );
              const a = pointAt(from, widthStart);
              const b = pointAt(from, -widthStart);
              const d = pointAt(to, widthEnd);
              const e = pointAt(to, -widthEnd);
              addTriangle(positions, colors, a, d, e, stalkColor);
              addTriangle(positions, colors, a, e, b, stalkColor.map((channel) => channel * 0.88));
            }
            const tipPath = path[path.length - 1];
            const tip = localPoint(
              radialX * tipPath.radius * filamentScale,
              tipPath.height * filamentScale,
              radialZ * tipPath.radius * filamentScale,
            );
            // Small golden anthers remain visible at the tips of all 18 filaments.
            addOctahedron(positions, colors, tip[0], tip[1], tip[2], 0.0055, 0.0055, 0.0055, [0.99, 0.76, 0.32]);
          }
        }
      } else {
        // Peony: broad guard petals enclose rounded inner petaloids.
        const petalRows = [
          { count: 9, radius: 0.105, y: bloomY, rx: 0.062, ry: 0.045, rz: 0.052 },
          { count: 11, radius: 0.068, y: bloomY + 0.027, rx: 0.052, ry: 0.05, rz: 0.045 },
          { count: 9, radius: 0.034, y: bloomY + 0.055, rx: 0.041, ry: 0.044, rz: 0.037 },
        ];
        for (let row = 0; row < petalRows.length; row += 1) {
          const shape = petalRows[row];
          for (let petal = 0; petal < shape.count; petal += 1) {
            const angle = petal / shape.count * Math.PI * 2 + row * 0.29;
            const shade = (petal + row) % 3 === 0 ? 1.1 : (petal + row) % 3 === 1 ? 0.94 : 1;
            const color = headColor.map((channel) => Math.min(1, channel * shade));
            addOctahedron(positions, colors,
              x + Math.cos(angle) * shape.radius, shape.y + Math.sin(angle) * (row === 0 ? 0.018 : 0.01), z + Math.sin(angle) * shape.radius,
              shape.rx, shape.ry, shape.rz, color);
          }
        }
        for (let sepal = 0; sepal < 5; sepal += 1) {
          const angle = sepal / 5 * Math.PI * 2;
          addOctahedron(positions, colors, x + Math.cos(angle) * 0.076, bloomY - 0.025, z + Math.sin(angle) * 0.076,
            0.032, 0.018, 0.03, [0.32, 0.52, 0.28]);
        }
        addOctahedron(positions, colors, x, bloomY + 0.064, z, 0.028, 0.03, 0.028, [0.91, 0.69, 0.3]);
      }
      return;
    }

    if (flowerIndex === 0) {
      addLeaf(positions, colors, x, 0.35, z, [-0.8, 0.32, -0.14], 0.29, [0.36, 0.62, 0.27]);
      addLeaf(positions, colors, x, 0.49, z, [0.77, 0.34, 0.18], 0.27, [0.39, 0.66, 0.29]);
      const headY = 0.055 + height;
      const flowerHeadStart = positions.length;
      // Layered ray florets form the familiar face-on sunflower silhouette.
      addOctahedron(positions, colors, x, headY, z + 0.014, 0.081, 0.081, 0.045, [0.34, 0.18, 0.09]);
      for (let petal = 0; petal < 20; petal += 1) {
        const angle = (petal / 20) * Math.PI * 2;
        const radial = [Math.cos(angle), Math.sin(angle)];
        const tangent = [-radial[1], radial[0]];
        const layer = petal % 2 ? 0 : 1;
        const innerRadius = layer ? 0.066 : 0.047;
        const outerRadius = layer ? 0.19 : 0.16;
        const halfWidth = layer ? 0.027 : 0.025;
        const depth = layer ? 0.005 : -0.008;
        const root = [x + radial[0] * innerRadius, headY + radial[1] * innerRadius, z + depth];
        const tip = [x + radial[0] * outerRadius, headY + radial[1] * outerRadius, z + depth - 0.008];
        const middleRadius = innerRadius + (outerRadius - innerRadius) * 0.55;
        const ridge = [x + radial[0] * middleRadius, headY + radial[1] * middleRadius, z + depth + 0.04];
        const left = [x + radial[0] * middleRadius + tangent[0] * halfWidth,
          headY + radial[1] * middleRadius + tangent[1] * halfWidth, z + depth + 0.02];
        const right = [x + radial[0] * middleRadius - tangent[0] * halfWidth,
          headY + radial[1] * middleRadius - tangent[1] * halfWidth, z + depth + 0.02];
        const petalColor = petal % 3 === 0 ? headColor.map((channel) => Math.min(1, channel * 1.08)) : headColor;
        addTriangle(positions, colors, root, left, ridge, petalColor.map((channel) => channel * 0.94));
        addTriangle(positions, colors, left, tip, ridge, petalColor);
        addTriangle(positions, colors, root, ridge, right, petalColor);
        addTriangle(positions, colors, ridge, tip, right, petalColor.map((channel) => channel * 0.94));
      }
      // Small florets spiral across the raised dark disk rather than a single lump.
      const diskFlorets = 48;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      for (let floret = 0; floret < diskFlorets; floret += 1) {
        const radius = 0.073 * Math.sqrt((floret + 0.5) / diskFlorets);
        const angle = floret * goldenAngle;
        const diskColor = floret % 4 === 0 ? [0.52, 0.31, 0.15] : [0.37, 0.2, 0.1];
        addOctahedron(positions, colors, x + Math.cos(angle) * radius, headY + Math.sin(angle) * radius, z + 0.026,
          0.012, 0.012, 0.012, diskColor);
      }
      for (let bract = 0; bract < 12; bract += 1) {
        const angle = bract / 12 * Math.PI * 2;
        addOctahedron(positions, colors, x + Math.cos(angle) * 0.075, headY + Math.sin(angle) * 0.075, z - 0.004,
          0.021, 0.018, 0.014, [0.32, 0.49, 0.23]);
      }
      const headCos = Math.cos(environmentState.sunflowerYaw), headSin = Math.sin(environmentState.sunflowerYaw);
      for (let vertex = flowerHeadStart; vertex < positions.length; vertex += 3) {
        const offsetX = positions[vertex] - x, offsetZ = positions[vertex + 2] - z;
        positions[vertex] = x + offsetX * headCos + offsetZ * headSin;
        positions[vertex + 2] = z - offsetX * headSin + offsetZ * headCos;
      }
      return;
    }

    if (flowerIndex === 1) {
      addLeaf(positions, colors, x, 0.12, z, [-0.82, 0.31, -0.14], 0.2, [0.32, 0.58, 0.32]);
      addLeaf(positions, colors, x, 0.12, z, [0.75, 0.36, 0.18], 0.2, [0.36, 0.63, 0.34]);
      // A dense upright raceme of individual six-part, flared florets.
      const rows = 6;
      for (let row = 0; row < rows; row += 1) {
        const count = row === 0 || row === rows - 1 ? 3 : 4;
        const rowY = 0.055 + height * (0.49 + row * 0.095);
        const rowRadius = 0.035 + Math.sin((row + 1) / (rows + 1) * Math.PI) * 0.048;
        for (let bloom = 0; bloom < count; bloom += 1) {
          const angle = (bloom / count) * Math.PI * 2 + row * 0.43;
          const radial = [Math.cos(angle), 0, Math.sin(angle)];
          const tangent = [-Math.sin(angle), 0, Math.cos(angle)];
          const center = [x + radial[0] * rowRadius, rowY, z + radial[2] * rowRadius];
          const width = 0.014;
          for (let lobe = 0; lobe < 6; lobe += 1) {
            const lobeAngle = lobe / 6 * Math.PI * 2;
            const up = Math.cos(lobeAngle) * 0.014;
            const side = Math.sin(lobeAngle) * 0.014;
            const root = [center[0] + radial[0] * 0.013, center[1] + up, center[2] + radial[2] * 0.013];
            const tip = [center[0] + radial[0] * 0.066, center[1] + up * 1.8, center[2] + radial[2] * 0.066];
            const left = [center[0] + radial[0] * 0.034 + tangent[0] * width + tangent[0] * side,
              center[1] + up, center[2] + radial[2] * 0.034 + tangent[2] * width + tangent[2] * side];
            const right = [center[0] + radial[0] * 0.034 - tangent[0] * width + tangent[0] * side,
              center[1] + up, center[2] + radial[2] * 0.034 - tangent[2] * width + tangent[2] * side];
            addTriangle(positions, colors, root, left, tip, headColor);
            addTriangle(positions, colors, root, tip, right, headColor.map((channel) => channel * 0.94));
          }
          addOctahedron(positions, colors, ...center, 0.018, 0.018, 0.018, headColor);
        }
      }
      return;
    }

    if (flowerIndex === 2) {
      addLeaf(positions, colors, x, 0.13, z, [-0.88, 0.18, -0.28], 0.39, [0.36, 0.61, 0.31]);
      addLeaf(positions, colors, x, 0.14, z, [0.88, 0.2, 0.26], 0.38, [0.41, 0.66, 0.34]);
      const bellCount = 6;
      for (let bell = 0; bell < bellCount; bell += 1) {
        const progress = bell / (bellCount - 1);
        const offset = -0.13 + progress * 0.25 + Math.sin(bell * 1.7) * 0.014;
        const depthOffset = bell % 2 === 0 ? -0.026 : 0.026;
        const offsetY = bell % 2 === 0 ? 0.008 : -0.006;
        const bellY = 0.055 + height * (0.82 - progress * 0.2) + offsetY;
        const cx = x + offset;
        const cz = z + depthOffset;
        const cy = bellY - 0.026;
        const green = [0.36, 0.57, 0.31];
        addTriangle(positions, colors, [x, bellY + 0.04, z], [cx, bellY + 0.018, cz - 0.008], [cx, bellY + 0.018, cz + 0.008], green);
        const innerRadius = 0.014;
        const rimRadius = 0.047;
        for (let lobe = 0; lobe < 6; lobe += 1) {
          const a0 = lobe / 6 * Math.PI * 2;
          const a1 = (lobe + 1) / 6 * Math.PI * 2;
          const top0 = [cx + Math.cos(a0) * innerRadius, cy + 0.026, cz + Math.sin(a0) * innerRadius];
          const top1 = [cx + Math.cos(a1) * innerRadius, cy + 0.026, cz + Math.sin(a1) * innerRadius];
          const rim0 = [cx + Math.cos(a0) * rimRadius, cy - 0.023, cz + Math.sin(a0) * rimRadius];
          const rim1 = [cx + Math.cos(a1) * rimRadius, cy - 0.023, cz + Math.sin(a1) * rimRadius];
          const shade = lobe % 2 ? 0.93 : 1.04;
          const petalColor = headColor.map((channel) => Math.min(1, channel * shade));
          addTriangle(positions, colors, top0, rim0, rim1, petalColor);
          addTriangle(positions, colors, top0, rim1, top1, petalColor.map((channel) => channel * 0.97));
        }
        addOctahedron(positions, colors, cx, cy + 0.006, cz, 0.012, 0.013, 0.012, headColor.map((channel) => channel * 0.9));
      }
      return;
    }

    const bloomY = 0.055 + height;
    if (flowerIndex === 3) {
      // Rose: overlapping petals curl around a tight, clockwise spiral center.
      const roseLayers = [
        { count: 10, radius: 0.098, length: 0.086, width: 0.039, y: bloomY - 0.04, crown: 0.075, phase: 0, sweep: 0.46 },
        { count: 9, radius: 0.069, length: 0.076, width: 0.036, y: bloomY - 0.015, crown: 0.085, phase: 0.31, sweep: 0.54 },
        { count: 7, radius: 0.041, length: 0.061, width: 0.03, y: bloomY + 0.014, crown: 0.075, phase: 0.72, sweep: 0.62 },
        { count: 5, radius: 0.017, length: 0.043, width: 0.024, y: bloomY + 0.043, crown: 0.055, phase: 1.28, sweep: 0.68 },
      ];
      for (let layer = 0; layer < roseLayers.length; layer += 1) {
        const ring = roseLayers[layer];
        for (let petal = 0; petal < ring.count; petal += 1) {
          const angle = (petal / ring.count) * Math.PI * 2 + ring.phase;
          const point = (along, across, y) => [
            x + Math.cos(angle) * (ring.radius + along) - Math.sin(angle) * (across + along * ring.sweep),
            y,
            z + Math.sin(angle) * (ring.radius + along) + Math.cos(angle) * (across + along * ring.sweep),
          ];
          const root = point(-ring.length * 0.56, 0, ring.y - 0.035);
          const leftShoulder = point(-ring.length * 0.04, -ring.width * 0.68, ring.y + ring.crown * 0.6);
          const ridge = point(ring.length * 0.02, 0, ring.y + ring.crown);
          const rightShoulder = point(-ring.length * 0.04, ring.width * 0.68, ring.y + ring.crown * 0.6);
          const leftLip = point(ring.length * 0.5, -ring.width * 0.48, ring.y + ring.crown * 0.72);
          const lip = point(ring.length * (0.5 + (petal % 2) * 0.035), 0, ring.y + ring.crown * 0.84);
          const rightLip = point(ring.length * 0.5, ring.width * 0.48, ring.y + ring.crown * 0.72);
          const colorScale = (petal + layer) % 3 === 0 ? 1.09 : (petal + layer) % 3 === 1 ? 0.92 : 1;
          const petalColor = headColor.map((channel) => Math.min(1, channel * colorScale));
          const shadeColor = petalColor.map((channel) => channel * 0.9);
          addTriangle(positions, colors, root, leftShoulder, ridge, shadeColor);
          addTriangle(positions, colors, leftShoulder, leftLip, lip, petalColor);
          addTriangle(positions, colors, leftShoulder, lip, ridge, petalColor);
          addTriangle(positions, colors, root, ridge, rightShoulder, petalColor);
          addTriangle(positions, colors, rightShoulder, lip, rightLip, shadeColor);
          addTriangle(positions, colors, rightShoulder, ridge, lip, petalColor);
        }
      }
      for (let sepal = 0; sepal < 5; sepal += 1) {
        const angle = sepal / 5 * Math.PI * 2 + 0.2;
        const root = [x + Math.cos(angle) * 0.025, bloomY - 0.012, z + Math.sin(angle) * 0.025];
        const tip = [x + Math.cos(angle) * 0.105, bloomY - 0.055, z + Math.sin(angle) * 0.105];
        const side = [-Math.sin(angle) * 0.018, 0, Math.cos(angle) * 0.018];
        addTriangle(positions, colors, root,
          [tip[0] + side[0], tip[1], tip[2] + side[2]], tip, [0.3, 0.5, 0.25]);
        addTriangle(positions, colors, root, tip,
          [tip[0] - side[0], tip[1], tip[2] - side[2]], [0.34, 0.55, 0.28]);
      }
      return;
    }

    addLeaf(positions, colors, x, 0.22, z, [-0.82, 0.38, -0.12], 0.22, [0.31, 0.58, 0.3]);
    addLeaf(positions, colors, x, 0.32, z, [0.74, 0.34, 0.16], 0.21, [0.37, 0.64, 0.33]);
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = (petal / 5) * Math.PI * 2;
      addOctahedron(positions, colors, x + Math.cos(angle) * 0.055, bloomY, z + Math.sin(angle) * 0.055,
         0.06, 0.055, 0.06, petal % 2 ? headColor.map((channel) => Math.min(1, channel * 0.9)) : headColor);
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
      const colorScale = 1.025 + random(patch, 5) * 0.085;
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

  function addSoilTexture(positions, colors, x, z, bed, y, wet) {
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
    for (const [offsetX, offsetZ, length, angle, width, shade] of marks) {
      const cx = x + Math.max(-limit, Math.min(limit, offsetX));
      const cz = z + Math.max(-limit, Math.min(limit, offsetZ));
      const dx = Math.cos(angle) * length * 0.5, dz = Math.sin(angle) * length * 0.5;
      const px = -Math.sin(angle) * width * 0.5, pz = Math.cos(angle) * width * 0.5;
      const a = [cx - dx + px, y, cz - dz + pz];
      const b = [cx + dx + px, y, cz + dz + pz];
      const d = [cx - dx - px, y, cz - dz - pz];
      const e = [cx + dx - px, y, cz + dz - pz];
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
  function addGrassRamp(positions, colors, index, x, z, half, y) {
    const source = plotPositions[index];
    const heightAtCorner = (cornerX, cornerZ) => {
      const touching = plotPositions.map((position, neighborIndex) => ({ position, neighborIndex }))
        .filter(({ position, neighborIndex }) => neighborIndex !== index
          && Math.abs(position.x - cornerX) <= half + 1e-8
          && Math.abs(position.z - cornerZ) <= half + 1e-8);
      const cardinal = touching.filter(({ position }) => Math.abs(position.x - source.x) + Math.abs(position.z - source.z) < 1.5);
      const relevant = cardinal.length ? cardinal : touching;
      if (!relevant.length) return y;
      return relevant.reduce((sum, { position }) => sum + (position.y || 0), 0) / relevant.length;
    };
    const corners = [
      { x: x - half, z: z - half, side: [0.55, 0.39, 0.28] },
      { x: x + half, z: z - half, side: [0.48, 0.33, 0.25] },
      { x: x + half, z: z + half, side: [0.57, 0.4, 0.29] },
      { x: x - half, z: z + half, side: [0.5, 0.35, 0.26] },
    ];
    corners.forEach((corner) => { corner.y = heightAtCorner(corner.x, corner.z); corner.top = [corner.x, corner.y, corner.z]; });
    const bottomY = y - 0.5;
    const grass = [0.43, 0.68, 0.39];
    const diagonalA = Math.abs(corners[0].y - corners[2].y);
    const diagonalB = Math.abs(corners[1].y - corners[3].y);
    const useDiagonalA = diagonalA <= diagonalB;
    if (diagonalA <= diagonalB) {
      addTriangle(positions, colors, corners[0].top, corners[1].top, corners[2].top, grass);
      addTriangle(positions, colors, corners[0].top, corners[2].top, corners[3].top, grass);
    } else {
      addTriangle(positions, colors, corners[0].top, corners[1].top, corners[3].top, grass);
      addTriangle(positions, colors, corners[1].top, corners[2].top, corners[3].top, grass);
    }
    for (let edgeIndex = 0; edgeIndex < corners.length; edgeIndex += 1) {
      const first = corners[edgeIndex], second = corners[(edgeIndex + 1) % corners.length];
      const firstBottom = [first.x, bottomY, first.z], secondBottom = [second.x, bottomY, second.z];
      addTriangle(positions, colors, firstBottom, secondBottom, second.top, first.side);
      addTriangle(positions, colors, firstBottom, second.top, first.top, first.side);
    }
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
    const unitCoords = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const unitCorners = corners.map((corner, cornerIndex) => ({ ...corner, u: unitCoords[cornerIndex][0], v: unitCoords[cornerIndex][1] }));
    const surfaceHeightAt = (px, pz) => {
      const [u, v] = toUnit(px, pz);
      if (useDiagonalA) return v <= u
        ? triangleHeight(px, pz, unitCorners[0], unitCorners[1], unitCorners[2])
        : triangleHeight(px, pz, unitCorners[0], unitCorners[2], unitCorners[3]);
      return u + v <= 1
        ? triangleHeight(px, pz, unitCorners[0], unitCorners[1], unitCorners[3])
        : triangleHeight(px, pz, unitCorners[1], unitCorners[2], unitCorners[3]);
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
        const phase = (time * 0.0015 + particle * 0.23 + index * 0.17) % 1;
        const angle = particle * 2.399 + index;
        const radius = 0.16 + (particle % 2) * 0.07;
        const px = plantX + Math.cos(angle) * radius;
        const pz = plantZ + Math.sin(angle) * radius;
        const py = plantY + 0.16 + phase * 0.38;
        const size = 0.018 + Math.sin(phase * Math.PI) * 0.009;
        addOctahedron(effectPositions, effectColors, px, py, pz, size, size * 1.6, size, [0.47, 0.78, 0.72]);
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
      const climbDuration = durationForDistance(Math.abs(laneY - startY));
      const outboundDistance = routeLength(animation.outboundRoute);
      const horizontalDuration = durationForDistance(outboundDistance);
      const descentDuration = durationForDistance(Math.abs(laneY - workY));
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
        y = laneY + (workY - laneY) * descentProgress;
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
      const completing = elapsed >= returnStart + (animation.returning === false ? 0 : returnDuration);
      if (completing && animation.returning !== false) { x = idleX; y = idleY; z = idleZ; }
      return { x, y, z, elapsed, workProgress, completing, returnStart };
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
      if (animation && candidate.completing && state.animation === animation) {
        state.animation = null;
        const onComplete = animation.onComplete;
        animation.onComplete = null;
        onComplete?.();
        if (state.animation === null && animation.returning === false) {
          animation.returning = true;
          animation.elapsed = candidate.returnStart;
          state.animation = animation;
        }
      }
    }
    droneVertexCount = positions.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, dronePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, droneColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    effectVertexCount = effectPositions.length / 3;
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
      const wet = rainWet || postWaterWet;
      let plantBaseY = plotY;
      if (plot?.grassOnly) {
        const surfaceHeightAt = addGrassRamp(positions, colors, i, x, z, half, plotY);
        plantBaseY = surfaceHeightAt(x, z);
        addGrassTexture(positions, colors, x, z, half, plotY, [0.43, 0.68, 0.39], surfaceHeightAt);
      }
      else {
        addBox(positions, colors, x - half, plotY - 0.5, z - half, x + half, plotY, z + half, {
          top: [0.43, 0.68, 0.39], front: [0.57, 0.37, 0.27], right: [0.48, 0.31, 0.25],
          back: [0.58, 0.39, 0.28], left: [0.51, 0.33, 0.25], bottom: [0.4, 0.28, 0.24],
        });
        addGrassTexture(positions, colors, x, z, half, plotY, [0.43, 0.68, 0.39]);
      }
      const bed = TILE * 0.66;
      if (!plot?.grassOnly) addBox(positions, colors, x - bed / 2, plotY + 0.001, z - bed / 2, x + bed / 2, plotY + 0.055, z + bed / 2, wet ? {
        top: [0.43, 0.29, 0.2], front: [0.39, 0.26, 0.19], right: [0.36, 0.24, 0.18],
        back: [0.41, 0.27, 0.2], left: [0.38, 0.25, 0.19], bottom: [0.34, 0.23, 0.18],
      } : {
        top: [0.66, 0.45, 0.31], front: [0.57, 0.38, 0.28], right: [0.53, 0.35, 0.27],
        back: [0.6, 0.4, 0.29], left: [0.56, 0.37, 0.27], bottom: [0.5, 0.34, 0.26],
      });
      if (!plot?.grassOnly) addSoilTexture(positions, colors, x, z, bed, plotY + 0.057, wet);
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
      if (plot && Number.isInteger(plot.crop) && Number.isFinite(plot.plantedAt)) {
        const elapsed = Number.isFinite(plot.elapsed) ? plot.elapsed : Math.max(0, Date.now() - plot.plantedAt);
        const growTime = Number.isFinite(plot.growTime) && plot.growTime > 0 ? plot.growTime : 15_000;
        const progress = Math.min(1, elapsed / growTime);
        const stage = progress >= 1 ? 2 : progress >= 0.28 ? 1 : 0;
        const flowerVertexStart = positions.length;
        addFlowerModel(positions, colors, x, z, plot.crop, stage, Number.isFinite(plot.plantHeight) ? plot.plantHeight : 1, plot.customColor);
        for (let vertex = flowerVertexStart + 1; vertex < positions.length; vertex += 3) positions[vertex] += plantBaseY;
      }
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
    if (dragPreview && Number.isInteger(dragPreview.index)) {
      const [x, z] = getPlotPosition(dragPreview.index);
      const y = 1.18;
      const shaft = { top: [0.98, 0.78, 0.3], front: [0.86, 0.62, 0.2], right: [0.82, 0.58, 0.18], back: [0.92, 0.69, 0.23], left: [0.84, 0.6, 0.19], bottom: [0.75, 0.5, 0.16] };
      const tipColor = [1, 0.82, 0.3];
      addBox(positions, colors, x - 0.34, y, z - 0.025, x + 0.34, y + 0.025, z + 0.025, shaft);
      addTriangle(positions, colors, [x - 0.49, y + 0.026, z], [x - 0.27, y + 0.026, z - 0.11], [x - 0.27, y + 0.026, z + 0.11], tipColor);
      addTriangle(positions, colors, [x + 0.49, y + 0.026, z], [x + 0.27, y + 0.026, z + 0.11], [x + 0.27, y + 0.026, z - 0.11], tipColor);
      addBox(positions, colors, x - 0.025, y + 0.035, z - 0.34, x + 0.025, y + 0.06, z + 0.34, shaft);
      addTriangle(positions, colors, [x, y + 0.061, z - 0.49], [x - 0.11, y + 0.061, z - 0.27], [x + 0.11, y + 0.061, z - 0.27], tipColor);
      addTriangle(positions, colors, [x, y + 0.061, z + 0.49], [x + 0.11, y + 0.061, z + 0.27], [x - 0.11, y + 0.061, z + 0.27], tipColor);
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
    const candidates = [];
    const hitRadius = Math.max(72, Math.min(104, Math.min(canvas.clientWidth, canvas.clientHeight) * 0.18));
    for (let index = 0; index < droneCount; index += 1) {
      if (droneDocks[index]?.deployed === false) continue;
      const [dockX, dockZ] = getDockPosition(index);
      const platformY = 1.366 + getDockHeight(index);
      const center = projectPoint([dockX, platformY, dockZ]);
      if (!center) continue;
      const polygon = [
        projectPoint([dockX - 0.34, platformY, dockZ - 0.3]),
        projectPoint([dockX + 0.34, platformY, dockZ - 0.3]),
        projectPoint([dockX + 0.34, platformY, dockZ + 0.3]),
        projectPoint([dockX - 0.34, platformY, dockZ + 0.3]),
      ];
      const onPlatform = polygon.every(Boolean) && pointInPolygon(xAtCanvas, yAtCanvas, polygon);
      const distanceToCenter = Math.hypot(xAtCanvas - center.x, yAtCanvas - center.y);
      if (onPlatform || distanceToCenter <= hitRadius) candidates.push({ index, onPlatform, distanceToCenter });
    }
    candidates.sort((a, b) => Number(b.onPlatform) - Number(a.onPlatform) || a.distanceToCenter - b.distanceToCenter);
    return candidates[0]?.index ?? null;
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
  function draw(time) {
    const delta = previousTime ? time - previousTime : 16;
    previousTime = time;
    moveCamera(delta);
    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    updateDroneFrame(time);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(locations.color);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
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
    gl.drawArrays(gl.TRIANGLES, 0, effectVertexCount);
    gl.bindBuffer(gl.ARRAY_BUFFER, dronePositionBuffer);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, droneColorBuffer);
    gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, droneVertexCount);
    requestAnimationFrame(draw);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size === 2) {
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
    rotateTouchGesture = event.pointerType === 'touch'
      && window.matchMedia?.('(max-width: 700px)').matches === true
      && Date.now() - lastEmptyTouchAt <= 500;
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
    if (dockHitAtPointer !== null && !hasDroneAnimations()) {
      const pressedDock = dockHitAtPointer;
      if (heightEdit?.kind === 'dock' && heightEdit.index === pressedDock && heightEdit.mode === 'height') {
        const [x, z] = getDockPosition(pressedDock); const baseY = 1.36 + getDockHeight(pressedDock);
        const low = projectPoint([x, baseY, z]), high = projectPoint([x, baseY + 1, z]);
        heightDrag = { kind: 'dock', index: pressedDock, startY: event.clientY, original: getDockHeight(pressedDock), pixelStep: low && high ? Math.max(1, Math.abs(high.y - low.y)) : 48 };
      } else dockPressTimer = setTimeout(() => {
        if (!dragging || dockHitAtPointer !== pressedDock) return;
        dragDock = dockPressReady = true;
        const worldPoint = screenToGround(pointerStartX, pointerStartY);
        const [dockX, dockZ] = getDockPosition(pressedDock);
        dockDragOffset = worldPoint ? [dockX - worldPoint[0], dockZ - worldPoint[1]] : [0, 0];
        dockPreview = { index: pressedDock, x: dockX, z: dockZ, y: getDockHeight(pressedDock) };
        uploadWorld();
      }, 500);
    }
    pointerPlotIndex = dockHitAtPointer !== null ? null : findPlotAt(event.clientX, event.clientY);
    plotPressIndex = pointerPlotIndex;
    plotPressReady = false;
    dragPlotIndex = null;
    if (plotPressIndex !== null) {
      const pressedPlot = plotPressIndex;
      if (heightEdit?.kind === 'plot' && heightEdit.index === pressedPlot && heightEdit.mode === 'height') {
        const [x, z] = getPlotPosition(pressedPlot); const baseY = getPlotHeight(pressedPlot) + 0.08;
        const low = projectPoint([x, baseY, z]), high = projectPoint([x, baseY + 0.5, z]);
        heightDrag = { kind: 'plot', index: pressedPlot, startY: event.clientY, original: getPlotHeight(pressedPlot), pixelStep: low && high ? Math.max(1, Math.abs(high.y - low.y)) : 48 };
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
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
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
      const worldPoint = screenToGround(event.clientX, event.clientY);
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
    if (event.pointerType === 'touch' && window.matchMedia?.('(max-width: 700px)').matches === true) {
      const deltaX = event.clientX - lastPointerX;
      const deltaY = event.clientY - lastPointerY;
      if (rotateTouchGesture) {
        if (cameraMode !== '2d') {
          yaw -= deltaX * 0.008;
          pitch = Math.max(0.18, Math.min(1.28, pitch + deltaY * 0.006));
        }
      } else if (cameraMode === '2d') {
        const panScale = topDownHeight / 12 * 0.012;
        targetX -= deltaX * panScale;
        targetZ += deltaY * panScale;
      } else {
        const forwardX = -Math.sin(yaw);
        const forwardZ = -Math.cos(yaw);
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        const panScale = 0.008;
        targetX -= rightX * deltaX * panScale - forwardX * deltaY * panScale;
        targetZ -= rightZ * deltaX * panScale - forwardZ * deltaY * panScale;
      }
    } else if (cameraMode !== '2d') {
      yaw -= (event.clientX - lastPointerX) * 0.008;
      pitch = Math.max(0.18, Math.min(1.28, pitch + (event.clientY - lastPointerY) * 0.006));
    }
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch') touchPoints.delete(event.pointerId);
    if (suppressTouchTap) {
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
      heightDrag = null;
      if (touchPoints.size === 0) suppressTouchTap = false;
      uploadWorld();
      return;
    }
    dragging = false;
    clearTimeout(plotPressTimer);
    clearTimeout(dockPressTimer);
    const heldWithoutDragging = plotPressReady && plotPressIndex !== null && !pointerMoved;
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
      if (dockPressReady && !pointerMoved) {
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
      if (event.pointerType === 'touch' && window.matchMedia?.('(max-width: 700px)').matches === true
        && pointerPlotIndex === null && dockHitAtPointer === null) {
        lastEmptyTouchAt = Date.now();
      }
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
    dockPreview = null;
    dragPreview = null;
    uploadWorld();
  });
  canvas.addEventListener('pointercancel', (event) => { if (event.pointerType === 'touch') touchPoints.delete(event.pointerId); if (touchPoints.size === 0) { pinchActive = false; suppressTouchTap = false; } clearTimeout(plotPressTimer); clearTimeout(dockPressTimer); dragging = false; dragPlotIndex = null; dragPreview = null; dragDock = false; dockHitAtPointer = null; dockPreview = null; pointerPlotIndex = null; plotPressIndex = null; plotPressReady = false; dockPressReady = false; uploadWorld(); });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (cameraMode === '2d') topDownHeight = Math.max(5, Math.min(30, topDownHeight + event.deltaY * 0.02));
    else distance = Math.max(3, Math.min(12, distance + event.deltaY * 0.004));
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
    if (state.animation) return false;
    const dock = droneDocks[droneIndex] || dockPosition;
    const idlePosition = { x: dock.x, z: dock.z };
    const idleY = DRONE_IDLE_Y + (dock.y || 0);
    const start = state.location.slice();
    const returnGoal = [idlePosition.x, idlePosition.z];
    state.animation = {
      kind, target, start, startY: state.y,
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
    animatePlant(index, onDeparture, onComplete, shouldReturn, droneIndex = 0) {
      if (!Number.isInteger(index) || index < 0 || index >= landCount) return false;
      const [targetX, targetZ] = getPlotPosition(index);
      return startDroneAnimation(droneIndex, 'plant', [targetX, targetZ], { hoverDuration: 500, targetPlotIndex: index, workY: DRONE_WORK_Y + getPlotHeight(index), onDeparture, onComplete, shouldReturn });
    },
    animateHarvest(index, onDeparture, onComplete, shouldReturn, droneIndex = 0) {
      if (!Number.isInteger(index) || index < 0 || index >= landCount) return false;
      const [targetX, targetZ] = getPlotPosition(index);
      return startDroneAnimation(droneIndex, 'harvest', [targetX, targetZ], { hoverDuration: 500, targetPlotIndex: index, workY: DRONE_WORK_Y + getPlotHeight(index), onDeparture, onComplete, shouldReturn });
    },
    animateWater(index, onDeparture, onComplete, shouldReturn, droneIndex = 0) {
      if (!Number.isInteger(index) || index < 0 || index >= landCount) return false;
      const [targetX, targetZ] = getPlotPosition(index);
      return startDroneAnimation(droneIndex, 'water', [targetX, targetZ], { hoverDuration: 1680, targetPlotIndex: index, workY: DRONE_WORK_Y + getPlotHeight(index), onDeparture, onComplete, shouldReturn });
    },
    animateExpansion(position, onDeparture, onComplete, shouldReturn, droneIndex = 0) {
      const fallback = getPlotPosition(landCount, landCount + 1);
      const targetX = Number.isInteger(position?.x) ? position.x : fallback[0];
      const targetZ = Number.isInteger(position?.z) ? position.z : fallback[1];
      return startDroneAnimation(droneIndex, 'expand', [targetX, targetZ], { hoverDuration: 700, onDeparture, onComplete, shouldReturn });
    },
    setPlotPositions(positions) {
      if (!Array.isArray(positions) || !positions.length || positions.some((position) => !Number.isInteger(position.x) || !Number.isInteger(position.z) || (position.y !== undefined && (!Number.isFinite(position.y) || Math.abs(position.y * 2 - Math.round(position.y * 2)) > 1e-8)))) return;
      const changed = positions.length !== plotPositions.length || positions.some((position, index) => position.x !== plotPositions[index]?.x || position.z !== plotPositions[index]?.z || (position.y || 0) !== (plotPositions[index]?.y || 0));
      if (!changed) return;
      plotPositions = positions.map(({ x, z, y = 0 }) => ({ x, z, y }));
      landCount = plotPositions.length;
      uploadWorld();
    },
    setLandCount(count) {
      if (Number.isFinite(count) && count > 0 && count !== landCount) {
        landCount = count;
        uploadWorld();
      }
    },
    setPlots(plots) {
      if (!Array.isArray(plots)) return;
      plotStates = plots.map((plot) => ({ crop: plot.crop, plantedAt: plot.plantedAt, plantHeight: plot.plantHeight, customColor: plot.customColor, elapsed: plot.elapsed, growTime: plot.growTime, waterUntil: plot.waterUntil, grassOnly: plot.grassOnly === true }));
      uploadWorld();
    },
    setEnvironment(state) {
      if (!state || typeof state.isRaining !== 'boolean') return;
      const rainChanged = environmentState.isRaining !== state.isRaining;
      const phaseChanged = environmentState.phase !== state.phase;
      const cycle = window.skyEnvironment?.DAY_CYCLE_MS || 16 * 60_000;
      const cycleTime = Number.isFinite(state.worldTimeMs) ? ((state.worldTimeMs % cycle) + cycle) % cycle : 0;
      const daylightProgress = Math.min(1, cycleTime / (10 * 60_000));
      const sunflowerYaw = cycleTime <= 10 * 60_000 ? 0.08 * (1 - Math.cos(daylightProgress * Math.PI * 2)) / 2 : 0;
      const sunflowerTurnChanged = Math.abs(sunflowerYaw - environmentState.sunflowerYaw) >= 0.0005;
      environmentState = { phase: state.phase || 'day', isDay: state.isDay === true, isRaining: state.isRaining, lightLevel: Number.isFinite(state.lightLevel) ? state.lightLevel : 1, sunflowerYaw };
      frame.classList.toggle('is-raining', environmentState.isRaining);
      for (const phase of ['dawn', 'day', 'dusk', 'night']) frame.classList.toggle(`is-${phase}`, environmentState.phase === phase);
      canvas.style.filter = `brightness(${0.84 + environmentState.lightLevel * 0.16})`;
      // Rebuild the soil geometry on the rain edge itself, without waiting for a later plot refresh.
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
      droneDocks = docks.map(({ x, z, y = 0, deployed, deploymentOrder, battery }) => ({ x, z, y, deployed: deployed !== false, deploymentOrder, battery: Math.max(0, Math.min(100, battery ?? 100)) }));
      droneDocks[0] = { ...droneDocks[0], ...dockPosition };
      droneDocks.forEach((dock, index) => { if (!droneStates[index].animation) droneStates[index].location = [dock.x, dock.z]; });
      uploadWorld();
    },
  };
  requestAnimationFrame(draw);
})();
