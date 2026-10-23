(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addRoseStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const stemTop = baseY + height - 0.028;
    const stemColor = [0.29, 0.43, 0.22];
    const leafColors = [[0.28, 0.48, 0.24], [0.34, 0.55, 0.27], [0.38, 0.59, 0.29]];

    // 灌木玫瑰以略有弧度的木質主枝及側枝構成骨架。
    const addBranch = (points, radii) => {
      const sides = 6;
      const rings = points.map((point, index) => {
        const previous = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        let dx = next[0] - previous[0], dz = next[2] - previous[2];
        const length = Math.hypot(dx, dz) || 1;
        const sideX = -dz / length, sideZ = dx / length;
        return Array.from({ length: sides }, (_, side) => {
          const angle = side / sides * Math.PI * 2;
          return [point[0] + sideX * Math.cos(angle) * radii[index],
            point[1] + Math.sin(angle) * radii[index] * 0.82,
            point[2] + sideZ * Math.cos(angle) * radii[index]];
        });
      });
      for (let ring = 0; ring < rings.length - 1; ring += 1) {
        for (let side = 0; side < sides; side += 1) {
          const next = (side + 1) % sides;
          const shade = side % 2 ? 0.9 : 1.04;
          addTriangle(positions, colors, rings[ring][side], rings[ring][next], rings[ring + 1][next],
            stemColor.map((channel) => channel * shade));
          addTriangle(positions, colors, rings[ring][side], rings[ring + 1][next], rings[ring + 1][side],
            stemColor.map((channel) => channel * 0.96));
        }
      }
    };

    const mainPoints = [
      [x, baseY, z],
      [x - 0.004, baseY + height * 0.28, z + 0.003],
      [x + 0.008, baseY + height * 0.57, z + 0.006],
      [x + 0.014, stemTop, z + 0.008],
    ];
    addBranch(mainPoints, [0.010, 0.0085, 0.0065, 0.0045]);

    // 玫瑰花萼：五片深綠色尖形萼片從花托底部向外伸展，避免花頭底部呈現紅色多面體。
    if (stage === 2) {
      const calyxY = stemTop - 0.006;
      const calyxColor = [0.19, 0.34, 0.16];
      const calyxShade = [0.15, 0.28, 0.12];
      for (let sepal = 0; sepal < 5; sepal += 1) {
        const angle = sepal / 5 * Math.PI * 2 + 0.28;
        const radial = [Math.cos(angle), Math.sin(angle)];
        const tangent = [-radial[1], radial[0]];
        const base = [x + 0.014 + radial[0] * 0.004, calyxY, z + 0.008 + radial[1] * 0.004];
        const shoulder = [
          x + 0.014 + radial[0] * 0.025,
          calyxY + 0.004,
          z + 0.008 + radial[1] * 0.025,
        ];
        const tip = [
          x + 0.014 + radial[0] * 0.058,
          calyxY + 0.012,
          z + 0.008 + radial[1] * 0.058,
        ];
        const left = [shoulder[0] + tangent[0] * 0.012, shoulder[1] + 0.002, shoulder[2] + tangent[1] * 0.012];
        const right = [shoulder[0] - tangent[0] * 0.012, shoulder[1] + 0.002, shoulder[2] - tangent[1] * 0.012];
        addTriangle(positions, colors, base, left, tip, calyxColor);
        addTriangle(positions, colors, left, right, tip, calyxShade);
        addTriangle(positions, colors, right, base, tip, calyxColor.map((channel) => channel * 0.92));
      }
    }

    const branchDefs = [
      { start: 0.30, dir: [-1, 0.18], reach: 0.115 },
      { start: 0.49, dir: [0.88, -0.34], reach: 0.105 },
      { start: 0.66, dir: [-0.74, -0.52], reach: 0.082 },
    ];
    const leafClusters = [];
    for (const branch of branchDefs) {
      const sy = baseY + height * branch.start;
      const sx = x + (branch.start > 0.5 ? 0.008 : -0.003);
      const sz = z + branch.start * 0.008;
      const dx = branch.dir[0], dz = branch.dir[1];
      const end = [sx + dx * branch.reach, sy + height * 0.16, sz + dz * branch.reach];
      addBranch([
        [sx, sy, sz],
        [sx + dx * branch.reach * 0.45, sy + height * 0.07, sz + dz * branch.reach * 0.45],
        end,
      ], [0.0058, 0.004, 0.0026]);
      leafClusters.push({ start: [sx, sy, sz], end, dx, dz, reach: branch.reach });
    }

    // 玫瑰羽狀複葉：沿葉軸安排五對小葉及一枚端生小葉。
    const addLeaflet = (start, direction, length, width, color) => {
      const magnitude = Math.hypot(direction[0], direction[1]) || 1;
      const dx = direction[0] / magnitude, dz = direction[1] / magnitude;
      const sideX = -dz, sideZ = dx;
      const tip = [start[0] + dx * length, start[1] + length * 0.12, start[2] + dz * length];
      const mid = [start[0] + dx * length * 0.52, start[1] + length * 0.07 + 0.003, start[2] + dz * length * 0.52];
      const left = [mid[0] + sideX * width, mid[1] + 0.002, mid[2] + sideZ * width];
      const right = [mid[0] - sideX * width, mid[1] + 0.002, mid[2] - sideZ * width];
      addTriangle(positions, colors, start, left, mid, color.map((channel) => channel * 0.88));
      addTriangle(positions, colors, left, tip, mid, color);
      addTriangle(positions, colors, mid, tip, right, color.map((channel) => channel * 0.95));
      addTriangle(positions, colors, right, start, mid, color.map((channel) => channel * 0.82));
      // 小葉尖端的深色中脈讓複葉在小尺寸下仍容易辨認。
      addTriangle(positions, colors, mid, tip,
        [mid[0] + (tip[0] - mid[0]) * 0.88, mid[1] + 0.0015, mid[2] + (tip[2] - mid[2]) * 0.88],
        [0.22, 0.39, 0.19]);
    };

    for (let clusterIndex = 0; clusterIndex < leafClusters.length; clusterIndex += 1) {
      const cluster = leafClusters[clusterIndex];
      const axisX = cluster.dx, axisZ = cluster.dz;
      const sideX = -axisZ, sideZ = axisX;
      const leafAxisLength = cluster.reach * 0.84;
      for (let pair = 0; pair < 3; pair += 1) {
        const t = 0.20 + pair * 0.235;
        const origin = [
          cluster.start[0] + axisX * leafAxisLength * t,
          cluster.start[1] + height * 0.11 * t + 0.004,
          cluster.start[2] + axisZ * leafAxisLength * t,
        ];
        const leafletLength = (stage === 1 ? 0.022 : 0.034) * (1 - pair * 0.08);
        const leafletWidth = leafletLength * 0.38;
        const color = leafColors[(pair + clusterIndex) % leafColors.length];
        addLeaflet(origin, [sideX + axisX * 0.42, sideZ + axisZ * 0.42], leafletLength, leafletWidth, color);
        addLeaflet(origin, [-sideX + axisX * 0.42, -sideZ + axisZ * 0.42], leafletLength, leafletWidth, color.map((channel) => channel * 0.94));
      }
      const terminal = [
        cluster.start[0] + axisX * leafAxisLength,
        cluster.start[1] + height * 0.12,
        cluster.start[2] + axisZ * leafAxisLength,
      ];
      addLeaflet(terminal, [axisX, axisZ], stage === 1 ? 0.027 : 0.039, 0.014, leafColors[clusterIndex % leafColors.length]);
    }

    // 僅在成熟株型加入少量向外斜生的細刺，避免刺的視覺量壓過葉片。
    if (stage === 2) {
      for (const thorn of [
        [0.28, -1, 0.12], [0.44, 1, -0.2], [0.61, -0.8, -0.5],
      ]) {
        const y = baseY + height * thorn[0];
        const root = [x + thorn[0] * 0.01, y, z + thorn[0] * 0.008];
        const tip = [root[0] + thorn[1] * 0.018, y + 0.012, root[2] + thorn[2] * 0.018];
        const side = [-(tip[2] - root[2]) * 0.18, 0, (tip[0] - root[0]) * 0.18];
        addTriangle(positions, colors, root,
          [root[0] + side[0], root[1] + 0.003, root[2] + side[2]], tip, [0.42, 0.48, 0.29]);
        addTriangle(positions, colors, root, tip,
          [root[0] - side[0], root[1] - 0.002, root[2] - side[2]], [0.31, 0.4, 0.23]);
      }
    }
  }

  function addRoseBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    // 將玫瑰花頭縮至原尺寸一半，並把底部下移至花萼頂端。
          const roseScale = 0.5;
          const roseBaseY = bloomY - 0.01;
          const roseCalyxY = bloomY - 0.034;
          const addRoseTriangle = (positions, colors, a, b, c, color) => {
            const transform = (point) => [
              x + 0.014 + (point[0] - x) * roseScale,
              roseCalyxY + (point[1] - roseBaseY) * roseScale,
              z + 0.008 + (point[2] - z) * roseScale,
            ];
            addTriangle(positions, colors, transform(a), transform(b), transform(c), color);
          };
          // 蛋形花苞本體、逐層收緊並帶旋向的包覆花瓣、頂端螺旋花心與三片外翻外瓣。
          const smooth = (edge0, edge1, value) => {
            const k = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
            return k * k * (3 - 2 * k);
          };
          const bodyBase = bloomY - 0.01, bodyHeight = 0.27;
          const slim = 0.78;
          const eggRadius = (s) => 0.025 + 0.075 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(s, 0.7))), 0.9);
          const bodyLayers = [
            { count: 5, scale: 1.00, from: 0.00, to: 0.80, twist: 0.30, phase: 0.20, lip: 0.016, shade: 1.00 },
            { count: 4, scale: 0.86, from: 0.10, to: 0.84, twist: 0.60, phase: 0.90, lip: 0.008, shade: 0.93 },
            { count: 3, scale: 0.64, from: 0.25, to: 0.88, twist: 0.95, phase: 0.50, lip: 0, shade: 0.86 },
          ];
          for (const layer of bodyLayers) {
            const halfAngle = Math.PI / layer.count * 1.3;
            for (let petal = 0; petal < layer.count; petal += 1) {
              const centerAngle = petal / layer.count * Math.PI * 2 + layer.phase;
              const overlapOffset = 0.006 * petal / layer.count;
              const petalTint = petal % 2 ? 0.97 : 1.03;
              const upSteps = 8, acrossSteps = 6;
              const grid = [];
              for (let up = 0; up <= upSteps; up += 1) {
                const t = up / upSteps;
                const s = layer.from + (layer.to - layer.from) * t;
                const row = [];
                for (let across = 0; across <= acrossSteps; across += 1) {
                  const u = across / acrossSteps * 2 - 1;
                  const angle = centerAngle + u * halfAngle + layer.twist * t;
                  const bulge = 1 + 0.07 * (1 - u * u) * Math.sin(Math.PI * Math.min(1, t * 1.15));
                  const lip = layer.lip * smooth(0.78, 1, t) * (0.6 + 0.4 * (1 - u * u));
                  const radius = Math.max(0.01, (eggRadius(s) * layer.scale * bulge + lip + overlapOffset) * slim);
                  const y = bodyBase + bodyHeight * s - 0.008 * u * u;
                  row.push([x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius]);
                }
                grid.push(row);
              }
              for (let up = 0; up < upSteps; up += 1) {
                const t = (up + 0.5) / upSteps;
                const faceShade = layer.shade * petalTint * (0.74 + 0.26 * smooth(0, 0.55, t)) * (1 + 0.06 * smooth(0.8, 1, t));
                for (let across = 0; across < acrossSteps; across += 1) {
                  const isEdge = across === 0 || across === acrossSteps - 1;
                  const faceColor = headColor.map((channel) => Math.min(1, channel * faceShade * (isEdge ? 0.9 : 1)));
                  const a = grid[up][across], b = grid[up + 1][across];
                  const c = grid[up + 1][across + 1], d = grid[up][across + 1];
                  addRoseTriangle(positions, colors, a, b, c, faceColor);
                  addRoseTriangle(positions, colors, a, c, d, faceColor);
                }
              }
            }
          }
    
          // 最外層三片花瓣：包住花苞下半部，末端向外下翻。
          const outerCount = 3;
          for (let petal = 0; petal < outerCount; petal += 1) {
            const centerAngle = petal / outerCount * Math.PI * 2 + 0.7;
            const halfAngle = 1.2;
            const upSteps = 10, acrossSteps = 8;
            const grid = [];
            for (let step = 0; step <= upSteps; step += 1) {
              const t = step / upSteps;
              const s = 0.02 + 0.72 * t;
              const curl = smooth(0.82, 1, t);
              const row = [];
              for (let across = 0; across <= acrossSteps; across += 1) {
                const u = across / acrossSteps * 2 - 1;
                const angle = centerAngle + u * halfAngle + 0.2 * t;
                const bulge = 1 + 0.05 * (1 - u * u) * Math.sin(Math.PI * Math.min(1, t * 1.15));
                const radius = (eggRadius(s) * 1.12 * bulge + 0.016 + 0.003 * petal + 0.03 * curl * curl) * slim;
                const y = bodyBase + bodyHeight * s - 0.008 * u * u - 0.006 * curl;
                row.push([x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius]);
              }
              grid.push(row);
            }
            for (let step = 0; step < upSteps; step += 1) {
              const t = (step + 0.5) / upSteps;
              const faceShade = (0.76 + 0.3 * smooth(0, 0.6, t)) * (petal % 2 ? 0.98 : 1.04) * (1 + 0.05 * smooth(0.82, 1, t));
              for (let across = 0; across < acrossSteps; across += 1) {
                const isEdge = across === 0 || across === acrossSteps - 1;
                const faceColor = headColor.map((channel) => Math.min(1, channel * faceShade * (isEdge ? 0.9 : 1)));
                const a = grid[step][across], b = grid[step + 1][across];
                const c = grid[step + 1][across + 1], d = grid[step][across + 1];
                addRoseTriangle(positions, colors, a, b, c, faceColor);
                addRoseTriangle(positions, colors, a, c, d, faceColor);
              }
            }
          }
    
          // 螺旋花心：先以略微下凹的扇形封口，再以三枚小旋瓣標示旋向。
          const topS = 0.88;
          const topY = bodyBase + bodyHeight * topS;
          const capRadius = Math.max(0.01, eggRadius(topS) * 0.64 * slim);
          const coreColor = headColor.map((channel) => channel * 0.72);
          for (let k = 0; k < 6; k += 1) {
            const a0 = k / 6 * Math.PI * 2 + 1.45;
            const a1 = (k + 1) / 6 * Math.PI * 2 + 1.45;
            addRoseTriangle(positions, colors,
              [x, topY - 0.004, z],
              [x + Math.cos(a0) * capRadius, topY, z + Math.sin(a0) * capRadius],
              [x + Math.cos(a1) * capRadius, topY, z + Math.sin(a1) * capRadius],
              k % 2 ? coreColor : coreColor.map((channel) => channel * 1.12));
          }
          for (let curl = 0; curl < 3; curl += 1) {
            const angle = curl * 2.1 + 0.4;
            addRoseTriangle(positions, colors,
              [x + Math.cos(angle) * capRadius * 0.15, topY - 0.002, z + Math.sin(angle) * capRadius * 0.15],
              [x + Math.cos(angle + 0.9) * capRadius * 1.1, topY + 0.001, z + Math.sin(angle + 0.9) * capRadius * 1.1],
              [x + Math.cos(angle + 1.7) * capRadius * 0.75, topY + 0.003, z + Math.sin(angle + 1.7) * capRadius * 0.75],
              headColor.map((channel) => Math.min(1, channel * (0.9 + curl * 0.06))));
          }
          // 玫瑰已完成專用花頭與花萼；略過舊版通用花頭，避免額外生成紅色八面體。
          return;
  }

  registry.register(3, { stem: addRoseStemLeafGeometry, bloom: addRoseBloom });
})();
