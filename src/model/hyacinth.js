(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addHyacinthStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const leafCount = 5;
    const leafColors = [
      [0.31, 0.55, 0.28], [0.36, 0.61, 0.31], [0.29, 0.51, 0.26],
      [0.34, 0.58, 0.29], [0.39, 0.63, 0.32],
    ];

    // Hyacinth leaves form a compact basal rosette, not nodes along the flower stalk.
    for (let leaf = 0; leaf < leafCount; leaf += 1) {
      const angle = leaf / leafCount * Math.PI * 2 + 0.22;
      const radial = [Math.cos(angle), Math.sin(angle)];
      const tangent = [-radial[1], radial[0]];
      const length = (stage === 1 ? 0.12 : 0.205) + (leaf % 2) * 0.012;
      const width = (stage === 1 ? 0.023 : 0.034) * 0.5;

      // 風信子單片葉的頂點座標（皆為世界座標 [x, y, z]）。
      // root：葉片基部；肩點 shoulder 是控制葉片外展的參考點，不直接作為三角形頂點。
      const root = [x + radial[0] * 0.012, baseY + 0.012, z + radial[1] * 0.012];
      const shoulder = [
        x + radial[0] * length * 0.52,
        baseY + (stage === 1 ? 0.085 : 0.145) * 0.8,
        z + radial[1] * length * 0.52,
      ];
      const originalHighestY = shoulder[1] + 0.018;

      // left：左側葉肩頂點 = shoulder + 切線方向半葉寬，Y 高於 shoulder 0.008（恢復原設定）。
      const left = [shoulder[0] + tangent[0] * width, shoulder[1] + 0.008, shoulder[2] + tangent[1] * width];
      // right：右側葉肩頂點 = shoulder - 切線方向半葉寬，Y 高於 shoulder 0.008（恢復原設定）。
      const right = [shoulder[0] - tangent[0] * width, shoulder[1] + 0.008, shoulder[2] - tangent[1] * width];

      // ridge：葉片原最高脊線頂點；相對 shoulder 徑向內移 0.011，Y 高 0.018。
      const ridge = [shoulder[0] - radial[0] * 0.011, originalHighestY, shoulder[2] - radial[1] * 0.011];
      // lowerRidge：新增的低脊線頂點；徑向內移 0.0045，Y 比 shoulder 低 0.018。
      const lowerRidge = [
        shoulder[0] - radial[0] * 0.0045,
        shoulder[1] - 0.018,
        shoulder[2] - radial[1] * 0.0045,
      ];
      // tip：葉尖頂點；水平座標與 ridge 完全相同，高度位於 ridge 上方 0.04。
      const tip = [
        ridge[0],
        ridge[1] + 0.04,
        ridge[2],
      ];
      // 以 root 為固定旋轉中心，繞葉片切線軸旋轉 8 度，讓葉片上段稍微朝植株中心收攏。
      // 徑向位移與高度一起旋轉；切線方向位移保持不變，因此整片葉子的形狀與寬度一致保留。
      const inwardFold = 8 * Math.PI / 180;
      const foldLeafPoint = (point) => {
        const dx = point[0] - root[0];
        const dz = point[2] - root[2];
        const radialOffset = dx * radial[0] + dz * radial[1];
        const tangentOffset = dx * tangent[0] + dz * tangent[1];
        const verticalOffset = point[1] - root[1];
        const foldedRadial = radialOffset * Math.cos(inwardFold) - verticalOffset * Math.sin(inwardFold);
        const foldedVertical = radialOffset * Math.sin(inwardFold) + verticalOffset * Math.cos(inwardFold);
        return [
          root[0] + radial[0] * foldedRadial + tangent[0] * tangentOffset,
          root[1] + foldedVertical,
          root[2] + radial[1] * foldedRadial + tangent[1] * tangentOffset,
        ];
      };
      const foldedLeft = foldLeafPoint(left);
      const foldedRight = foldLeafPoint(right);
      const foldedRidge = foldLeafPoint(ridge);
      const foldedLowerRidge = foldLeafPoint(lowerRidge);
      const foldedTip = foldLeafPoint(tip);
      const color = leafColors[leaf % leafColors.length];
      addTriangle(positions, colors, root, foldedLeft, foldedLowerRidge, color);
      addTriangle(positions, colors, foldedLowerRidge, foldedLeft, foldedRidge, color.map((channel) => Math.min(1, channel * 1.03)));
      addTriangle(positions, colors, foldedRidge, foldedLeft, foldedTip, color.map((channel) => Math.min(1, channel * 1.05)));
      addTriangle(positions, colors, root, foldedLowerRidge, foldedRight, color.map((channel) => channel * 0.9));
      addTriangle(positions, colors, foldedLowerRidge, foldedRidge, foldedRight, color.map((channel) => channel * 0.94));
      addTriangle(positions, colors, foldedRidge, foldedTip, foldedRight, color);
      // A narrow central spine keeps the strap-like leaf readable without a tall ridge.
      addTriangle(positions, colors, root, foldedLowerRidge, foldedTip, color.map((channel) => Math.min(1, channel * 1.08)));
    }

    if (stage === 1) return;

    // One sturdy, leafless flower stalk rises from the center of the rosette.
    const stalkTop = baseY + height * 0.82;
    const stalkBottom = baseY; // 主莖底端直接落在土壤表面，避免與地面留縫。
    const stalkRings = [
      { t: 0, radius: 0.012 },
      { t: 0.35, radius: 0.0105 },
      { t: 0.72, radius: 0.009 },
      { t: 1, radius: 0.008 },
    ];
    const sides = 8;
    const rings = stalkRings.map(({ t, radius }) => Array.from({ length: sides }, (_, side) => {
      const angle = side / sides * Math.PI * 2;
      return [x + Math.cos(angle) * radius, stalkBottom + (stalkTop - stalkBottom) * t,
        z + Math.sin(angle) * radius];
    }));
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        const shade = side % 2 ? 0.94 : 1;
        const color = [0.3, 0.53, 0.27].map((channel) => channel * shade);
        addTriangle(positions, colors, rings[ring][side], rings[ring][next], rings[ring + 1][next], color);
        addTriangle(positions, colors, rings[ring][side], rings[ring + 1][next], rings[ring + 1][side], color.map((channel) => channel * 0.97));
      }
    }
  }

  function addHyacinthBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    if (dedicatedStemLeafModel) dedicatedStemLeafModel(positions, colors, x, z, height, stage);
          // A dense upright raceme of individual six-part, flared florets.
          const rows = 6;
          for (let row = 0; row < rows; row += 1) {
            const count = row === 0 || row === rows - 1 ? 3 : 4;
            const rowY = 0.055 + height * (0.49 + row * 0.095);
            // Keep florets close to the central stalk and fold petals inward.
            const rowRadius = 0.014 + Math.sin((row + 1) / (rows + 1) * Math.PI) * 0.016;
            for (let bloom = 0; bloom < count; bloom += 1) {
              const angle = (bloom / count) * Math.PI * 2 + row * 0.43;
              const radial = [Math.cos(angle), 0, Math.sin(angle)];
              const tangent = [-Math.sin(angle), 0, Math.cos(angle)];
              const center = [x + radial[0] * rowRadius, rowY, z + radial[2] * rowRadius];
              const width = 0.010;
              for (let lobe = 0; lobe < 6; lobe += 1) {
                const lobeAngle = lobe / 6 * Math.PI * 2;
                const up = Math.cos(lobeAngle) * 0.012;
                const side = Math.sin(lobeAngle) * 0.012;
                const root = [center[0] + radial[0] * 0.012, center[1] + up, center[2] + radial[2] * 0.012];
                const tip = [center[0] - radial[0] * 0.014, center[1] + up * 1.25, center[2] - radial[2] * 0.014];
                const petalBase = [center[0] - radial[0] * 0.002, center[1] + up * 0.35, center[2] - radial[2] * 0.002];
                const left = [petalBase[0] + tangent[0] * width + tangent[0] * side,
                  petalBase[1] + up * 0.35, petalBase[2] + tangent[2] * width + tangent[2] * side];
                const right = [petalBase[0] - tangent[0] * width + tangent[0] * side,
                  petalBase[1] + up * 0.35, petalBase[2] - tangent[2] * width + tangent[2] * side];
                addTriangle(positions, colors, root, left, tip, headColor);
                addTriangle(positions, colors, root, tip, right, headColor.map((channel) => channel * 0.94));
              }
              addOctahedron(positions, colors, ...center, 0.012, 0.014, 0.012, headColor);
            }
          }
          return;
  }

  registry.register(1, { stem: addHyacinthStemLeafGeometry, bloom: addHyacinthBloom });
})();
