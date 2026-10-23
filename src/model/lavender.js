(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addLavenderStemLeafGeometry(positions, colors, x, z, height, stage) {
    const baseY = 0.055;
    const stemColor = [0.27, 0.45, 0.24];
    const leafColors = [[0.34, 0.53, 0.28], [0.39, 0.58, 0.31], [0.29, 0.47, 0.25]];
    const stems = [
      { side: -1, bend: -1, phase: 0.25, spread: 0.075, lean: -0.038, depth: 0.045, depthPhase: 0.3, heightScale: 0.88 },
      { side: 0, bend: 1, phase: 1.45, spread: 0.042, lean: 0.014, depth: -0.052, depthPhase: 1.7, heightScale: 1.0 },
      { side: 1, bend: -1, phase: 2.5, spread: 0.071, lean: 0.043, depth: 0.062, depthPhase: 2.6, heightScale: 0.79 },
    ];
    const centerAt = (stem, t) => {
      const bend = Math.sin(t * Math.PI * 1.15 + stem.phase) * stem.spread * (0.35 + t * 0.65);
      const sway = stem.lean * t + bend * stem.bend;
      const depthBend = Math.sin(t * Math.PI * 1.25 + stem.depthPhase) * stem.depth * (0.25 + t * 0.75);
      return [x + stem.side * 0.012 + sway, baseY + height * stem.heightScale * t,
        z + depthBend + Math.sin(t * Math.PI + stem.phase) * 0.012 * t];
    };
    const addNarrowLeaf = (root, angle, length, color) => {
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const tip = [root[0] + dx * length, root[1] + length * 0.34, root[2] + dz * length];
      const side = [-dz, 0, dx];
      const mid = [root[0] + dx * length * 0.52, root[1] + length * 0.21, root[2] + dz * length * 0.52];
      const width = length * 0.105;
      const left = [mid[0] + side[0] * width, mid[1] + 0.001, mid[2] + side[2] * width];
      const right = [mid[0] - side[0] * width, mid[1] + 0.001, mid[2] - side[2] * width];
      addTriangle(positions, colors, root, left, tip, color);
      addTriangle(positions, colors, root, tip, right, color.map((v) => v * 0.86));
      addTriangle(positions, colors, root, mid, tip, color.map((v) => Math.min(1, v * 1.08)));
    };
    if (stage === 1) {
      for (let leaf = 0; leaf < 7; leaf += 1) {
        const angle = leaf * 2.399 + 0.35;
        const root = [x + Math.cos(angle) * 0.012, baseY + 0.018 + (leaf % 3) * 0.008,
          z + Math.sin(angle) * 0.012];
        addNarrowLeaf(root, angle, 0.047 + (leaf % 2) * 0.009, leafColors[leaf % leafColors.length]);
      }
      return;
    }
    stems.forEach((stem, stemIndex) => {
      const sections = 14;
      const radius = 0.0062;
      const rings = [];
      for (let section = 0; section <= sections; section += 1) {
        const t = section / sections;
        const center = centerAt(stem, t);
        rings.push(Array.from({ length: 6 }, (_, side) => {
          const angle = side / 6 * Math.PI * 2;
          return [center[0] + Math.cos(angle) * radius * (1 - t * 0.32),
            center[1], center[2] + Math.sin(angle) * radius * (1 - t * 0.32)];
        }));
      }
      for (let section = 0; section < sections; section += 1) {
        for (let side = 0; side < 6; side += 1) {
          const next = (side + 1) % 6;
          const color = stemColor.map((v) => v * (side % 2 ? 0.92 : 1.04));
          addTriangle(positions, colors, rings[section][side], rings[section][next], rings[section + 1][next], color);
          addTriangle(positions, colors, rings[section][side], rings[section + 1][next], rings[section + 1][side], color.map((v) => v * 0.96));
        }
      }
      // 薰衣草的狹長葉片集中在下段，沿彎曲莖節向外斜伸。
      [0.12, 0.25, 0.37, 0.48].forEach((t, leafIndex) => {
        const root = centerAt(stem, t);
        const angle = stemIndex * 1.75 + leafIndex * 2.55 + 0.4;
        addNarrowLeaf(root, angle, height * (0.17 - leafIndex * 0.014), leafColors[(stemIndex + leafIndex) % leafColors.length]);
        if (leafIndex < 3) addNarrowLeaf(root, angle + Math.PI * 0.82,
          height * (0.135 - leafIndex * 0.012), leafColors[(stemIndex + leafIndex + 1) % leafColors.length]);
      });
    });
  }

  function addLavenderBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    // 薰衣草三根花穗各自沿不同的柔彎曲線排列，與專屬莖模型相呼應。
            const lavenderStems = [
              { side: -1, bend: -1, phase: 0.25, spread: 0.075, lean: -0.038, depth: 0.045, depthPhase: 0.3, heightScale: 0.88 },
              { side: 0, bend: 1, phase: 1.45, spread: 0.042, lean: 0.014, depth: -0.052, depthPhase: 1.7, heightScale: 1.0 },
              { side: 1, bend: -1, phase: 2.5, spread: 0.071, lean: 0.043, depth: 0.062, depthPhase: 2.6, heightScale: 0.79 },
            ];
            const stemCenter = (stem, t) => {
              const sway = stem.lean * t + Math.sin(t * Math.PI * 1.15 + stem.phase) *
                stem.spread * (0.35 + t * 0.65) * stem.bend;
              const depthBend = Math.sin(t * Math.PI * 1.25 + stem.depthPhase) * stem.depth * (0.25 + t * 0.75);
              return [x + stem.side * 0.012 + sway,
                0.055 + height * (0.53 + t * 0.43) * stem.heightScale,
                z + depthBend + Math.sin(t * Math.PI + stem.phase) * 0.012 * t];
            };
            lavenderStems.forEach((stem, stemIndex) => {
              const whorlCount = 7;
              for (let whorl = 0; whorl < whorlCount; whorl += 1) {
                const progress = whorl / (whorlCount - 1);
                const center = stemCenter(stem, progress);
                const flowerCount = whorl < 2 ? 4 : 5;
                const radius = 0.024 * (1 - progress * 0.42);
                for (let flower = 0; flower < flowerCount; flower += 1) {
                  const angle = flower / flowerCount * Math.PI * 2 + whorl * 0.48 + stemIndex * 0.31;
                  const radial = [Math.cos(angle), Math.sin(angle)];
                  const cx = center[0] + radial[0] * radius;
                  const cz = center[2] + radial[1] * radius;
                  const cy = center[1] + (flower % 2 ? 0.004 : -0.003);
                  const shade = (flower + whorl + stemIndex) % 3 === 0 ? 1.1 :
                    (flower + whorl + stemIndex) % 3 === 1 ? 0.94 : 1;
                  const floretColor = headColor.map((channel) => Math.min(1, channel * shade));
                  addOctahedron(positions, colors, cx, cy, cz, 0.0125, 0.018, 0.0125, floretColor);
                  addOctahedron(positions, colors, cx + radial[0] * 0.012, cy + 0.012,
                    cz + radial[1] * 0.012, 0.010, 0.012, 0.010, floretColor);
                  addOctahedron(positions, colors, cx - radial[0] * 0.008, cy + 0.009,
                    cz - radial[1] * 0.008, 0.009, 0.010, 0.009, floretColor.map((channel) => channel * 0.92));
                }
              }
            });
  }

  registry.register(8, { stem: addLavenderStemLeafGeometry, bloom: addLavenderBloom });
})();
