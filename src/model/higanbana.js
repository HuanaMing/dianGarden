(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addHiganbanaStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const leafColors = [
      [0.22, 0.39, 0.19],
      [0.27, 0.45, 0.21],
      [0.31, 0.49, 0.23],
      [0.24, 0.42, 0.2],
      [0.29, 0.46, 0.22],
    ];

    // 彼岸花的葉期與花期通常分離：幼株階段以基部狹長帶狀葉表現葉叢。
    // 成熟開花階段則收掉葉片，只保留細長、近乎無葉的花莖。
    if (stage === 1) {
      const leafCount = 5;
      const sections = 7;
      for (let leaf = 0; leaf < leafCount; leaf += 1) {
        const angle = leaf / leafCount * Math.PI * 2 + 0.18;
        const radial = [Math.cos(angle), Math.sin(angle)];
        const tangent = [-radial[1], radial[0]];
        const length = height * (0.88 + (leaf % 3) * 0.12);
        const maxWidth = 0.013 + (leaf % 2) * 0.002;
        const points = [];

        for (let section = 0; section <= sections; section += 1) {
          const t = section / sections;
          const distance = length * t;
          const width = maxWidth * Math.pow(Math.sin(Math.PI * t), 0.72);
          const center = [
            x + radial[0] * (0.008 + distance),
            baseY + 0.008 + 0.025 * Math.sin(Math.PI * t) - 0.035 * t * t,
            z + radial[1] * (0.008 + distance),
          ];
          const left = [center[0] + tangent[0] * width, center[1] + 0.003, center[2] + tangent[1] * width];
          const right = [center[0] - tangent[0] * width, center[1] + 0.003, center[2] - tangent[1] * width];
          const ridge = [center[0], center[1] + 0.0035, center[2]];
          points.push({ left, right, ridge });
        }

        for (let section = 0; section < sections; section += 1) {
          const a = points[section];
          const b = points[section + 1];
          const color = leafColors[leaf].map((channel) => Math.min(1, channel * (section % 2 ? 0.96 : 1.04)));
          addTriangle(positions, colors, a.left, b.left, b.ridge, color);
          addTriangle(positions, colors, a.left, b.ridge, a.ridge, color.map((channel) => Math.min(1, channel * 1.04)));
          addTriangle(positions, colors, a.ridge, b.ridge, b.right, color.map((channel) => channel * 0.94));
          addTriangle(positions, colors, a.ridge, b.right, a.right, color.map((channel) => channel * 0.9));
        }
      }
      return;
    }

    // 開花時的花莖細長、近乎無葉，略有自然的 XZ 雙軸偏移。
    const stalkTop = Math.max(baseY + 0.12, baseY + height - 0.085);
    const segments = 9;
    const sides = 7;
    const rings = Array.from({ length: segments + 1 }, (_, segment) => {
      const t = segment / segments;
      const centerX = x + 0.007 * Math.sin(t * Math.PI * 0.9) - 0.002 * t;
      const centerZ = z + 0.005 * Math.sin(t * Math.PI * 1.2 + 0.3);
      const radius = 0.0065 * (1 - 0.24 * t);
      return Array.from({ length: sides }, (_, side) => {
        const angle = side / sides * Math.PI * 2;
        return [centerX + Math.cos(angle) * radius, baseY + (stalkTop - baseY) * t,
          centerZ + Math.sin(angle) * radius];
      });
    });

    for (let segment = 0; segment < segments; segment += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        const shade = side % 2 ? 0.92 : 1.04;
        const color = [0.25, 0.43, 0.21].map((channel) => channel * shade);
        addTriangle(positions, colors, rings[segment][side], rings[segment][next], rings[segment + 1][next], color);
        addTriangle(positions, colors, rings[segment][side], rings[segment + 1][next], rings[segment + 1][side],
          color.map((channel) => channel * 0.96));
      }
    }
  }

  function addHiganbanaBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    // Red spider lily: six three-petal florets arranged at the face centers
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
            const clusterRadius = 0.080;
            const petalScale = 0.8;
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
              // Add a tapered 3D pedicel from each floret base back to the main stem.
              // A four-sided tube keeps the stalk visible from different camera angles.
              const stalkStart = [
                cx - normal[0] * 0.018,
                cy - normal[1] * 0.018,
                cz - normal[2] * 0.018,
              ];
              const stalkEnd = [x, bloomY - 0.085, z];
              const stalkDirection = normalize(stalkEnd.map((value, axis) => value - stalkStart[axis]));
              const stalkReference = Math.abs(stalkDirection[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
              const stalkSide = normalize(cross(stalkDirection, stalkReference));
              const stalkDepth = normalize(cross(stalkDirection, stalkSide));
              const stalkRing = (center, radius) => [
                center.map((value, axis) => value + stalkSide[axis] * radius + stalkDepth[axis] * radius * 0.72),
                center.map((value, axis) => value - stalkSide[axis] * radius + stalkDepth[axis] * radius * 0.72),
                center.map((value, axis) => value - stalkSide[axis] * radius - stalkDepth[axis] * radius * 0.72),
                center.map((value, axis) => value + stalkSide[axis] * radius - stalkDepth[axis] * radius * 0.72),
              ];
              const stalkTopRing = stalkRing(stalkStart, 0.006);
              const stalkBottomRing = stalkRing(stalkEnd, 0.009);
              const stalkColor = [0.24, 0.43, 0.19];
              const stalkShade = [0.19, 0.35, 0.15];
              for (let stalkFace = 0; stalkFace < 4; stalkFace += 1) {
                const next = (stalkFace + 1) % 4;
                addTriangle(positions, colors, stalkTopRing[stalkFace], stalkBottomRing[stalkFace], stalkBottomRing[next], stalkColor);
                addTriangle(positions, colors, stalkTopRing[stalkFace], stalkBottomRing[next], stalkTopRing[next], stalkShade);
              }
    
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
              for (let petal = 0; petal < 6; petal += 1) {
                const angle = petal / 6 * Math.PI * 2 + bloom * 0.17;
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
    
              // Three stamens spread in the XZ plane at -10, 0, and +10 degrees
              // around the floret's outward normal. Each centerline droops slightly
              // first, then sweeps upward toward its golden anther.
              const horizontalLength = Math.hypot(normal[0], normal[2]) || 1;
              const radialWorldX = normal[0] / horizontalLength;
              const radialWorldZ = normal[2] / horizontalLength;
              const filamentAngles = [-20, 0, 20].map((degrees) => degrees * Math.PI / 180);
              for (let filament = 0; filament < 3; filament += 1) {
                const angle = filamentAngles[filament];
                const directionX = radialWorldX * Math.cos(angle) + radialWorldZ * Math.sin(angle);
                const directionZ = -radialWorldX * Math.sin(angle) + radialWorldZ * Math.cos(angle);
                // Place the lowest point at 60% of the filament's radial length,
                // then sweep upward toward the anther.
                const radii = [0.012, 0.040, 0.075, 0.092, 0.115, 0.145];
                const heights = [-0.005, -0.005, -0.012, -0.012, -0.009, 0.007];
                const path = radii.map((radius, index) => ({
                  radius,
                  height: heights[index],
                }));
                const stalkColor = filament === 1 ? [0.98, 0.62, 0.58] : [0.91, 0.35, 0.43];
                for (let segment = 0; segment < path.length - 1; segment += 1) {
                  const from = path[segment];
                  const to = path[segment + 1];
                  const widthStart = 0.003 * (1 - segment * 0.12);
                  const widthEnd = widthStart * 0.78;
                  const pointAt = (node, sideWidth) => [
                    cx + (directionX * node.radius - directionZ * sideWidth) * filamentScale,
                    cy + node.height * filamentScale,
                    cz + (directionZ * node.radius + directionX * sideWidth) * filamentScale,
                  ];
                  const a = pointAt(from, widthStart);
                  const b = pointAt(from, -widthStart);
                  const d = pointAt(to, widthEnd);
                  const e = pointAt(to, -widthEnd);
                  addTriangle(positions, colors, a, d, e, stalkColor);
                  addTriangle(positions, colors, a, e, b, stalkColor.map((channel) => channel * 0.88));
                }
                const tipPath = path[path.length - 1];
                const tip = [
                  cx + directionX * tipPath.radius * filamentScale,
                  cy + tipPath.height * filamentScale,
                  cz + directionZ * tipPath.radius * filamentScale,
                ];
                // Small golden anthers remain visible at the tips of all 18 filaments.
                addOctahedron(positions, colors, tip[0], tip[1], tip[2], 0.0055, 0.0055, 0.0055, [0.99, 0.76, 0.32]);
              }
            }
  }

  registry.register(10, { stem: addHiganbanaStemLeafGeometry, bloom: addHiganbanaBloom });
})();
