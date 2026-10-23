(() => {
  const scriptUrl = document.currentScript?.src;
  if (!scriptUrl || typeof window.fetch !== 'function') return;

  const versionUrl = new URL('version.json', scriptUrl);
  const storageKey = 'diangarden-seen-version-v1';
  const checkIntervalMs = 5 * 60 * 1000;
  let currentVersion = '';
  let dismissedVersion = '';
  let banner = null;

  function createUpdateBanner(version) {
    if (banner) return;
    const wrapper = document.createElement('section');
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.setAttribute('aria-label', '遊戲版本更新');
    wrapper.className = 'diangarden-version-update';
    Object.assign(wrapper.style, {
      position: 'fixed',
      zIndex: '10000',
      left: '50%',
      bottom: 'max(16px, env(safe-area-inset-bottom))',
      transform: 'translateX(-50%)',
      width: 'min(92vw, 460px)',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 14px',
      border: '1px solid rgba(64, 91, 67, 0.22)',
      borderRadius: '14px',
      background: '#fffdf5',
      color: '#26382a',
      boxShadow: '0 8px 28px rgba(25, 42, 28, 0.22)',
      font: '500 14px/1.45 system-ui, sans-serif',
    });

    const message = document.createElement('span');
    message.textContent = '花園有新版本了，重新載入即可更新。';
    Object.assign(message.style, { flex: '1', minWidth: '0' });

    const reloadButton = document.createElement('button');
    reloadButton.type = 'button';
    reloadButton.textContent = '重新載入';
    Object.assign(reloadButton.style, {
      border: '0',
      borderRadius: '9px',
      padding: '9px 11px',
      background: '#477451',
      color: '#ffffff',
      font: 'inherit',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    });
    reloadButton.addEventListener('click', () => {
      try { localStorage.setItem(storageKey, version); } catch (_) {}
      window.location.reload();
    });

    const laterButton = document.createElement('button');
    laterButton.type = 'button';
    laterButton.textContent = '稍後';
    Object.assign(laterButton.style, {
      border: '1px solid rgba(64, 91, 67, 0.25)',
      borderRadius: '9px',
      padding: '8px 10px',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    });
    laterButton.addEventListener('click', () => {
      dismissedVersion = version;
      wrapper.remove();
      banner = null;
    });

    wrapper.append(message, reloadButton, laterButton);
    document.body.append(wrapper);
    banner = wrapper;
  }

  async function checkVersion() {
    try {
      const url = new URL(versionUrl.href);
      url.searchParams.set('check', String(Date.now()));
      const response = await fetch(url.href, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      if (typeof payload.version !== 'string' || !/^\d{6},\d{2}$/.test(payload.version)) return;

      currentVersion = payload.version;
      let seenVersion = '';
      try { seenVersion = localStorage.getItem(storageKey) || ''; } catch (_) {}

      if (!seenVersion) {
        try { localStorage.setItem(storageKey, currentVersion); } catch (_) {}
        return;
      }
      if (seenVersion !== currentVersion && dismissedVersion !== currentVersion) {
        createUpdateBanner(currentVersion);
      }
    } catch (_) {
      // Version checks are best-effort and must never block game startup or play.
    }
  }

  void checkVersion();
  window.setInterval(() => { void checkVersion(); }, checkIntervalMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkVersion();
  });
})();
