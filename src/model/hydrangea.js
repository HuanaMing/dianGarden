(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addHydrangeaStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const stemColor = [0.28, 0.46, 0.25];
    const leafColors = [
      [0.31, 0.49, 0.27],
      [0.36, 0.54, 0.30],
      [0.27, 0.43, 0.23],
    ];

    const addStem = () => {
      const sides = 8;
      const ringCount = 8;
      const rings = Array.from({ length: ringCount }, (_, ring) => {
        const t = ring / (ringCount - 1);
        const radius = 0.010 * (1 - 0.42 * t);
        const centerX = x + Math.sin(t * Math.PI * 0.9) * 0.002;
        const centerZ = z + Math.sin(t * Math.PI * 0.7) * 0.0015;
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
    };

    const addHydrangeaLeaf = (nodeY, angle, length, halfWidth, leafColor, petioleLength = 0.035) => {
      const radial = [Math.cos(angle), Math.sin(angle)];
      const tangent = [-radial[1], radial[0]];
      const root = [x + radial[0] * 0.008, nodeY, z + radial[1] * 0.008];
      const petioleTip = [
        root[0] + radial[0] * (petioleLength + 0.006),
        nodeY + 0.007,
        root[2] + radial[1] * (petioleLength + 0.006),
      ];
      addTriangle(positions, colors, root,
        [root[0] + tangent[0] * 0.002, root[1] + 0.002, root[2] + tangent[1] * 0.002],
        petioleTip, [0.34, 0.50, 0.28]);
      addTriangle(positions, colors, root, petioleTip,
        [root[0] - tangent[0] * 0.002, root[1] + 0.002, root[2] - tangent[1] * 0.002],
        [0.29, 0.44, 0.24]);

      const sections = 16;
      const centers = [];
      const leftEdge = [];
      const rightEdge = [];
      for (let section = 0; section <= sections; section += 1) {
        const t = section / sections;
        const distance = petioleLength + length * t;
        const centerY = nodeY + 0.006 + length * (0.12 * t - 0.17 * t * t);
        const center = [
          root[0] + radial[0] * distance,
          centerY,
          root[2] + radial[1] * distance,
        ];
        // 葉片中央較寬，葉基與尖端收窄；邊緣的細微波動形成柔和鋸齒。
        const envelope = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.78);
        const serration = 0.91 + 0.09 * Math.cos(t * Math.PI * 12);
        const width = halfWidth * envelope * serration;
        centers.push(center);
        leftEdge.push([center[0] + tangent[0] * width, center[1] + 0.0015, center[2] + tangent[1] * width]);
        rightEdge.push([center[0] - tangent[0] * width, center[1] + 0.0015, center[2] - tangent[1] * width]);
      }
      for (let section = 0; section < sections; section += 1) {
        const a = centers[section], b = centers[section + 1];
        const color = leafColor.map((channel) => Math.min(1, channel * (section % 2 ? 0.97 : 1.03)));
        addTriangle(positions, colors, a, leftEdge[section], leftEdge[section + 1], color);
        addTriangle(positions, colors, a, leftEdge[section + 1], b, color);
        addTriangle(positions, colors, a, rightEdge[section + 1], rightEdge[section], color.map((channel) => channel * 0.84));
        addTriangle(positions, colors, a, b, rightEdge[section + 1], color.map((channel) => channel * 0.92));
        // 低對比中肋沿葉片延伸，增加寬葉的立體感。
        const ridgeA = [a[0] + radial[0] * 0.0012, a[1] + 0.002, a[2] + radial[1] * 0.0012];
        const ridgeB = [b[0] + radial[0] * 0.0012, b[1] + 0.002, b[2] + radial[1] * 0.0012];
        addTriangle(positions, colors, a, ridgeA, ridgeB, color.map((channel) => Math.min(1, channel * 1.07)));
      }
    };

    if (stage === 1) {
      // 幼苗只保留低矮、向外舒展的基部葉片。
      for (let leaf = 0; leaf < 5; leaf += 1) {
        const angle = leaf / 5 * Math.PI * 2 + 0.28;
        addHydrangeaLeaf(baseY + 0.025, angle, 0.055 + (leaf % 2) * 0.008,
          0.021, leafColors[leaf % leafColors.length], 0.008);
      }
      return;
    }

    addStem();

    // 繡球花葉片沿莖節成對對生，每一層略微轉向，並在花球下方留出空間。
    const nodes = [
      { t: 0.22, angle: 0.35, length: height * 0.31, width: height * 0.092 },
      { t: 0.39, angle: 1.18, length: height * 0.29, width: height * 0.088 },
      { t: 0.54, angle: 0.08, length: height * 0.245, width: height * 0.078 },
    ];
    nodes.forEach((node, index) => {
      const nodeY = baseY + height * node.t;
      const color = leafColors[index % leafColors.length];
      addHydrangeaLeaf(nodeY, node.angle, node.length, node.width, color);
      addHydrangeaLeaf(nodeY, node.angle + Math.PI, node.length * 0.96, node.width * 0.94,
        leafColors[(index + 1) % leafColors.length]);
    });

    // 靠近土面的短葉補足株型，不讓主莖像細桿直接插入土壤。
    for (let leaf = 0; leaf < 3; leaf += 1) {
      const angle = leaf / 3 * Math.PI * 2 + 0.5;
      addHydrangeaLeaf(baseY + 0.035, angle, height * 0.20, height * 0.065,
        leafColors[(leaf + 2) % leafColors.length], 0.012);
    }
  }

  function addHydrangeaBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
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
  }

  registry.register(7, { stem: addHydrangeaStemLeafGeometry, bloom: addHydrangeaBloom });
})();
