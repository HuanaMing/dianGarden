(() => {
  const registry = window.dianGardenFlowerModels;
  const { addTriangle, addOctahedron, addIcosahedron, addLeaf } = registry.geometry;

function addSunflowerStemLeafGeometry(positions, colors, x, z, height, stage) {
    const stemTop = 0.055 + height;
    // Build a tapered, low-poly round stalk from short ring segments instead
    // of a square box. A tiny centerline drift avoids a perfectly mechanical look.
    const stemRings = [
      { t: 0, radius: 0.022 },
      { t: 0.22, radius: 0.0205 },
      { t: 0.46, radius: 0.0185 },
      { t: 0.7, radius: 0.0165 },
      { t: 0.9, radius: 0.015 },
      { t: 1, radius: 0.014 },
    ];
    const stemSides = 10;
    const stemRingVertices = stemRings.map(({ t, radius }) => {
      const centerX = x + Math.sin(t * Math.PI) * 0.0045;
      const centerZ = z + Math.sin(t * Math.PI * 0.8) * 0.0025;
      return Array.from({ length: stemSides }, (_, side) => {
        const angle = side / stemSides * Math.PI * 2;
        return [centerX + Math.cos(angle) * radius, 0.055 + height * t,
          centerZ + Math.sin(angle) * radius];
      });
    });
    for (let ring = 0; ring < stemRingVertices.length - 1; ring += 1) {
      for (let side = 0; side < stemSides; side += 1) {
        const next = (side + 1) % stemSides;
        const lowerA = stemRingVertices[ring][side];
        const lowerB = stemRingVertices[ring][next];
        const upperA = stemRingVertices[ring + 1][side];
        const upperB = stemRingVertices[ring + 1][next];
        const shade = 0.88 + (Math.cos((side + 0.5) / stemSides * Math.PI * 2) + 1) * 0.08;
        const stemColor = [0.28, 0.48, 0.24].map((channel) => Math.min(1, channel * shade));
        addTriangle(positions, colors, lowerA, lowerB, upperB, stemColor);
        addTriangle(positions, colors, lowerA, upperB, upperA, stemColor.map((channel) => channel * 0.97));
      }
    }
    // Close the stalk base with a small green polygon hidden against the soil.
    const stemBaseCenter = [x, 0.055, z];
    for (let side = 0; side < stemSides; side += 1) {
      addTriangle(positions, colors, stemBaseCenter, stemRingVertices[0][(side + 1) % stemSides],
        stemRingVertices[0][side], [0.23, 0.39, 0.2]);
    }

    const leafNodes = stage === 1 ? [0.42, 0.72] : [0.28, 0.46, 0.64, 0.8];
    const leafLengths = stage === 1 ? [0.13, 0.12] : [0.245, 0.235, 0.205, 0.17];
    const leafColors = [[0.34, 0.6, 0.26], [0.39, 0.66, 0.29], [0.31, 0.56, 0.24], [0.36, 0.62, 0.27]];

    for (let leaf = 0; leaf < leafNodes.length; leaf += 1) {
      const nodeY = 0.055 + height * leafNodes[leaf];
      const angle = leaf * 2.38 + 0.42;
      const radial = [Math.cos(angle), Math.sin(angle)];
      const tangent = [-radial[1], radial[0]];
      const length = leafLengths[leaf];
      const width = stage === 1 ? 0.045 : 0.078 - leaf * 0.006;
      const droop = length * 0.29;
      const base = [x + radial[0] * 0.018, nodeY, z + radial[1] * 0.018];
      const bladeStart = [x + radial[0] * 0.052, nodeY - 0.012, z + radial[1] * 0.052];
      const shoulderY = nodeY - droop * 0.42;
      const shoulder = [x + radial[0] * length * 0.57, shoulderY, z + radial[1] * length * 0.57];
      const tip = [x + radial[0] * length, nodeY - droop, z + radial[1] * length];
      const left = [shoulder[0] + tangent[0] * width, shoulderY + 0.014, shoulder[2] + tangent[1] * width];
      const right = [shoulder[0] - tangent[0] * width, shoulderY + 0.014, shoulder[2] - tangent[1] * width];
      const ridge = [shoulder[0] + radial[0] * length * 0.13, shoulderY + 0.023, shoulder[2] + radial[1] * length * 0.13];
      const color = leafColors[leaf % leafColors.length];
      const petioleSide = [tangent[0] * 0.006, tangent[1] * 0.006];

      addTriangle(positions, colors, base,
        [bladeStart[0] + petioleSide[0], bladeStart[1], bladeStart[2] + petioleSide[1]],
        [bladeStart[0] - petioleSide[0], bladeStart[1], bladeStart[2] - petioleSide[1]], [0.25, 0.46, 0.2]);
      addTriangle(positions, colors, bladeStart, left, ridge, color);
      addTriangle(positions, colors, ridge, left, tip, color.map((channel) => Math.min(1, channel * 1.05)));
      addTriangle(positions, colors, bladeStart, ridge, right, color.map((channel) => channel * 0.9));
      addTriangle(positions, colors, ridge, tip, right, color);
    }
  }

  function addSunFlowerBloom({
    positions, colors, x, z, height, headColor, environmentState, stemModel, stage,
  }) {
    const bloomY = 0.055 + height;
    const dedicatedStemLeafModel = stemModel;
    if (dedicatedStemLeafModel) dedicatedStemLeafModel(positions, colors, x, z, height, stage);
          const headY = 0.055 + height;
          const flowerHeadStart = positions.length;
          // Layered ray florets form the familiar face-on sunflower silhouette.
          addOctahedron(positions, colors, x, headY, z + 0.014, 0.081, 0.081, 0.045, [0.34, 0.18, 0.09]);
          for (let petal = 0; petal < 20; petal += 1) {
            const angle = (petal / 20) * Math.PI * 2;
            const radial = [Math.cos(angle), Math.sin(angle)];
            const tangent = [-radial[1], radial[0]];
            const layer = petal % 2 ? 0 : 1;
            const innerRadius = layer ? 0.066 : 0.047;
            const outerRadius = layer ? 0.19 : 0.16;
            const halfWidth = layer ? 0.027 : 0.025;
            const depth = layer ? 0.005 : -0.008;
            const root = [x + radial[0] * innerRadius, headY + radial[1] * innerRadius, z + depth];
            const tip = [x + radial[0] * outerRadius, headY + radial[1] * outerRadius, z + depth - 0.008];
            const middleRadius = innerRadius + (outerRadius - innerRadius) * 0.55;
            const ridge = [x + radial[0] * middleRadius, headY + radial[1] * middleRadius, z + depth + 0.04];
            const left = [x + radial[0] * middleRadius + tangent[0] * halfWidth,
              headY + radial[1] * middleRadius + tangent[1] * halfWidth, z + depth + 0.02];
            const right = [x + radial[0] * middleRadius - tangent[0] * halfWidth,
              headY + radial[1] * middleRadius - tangent[1] * halfWidth, z + depth + 0.02];
            const petalColor = petal % 3 === 0 ? headColor.map((channel) => Math.min(1, channel * 1.08)) : headColor;
            addTriangle(positions, colors, root, left, ridge, petalColor.map((channel) => channel * 0.94));
            addTriangle(positions, colors, left, tip, ridge, petalColor);
            addTriangle(positions, colors, root, ridge, right, petalColor);
            addTriangle(positions, colors, ridge, tip, right, petalColor.map((channel) => channel * 0.94));
          }
          // Small florets spiral across the raised dark disk rather than a single lump.
          const diskFlorets = 48;
          const goldenAngle = Math.PI * (3 - Math.sqrt(5));
          for (let floret = 0; floret < diskFlorets; floret += 1) {
            const radius = 0.073 * Math.sqrt((floret + 0.5) / diskFlorets);
            const angle = floret * goldenAngle;
            const diskColor = floret % 4 === 0 ? [0.52, 0.31, 0.15] : [0.37, 0.2, 0.1];
            addOctahedron(positions, colors, x + Math.cos(angle) * radius, headY + Math.sin(angle) * radius, z + 0.026,
              0.012, 0.012, 0.012, diskColor);
          }
          for (let bract = 0; bract < 12; bract += 1) {
            const angle = bract / 12 * Math.PI * 2;
            addOctahedron(positions, colors, x + Math.cos(angle) * 0.075, headY + Math.sin(angle) * 0.075, z - 0.004,
              0.021, 0.018, 0.014, [0.32, 0.49, 0.23]);
          }
          const headCos = Math.cos(environmentState.sunflowerYaw), headSin = Math.sin(environmentState.sunflowerYaw);
          for (let vertex = flowerHeadStart; vertex < positions.length; vertex += 3) {
            const offsetX = positions[vertex] - x, offsetZ = positions[vertex + 2] - z;
            positions[vertex] = x + offsetX * headCos + offsetZ * headSin;
            positions[vertex + 2] = z - offsetX * headSin + offsetZ * headCos;
          }
          // Move the whole head slightly forward so its rear edge meets the stalk.
          const sunflowerHeadForwardOffset = 0.031;
          for (let vertex = flowerHeadStart; vertex < positions.length; vertex += 3) {
            positions[vertex + 2] += sunflowerHeadForwardOffset;
          }
          return;
  }

  registry.register(0, { stem: addSunflowerStemLeafGeometry, bloom: addSunFlowerBloom });
})();
