(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addPeonyStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const stemColor = [0.27, 0.46, 0.24];
    const leafColors = [[0.29, 0.48, 0.25], [0.35, 0.55, 0.29], [0.31, 0.51, 0.26]];
    // 草本牡丹以基部成叢的多根莖為骨架，中央主莖承接既有花頭。
    const stems = [
      // 主莖從花叢基部彎向中心，頂端精確接到牡丹花頭中心。
      { angle: -0.35, lean: 0, depth: 0, phase: 0.2, scale: 1.0 },
      // 其餘不承接花頭的側莖刻意降低，避免看起來像多根無花花莖。
      { angle: 2.15, lean: -0.052, depth: -0.035, phase: 1.4, scale: 0.52 },
      { angle: 0.9, lean: 0.035, depth: 0.046, phase: 2.2, scale: 0.46 },
      { angle: 3.45, lean: -0.034, depth: 0.012, phase: 2.8, scale: 0.40 },
    ];
    const centerAt = (stem, t) => {
      // 彎曲量在莖頂收斂為零，主莖末端因此落在花頭正中心。
      const curve = Math.sin(t * Math.PI) * 0.012 * t * (stem.phase > 0.5 ? 1 : 0.75);
      const baseOffset = 1 - t;
      return [
        x + Math.cos(stem.angle) * 0.012 * baseOffset + stem.lean * t + curve,
        baseY + height * stem.scale * t,
        z + Math.sin(stem.angle) * 0.012 * baseOffset + stem.depth * t
          + Math.sin(t * Math.PI) * 0.009 * t * (stem.phase > 0.5 ? 1 : 0.75),
      ];
    };
    const addLeaflet = (root, tip, widthDirection, width, color) => {
      const middle = [
        root[0] * 0.34 + tip[0] * 0.66,
        root[1] * 0.34 + tip[1] * 0.66 + 0.004,
        root[2] * 0.34 + tip[2] * 0.66,
      ];
      const left = [middle[0] + widthDirection[0] * width, middle[1] + 0.003, middle[2] + widthDirection[1] * width];
      const right = [middle[0] - widthDirection[0] * width, middle[1] + 0.003, middle[2] - widthDirection[1] * width];
      addTriangle(positions, colors, root, left, tip, color);
      addTriangle(positions, colors, root, tip, right, color.map((v) => v * 0.9));
      addTriangle(positions, colors, left, middle, tip, color.map((v) => Math.min(1, v * 1.06)));
      addTriangle(positions, colors, middle, right, tip, color.map((v) => v * 0.96));
    };
    const addCompoundLeaf = (root, angle, length, color, leafletCount = 3) => {
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const sideX = -dz, sideZ = dx;
      const rachisTip = [root[0] + dx * length, root[1] + length * 0.16, root[2] + dz * length];
      // 葉軸以細窄三角面表示；兩側小葉成對錯開，末端再補一枚頂生小葉。
      addTriangle(positions, colors, root,
        [root[0] + sideX * 0.004, root[1] + 0.002, root[2] + sideZ * 0.004],
        rachisTip, color.map((v) => v * 0.82));
      for (let pair = 0; pair < leafletCount; pair += 1) {
        const t = 0.24 + pair * (0.62 / Math.max(1, leafletCount - 1));
        const axisPoint = [
          root[0] + dx * length * t,
          root[1] + length * 0.16 * t,
          root[2] + dz * length * t,
        ];
        const leafletLength = length * (0.43 - pair * 0.035);
        const leafletWidth = leafletLength * 0.31;
        const offset = length * 0.075;
        const directions = [
          [dx * 0.30 + sideX, dz * 0.30 + sideZ],
          [dx * 0.30 - sideX, dz * 0.30 - sideZ],
        ];
        directions.forEach((direction, side) => {
          const tip = [
            axisPoint[0] + direction[0] * leafletLength + dx * offset * (side ? -1 : 1),
            axisPoint[1] + leafletLength * 0.12,
            axisPoint[2] + direction[1] * leafletLength + dz * offset * (side ? -1 : 1),
          ];
          const dirLength = Math.hypot(direction[0], direction[1]) || 1;
          const widthDirection = [-direction[1] / dirLength, direction[0] / dirLength];
          addLeaflet(axisPoint, tip, widthDirection, leafletWidth, color);
        });
      }
      addLeaflet(
        [root[0] + dx * length * 0.73, root[1] + length * 0.12, root[2] + dz * length * 0.73],
        rachisTip,
        [sideX, sideZ],
        length * 0.13,
        color.map((v) => Math.min(1, v * 1.05)),
      );
    };

    if (stage === 1) {
      for (let leaf = 0; leaf < 3; leaf += 1) {
        const angle = leaf * Math.PI * 2 / 3 + 0.4;
        const root = [x + Math.cos(angle) * 0.01, baseY + 0.018 + leaf * 0.008, z + Math.sin(angle) * 0.01];
        addCompoundLeaf(root, angle, 0.09, leafColors[leaf], 2);
      }
      return;
    }

    stems.forEach((stem, stemIndex) => {
      const sections = 10;
      const radius = stemIndex === 0 ? 0.0062 : 0.0048;
      const rings = [];
      for (let section = 0; section <= sections; section += 1) {
        const t = section / sections;
        const center = centerAt(stem, t);
        rings.push(Array.from({ length: 6 }, (_, side) => {
          const angle = side / 6 * Math.PI * 2;
          return [
            center[0] + Math.cos(angle) * radius * (1 - t * 0.24),
            center[1],
            center[2] + Math.sin(angle) * radius * (1 - t * 0.24),
          ];
        }));
      }
      for (let section = 0; section < sections; section += 1) {
        for (let side = 0; side < 6; side += 1) {
          const next = (side + 1) % 6;
          const color = stemColor.map((v) => v * (side % 2 ? 0.94 : 1.04));
          addTriangle(positions, colors, rings[section][side], rings[section][next], rings[section + 1][next], color);
          addTriangle(positions, colors, rings[section][side], rings[section + 1][next], rings[section + 1][side], color.map((v) => v * 0.96));
        }
      }
      // 互生複葉沿莖中下段分布，朝向輪流改變，形成寬而蓬鬆的葉叢。
      [0.2, 0.39, 0.57].forEach((t, leafIndex) => {
        const root = centerAt(stem, t);
        const angle = stem.angle + (leafIndex % 2 ? Math.PI * 0.72 : -Math.PI * 0.22) + stemIndex * 0.38;
        const length = height * stem.scale * (0.25 - leafIndex * 0.025) * (stemIndex === 0 ? 1 : 0.86);
        addCompoundLeaf(root, angle, length, leafColors[(stemIndex + leafIndex) % leafColors.length], 3);
      });
    });
    // 貼近地面的外展複葉填滿叢生基部，但保留中央花莖的視覺通道。
    for (let leaf = 0; leaf < 3; leaf += 1) {
      const angle = leaf * Math.PI * 2 / 3 + 0.65;
      const root = [x + Math.cos(angle) * 0.008, baseY + 0.025, z + Math.sin(angle) * 0.008];
      addCompoundLeaf(root, angle, height * 0.22, leafColors[(leaf + 1) % leafColors.length], 3);
    }
  }

  function addPeonyBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage,
  }) {
    const bloomY = 0.055 + height;
    const smoothStep = (edge0, edge1, value) => {
      const k = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
      return k * k * (3 - 2 * k);
    };
    const peonyRandom = (seed) => {
      const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return value - Math.floor(value);
    };
    const peonyLayers = [
      { count: 8, rootR: 0.024, rootY: -0.004, tilt: 26, curl: 38, length: 0.150, width: 0.060, cup: 0.40, ruffle: 0.0045, shade: 1.02, rows: 4, cols: 6 },
      { count: 9, rootR: 0.021, rootY: 0.012, tilt: 42, curl: 34, length: 0.132, width: 0.056, cup: 0.42, ruffle: 0.0040, shade: 0.99, rows: 4, cols: 6 },
      { count: 10, rootR: 0.018, rootY: 0.028, tilt: 57, curl: 32, length: 0.114, width: 0.050, cup: 0.45, ruffle: 0.0033, shade: 0.95, rows: 4, cols: 5 },
      { count: 9, rootR: 0.015, rootY: 0.044, tilt: 69, curl: 34, length: 0.096, width: 0.045, cup: 0.5, ruffle: 0.0025, shade: 0.91, rows: 4, cols: 5 },
      { count: 8, rootR: 0.012, rootY: 0.058, tilt: 78, curl: 42, length: 0.078, width: 0.040, cup: 0.55, ruffle: 0.0018, shade: 0.87, rows: 3, cols: 4 },
      { count: 6, rootR: 0.008, rootY: 0.074, tilt: 84, curl: 60, length: 0.066, width: 0.034, cup: 0.6, ruffle: 0.0012, shade: 0.83, rows: 3, cols: 4 },
    ];

    peonyLayers.forEach((layer, layerIndex) => {
      for (let petal = 0; petal < layer.count; petal += 1) {
        const seed = layerIndex * 31 + petal * 7.7;
        const theta = petal / layer.count * Math.PI * 2 + layerIndex * 0.61
          + (peonyRandom(seed) - 0.5) * 0.4;
        const radial = [Math.cos(theta), Math.sin(theta)];
        const tangent = [-radial[1], radial[0]];
        const length = layer.length * (0.92 + peonyRandom(seed + 1) * 0.16);
        const tilt = (layer.tilt + (peonyRandom(seed + 2) - 0.5) * 6) * Math.PI / 180;
        const curl = layer.curl * Math.PI / 180;
        const petalTint = 0.94 + peonyRandom(seed + 3) * 0.12;

        // 花瓣中心線先向外展開，沿途逐步抬升，末端收向圓頂中心。
        const path = [{ r: layer.rootR, y: bloomY + layer.rootY }];
        for (let row = 0; row < layer.rows; row += 1) {
          const mid = (row + 0.5) / layer.rows;
          const phi = tilt + curl * mid * mid;
          const last = path[row];
          path.push({
            r: last.r + Math.cos(phi) * length / layer.rows,
            y: last.y + Math.sin(phi) * length / layer.rows,
          });
        }

        const grid = [];
        for (let row = 0; row <= layer.rows; row += 1) {
          const t = row / layer.rows;
          const halfWidth = layer.width * (0.15 + 0.85 * Math.pow(Math.sin(Math.PI * (0.04 + 0.72 * t)), 0.8));
          const ruffleAmount = smoothStep(0.5, 1, t) * layer.ruffle;
          const line = [];
          for (let col = 0; col <= layer.cols; col += 1) {
            const u = col / layer.cols * 2 - 1;
            const lateral = u * halfWidth;
            // 花瓣兩側形成杯狀內凹，邊緣細皺，尖端避免形成尖角。
            const cupLift = layer.cup * u * u * halfWidth * 0.5
              * Math.sin(Math.PI * Math.min(1, t) * 0.85);
            const pullIn = u * u * halfWidth * 0.22 * t;
            const wave = Math.sin(u * Math.PI * 1.6 + seed) * ruffleAmount;
            const sway = Math.cos(u * Math.PI * 2.3 + seed * 1.7) * ruffleAmount * 0.6;
            const back = row > 0 ? u * u * 0.55 * smoothStep(0.7, 1, t) : 0;
            const previous = path[Math.max(0, row - 1)];
            const pathR = path[row].r + (previous.r - path[row].r) * back;
            const pathY = path[row].y + (previous.y - path[row].y) * back;
            const reach = Math.max(0.004, pathR - pullIn + sway);
            line.push([
              x + radial[0] * reach + tangent[0] * lateral,
              pathY + cupLift + wave,
              z + radial[1] * reach + tangent[1] * lateral,
            ]);
          }
          grid.push(line);
        }

        for (let row = 0; row < layer.rows; row += 1) {
          const t = (row + 0.5) / layer.rows;
          const base = layer.shade * petalTint * (0.72 + 0.32 * smoothStep(0, 0.8, t));
          const rimMix = 0.2 * smoothStep(0.55, 1, t);
          for (let col = 0; col < layer.cols; col += 1) {
            const tone = base * ((row + col) % 2 ? 0.97 : 1.02);
            const faceColor = headColor.map((channel) => {
              const shaded = Math.min(1, channel * tone);
              return Math.min(1, shaded + (1 - shaded) * rimMix);
            });
            const a = grid[row][col], b = grid[row + 1][col];
            const c = grid[row + 1][col + 1], d = grid[row][col + 1];
            addTriangle(positions, colors, a, b, c, faceColor);
            addTriangle(positions, colors, a, c, d, faceColor);
          }
        }
      }
    });

    // 花頭底部的綠色花萼杯，以及貼伏在外層花瓣下方的五片尖萼片。
    addOctahedron(positions, colors, x, bloomY - 0.018, z, 0.034, 0.024, 0.034, [0.3, 0.5, 0.25]);
    for (let sepal = 0; sepal < 5; sepal += 1) {
      const angle = sepal / 5 * Math.PI * 2 + 0.3;
      const root = [x + Math.cos(angle) * 0.026, bloomY - 0.012, z + Math.sin(angle) * 0.026];
      const shoulder = [x + Math.cos(angle) * 0.062, bloomY - 0.022, z + Math.sin(angle) * 0.062];
      const tip = [x + Math.cos(angle) * 0.108, bloomY - 0.048, z + Math.sin(angle) * 0.108];
      const side = [-Math.sin(angle) * 0.014, 0.002, Math.cos(angle) * 0.014];
      addTriangle(positions, colors, root,
        [shoulder[0] + side[0], shoulder[1] + 0.003, shoulder[2] + side[2]],
        tip, [0.32, 0.52, 0.26]);
      addTriangle(positions, colors, root, tip,
        [shoulder[0] - side[0], shoulder[1] - 0.002, shoulder[2] - side[2]],
        [0.25, 0.42, 0.21]);
    }
  }

  registry.register(9, { stem: addPeonyStemLeafGeometry, bloom: addPeonyBloom });
})();
