(() => {
  'use strict';

  const GUEST_MODE_KEY = 'sky-garden-guest-mode-v1';
  const GUEST_MODE_ACTIVE = (() => { try { return localStorage.getItem(GUEST_MODE_KEY) === 'true'; } catch (_) { return false; } })();
  const STORAGE_KEY = 'sky-garden-save-v1';
  const VARIANTS_KEY = 'sky-garden-flower-variants-v1';
  const AUTO_CROPS_KEY = 'sky-garden-auto-crops-v1';
  const SYNC_META_KEY = 'sky-garden-cloud-sync-v1';
  const AUTH_SESSION_KEY = 'sky-garden-auth-session-v1';
  const AUTH_OPENED_AT_KEY = 'sky-garden-auth-opened-at-v1';
  const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;
  const LEGACY_BROWSER_ID_KEY = 'sky-garden-browser-id-v1';
  let sessionOpenedAt = 0;
  try { localStorage.removeItem(LEGACY_BROWSER_ID_KEY); } catch (_) { /* Ignore unavailable local storage. */ }
  let hasResolvedStartupCloud = false;
  let resolveStartupCloud;
  window.diangardenCloudReady = new Promise((resolve) => { resolveStartupCloud = resolve; });
  const startupDialog = document.querySelector('#startup-garden-dialog');

  const startupSigninNode = document.querySelector('#startup-google-signin');
  const startupLoginHint = document.querySelector('#startup-login-hint');
  const guestNoticeNode = document.querySelector('#guest-garden-notice');
  const returnToOwnGardenButton = document.querySelector('#return-to-own-garden');
  const startGuestGardenButton = document.querySelector('#start-guest-garden');
  function finishStartupCloud() {
    if (hasResolvedStartupCloud) return;
    hasResolvedStartupCloud = true;
    if (startupDialog?.open) startupDialog.close();
    resolveStartupCloud();
  }
  function showStartupChoice(message) {
    if (startupLoginHint && message) startupLoginHint.textContent = message;
    if (!GUEST_MODE_ACTIVE && startupDialog && !startupDialog.open) startupDialog.showModal();
  }
  const config = window.DIANGARDEN_CLOUD_SAVE_CONFIG || {};
  const statusNode = document.querySelector('#cloud-save-status');
  const signinNode = document.querySelector('#cloud-save-signin');
  const actionsNode = document.querySelector('#cloud-save-actions');
  const uploadButton = document.querySelector('#cloud-save-upload');
  const downloadButton = document.querySelector('#cloud-save-download');
  const refreshButton = document.querySelector('#cloud-save-refresh');
  const signoutButton = document.querySelector('#cloud-save-signout');

  if (!statusNode || !signinNode || !actionsNode) return;
  const sessionRefreshButton = document.querySelector('#cloud-session-refresh') || (() => {
    const button = document.createElement('button');
    button.id = 'cloud-session-refresh';
    button.className = 'cloud-session-refresh';
    button.type = 'button';
    button.textContent = '重新整理遊戲';
    button.hidden = true;
    statusNode.insertAdjacentElement('afterend', button);
    return button;
  })();
  const mainSessionRefreshButton = document.querySelector('#cloud-session-refresh-main');

  let accessToken = null;
  let legacyIdToken = null;
  let refreshToken = null;
  let accessExpiresAt = 0;
  let authRefreshPromise = null;
  let currentSub = null;
  let cloudRevision = 0;
  let cloudSave = null;
  let syncEnabled = false;
  let sessionExpired = false;
  let syncBusy = false;
  let pendingSyncTimer = null;
  let lastUploadedSignature = '';
  let googleInitialized = false;

  function setStatus(message, state = 'normal') {
    statusNode.textContent = message;
    statusNode.dataset.state = state;
  }

  function refreshCurrentPage() {
    window.location.href = window.location.href;
  }

  function setSessionExpired(expired) {
    sessionExpired = expired;
    window.diangardenCloudSessionExpired = expired;
    sessionRefreshButton.hidden = !expired;
    if (mainSessionRefreshButton) mainSessionRefreshButton.hidden = !expired;
    if (expired) {
      // A stale cloud-save owner is not an expired login. Keep the long-lived
      // game session so a page reload can rotate its refresh token and recover.
      if (refreshToken) {
        try { sessionStorage.removeItem(AUTH_OPENED_AT_KEY); } catch (_) { /* Start a fresh save claim after reload. */ }
      } else {
        // Legacy Google-ID-token sessions cannot survive a reload safely.
        clearStoredAuthSession();
      }
      sessionOpenedAt = 0;
      syncEnabled = false;
      clearTimeout(pendingSyncTimer);
      setStatus('雲端同步已暫停；本機進度仍會保留。', 'warning');
      signinNode.hidden = true;
      if (startupSigninNode) startupSigninNode.hidden = true;
    }
    window.dispatchEvent(new CustomEvent('diangarden:cloud-session-state', {
      detail: { expired, message: expired ? '雲端同步已暫停；本機進度仍會保留。' : '' },
    }));
  }

  function readMeta() {
    try {
      const value = JSON.parse(localStorage.getItem(SYNC_META_KEY) || 'null');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function writeMeta(meta) {
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
    } catch (_) {
      setStatus('無法儲存同步狀態；本機遊戲仍可繼續。', 'warning');
    }
  }

  function readLocalSave() {
    const saveData = localStorage.getItem(STORAGE_KEY);
    const variantsData = localStorage.getItem(VARIANTS_KEY) || '[]';
    const autoCropsData = localStorage.getItem(AUTO_CROPS_KEY) || '[0]';
    if (!saveData) return null;
    try {
      const main = JSON.parse(saveData);
      const variants = JSON.parse(variantsData);
      const autoCrops = JSON.parse(autoCropsData);
      if (!main || typeof main !== 'object' || Array.isArray(main)
        || !Array.isArray(variants) || !Array.isArray(autoCrops)) return null;
      return { saveData, variantsData, autoCropsData };
    } catch (_) {
      return null;
    }
  }

  function signatureOf(save) {
    return save ? JSON.stringify([save.saveData, save.variantsData, save.autoCropsData]) : '';
  }

  function parseJwtPayload(token) {
    try {
      const part = token.split('.')[1];
      if (!part) return null;
      const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4);
      return JSON.parse(decodeURIComponent(Array.from(atob(padded), (char) =>
        '%' + char.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
    } catch (_) { return null; }
  }

  function clearStoredAuthSession() {
    try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (_) { /* Ignore unavailable local storage. */ }
    try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch (_) { /* Ignore unavailable session storage. */ }
    try { sessionStorage.removeItem(AUTH_OPENED_AT_KEY); } catch (_) { /* Ignore unavailable session storage. */ }
  }

  function restoreLegacyAuthSession() {
    try {
      const record = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || 'null');
      const claims = record && typeof record.idToken === 'string' ? parseJwtPayload(record.idToken) : null;
      if (!record || record.version !== 1 || !claims || claims.sub !== record.currentSub
        || claims.aud !== config.googleClientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || !Number.isFinite(claims.exp)
        || claims.exp * 1000 <= Date.now() + TOKEN_EXPIRY_SKEW_MS
        || !Number.isSafeInteger(record.sessionOpenedAt) || record.sessionOpenedAt <= 0) return false;
      legacyIdToken = record.idToken;
      currentSub = record.currentSub;
      sessionOpenedAt = record.sessionOpenedAt;
      return true;
    } catch (_) { return false; }
  }

  function persistLegacyAuthSession(token, claims) {
    legacyIdToken = token;
    currentSub = claims.sub;
    sessionOpenedAt = Date.now();
    try {
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
        version: 1, idToken: token, currentSub, exp: claims.exp, sessionOpenedAt,
      }));
    } catch (_) { /* Legacy fallback lasts for this page only. */ }
  }

  function readStoredAuthSession() {
    try {
      const record = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
      if (record && record.version === 2 && typeof record.refreshToken === 'string'
        && typeof record.currentSub === 'string' && record.refreshToken.length > 20) return record;
    } catch (_) { /* Treat invalid stored state as signed out. */ }
    return null;
  }

  function persistAuthSession() {
    if (typeof refreshToken !== 'string' || typeof currentSub !== 'string') return false;
    try {
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ version: 2, refreshToken, currentSub }));
      return true;
    } catch (_) {
      clearStoredAuthSession();
      setStatus('無法保存長期登入狀態；本機遊戲仍可繼續。', 'warning');
      return false;
    }
  }

  function restoreSessionOpenedAt() {
    try {
      const saved = Number(sessionStorage.getItem(AUTH_OPENED_AT_KEY) || 0);
      if (Number.isSafeInteger(saved) && saved > 0) {
        sessionOpenedAt = saved;
        return;
      }
      sessionOpenedAt = Date.now();
      sessionStorage.setItem(AUTH_OPENED_AT_KEY, String(sessionOpenedAt));
    } catch (_) {
      sessionOpenedAt = Date.now();
    }
  }

  async function postSession(path, payload) {
    const baseUrl = String(config.apiBaseUrl || '').trim().replace(/\/$/, '');
    if (!baseUrl) throw new Error('cloud_api_not_configured');
    const response = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    let result;
    try { result = await response.json(); } catch (_) { result = {}; }
    if (!response.ok) throw new Error(result.error || 'session_request_failed');
    return result;
  }

  async function refreshGameSession() {
    if (authRefreshPromise) return authRefreshPromise;
    authRefreshPromise = (async () => {
      if (!refreshToken) {
        const stored = readStoredAuthSession();
        if (stored) {
          refreshToken = stored.refreshToken;
          currentSub = stored.currentSub;
        }
      }
      if (!refreshToken) throw new Error('login_required');
      const result = await postSession('/api/session/refresh', { refreshToken });
      if (typeof result.accessToken !== 'string' || typeof result.refreshToken !== 'string'
        || typeof result.userId !== 'string' || !Number.isFinite(result.accessExpiresAt)) {
        throw new Error('invalid_session_response');
      }
      accessToken = result.accessToken;
      refreshToken = result.refreshToken;
      accessExpiresAt = result.accessExpiresAt * 1000;
      currentSub = result.userId;
      persistAuthSession();
      restoreSessionOpenedAt();
      return true;
    })();
    try { return await authRefreshPromise; }
    catch (error) {
      if (['session_expired', 'refresh_token_reused', 'invalid_refresh_token'].includes(error.message)) {
        clearAuthentication();
        throw new Error('authentication_required');
      }
      throw error;
    } finally {
      authRefreshPromise = null;
    }
  }

  async function createGameSession(googleIdToken) {
    const result = await postSession('/api/session', { idToken: googleIdToken });
    if (typeof result.accessToken !== 'string' || typeof result.refreshToken !== 'string'
      || typeof result.userId !== 'string' || !Number.isFinite(result.accessExpiresAt)) {
      throw new Error('invalid_session_response');
    }
    accessToken = result.accessToken;
    refreshToken = result.refreshToken;
    accessExpiresAt = result.accessExpiresAt * 1000;
    currentSub = result.userId;
    sessionOpenedAt = Date.now();
    try { sessionStorage.setItem(AUTH_OPENED_AT_KEY, String(sessionOpenedAt)); } catch (_) { /* Continue in memory. */ }
    persistAuthSession();
  }

  function clearAuthentication() {
    clearStoredAuthSession();
    accessToken = null;
    legacyIdToken = null;
    refreshToken = null;
    accessExpiresAt = 0;
    authRefreshPromise = null;
    currentSub = null;
    sessionOpenedAt = 0;
    cloudSave = null;
    cloudRevision = 0;
    syncEnabled = false;
    clearTimeout(pendingSyncTimer);
    setSessionExpired(false);
    signinNode.hidden = false;
    if (startupSigninNode) startupSigninNode.hidden = false;
    updateButtons(false);
  }

  function updateButtons(visible) {
    const authenticated = Boolean(visible && (accessToken || legacyIdToken) && !sessionExpired);
    const needsChoice = authenticated && statusNode.dataset.state === 'choice';
    actionsNode.hidden = !authenticated;
    uploadButton.hidden = !needsChoice;
    downloadButton.hidden = !needsChoice || !cloudSave;
    refreshButton.hidden = !needsChoice;
    signoutButton.hidden = !authenticated;
    uploadButton.disabled = syncBusy;
    downloadButton.disabled = syncBusy || !cloudSave;
    refreshButton.disabled = syncBusy;
    signoutButton.disabled = syncBusy;
  }

  async function apiRequest(method, body) {
    const baseUrl = String(config.apiBaseUrl || '').trim().replace(/\/$/, '');
    if (!baseUrl) throw new Error('cloud_api_not_configured');
    if (!legacyIdToken && (!accessToken || accessExpiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS)) {
      await refreshGameSession();
    }
    const send = async () => fetch(baseUrl + '/api/save', {
      method,
      headers: {
        Authorization: 'Bearer ' + (accessToken || legacyIdToken),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'X-DianGarden-Opened-At': String(sessionOpenedAt),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
    let response = await send();
    let result;
    try { result = await response.json(); } catch (_) { result = {}; }
    if (response.status === 401 && result.error === 'access_token_expired') {
      await refreshGameSession();
      response = await send();
      try { result = await response.json(); } catch (_) { result = {}; }
    }
    if (response.status === 409) {
      const error = new Error(result.error || 'revision_conflict');
      error.revision = Number.isSafeInteger(result.revision) ? result.revision : null;
      throw error;
    }
    if (response.status === 401) {
      if (['session_expired', 'invalid_access_token', 'authentication_required', 'refresh_token_reused'].includes(result.error)) {
        clearAuthentication();
        throw new Error('authentication_required');
      }
    }
    if (!response.ok) throw new Error(result.error || 'cloud_request_failed');
    return result;
  }

  function messageForError(error) {
    if (error.message === 'cloud_api_not_configured') return '雲端 API 尚未設定；目前仍使用本機自動存檔。';
    if (error.message === 'login_required') return '請先登入 Google。';
    if (error.message === 'revision_conflict') return '雲端存檔版本已更新，已停止這次上傳。請重新載入最新雲端存檔。';
    if (error.message === 'stale_session') return '雲端同步已暫停；本機進度仍會保留。';
    if (error.message === 'invalid_google_id_token' || error.message === 'authentication_required') return 'Google 登入已失效，請重新登入。';
    if (error.message === 'storage_unavailable') return '雲端資料庫暫時無法使用；本機進度仍安全保留。';
    if (error.message === 'origin_not_allowed') return '目前網站網址尚未加入雲端 API 允許清單。';
    return '雲端同步暫時失敗；本機遊戲仍可繼續。';
  }

  function makeUploadPayload(save, revision) {
    return {
      schemaVersion: 1,
      baseRevision: revision,
      saveData: save.saveData,
      variantsData: save.variantsData,
      autoCropsData: save.autoCropsData,
      openedAt: sessionOpenedAt,
      savedAt: (() => { try { const parsed = JSON.parse(save.saveData); return Number.isSafeInteger(parsed.savedAt) && parsed.savedAt > 0 ? parsed.savedAt : Date.now(); } catch (_) { return Date.now(); } })(),
    };
  }

  async function checkCloud({ quiet = false } = {}) {
    if (!(accessToken || legacyIdToken) || sessionExpired) return;
    syncBusy = true;
    updateButtons(true);
    if (!quiet) setStatus('正在檢查雲端存檔…');
    try {
      const result = await apiRequest('GET');
      setSessionExpired(false);
      cloudSave = result.status === 'ok' ? result.save : null;
      cloudRevision = cloudSave ? cloudSave.revision : 0;
      const local = readLocalSave();
      if (cloudSave) {
        // Restore a cloud revision only once. Startup may update volatile timestamps
        // after offline simulation, so an already accepted revision must not trigger a reload loop.
        const cloudSignature = signatureOf(cloudSave);
        const localSignature = signatureOf(local);
        const meta = readMeta();
        const previouslyLoadedSameRevision = meta.userSub === currentSub && meta.revision === cloudRevision;
        if (cloudSignature !== localSignature && !previouslyLoadedSameRevision) {
          localStorage.setItem(STORAGE_KEY, cloudSave.saveData);
          localStorage.setItem(VARIANTS_KEY, cloudSave.variantsData);
          localStorage.setItem(AUTO_CROPS_KEY, cloudSave.autoCropsData);
          writeMeta({ userSub: currentSub, revision: cloudRevision, localSignature: cloudSignature, updatedAt: cloudSave.updatedAt || null });
          syncEnabled = false;
          setStatus('已先載入雲端花園，正在重新載入並恢復離線進度…', 'success');
          window.dispatchEvent(new Event('diangarden:restore-cloud-save'));
          finishStartupCloud();
          window.location.reload();
          return;
        }
        writeMeta({ userSub: currentSub, revision: cloudRevision, localSignature: cloudSignature, updatedAt: cloudSave.updatedAt || null });
        lastUploadedSignature = cloudSignature;
        syncEnabled = true;
        setStatus('已載入最新雲端花園；這台瀏覽器取得目前同步權。', 'success');
      } else {
        syncEnabled = false;
        setStatus(local
          ? '雲端還沒有存檔。按「使用這台裝置的花園」即可建立雲端備份。'
          : '雲端還沒有存檔；先開始遊玩，再將目前花園上傳。', 'choice');
      }
      updateButtons(true);
      finishStartupCloud();
    } catch (error) {
      finishStartupCloud();
      syncEnabled = false;
      if (error.message === 'stale_session') {
        setSessionExpired(true);
      } else {
        setStatus(messageForError(error), 'warning');
      }
      if (error.message === 'invalid_google_id_token' || error.message === 'authentication_required') {
        clearAuthentication();
        showStartupChoice('Google 登入已失效，請重新登入後再繼續同步。');
      }
    } finally {
      syncBusy = false;
      updateButtons(Boolean(accessToken || legacyIdToken));
    }
  }

  async function uploadLocal({ automatic = false } = {}) {
    if (!(accessToken || legacyIdToken) || syncBusy || sessionExpired) return;
    const local = readLocalSave();
    if (!local) {
      setStatus('目前沒有可用的本機存檔；請先開始遊玩。', 'warning');
      return;
    }
    syncBusy = true;
    updateButtons(true);
    if (!automatic) setStatus('正在安全地上傳本機花園…');
    try {
      const result = await apiRequest('PUT', makeUploadPayload(local, cloudRevision));
      cloudRevision = result.revision;
      cloudSave = { ...local, revision: result.revision, updatedAt: result.updatedAt };
      const localSignature = signatureOf(local);
      writeMeta({ userSub: currentSub, revision: cloudRevision, localSignature, updatedAt: result.updatedAt });
      lastUploadedSignature = localSignature;
      syncEnabled = true;
      setStatus('花園已同步到雲端；這台裝置仍會保留本機存檔。', 'success');
    } catch (error) {
      syncEnabled = false;
      if (error.message === 'stale_session') {
        setSessionExpired(true);
      } else {
        setStatus(messageForError(error), 'warning');
        if (error.message === 'invalid_google_id_token' || error.message === 'authentication_required') {
          clearAuthentication();
          showStartupChoice('Google 登入已失效，請重新登入後再繼續同步。');
        }
      }
      if (error.message === 'revision_conflict') await checkCloud({ quiet: true });
    } finally {
      syncBusy = false;
      updateButtons(Boolean(accessToken || legacyIdToken));
      if (syncEnabled && (accessToken || legacyIdToken)) {
        const latestSignature = signatureOf(readLocalSave());
        if (latestSignature && latestSignature !== lastUploadedSignature) {
          clearTimeout(pendingSyncTimer);
          pendingSyncTimer = setTimeout(() => uploadLocal({ automatic: true }), 1200);
        }
      }
    }
  }

  function downloadCloud() {
    if (!cloudSave || syncBusy) return;
    const confirmed = window.confirm('載入雲端花園會取代這台裝置目前的本機存檔。雲端版本會保留。確定繼續嗎？');
    if (!confirmed) return;
    try {
      JSON.parse(cloudSave.saveData);
      JSON.parse(cloudSave.variantsData);
      JSON.parse(cloudSave.autoCropsData);
      window.skyWorld?.setRenderingPaused?.('cloud-restore', true);
      localStorage.setItem(STORAGE_KEY, cloudSave.saveData);
      localStorage.setItem(VARIANTS_KEY, cloudSave.variantsData);
      localStorage.setItem(AUTO_CROPS_KEY, cloudSave.autoCropsData);
      writeMeta({
        userSub: currentSub,
        revision: cloudSave.revision,
        localSignature: signatureOf({
          saveData: cloudSave.saveData,
          variantsData: cloudSave.variantsData,
          autoCropsData: cloudSave.autoCropsData,
        }),
        updatedAt: cloudSave.updatedAt || null,
      });
      setStatus('已載入雲端花園，正在重新載入遊戲…', 'success');
      // Prevent the old in-memory game from overwriting the cloud save during pagehide.
      window.dispatchEvent(new Event('diangarden:restore-cloud-save'));
      window.location.reload();
    } catch (_) {
      window.skyWorld?.setRenderingPaused?.('cloud-restore', false);
      setStatus('雲端存檔格式無法讀取；本機資料未變更。', 'warning');
    }
  }

  async function handleCredential(response) {
    if (!response || typeof response.credential !== 'string') {
      setStatus('Google 登入未完成，請再試一次。', 'warning');
      if (startupLoginHint) startupLoginHint.textContent = 'Google 登入未完成，請再試一次；也可以直接進入訪客花園。';
      return;
    }
    const claims = parseJwtPayload(response.credential);
    if (!claims || typeof claims.sub !== 'string' || claims.aud !== config.googleClientId
      || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
      || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
      setStatus('無法讀取 Google 登入資訊，請再試一次。', 'warning');
      if (startupLoginHint) startupLoginHint.textContent = '無法讀取 Google 登入資訊，請重新登入或選擇訪客花園。';
      return;
    }
    try {
      await createGameSession(response.credential);
      signinNode.hidden = true;
      if (startupSigninNode) startupSigninNode.hidden = true;
      setSessionExpired(false);
      syncEnabled = false;
      setStatus('Google 登入成功，正在檢查雲端花園…');
      if (startupLoginHint) startupLoginHint.textContent = '登入成功，正在確認你的花園…';
      updateButtons(true);
      await checkCloud();
    } catch (error) {
      // Older deployed Workers reject the new POST endpoint at CORS preflight.
      // Fall back to the existing short-lived Google token flow until the Worker is updated.
      if (error instanceof TypeError || ['not_found', 'method_not_allowed'].includes(error.message)) {
        persistLegacyAuthSession(response.credential, claims);
        signinNode.hidden = true;
        if (startupSigninNode) startupSigninNode.hidden = true;
        setSessionExpired(false);
        setStatus('已使用目前雲端 API 登入；重新部署登入服務後即可啟用長期登入。', 'warning');
        updateButtons(true);
        await checkCloud();
        return;
      }
      clearAuthentication();
      setStatus(messageForError(error), 'warning');
      showStartupChoice('登入未完成，請再試一次；也可以進入獨立訪客花園。');
    }
  }

  function initializeGoogle({ prompt = true } = {}) {
    if (googleInitialized || !window.google?.accounts?.id || !config.googleClientId) return;
    googleInitialized = true;
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleCredential,
      auto_select: true,
      cancel_on_tap_outside: true,
    });
    const buttonOptions = {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: 260,
    };
    window.google.accounts.id.renderButton(signinNode, buttonOptions);
    if (startupSigninNode) window.google.accounts.id.renderButton(startupSigninNode, buttonOptions);
    if (!prompt) return;
    if (startupLoginHint) startupLoginHint.textContent = '若未自動登入，請點擊下方 Google 登入按鈕。';
    setStatus('Google 登入已準備好；若未自動登入，請點擊登入按鈕。');
    window.google.accounts.id.prompt((notification) => {
      if (!(accessToken || legacyIdToken) && (notification.isNotDisplayed?.() || notification.isSkippedMoment?.() || notification.isDismissedMoment?.())) {
        setStatus('Google 未能自動登入，請點擊 Google 登入按鈕。');
      }
    });
    window.setTimeout(() => {
      if (!(accessToken || legacyIdToken) && !hasResolvedStartupCloud) showStartupChoice('尚未自動登入，請登入 Google 回到自己的花園，或選擇進入訪客花園。');
    }, 3500);
  }

  async function loadGoogleIdentity() {
    if (GUEST_MODE_ACTIVE) {
      setStatus('目前使用獨立訪客花園；不會登入或同步雲端。');
      signinNode.hidden = true;
      if (guestNoticeNode) guestNoticeNode.hidden = false;
      if (returnToOwnGardenButton) returnToOwnGardenButton.hidden = false;
      updateButtons(false);
      finishStartupCloud();
      return;
    }
    if (!config.googleClientId || !String(config.apiBaseUrl || '').trim()) {
      setStatus('Google 雲端登入尚未設定；你仍可選擇進入訪客花園。', 'warning');
      if (startupSigninNode) startupSigninNode.hidden = true;
      signinNode.hidden = true;
      updateButtons(false);
      showStartupChoice('目前無法使用 Google 登入；你可以進入獨立訪客花園，原有進度不會被覆蓋。');
      return;
    }
    if (guestNoticeNode) guestNoticeNode.hidden = true;
    if (returnToOwnGardenButton) returnToOwnGardenButton.hidden = true;
    if (restoreLegacyAuthSession()) {
      signinNode.hidden = true;
      if (startupSigninNode) startupSigninNode.hidden = true;
      setSessionExpired(false);
      setStatus('已恢復目前雲端 API 的登入，正在確認雲端花園…');
      updateButtons(true);
      if (window.google?.accounts?.id) initializeGoogle({ prompt: false });
      else {
        const legacyScript = document.createElement('script');
        legacyScript.src = 'https://accounts.google.com/gsi/client';
        legacyScript.async = true;
        legacyScript.defer = true;
        legacyScript.onload = () => initializeGoogle({ prompt: false });
        document.head.appendChild(legacyScript);
      }
      await checkCloud({ quiet: true });
      return;
    }
    const stored = readStoredAuthSession();
    if (stored) {
      refreshToken = stored.refreshToken;
      currentSub = stored.currentSub;
      try {
        await refreshGameSession();
        signinNode.hidden = true;
        if (startupSigninNode) startupSigninNode.hidden = true;
        setSessionExpired(false);
        setStatus('已恢復長期登入，正在確認雲端花園…');
        updateButtons(true);
        if (window.google?.accounts?.id) initializeGoogle({ prompt: false });
        else {
          const script = document.createElement('script');
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.defer = true;
          script.onload = () => initializeGoogle({ prompt: false });
          document.head.appendChild(script);
        }
        await checkCloud({ quiet: true });
        return;
      } catch (error) {
        clearAuthentication();
        if (error.message === 'cloud_api_not_configured') setStatus('雲端 API 尚未設定；目前仍使用本機自動存檔。', 'warning');
      }
    }
    signinNode.hidden = false;
    if (window.google?.accounts?.id) {
      initializeGoogle();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogle;
    script.onerror = () => {
      setStatus('無法載入 Google 登入服務；你仍可進入訪客花園。', 'warning');
      showStartupChoice('Google 登入服務載入失敗，請稍後重試或先進入訪客花園。');
    };
    document.head.appendChild(script);
    setStatus('正在載入 Google 登入…');
    if (startupLoginHint) startupLoginHint.textContent = '正在準備 Google 登入…';
    window.setTimeout(() => {
      if (!(accessToken || legacyIdToken) && !hasResolvedStartupCloud && !startupDialog?.open) showStartupChoice('Google 登入尚未完成，請選擇登入或進入訪客花園。');
    }, 3500);
  }

  const sessionBanner = document.querySelector('#cloud-session-banner');
  const sessionSettingsBanner = document.querySelector('#cloud-session-banner-settings');
  window.addEventListener('diangarden:cloud-session-state', (event) => {
    const expired = Boolean(event.detail?.expired);
    if (sessionBanner) sessionBanner.hidden = !expired;
    if (sessionSettingsBanner) sessionSettingsBanner.hidden = !expired;
  });

  uploadButton.addEventListener('click', () => uploadLocal());
  downloadButton.addEventListener('click', downloadCloud);
  refreshButton.addEventListener('click', () => checkCloud());
  sessionRefreshButton.addEventListener('click', refreshCurrentPage);
  mainSessionRefreshButton?.addEventListener('click', refreshCurrentPage);
  if (startGuestGardenButton) startGuestGardenButton.addEventListener('click', () => {
    try {
      localStorage.setItem(GUEST_MODE_KEY, 'true');
      window.location.reload();
    } catch (_) {
      if (startupLoginHint) startupLoginHint.textContent = '無法建立獨立訪客存檔，請允許此網站使用本機儲存空間後再試。';
    }
  });
  if (returnToOwnGardenButton) returnToOwnGardenButton.addEventListener('click', () => {
    try {
      localStorage.removeItem(GUEST_MODE_KEY);
      window.location.reload();
    } catch (_) {
      setStatus('無法切換花園；瀏覽器本機儲存空間目前不可用。', 'warning');
    }
  });

  signoutButton.addEventListener('click', async () => {
    const tokenToRevoke = refreshToken;
    const baseUrl = String(config.apiBaseUrl || '').trim().replace(/\/$/, '');
    if (tokenToRevoke && baseUrl) {
      try {
        await fetch(baseUrl + '/api/session/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokenToRevoke }),
          cache: 'no-store',
        });
      } catch (_) { /* Local sign-out still succeeds when the network is unavailable. */ }
    }
    clearAuthentication();
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    setStatus('已登出雲端存檔；本機花園仍會自動儲存。');
    updateButtons(false);
  });

  window.addEventListener('diangarden:save', () => {
    if (!syncEnabled || !(accessToken || legacyIdToken) || syncBusy || sessionExpired) return;
    clearTimeout(pendingSyncTimer);
    pendingSyncTimer = setTimeout(() => {
      const local = readLocalSave();
      const signature = signatureOf(local);
      if (!signature || signature === lastUploadedSignature) return;
      uploadLocal({ automatic: true });
    }, 2500);
  });

  loadGoogleIdentity();
})();
