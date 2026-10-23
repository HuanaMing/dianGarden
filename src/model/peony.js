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
    positions, colors, x, z, height, headColor, environmentState, stemModel,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    const basePink = [1.0, 0.34, 0.58];
            const rows = 10;
            const drawPeonyPetal = (angle, petalLength, petalHalfWidth, layerBase, arch, tipLift, shade, rootRadius, edgeCurl) => {
              const radial = [Math.cos(angle), Math.sin(angle)];
              const tangent = [-radial[1], radial[0]];
              const petalColor = basePink.map((channel) => Math.min(1, channel * shade));
              const petalRows = Array.from({ length: rows + 1 }, (_, row) => {
                const t = row / rows;
                const width = petalHalfWidth * Math.pow(Math.sin(Math.PI * t), 0.72);
                // 花瓣沿長度方向採「根部抬起、尖端再向上翹」的弧線；中段下凹，
                // 不再把整片花瓣的中心線拱成向上的凸包。半徑略向內收，讓輪廓更柔和。
                const radius = rootRadius + petalLength * (t - 0.055 * Math.sin(Math.PI * t));
                const archCurve = -arch * Math.sin(Math.PI * t);
                const center = [
                  x + radial[0] * radius,
                  bloomY + layerBase + archCurve + tipLift * t,
                  z + radial[1] * radius,
                ];
                // 只抬高兩側邊緣，形成花瓣內凹、邊緣微翹的碗狀曲面。
                const curl = edgeCurl * Math.sin(Math.PI * t);
                const left = [center[0] + tangent[0] * width, center[1] + curl, center[2] + tangent[1] * width];
                const right = [center[0] - tangent[0] * width, center[1] + curl, center[2] - tangent[1] * width];
                return { left, center, right };
              });
              for (let row = 0; row < rows; row += 1) {
                const a = petalRows[row];
                const b = petalRows[row + 1];
                addTriangle(positions, colors, a.left, b.left, b.center, petalColor.map((c) => c * 0.88));
                addTriangle(positions, colors, a.left, b.center, a.center, petalColor);
                addTriangle(positions, colors, a.center, b.center, b.right, petalColor.map((c) => Math.min(1, c * 1.05)));
                addTriangle(positions, colors, a.center, b.right, a.right, petalColor.map((c) => c * 0.94));
              }
            };
            const layers = [
              { count: 12, length: 0.166, width: 0.041, base: -0.032, arch: 0.072, tip: -0.006, shade: 0.96, root: 0.002, curl: 0.014 },
              { count: 10, length: 0.145, width: 0.043, base: -0.006, arch: 0.083, tip: 0.008, shade: 1.00, root: 0.008, curl: 0.018 },
              { count: 9, length: 0.119, width: 0.038, base: 0.014, arch: 0.091, tip: 0.018, shade: 0.91, root: 0.012, curl: 0.020 },
              { count: 7, length: 0.092, width: 0.032, base: 0.035, arch: 0.080, tip: 0.026, shade: 0.86, root: 0.014, curl: 0.022 },
              { count: 6, length: 0.067, width: 0.026, base: 0.052, arch: 0.064, tip: 0.030, shade: 0.94, root: 0.010, curl: 0.018 },
            ];
            for (let layer = 0; layer < layers.length; layer += 1) {
              const shape = layers[layer];
              for (let petal = 0; petal < shape.count; petal += 1) {
                const angle = petal / shape.count * Math.PI * 2 + layer * 0.29 + (layer % 2 ? Math.PI / shape.count : 0.11);
                const variation = petal % 3;
                drawPeonyPetal(
                  angle,
                  shape.length * (variation === 0 ? 1.04 : variation === 1 ? 1.0 : 0.94),
                  shape.width * (variation === 1 ? 1.05 : variation === 2 ? 0.96 : 1.0),
                  shape.base + (variation === 0 ? 0.003 : variation === 2 ? -0.003 : 0),
                  shape.arch * (variation === 0 ? 1.06 : variation === 2 ? 0.94 : 1.0),
                  shape.tip,
                  shape.shade * (variation === 0 ? 1.04 : variation === 2 ? 0.94 : 1.0),
                  shape.root,
                  shape.curl
                );
              }
            }
            return;
  }

  registry.register(9, { stem: addPeonyStemLeafGeometry, bloom: addPeonyBloom });
})();
