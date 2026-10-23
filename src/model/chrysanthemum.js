(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addChrysanthemumStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const stemTop = baseY + height;
    const stemColor = [0.29, 0.48, 0.27];
    const leafColors = [
      [0.31, 0.49, 0.29],
      [0.37, 0.55, 0.32],
      [0.28, 0.45, 0.26],
    ];

    // 菊花主莖直立略漸細，葉片沿莖節互生，不採用康乃馨的成對對生排列。
    const sides = 7;
    const ringCount = 7;
    const rings = Array.from({ length: ringCount }, (_, ring) => {
      const t = ring / (ringCount - 1);
      const radius = 0.008 * (1 - 0.48 * t);
      const centerX = x + Math.sin(t * Math.PI * 1.1) * 0.0025;
      const centerZ = z + Math.sin(t * Math.PI * 0.8) * 0.002;
      return Array.from({ length: sides }, (_, side) => {
        const angle = side / sides * Math.PI * 2;
        return [centerX + Math.cos(angle) * radius, baseY + height * t,
          centerZ + Math.sin(angle) * radius];
      });
    });
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        const shade = side % 2 ? 0.92 : 1.04;
        const color = stemColor.map((channel) => channel * shade);
        addTriangle(positions, colors, rings[ring][side], rings[ring][next], rings[ring + 1][next], color);
        addTriangle(positions, colors, rings[ring][side], rings[ring + 1][next], rings[ring + 1][side],
          color.map((channel) => channel * 0.96));
      }
    }

    const addLobedLeaf = (nodeY, angle, length, halfWidth, leafColor) => {
      const radial = [Math.cos(angle), Math.sin(angle)];
      const tangent = [-radial[1], radial[0]];
      const sections = 10;
      const centers = [];
      const leftEdge = [];
      const rightEdge = [];
      for (let section = 0; section <= sections; section += 1) {
        const t = section / sections;
        const distance = length * (0.08 * t + 0.92 * Math.sin(t * Math.PI * 0.46));
        const y = nodeY + length * (0.12 * t + 0.08 * Math.sin(Math.PI * t));
        const center = [x + radial[0] * distance, y, z + radial[1] * distance];
        const envelope = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.72);
        // 沿葉軸分布的寬窄起伏，形成菊葉特有的羽狀裂片與粗鋸齒邊。
        const lobe = 0.58 + 0.42 * Math.abs(Math.sin(t * Math.PI * 4.5));
        const width = halfWidth * envelope * lobe;
        centers.push(center);
        leftEdge.push([center[0] + tangent[0] * width, center[1] + 0.001, center[2] + tangent[1] * width]);
        rightEdge.push([center[0] - tangent[0] * width, center[1] + 0.001, center[2] - tangent[1] * width]);
      }
      for (let section = 0; section < sections; section += 1) {
        const a = centers[section], b = centers[section + 1];
        const color = leafColor.map((channel) => Math.min(1, channel * (section % 2 ? 0.96 : 1.04)));
        addTriangle(positions, colors, a, leftEdge[section], leftEdge[section + 1], color);
        addTriangle(positions, colors, a, leftEdge[section + 1], b, color);
        addTriangle(positions, colors, a, rightEdge[section + 1], rightEdge[section], color.map((channel) => channel * 0.83));
        addTriangle(positions, colors, a, b, rightEdge[section + 1], color.map((channel) => channel * 0.91));
        const ridgeA = [a[0] + tangent[0] * 0.0012, a[1] + 0.002, a[2] + tangent[1] * 0.0012];
        const ridgeB = [b[0] + tangent[0] * 0.0012, b[1] + 0.002, b[2] + tangent[1] * 0.0012];
        addTriangle(positions, colors, a, ridgeA, ridgeB, color.map((channel) => Math.min(1, channel * 1.08)));
      }
    };

    if (stage === 1) {
      // 幼苗只顯示低矮的基部葉叢。
      for (let leaf = 0; leaf < 5; leaf += 1) {
        const angle = leaf / 5 * Math.PI * 2 + 0.2;
        addLobedLeaf(baseY + 0.018, angle, 0.09 + (leaf % 2) * 0.012, 0.014, leafColors[leaf % leafColors.length]);
      }
      return;
    }

    // 菊花葉互生於不同高度，向外伸展，葉片長度隨高度略減，頂部保留花頭空間。
    const nodes = [0.18, 0.34, 0.5, 0.65, 0.77];
    nodes.forEach((t, index) => {
      const angle = 0.35 + index * 1.91;
      const nodeY = baseY + height * t;
      const length = height * (0.37 - t * 0.12);
      const halfWidth = Math.max(0.014, height * 0.052);
      addLobedLeaf(nodeY, angle, length, halfWidth, leafColors[index % leafColors.length]);
    });
    // 基部再保留一圈短葉，讓主莖與土面接合自然。
    for (let leaf = 0; leaf < 3; leaf += 1) {
      const angle = leaf / 3 * Math.PI * 2 + 0.65;
      addLobedLeaf(baseY + 0.035, angle, height * 0.24, height * 0.043, leafColors[(leaf + 1) % leafColors.length]);
    }
  }

  function addChrysanthemumBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    // 菊花：三層花瓣曲線各細分為 10 個彎折節點。
            // 原始控制點仍位於 0%、30%、50%、70%、100%；新增節點以平滑插值補齊。
            // 每個節點為 [距離花心, 相對基準高度的高度差]。
            const rayLayers = [
              {
                count: 28, width: 0.014,
                profile: [[0.022, 0], [0.05, -0.0065], [0.1, 0.013], [0.12, 0.039], [0.11, 0.065]],
              },
              {
                count: 23, width: 0.012,
                profile: [[0.021, 0], [0.04, -0.0065], [0.07, 0.065], [0.06, 0.0845], [0.05, 0.091]],
              },
              {
                count: 18, width: 0.0095,
                profile: [[0.018, 0], [0.02, -0.0065], [0.035, 0.0455], [0.03, 0.052], [0.018, 0.052]],
              },
            ];
            const baseKnots = [0, 0.3, 0.5, 0.7, 1];
            const knots = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1];
            const interpolateProfile = (profile, t) => {
              let segment = 0;
              while (segment < baseKnots.length - 2 && t > baseKnots[segment + 1]) segment += 1;
              const span = baseKnots[segment + 1] - baseKnots[segment];
              const local = Math.max(0, Math.min(1, (t - baseKnots[segment]) / span));
              const eased = local * local * (3 - 2 * local);
              return [
                profile[segment][0] + (profile[segment + 1][0] - profile[segment][0]) * eased,
                profile[segment][1] + (profile[segment + 1][1] - profile[segment][1]) * eased,
              ];
            };
            // 將原始五個造型控制點補成十個節點，保留原曲線的整體輪廓。
            for (const shape of rayLayers) {
              shape.profile = knots.map((t) => interpolateProfile(shape.profile, t));
            }
            // 使用非均勻節點的三次 Hermite 曲線，讓節點之間的斜率連續，
            // 避免每一段都重新放慢再加速而產生不自然的折彎。
            const profileAt = (profile, t) => {
              let segment = 0;
              while (segment < knots.length - 2 && t > knots[segment + 1]) segment += 1;
              const t0 = knots[segment];
              const t1 = knots[segment + 1];
              const span = t1 - t0;
              const u = Math.max(0, Math.min(1, (t - t0) / span));
              const u2 = u * u;
              const u3 = u2 * u;
              const h00 = 2 * u3 - 3 * u2 + 1;
              const h10 = u3 - 2 * u2 + u;
              const h01 = -2 * u3 + 3 * u2;
              const h11 = u3 - u2;
              return [0, 1].map((axis) => {
                const p0 = profile[segment][axis];
                const p1 = profile[segment + 1][axis];
                const prevSlope = segment === 0
                  ? (profile[1][axis] - profile[0][axis]) / (knots[1] - knots[0])
                  : (profile[segment + 1][axis] - profile[segment - 1][axis]) /
                    (knots[segment + 1] - knots[segment - 1]);
                const nextSlope = segment + 1 === profile.length - 1
                  ? (profile[segment + 1][axis] - profile[segment][axis]) / span
                  : (profile[segment + 2][axis] - profile[segment][axis]) /
                    (knots[segment + 2] - knots[segment]);
                return h00 * p0 + h10 * span * prevSlope + h01 * p1 + h11 * span * nextSlope;
              });
            };
            for (let layer = 0; layer < rayLayers.length; layer += 1) {
              const shape = rayLayers[layer];
              for (let ray = 0; ray < shape.count; ray += 1) {
                const angle = ray / shape.count * Math.PI * 2 + layer * 0.11;
                const radial = [Math.cos(angle), Math.sin(angle)];
                const tangent = [-radial[1], radial[0]];
                const sections = 40;
                const centerline = [];
                const leftEdge = [];
                const rightEdge = [];
                for (let section = 0; section <= sections; section += 1) {
                  const t = section / sections;
                  const [radius, heightOffset] = profileAt(shape.profile, t);
                  // 花瓣根部窄、中央飽滿，末端收窄但不收成尖刺。
                  const widthEnvelope = t < 0.3
                    ? 0.22 + 0.78 * (t / 0.3)
                    : t < 0.7
                      ? 1
                      : 1 - 0.68 * ((t - 0.7) / 0.3);
                  const halfWidth = shape.width * widthEnvelope * 0.5;
                  const center = [x + radial[0] * radius, bloomY + heightOffset, z + radial[1] * radius];
                  centerline.push(center);
                  leftEdge.push([center[0] + tangent[0] * halfWidth, center[1], center[2] + tangent[1] * halfWidth]);
                  rightEdge.push([center[0] - tangent[0] * halfWidth, center[1], center[2] - tangent[1] * halfWidth]);
                }
                const petalColor = ray % 5 === 0
                  ? headColor.map((channel) => Math.min(1, channel * 1.06))
                  : ray % 3 === 1 ? headColor.map((channel) => channel * 0.96) : headColor;
                for (let section = 0; section < sections; section += 1) {
                  const a = centerline[section], b = centerline[section + 1];
                  const leftA = leftEdge[section], leftB = leftEdge[section + 1];
                  const rightA = rightEdge[section], rightB = rightEdge[section + 1];
                  const shade = section % 4 === 0 ? 1.035 : section % 4 === 2 ? 0.97 : 1;
                  addTriangle(positions, colors, a, leftA, leftB,
                    petalColor.map((channel) => Math.min(1, channel * shade)));
                  addTriangle(positions, colors, a, leftB, b, petalColor);
                  addTriangle(positions, colors, a, b, rightB,
                    petalColor.map((channel) => channel * 0.95));
                  addTriangle(positions, colors, a, rightB, rightA,
                    petalColor.map((channel) => channel * 0.98));
                }
              }
            }
            // 保留緊密、細小的金黃色管狀花心，避免花瓣根部露空。
            const diskCount = 32;
            const goldenAngle = Math.PI * (3 - Math.sqrt(5));
            for (let floret = 0; floret < diskCount; floret += 1) {
              const radius = 0.042 * Math.sqrt((floret + 0.5) / diskCount);
              const angle = floret * goldenAngle;
              addIcosahedron(positions, colors, x + Math.cos(angle) * radius, bloomY + 0.012, z + Math.sin(angle) * radius,
                0.008, floret % 3 ? [0.77, 0.48, 0.17] : [0.9, 0.65, 0.23]);
            }
  }

  registry.register(6, { stem: addChrysanthemumStemLeafGeometry, bloom: addChrysanthemumBloom });
})();
