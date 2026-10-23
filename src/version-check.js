(() => {
  const scriptUrl = document.currentScript?.src;
  if (!scriptUrl || typeof window.fetch !== 'function') return;

  const versionUrl = new URL('version.json', scriptUrl);
  const storageKey = 'diangarden-seen-version-v1';
  const validVersionPattern = /^(?:\d{6},\d{2}(?::\d{2}:\d{2}-r\d+a\d+)?|\d{6}, \d{3,})$/;
  const checkIntervalMs = 5 * 60 * 1000;
  let latestVersion = '';
  let dismissedVersion = '';
  let banner = null;
  let isRefreshing = false;

  const currentVersionElement = document.querySelector('#current-version');
  const latestVersionElement = document.querySelector('#latest-version');
  const statusElement = document.querySelector('#version-check-status');
  const forceUpdateButton = document.querySelector('#force-update-button');

  function getSeenVersion() {
    try { return localStorage.getItem(storageKey) || ''; } catch (_) { return ''; }
  }
  function setSeenVersion(version) {
    try { localStorage.setItem(storageKey, version); } catch (_) {}
  }
  function getCurrentVersion() {
    const buildVersion = window.__DIANGARDEN_BUILD_VERSION__;
    if (typeof buildVersion === 'string' && validVersionPattern.test(buildVersion)) return buildVersion;
    return getSeenVersion();
  }
  function renderVersionInfo(statusOverride = '') {
    const currentVersion = getCurrentVersion();
    if (currentVersion) setSeenVersion(currentVersion);
    if (currentVersionElement) currentVersionElement.textContent = currentVersion || '未知';
    if (latestVersionElement) latestVersionElement.textContent = latestVersion || '無法取得';
    if (!statusElement) return;
    statusElement.textContent = statusOverride || (
      !latestVersion ? '目前無法取得最新版本，請檢查網路後重試。' :
      currentVersion !== latestVersion ? '有新版本可用，建議立即更新。' :
      '目前已是最新版本。'
    );
    statusElement.classList.toggle('has-version-error', !latestVersion);
    statusElement.classList.toggle('has-version-update', Boolean(latestVersion && currentVersion !== latestVersion));
  }
  async function fetchLatestVersion() {
    const url = new URL(versionUrl.href);
    url.searchParams.set('check', String(Date.now()));
    const response = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('版本檔回應錯誤：' + response.status);
    const payload = await response.json();
    if (typeof payload.version !== 'string' || !/^(?:\d{6},\d{2}(?::\d{2}:\d{2}-r\d+a\d+)?|\d{6}, \d{3,})$/.test(payload.version)) throw new Error('版本檔格式錯誤');
    return payload.version;
  }
  function addCacheBuster(documentNode, baseUrl, token) {
    const selectors = [
      ['script[src]', 'src'], ['link[rel~="stylesheet"][href]', 'href'],
      ['img[src]', 'src'], ['source[src]', 'src'], ['video[src]', 'src'], ['audio[src]', 'src'],
    ];
    for (const [selector, attribute] of selectors) {
      documentNode.querySelectorAll(selector).forEach((element) => {
        const rawUrl = element.getAttribute(attribute);
        if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return;
        try {
          const resourceUrl = new URL(rawUrl, baseUrl);
          if (resourceUrl.origin !== window.location.origin || !['http:', 'https:'].includes(resourceUrl.protocol)) return;
          resourceUrl.searchParams.set('__dg_force_refresh', token);
          element.setAttribute(attribute, resourceUrl.href);
        } catch (_) {}
      });
    }
    documentNode.querySelectorAll('[srcset]').forEach((element) => {
      const original = element.getAttribute('srcset');
      if (!original) return;
      const updated = original.split(',').map((candidate) => {
        const parts = candidate.trim().split(/\s+/);
        try {
          const resourceUrl = new URL(parts[0], baseUrl);
          if (resourceUrl.origin === window.location.origin && ['http:', 'https:'].includes(resourceUrl.protocol)) {
            resourceUrl.searchParams.set('__dg_force_refresh', token);
            parts[0] = resourceUrl.href;
          }
        } catch (_) {}
        return parts.join(' ');
      }).join(', ');
      element.setAttribute('srcset', updated);
    });
  }
  async function forceRefresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    if (forceUpdateButton) {
      forceUpdateButton.disabled = true;
      forceUpdateButton.textContent = '正在更新…';
    }
    renderVersionInfo('正在重新取得遊戲頁面與程式資源…');
    try {
      const freshVersion = await fetchLatestVersion();
      const pageUrl = new URL(window.location.href);
      const requestToken = String(Date.now());
      pageUrl.searchParams.set('__dg_update', requestToken);
      const response = await fetch(pageUrl.href, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('遊戲頁面回應錯誤：' + response.status);
      const html = await response.text();
      const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
      if (!parsedDocument.querySelector('script[src$="game.js"], script[src*="game.js?"]') ||
          !parsedDocument.querySelector('script[src$="build-version.js"], script[src*="build-version.js?"]') ||
          !parsedDocument.querySelector('script[src$="version-check.js"], script[src*="version-check.js?"]')) {
        throw new Error('取得的頁面內容不完整，已保留目前遊戲');
      }
      const cacheToken = freshVersion.replace(',', '-') + '-' + requestToken;
      addCacheBuster(parsedDocument, response.url || pageUrl.href, cacheToken);
      dismissedVersion = '';
      renderVersionInfo('已取得最新檔案，正在重新載入…');
      // Run the existing pagehide save handler before replacing the document.
      window.dispatchEvent(new Event('pagehide'));
      const freshHtml = '<!doctype html>\n' + parsedDocument.documentElement.outerHTML;
      document.open();
      document.write(freshHtml);
      document.close();
    } catch (_) {
      isRefreshing = false;
      if (forceUpdateButton) {
        forceUpdateButton.disabled = false;
        forceUpdateButton.textContent = '立即更新';
      }
      renderVersionInfo('更新失敗，遊戲進度未被清除；請稍後重試。');
    }
  }
  function createUpdateBanner(version) {
    if (banner) return;
    const wrapper = document.createElement('section');
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.setAttribute('aria-label', '遊戲版本更新');
    wrapper.className = 'diangarden-version-update';
    Object.assign(wrapper.style, {
      position: 'fixed', zIndex: '10000', left: '50%', bottom: 'max(16px, env(safe-area-inset-bottom))',
      transform: 'translateX(-50%)', width: 'min(92vw, 460px)', boxSizing: 'border-box', display: 'flex',
      alignItems: 'center', gap: '12px', padding: '12px 14px',
      border: '1px solid rgba(64, 91, 67, 0.22)', borderRadius: '14px',
      background: '#fffdf5', color: '#26382a', boxShadow: '0 8px 28px rgba(25, 42, 28, 0.22)',
      font: '500 14px/1.45 system-ui, sans-serif',
    });
    const message = document.createElement('span');
    message.textContent = '花園有新版本了，重新載入即可更新。';
    Object.assign(message.style, { flex: '1', minWidth: '0' });
    const reloadButton = document.createElement('button');
    reloadButton.type = 'button';
    reloadButton.textContent = '重新載入';
    Object.assign(reloadButton.style, {
      border: '0', borderRadius: '9px', padding: '9px 11px', background: '#477451',
      color: '#ffffff', font: 'inherit', whiteSpace: 'nowrap', cursor: 'pointer',
    });
    reloadButton.addEventListener('click', () => { void forceRefresh(); });
    const laterButton = document.createElement('button');
    laterButton.type = 'button';
    laterButton.textContent = '稍後';
    Object.assign(laterButton.style, {
      border: '1px solid rgba(64, 91, 67, 0.25)', borderRadius: '9px', padding: '8px 10px',
      background: 'transparent', color: 'inherit', font: 'inherit', whiteSpace: 'nowrap', cursor: 'pointer',
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
      latestVersion = await fetchLatestVersion();
      const currentVersion = getCurrentVersion();
      if (!currentVersion) setSeenVersion(latestVersion);
      renderVersionInfo();
      if (currentVersion && currentVersion !== latestVersion && dismissedVersion !== latestVersion) createUpdateBanner(latestVersion);
      else if (banner && currentVersion === latestVersion) { banner.remove(); banner = null; }
    } catch (_) {
      latestVersion = '';
      renderVersionInfo();
    }
  }
  forceUpdateButton?.addEventListener('click', () => { void forceRefresh(); });
  void checkVersion();
  window.setInterval(() => { void checkVersion(); }, checkIntervalMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkVersion();
  });
})();
