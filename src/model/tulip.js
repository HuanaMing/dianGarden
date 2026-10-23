(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addTulipStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const leafColors = [
      [0.29, 0.49, 0.23],
      [0.34, 0.56, 0.27],
      [0.38, 0.60, 0.30],
      [0.31, 0.53, 0.25],
    ];
    const leafCount = 4;

    // 鬱金香為球根型：葉片集中從基部抽出，寬長帶狀，先直立再向外拱。
    // 以沿葉長方向的多段網格表現微彎曲面與漸尖葉形，不沿花莖分節生葉。
    for (let leaf = 0; leaf < leafCount; leaf += 1) {
      const angle = leaf / leafCount * Math.PI * 2 + 0.28 + (leaf % 2) * 0.18;
      const radial = [Math.cos(angle), Math.sin(angle)];
      const tangent = [-radial[1], radial[0]];
      const length = (stage === 1 ? 0.105 : 0.245 + (leaf % 2) * 0.025);
      const maxWidth = (stage === 1 ? 0.016 : 0.030 + (leaf % 2) * 0.002);
      const sections = 6;
      const centerline = [];

      for (let section = 0; section <= sections; section += 1) {
        const t = section / sections;
        const distance = length * (0.16 * t + 0.84 * Math.sin(t * Math.PI * 0.48));
        const outwardLean = (leaf % 2 ? 0.035 : 0.012) * t * t;
        const y = baseY + 0.006 + length * (0.78 * Math.sin(t * Math.PI * 0.43) + 0.13 * t);
        centerline.push([
          x + radial[0] * (0.008 + distance + outwardLean),
          y,
          z + radial[1] * (0.008 + distance + outwardLean),
        ]);
      }

      for (let section = 0; section < sections; section += 1) {
        const t0 = section / sections;
        const t1 = (section + 1) / sections;
        const widthAt = (t) => maxWidth * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.72);
        const a = centerline[section];
        const b = centerline[section + 1];
        const w0 = widthAt(t0);
        const w1 = widthAt(t1);
        const left0 = [a[0] + tangent[0] * w0, a[1] + 0.002, a[2] + tangent[1] * w0];
        const right0 = [a[0] - tangent[0] * w0, a[1] + 0.002, a[2] - tangent[1] * w0];
        const left1 = [b[0] + tangent[0] * w1, b[1], b[2] + tangent[1] * w1];
        const right1 = [b[0] - tangent[0] * w1, b[1], b[2] - tangent[1] * w1];
        const color = leafColors[leaf].map((channel) => Math.min(1, channel * (section % 2 ? 0.97 : 1.035)));
        addTriangle(positions, colors, a, left0, left1, color);
        addTriangle(positions, colors, a, left1, b, color.map((channel) => Math.min(1, channel * 1.025)));
        addTriangle(positions, colors, a, right1, right0, color.map((channel) => channel * 0.86));
        addTriangle(positions, colors, a, b, right1, color.map((channel) => channel * 0.93));

        // 細窄中央脊線只加一點明暗，不把葉片做成尖銳的高屋脊。
        const ridgeA = [a[0] + tangent[0] * 0.0018, a[1] + 0.0025, a[2] + tangent[1] * 0.0018];
        const ridgeB = [b[0] + tangent[0] * 0.0018, b[1] + 0.0025, b[2] + tangent[1] * 0.0018];
        addTriangle(positions, colors, a, ridgeA, ridgeB, color.map((channel) => Math.min(1, channel * 1.08)));
        addTriangle(positions, colors, a, ridgeB, b, color.map((channel) => Math.min(1, channel * 1.04)));
      }
    }

    // 幼苗只呈現短小基生葉叢；成熟階段才抽出中央單一、近乎垂直的無葉花莖。
    if (stage === 1) return;

    const stalkBottom = baseY;
    const stalkTop = baseY + height * 0.97;
    const sides = 8;
    const rings = [
      { t: 0, radius: 0.010 },
      { t: 0.32, radius: 0.0092 },
      { t: 0.72, radius: 0.008 },
      { t: 1, radius: 0.0072 },
    ].map(({ t, radius }) => Array.from({ length: sides }, (_, side) => {
      const angle = side / sides * Math.PI * 2;
      const gentleBend = 0.003 * t * t;
      return [x + gentleBend + Math.cos(angle) * radius,
        stalkBottom + (stalkTop - stalkBottom) * t,
        z + Math.sin(angle) * radius];
    }));

    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        const shade = side % 2 ? 0.94 : 1.03;
        const stalkColor = [0.30, 0.52, 0.26].map((channel) => channel * shade);
        addTriangle(positions, colors, rings[ring][side], rings[ring][next], rings[ring + 1][next], stalkColor);
        addTriangle(positions, colors, rings[ring][side], rings[ring + 1][next], rings[ring + 1][side],
          stalkColor.map((channel) => channel * 0.96));
      }
    }
  }

  function addTulipBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage, stage,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    // Tulip: six overlapping tepals with a softly rounded, subdivided upper rim.
            for (let tepal = 0; tepal < 6; tepal += 1) {
              const angle0 = tepal / 6 * Math.PI * 2;
              const angle1 = (tepal + 1) / 6 * Math.PI * 2;
              const middle = (angle0 + angle1) / 2;
              const baseY = bloomY - 0.035;
              const rimHeight = tepal % 2 ? 0.092 : 0.108;
              const shade = tepal % 2 ? 0.95 : 1.06;
              const tepalColor = headColor.map((channel) => Math.min(1, channel * shade));
              const rimPoints = Array.from({ length: 5 }, (_, point) => {
                const t = point / 4;
                const angle = angle0 + (angle1 - angle0) * t;
                const roundedHeight = rimHeight * (0.88 + 0.12 * Math.sin(Math.PI * t));
                return [x + Math.cos(angle) * 0.085, bloomY + roundedHeight, z + Math.sin(angle) * 0.085];
              });
              const basePoints = Array.from({ length: 5 }, (_, point) => {
                const t = point / 4;
                const angle = angle0 + (angle1 - angle0) * t;
                return [x + Math.cos(angle) * 0.036, baseY, z + Math.sin(angle) * 0.036];
              });
              for (let segment = 0; segment < 4; segment += 1) {
                addTriangle(positions, colors, basePoints[segment], rimPoints[segment], rimPoints[segment + 1], tepalColor);
                addTriangle(positions, colors, basePoints[segment], rimPoints[segment + 1], basePoints[segment + 1], tepalColor.map((channel) => channel * 0.96));
              }
              const rib = [x + Math.cos(middle) * 0.062, bloomY + 0.035, z + Math.sin(middle) * 0.062];
              addTriangle(positions, colors, basePoints[2], rib, rimPoints[0], tepalColor.map((channel) => Math.min(1, channel * 1.04)));
            }
            addOctahedron(positions, colors, x, bloomY + 0.006, z, 0.023, 0.02, 0.023, [0.88, 0.67, 0.27]);
  }

  registry.register(4, { stem: addTulipStemLeafGeometry, bloom: addTulipBloom });
})();
