(() => {
  'use strict';

  const GUEST_MODE_KEY = 'sky-garden-guest-mode-v1';
  const GUEST_MODE_ACTIVE = (() => { try { return localStorage.getItem(GUEST_MODE_KEY) === 'true'; } catch (_) { return false; } })();
  const STORAGE_KEY = 'sky-garden-save-v1';
  const VARIANTS_KEY = 'sky-garden-flower-variants-v1';
  const AUTO_CROPS_KEY = 'sky-garden-auto-crops-v1';
  const SYNC_META_KEY = 'sky-garden-cloud-sync-v1';
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

  let idToken = null;
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

  function setSessionExpired(expired) {
    sessionExpired = expired;
    window.diangardenCloudSessionExpired = expired;
    sessionRefreshButton.hidden = !expired;
    if (mainSessionRefreshButton) mainSessionRefreshButton.hidden = !expired;
    if (expired) {
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
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
      return JSON.parse(decodeURIComponent(Array.from(atob(padded), (char) =>
        '%' + char.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
    } catch (_) {
      return null;
    }
  }

  function updateButtons(visible) {
    const authenticated = Boolean(visible && idToken && !sessionExpired);
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
    if (!idToken) throw new Error('login_required');
    const response = await fetch(baseUrl + '/api/save', {
      method,
      headers: {
        Authorization: 'Bearer ' + idToken,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'X-DianGarden-Opened-At': String(sessionOpenedAt),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
    let result;
    try { result = await response.json(); } catch (_) { result = {}; }
    if (response.status === 409) {
      const error = new Error(result.error || 'revision_conflict');
      error.revision = Number.isSafeInteger(result.revision) ? result.revision : null;
      throw error;
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
    if (!idToken || sessionExpired) return;
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
        idToken = null;
        currentSub = null;
        signinNode.hidden = false;
        if (startupSigninNode) startupSigninNode.hidden = false;
        updateButtons(false);
      }
    } finally {
      syncBusy = false;
      updateButtons(Boolean(idToken));
    }
  }

  async function uploadLocal({ automatic = false } = {}) {
    if (!idToken || syncBusy || sessionExpired) return;
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
          idToken = null;
          currentSub = null;
          signinNode.hidden = false;
          if (startupSigninNode) startupSigninNode.hidden = false;
          updateButtons(false);
        }
      }
      if (error.message === 'revision_conflict') await checkCloud({ quiet: true });
    } finally {
      syncBusy = false;
      updateButtons(Boolean(idToken));
      if (syncEnabled && idToken) {
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
      setStatus('雲端存檔格式無法讀取；本機資料未變更。', 'warning');
    }
  }

  function handleCredential(response) {
    if (!response || typeof response.credential !== 'string') {
      setStatus('Google 登入未完成，請再試一次。', 'warning');
      if (startupLoginHint) startupLoginHint.textContent = 'Google 登入未完成，請再試一次；也可以直接進入訪客花園。';
      return;
    }
    const claims = parseJwtPayload(response.credential);
    if (!claims || typeof claims.sub !== 'string') {
      setStatus('無法讀取 Google 登入資訊，請再試一次。', 'warning');
      if (startupLoginHint) startupLoginHint.textContent = '無法讀取 Google 登入資訊，請重新登入或選擇訪客花園。';
      return;
    }
    idToken = response.credential;
    currentSub = claims.sub;
    signinNode.hidden = true;
    if (startupSigninNode) startupSigninNode.hidden = true;
    setSessionExpired(false);
    // Claim session ownership when login succeeds, not when this tab first opened.
    sessionOpenedAt = Date.now();
    syncEnabled = false;
    setStatus('Google 登入成功，正在檢查雲端花園…');
    if (startupLoginHint) startupLoginHint.textContent = '登入成功，正在確認你的花園…';
    updateButtons(true);
    checkCloud();
  }

  function initializeGoogle() {
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
    if (startupLoginHint) startupLoginHint.textContent = '若未自動登入，請點擊下方 Google 登入按鈕。';
    setStatus('Google 登入已準備好；若未自動登入，請點擊登入按鈕。');
    window.google.accounts.id.prompt((notification) => {
      if (!idToken && (notification.isNotDisplayed?.() || notification.isSkippedMoment?.() || notification.isDismissedMoment?.())) {
        setStatus('Google 未能自動登入，請點擊 Google 登入按鈕。');
      }
    });
    window.setTimeout(() => {
      if (!idToken && !hasResolvedStartupCloud) showStartupChoice('尚未自動登入，請登入 Google 回到自己的花園，或選擇進入訪客花園。');
    }, 3500);
  }

  function loadGoogleIdentity() {
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
      if (!idToken && !hasResolvedStartupCloud && !startupDialog?.open) showStartupChoice('Google 登入尚未完成，請選擇登入或進入訪客花園。');
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
  sessionRefreshButton.addEventListener('click', () => window.location.reload());
  mainSessionRefreshButton?.addEventListener('click', () => window.location.reload());
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

  signoutButton.addEventListener('click', () => {
    idToken = null;
    currentSub = null;
    signinNode.hidden = false;
    if (startupSigninNode) startupSigninNode.hidden = false;
    cloudSave = null;
    cloudRevision = 0;
    syncEnabled = false;
    setSessionExpired(false);
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    setStatus('已登出雲端存檔；本機花園仍會自動儲存。');
    updateButtons(false);
  });

  window.addEventListener('diangarden:save', () => {
    if (!syncEnabled || !idToken || syncBusy || sessionExpired) return;
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
