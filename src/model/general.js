(() => {
  const models = Array(11).fill(null);

  function addFace(positions, colors, corners, color) {
    const shade = [1, 0.88, 0.78, 0.88];
    const order = [0, 1, 2, 0, 2, 3];
    for (const index of order) {
      positions.push(...corners[index]);
      colors.push(color[0] * shade[index], color[1] * shade[index], color[2] * shade[index]);
    }
  }

function addTriangle(positions, colors, a, b, c, color) {
    for (const point of [a, b, c]) {
      positions.push(...point);
      colors.push(...color);
    }
  }

function addOctahedron(positions, colors, x, y, z, rx, ry, rz, color) {
    const top = [x, y + ry, z];
    const bottom = [x, y - ry, z];
    const east = [x + rx, y, z];
    const west = [x - rx, y, z];
    const north = [x, y, z - rz];
    const south = [x, y, z + rz];
    const faces = [
      [top, north, east], [top, east, south], [top, south, west], [top, west, north],
      [bottom, east, north], [bottom, south, east], [bottom, west, south], [bottom, north, west],
    ];
    for (let i = 0; i < faces.length; i += 1) {
      const shade = i < 4 ? 1 : 0.78;
      addTriangle(positions, colors, ...faces[i], color.map((channel) => channel * shade));
    }
  }

function addIcosahedron(positions, colors, x, y, z, radius, color) {
    // 正二十面體：12 個頂點、20 個等邊三角面，所有頂點到中心的距離相同。
    const phi = (1 + Math.sqrt(5)) / 2;
    const rawVertices = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
      [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
      [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
    ];
    const scale = radius / Math.sqrt(1 + phi * phi);
    const vertices = rawVertices.map(([vx, vy, vz]) => [
      x + vx * scale, y + vy * scale, z + vz * scale,
    ]);
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    for (let i = 0; i < faces.length; i += 1) {
      const shade = i % 5 === 0 ? 1.08 : i % 3 === 0 ? 0.86 : 0.96;
      addTriangle(positions, colors, vertices[faces[i][0]], vertices[faces[i][1]], vertices[faces[i][2]],
        color.map((channel) => Math.min(1, channel * shade)));
    }
  }

function addLeaf(positions, colors, x, y, z, direction, length, color) {
    const start = [x, y, z];
    const tip = [x + direction[0] * length, y + direction[1] * length, z + direction[2] * length];
    const side = [-direction[2] * 0.045, 0.018, direction[0] * 0.045];
    const left = [tip[0] + side[0], tip[1] + side[1], tip[2] + side[2]];
    const right = [tip[0] - side[0], tip[1] - side[1], tip[2] - side[2]];
    addTriangle(positions, colors, start, left, tip, color);
    addTriangle(positions, colors, start, tip, right, color.map((channel) => channel * 0.88));
  }

  function register(index, model) {
    if (!Number.isInteger(index) || index < 0 || index >= models.length) {
      throw new RangeError(`Invalid flower model index: ${index}`);
    }
    if (models[index]) throw new Error(`Flower model already registered: ${index}`);
    if (!model || typeof model.stem !== 'function' || typeof model.bloom !== 'function') {
      throw new TypeError(`Flower model ${index} must define stem and bloom functions`);
    }
    models[index] = Object.freeze({ stem: model.stem, bloom: model.bloom });
  }

  window.dianGardenFlowerModels = Object.freeze({
    register,
    get(index) { return models[index] || null; },
    get count() { return models.filter(Boolean).length; },
    geometry: Object.freeze({ addFace, addTriangle, addOctahedron, addIcosahedron, addLeaf }),
  });
})();
