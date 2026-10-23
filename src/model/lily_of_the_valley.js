(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function getLilyOfTheValleyStalkPoint(x, z, height, t) {
    const baseY = 0.055;
    // 鈴蘭花梗整體拉高至原本約 1.5 倍；下段先從植株中央直立生長，
    // 到上段才因鐘形花序的重量逐漸向側面微彎，避免整根像要倒下。
    const bendT = Math.max(0, (t - 0.58) / 0.42);
    const bend = bendT * bendT;
    return [
      x + 0.006 * t + 0.075 * bend,
      baseY + height * 1.5 * (1.28 * t - 0.52 * t * t),
      z + 0.005 * t + 0.008 * bend,
    ];
  }

function addLilyOfTheValleyStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const leafGreen = [
      [0.30, 0.53, 0.25],
      [0.36, 0.60, 0.29],
    ];

    // 鈴蘭由根莖基部抽出兩片寬橢圓披針形葉，葉片先向上再自然拱展。
    // 以多段葉脈中心線和漸寬網格構成葉片，避免沿用其他花種的細長三角葉。
    for (let leaf = 0; leaf < 2; leaf += 1) {
      const angle = leaf === 0 ? -0.78 : 2.36;
      const radial = [Math.cos(angle), Math.sin(angle)];
      const tangent = [-radial[1], radial[0]];
      const length = (stage === 1 ? 0.155 : 0.245) + leaf * 0.012;
      const maxWidth = stage === 1 ? 0.027 : 0.047;
      const rise = stage === 1 ? 0.105 : 0.17;
      const sections = 5;
      const centerline = [];

      for (let section = 0; section <= sections; section += 1) {
        const t = section / sections;
        const distance = length * t;
        const y = baseY + 0.008 + rise * Math.sin(t * Math.PI * 0.78) - rise * 0.12 * t * t;
        centerline.push([
          x + radial[0] * distance,
          y,
          z + radial[1] * distance,
        ]);
      }

      for (let section = 0; section < sections; section += 1) {
        const t0 = section / sections;
        const t1 = (section + 1) / sections;
        const widthAt = (t) => maxWidth * Math.pow(Math.sin(Math.PI * t), 0.72);
        const a = centerline[section];
        const b = centerline[section + 1];
        const w0 = widthAt(t0);
        const w1 = widthAt(t1);
        const left0 = [a[0] + tangent[0] * w0, a[1] + 0.002, a[2] + tangent[1] * w0];
        const right0 = [a[0] - tangent[0] * w0, a[1] + 0.002, a[2] - tangent[1] * w0];
        const left1 = [b[0] + tangent[0] * w1, b[1], b[2] + tangent[1] * w1];
        const right1 = [b[0] - tangent[0] * w1, b[1], b[2] - tangent[1] * w1];
        const color = leafGreen[leaf].map((channel) => Math.min(1, channel * (section % 2 ? 0.97 : 1.04)));
        addTriangle(positions, colors, a, left0, left1, color);
        addTriangle(positions, colors, a, left1, b, color.map((channel) => Math.min(1, channel * 1.03)));
        addTriangle(positions, colors, a, right1, right0, color.map((channel) => channel * 0.88));
        addTriangle(positions, colors, a, b, right1, color.map((channel) => channel * 0.93));
      }

      // 葉片中央的細葉脈讓寬葉在低多邊形風格下仍有清楚方向。
      for (let section = 0; section < sections; section += 1) {
        const a = centerline[section];
        const b = centerline[section + 1];
        const veinColor = leafGreen[leaf].map((channel) => Math.min(1, channel * 1.12));
        addTriangle(positions, colors, a, [a[0] + tangent[0] * 0.0025, a[1] + 0.003, a[2] + tangent[1] * 0.0025],
          [b[0] + tangent[0] * 0.0025, b[1] + 0.003, b[2] + tangent[1] * 0.0025], veinColor);
        addTriangle(positions, colors, a, [b[0] - tangent[0] * 0.0025, b[1] + 0.003, b[2] - tangent[1] * 0.0025],
          [a[0] - tangent[0] * 0.0025, a[1] + 0.003, a[2] - tangent[1] * 0.0025], veinColor.map((channel) => channel * 0.92));
      }
    }

    if (stage === 1) return;

    // 成熟鈴蘭的花梗加長並形成像貓尾巴般先回彎、再向外上揚的弧線。
    const stalkSegments = 10;
    const stalkPoints = [];
    for (let segment = 0; segment <= stalkSegments; segment += 1) {
      const t = segment / stalkSegments;
      stalkPoints.push(getLilyOfTheValleyStalkPoint(x, z, height, t));
    }
    for (let segment = 0; segment < stalkSegments; segment += 1) {
      const a = stalkPoints[segment];
      const b = stalkPoints[segment + 1];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dz) || 1;
      // 截面半寬由 0.0035 增至 0.0042，莖粗為原本的 1.2 倍。
      const side = [-dz / length * 0.0042, dx / length * 0.0042];
      const aL = [a[0] + side[0], a[1], a[2] + side[1]];
      const aR = [a[0] - side[0], a[1], a[2] - side[1]];
      const bL = [b[0] + side[0], b[1], b[2] + side[1]];
      const bR = [b[0] - side[0], b[1], b[2] - side[1]];
      const stalkColor = [0.31, 0.51, 0.27];
      addTriangle(positions, colors, aL, aR, bR, stalkColor);
      addTriangle(positions, colors, aL, bR, bL, stalkColor.map((channel) => channel * 0.94));
    }
  }

  function addLilyOfTheValleyBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    if (dedicatedStemLeafModel) dedicatedStemLeafModel(positions, colors, x, z, height, stage);
          const bellCount = 6;
          for (let bell = 0; bell < bellCount; bell += 1) {
            const progress = bell / (bellCount - 1);
            // 花朵沿共用花梗中心線由中段排到近末端，交錯位於花梗側面。
            const stalkT = 0.42 + progress * 0.5;
            const attachment = getLilyOfTheValleyStalkPoint(x, z, height, stalkT);
            const sideSign = bell % 2 === 0 ? 1 : -1;
            const cx = attachment[0] + 0.018 + progress * 0.012;
            const cz = attachment[2] + sideSign * 0.026;
            const bellY = attachment[1] - 0.024 - (bell % 2) * 0.004;
            const cy = bellY - 0.026;
            const green = [0.36, 0.57, 0.31];
            addTriangle(positions, colors, attachment,
              [cx, bellY + 0.018, cz - sideSign * 0.008],
              [cx, bellY + 0.018, cz + sideSign * 0.008], green);
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

  registry.register(2, { stem: addLilyOfTheValleyStemLeafGeometry, bloom: addLilyOfTheValleyBloom });
})();
