(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addCarnationStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const leafColor = [0.38, 0.53, 0.34];
    const leafShade = [0.34, 0.49, 0.31];

    // 康乃馨是纖細直立的草本；葉片狹長、灰綠，沿節點成對對生。
    const addLinearLeaf = (nodeY, angle, length, width) => {
      const radial = [Math.cos(angle), Math.sin(angle)];
      const tangent = [-radial[1], radial[0]];
      const sections = 5;
      const center = [];
      for (let section = 0; section <= sections; section += 1) {
        const t = section / sections;
        const distance = length * (0.08 * t + 0.92 * Math.sin(t * Math.PI * 0.47));
        const y = nodeY + length * (0.36 * t + 0.12 * Math.sin(Math.PI * t));
        center.push([x + radial[0] * distance, y, z + radial[1] * distance]);
      }
      const widthAt = (t) => width * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.62);
      for (let section = 0; section < sections; section += 1) {
        const t0 = section / sections, t1 = (section + 1) / sections;
        const a = center[section], b = center[section + 1];
        const w0 = widthAt(t0), w1 = widthAt(t1);
        const left0 = [a[0] + tangent[0] * w0, a[1] + 0.0015, a[2] + tangent[1] * w0];
        const right0 = [a[0] - tangent[0] * w0, a[1] + 0.0015, a[2] - tangent[1] * w0];
        const left1 = [b[0] + tangent[0] * w1, b[1], b[2] + tangent[1] * w1];
        const right1 = [b[0] - tangent[0] * w1, b[1], b[2] - tangent[1] * w1];
        const color = (section % 2 ? leafShade : leafColor).map((channel) => Math.min(1, channel * 1.02));
        addTriangle(positions, colors, a, left0, left1, color);
        addTriangle(positions, colors, a, left1, b, color);
        addTriangle(positions, colors, a, right1, right0, color.map((channel) => channel * 0.84));
        addTriangle(positions, colors, a, b, right1, color.map((channel) => channel * 0.92));
        const ridgeA = [a[0] + tangent[0] * 0.0012, a[1] + 0.0018, a[2] + tangent[1] * 0.0012];
        const ridgeB = [b[0] + tangent[0] * 0.0012, b[1] + 0.0018, b[2] + tangent[1] * 0.0012];
        addTriangle(positions, colors, a, ridgeA, ridgeB, color.map((channel) => Math.min(1, channel * 1.06)));
      }
    };

    if (stage === 1) {
      // 幼苗只在基部長出兩對短小對生葉。
      addLinearLeaf(baseY + 0.018, 0.3, 0.062, 0.008);
      addLinearLeaf(baseY + 0.018, 0.3 + Math.PI, 0.062, 0.008);
      addLinearLeaf(baseY + 0.038, 1.2, 0.073, 0.009);
      addLinearLeaf(baseY + 0.038, 1.2 + Math.PI, 0.073, 0.009);
      return;
    }

    const stemTop = baseY + height * 0.91;
    const sides = 7;
    const rings = Array.from({ length: 7 }, (_, ring) => {
      const t = ring / 6;
      const radius = 0.0072 * (1 - 0.42 * t);
      const centerX = x + 0.003 * Math.sin(t * Math.PI * 1.2);
      const centerZ = z + 0.002 * t;
      return Array.from({ length: sides }, (_, side) => {
        const angle = side / sides * Math.PI * 2;
        return [centerX + Math.cos(angle) * radius, baseY + (stemTop - baseY) * t,
          centerZ + Math.sin(angle) * radius];
      });
    });
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        const shade = side % 2 ? 0.93 : 1.04;
        const color = [0.29, 0.47, 0.27].map((channel) => channel * shade);
        addTriangle(positions, colors, rings[ring][side], rings[ring][next], rings[ring + 1][next], color);
        addTriangle(positions, colors, rings[ring][side], rings[ring + 1][next], rings[ring + 1][side],
          color.map((channel) => channel * 0.96));
      }
    }

    // 四對葉片沿主莖逐節對生，葉長隨高度略縮短，頂端留出花頭空間。
    const nodes = [0.16, 0.32, 0.49, 0.65, 0.78];
    nodes.forEach((t, index) => {
      const nodeY = baseY + height * t;
      const angle = 0.42 + index * 0.78;
      const length = height * (0.34 - t * 0.11);
      const width = Math.max(0.007, height * 0.022);
      addLinearLeaf(nodeY, angle, length, width);
      addLinearLeaf(nodeY, angle + Math.PI, length * 0.96, width * 0.94);
    });
  }

  function addCarnationBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    // Carnation: layered fan-shaped petals with a scalloped, fringed rim.
            const tiers = [
              { count: 12, inner: 0.018, outer: 0.14, y: bloomY - 0.018, width: 0.126, crown: 0.075 },
              { count: 11, inner: 0.014, outer: 0.112, y: bloomY + 0.012, width: 0.114, crown: 0.069 },
              { count: 9, inner: 0.009, outer: 0.075, y: bloomY + 0.039, width: 0.093, crown: 0.06 },
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
                // 每片花瓣的外緣使用多個交替高低的頂點，形成清楚的細鋸齒。
                const edgePoints = Array.from({ length: 9 }, (_, edge) => {
                  const t = edge / 8;
                  const distance = shape.outer * (0.83 + 0.17 * Math.sin(t * Math.PI));
                  const spread = (t * 2 - 1) * shape.width * 0.44;
                  const tooth = edge === 0 || edge === 8 ? 0.54 : (edge % 2 === 0 ? 0.86 : 0.58);
                  return [
                    x + radial[0] * distance + tangent[0] * spread,
                    shape.y + shape.crown * tooth,
                    z + radial[1] * distance + tangent[1] * spread,
                  ];
                });
                const petalColor = (petal + tier) % 3 === 0
                  ? headColor.map((channel) => Math.min(1, channel * 1.1))
                  : (petal + tier) % 3 === 1 ? headColor.map((channel) => channel * 0.94) : headColor;
                addTriangle(positions, colors, root, innerLeft, edgePoints[0], petalColor);
                addTriangle(positions, colors, root, edgePoints[0], edgePoints[1], petalColor);
                for (let edge = 1; edge < edgePoints.length - 1; edge += 1) {
                  addTriangle(positions, colors, root, edgePoints[edge], edgePoints[edge + 1],
                    petalColor.map((channel) => channel * (edge % 2 ? 0.97 : 1.02)));
                }
                addTriangle(positions, colors, root, edgePoints[edgePoints.length - 1], innerRight, petalColor);
    
              }
            }
            addOctahedron(positions, colors, x, bloomY + 0.035, z, 0.039, 0.044, 0.039, headColor);
  }

  registry.register(5, { stem: addCarnationStemLeafGeometry, bloom: addCarnationBloom });
})();
