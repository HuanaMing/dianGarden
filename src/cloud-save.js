(() => {
  'use strict';

  const STORAGE_KEY = 'sky-garden-save-v1';
  const VARIANTS_KEY = 'sky-garden-flower-variants-v1';
  const AUTO_CROPS_KEY = 'sky-garden-auto-crops-v1';
  const SYNC_META_KEY = 'sky-garden-cloud-sync-v1';
  const config = window.DIANGARDEN_CLOUD_SAVE_CONFIG || {};
  const statusNode = document.querySelector('#cloud-save-status');
  const signinNode = document.querySelector('#cloud-save-signin');
  const actionsNode = document.querySelector('#cloud-save-actions');
  const uploadButton = document.querySelector('#cloud-save-upload');
  const downloadButton = document.querySelector('#cloud-save-download');
  const refreshButton = document.querySelector('#cloud-save-refresh');
  const signoutButton = document.querySelector('#cloud-save-signout');

  if (!statusNode || !signinNode || !actionsNode) return;

  let idToken = null;
  let currentSub = null;
  let cloudRevision = 0;
  let cloudSave = null;
  let syncEnabled = false;
  let syncBusy = false;
  let pendingSyncTimer = null;
  let lastUploadedSignature = '';
  let googleInitialized = false;

  function setStatus(message, state = 'normal') {
    statusNode.textContent = message;
    statusNode.dataset.state = state;
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
    actionsNode.hidden = !visible;
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
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
    let result;
    try { result = await response.json(); } catch (_) { result = {}; }
    if (response.status === 409) {
      const error = new Error('revision_conflict');
      error.revision = Number.isSafeInteger(result.revision) ? result.revision : null;
      throw error;
    }
    if (!response.ok) throw new Error(result.error || 'cloud_request_failed');
    return result;
  }

  function messageForError(error) {
    if (error.message === 'cloud_api_not_configured') return '雲端 API 尚未設定；目前仍使用本機自動存檔。';
    if (error.message === 'login_required') return '請先登入 Google。';
    if (error.message === 'revision_conflict') return '另一台裝置的雲端存檔已更新。請重新檢查，再選擇要保留的版本。';
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
    };
  }

  async function checkCloud({ quiet = false } = {}) {
    if (!idToken) return;
    syncBusy = true;
    updateButtons(true);
    if (!quiet) setStatus('正在檢查雲端存檔…');
    try {
      const result = await apiRequest('GET');
      cloudSave = result.status === 'ok' ? result.save : null;
      cloudRevision = cloudSave ? cloudSave.revision : 0;
      const local = readLocalSave();
      const meta = readMeta();
      const localSignature = signatureOf(local);
      if (cloudSave && meta.userSub === currentSub && meta.revision === cloudRevision
        && meta.localSignature === localSignature) {
        syncEnabled = true;
        setStatus('已連結 Google 帳號，雲端與這台裝置的存檔一致。', 'success');
      } else if (cloudSave) {
        syncEnabled = false;
        setStatus('找到雲端花園。請選擇要保留這台裝置的花園，或載入雲端花園；不會自動覆蓋。', 'choice');
      } else {
        syncEnabled = false;
        setStatus(local
          ? '雲端還沒有存檔。按「使用這台裝置的花園」即可建立雲端備份。'
          : '雲端還沒有存檔；先開始遊玩，再將目前花園上傳。', 'choice');
      }
      updateButtons(true);
    } catch (error) {
      syncEnabled = false;
      setStatus(messageForError(error), 'warning');
      if (error.message === 'invalid_google_id_token') {
        idToken = null;
        currentSub = null;
        updateButtons(false);
      }
    } finally {
      syncBusy = false;
      updateButtons(Boolean(idToken));
    }
  }

  async function uploadLocal({ automatic = false } = {}) {
    if (!idToken || syncBusy) return;
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
      setStatus(messageForError(error), 'warning');
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
      window.location.reload();
    } catch (_) {
      setStatus('雲端存檔格式無法讀取；本機資料未變更。', 'warning');
    }
  }

  function handleCredential(response) {
    if (!response || typeof response.credential !== 'string') {
      setStatus('Google 登入未完成，請再試一次。', 'warning');
      return;
    }
    const claims = parseJwtPayload(response.credential);
    if (!claims || typeof claims.sub !== 'string') {
      setStatus('無法讀取 Google 登入資訊，請再試一次。', 'warning');
      return;
    }
    idToken = response.credential;
    currentSub = claims.sub;
    syncEnabled = false;
    setStatus('Google 登入成功，正在檢查雲端花園…');
    updateButtons(true);
    checkCloud();
  }

  function initializeGoogle() {
    if (googleInitialized || !window.google?.accounts?.id || !config.googleClientId) return;
    googleInitialized = true;
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(signinNode, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: 260,
    });
  }

  function loadGoogleIdentity() {
    if (!config.googleClientId || !String(config.apiBaseUrl || '').trim()) {
      setStatus('雲端存檔尚未設定；目前仍使用本機自動存檔。');
      signinNode.hidden = true;
      updateButtons(false);
      return;
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
    script.onerror = () => setStatus('無法載入 Google 登入服務；本機遊戲仍可使用。', 'warning');
    document.head.appendChild(script);
    setStatus('正在載入 Google 登入…');
  }

  uploadButton.addEventListener('click', () => uploadLocal());
  downloadButton.addEventListener('click', downloadCloud);
  refreshButton.addEventListener('click', () => checkCloud());
  signoutButton.addEventListener('click', () => {
    idToken = null;
    currentSub = null;
    cloudSave = null;
    cloudRevision = 0;
    syncEnabled = false;
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    setStatus('已登出雲端存檔；本機花園仍會自動儲存。');
    updateButtons(false);
  });

  window.addEventListener('diangarden:save', () => {
    if (!syncEnabled || !idToken || syncBusy) return;
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
