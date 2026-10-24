(() => {
  const wheel = document.querySelector('#garden-menu-wheel');
  const frame = document.querySelector('.world-frame');
  if (!wheel || !frame) return;

  const actions = ['drone', 'farm', 'settings', 'catalog', 'collapse'];
  const angles = [-90, -18, 54, 126, 198];
  const labels = {
    drone: '#drone-panel-toggle',
    farm: '#farm-management-toggle',
    settings: '#settings-toggle',
    catalog: '.encyclopedia-link',
    collapse: '#hud-toggle',
  };
  let pointerId = null;
  let origin = null;
  let selected = null;

  function closeWheel() {
    wheel.hidden = true;
    wheel.classList.remove('is-active');
    wheel.querySelectorAll('button').forEach((button) => button.classList.remove('is-selected'));
    pointerId = null;
    origin = null;
    selected = null;
  }

  function chooseAt(x, y) {
    if (!origin) return;
    const dx = x - origin.x;
    const dy = y - origin.y;
    if (Math.hypot(dx, dy) < 22) selected = null;
    else {
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      let best = 0;
      let distance = Infinity;
      angles.forEach((center, index) => {
        const delta = Math.abs(((angle - center + 540) % 360) - 180);
        if (delta < distance) { distance = delta; best = index; }
      });
      selected = actions[best];
    }
    wheel.querySelectorAll('[data-wheel-action]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.wheelAction === selected);
    });
  }

  function runAction(action) {
    closeWheel();
    const target = document.querySelector(labels[action] || '');
    target?.click();
  }

  wheel.querySelectorAll('[data-wheel-action]').forEach((button) => {
    const index = actions.indexOf(button.dataset.wheelAction);
    const angle = angles[index] * Math.PI / 180;
    button.style.left = `${Math.cos(angle) * 78}px`;
    button.style.top = `${Math.sin(angle) * 78}px`;
    button.addEventListener('click', () => runAction(button.dataset.wheelAction));
  });

  window.gardenMenuWheel = {
    isOpen: () => !wheel.hidden,
    openAt(clientX, clientY, id) {
      if (wheel.hidden === false || document.querySelector('dialog[open]')) return false;
      const rect = frame.getBoundingClientRect();
      const margin = 112;
      const x = Math.max(margin, Math.min(rect.width - margin, clientX - rect.left));
      const y = Math.max(margin, Math.min(rect.height - margin, clientY - rect.top));
      wheel.style.left = `${x}px`;
      wheel.style.top = `${y}px`;
      wheel.hidden = false;
      wheel.classList.add('is-active');
      pointerId = id;
      origin = { x: clientX, y: clientY };
      selected = null;
      window.dispatchEvent(new CustomEvent('garden-menu-wheel-open', { detail: { pointerId: id } }));
      return true;
    },
  };

  document.addEventListener('pointermove', (event) => {
    if (wheel.hidden || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    chooseAt(event.clientX, event.clientY);
  }, true);

  document.addEventListener('pointerup', (event) => {
    if (wheel.hidden || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const action = selected;
    closeWheel();
    if (action) runAction(action);
  }, true);

  document.addEventListener('pointercancel', (event) => {
    if (wheel.hidden || event.pointerId !== pointerId) return;
    event.stopPropagation();
    closeWheel();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !wheel.hidden) closeWheel();
  });
})();
