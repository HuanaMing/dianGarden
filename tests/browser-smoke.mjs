import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.GARDEN_TEST_URL || 'http://127.0.0.1:4173';
const outputDir = 'test-results/screenshots';

const indexHtml = await fs.readFile('src/index.html', 'utf8');
const cloudSaveSource = await fs.readFile('src/cloud-save.js', 'utf8');
const gameSource = await fs.readFile('src/game.js', 'utf8');
const skyWorldSource = await fs.readFile('src/sky-world.js', 'utf8');
const versionCheckSource = await fs.readFile('src/version-check.js', 'utf8');
if (!indexHtml.includes('id="startup-garden-dialog"') || !indexHtml.includes('id="start-guest-garden"')
  || !indexHtml.includes('id="return-to-own-garden"')) throw new Error('登入入口／訪客花園控制項缺失');
if (!cloudSaveSource.includes("signinNode.hidden = true;")
  || !cloudSaveSource.includes("signinNode.hidden = false;")
  || !cloudSaveSource.includes("if (startupSigninNode) startupSigninNode.hidden = true;")
  || !cloudSaveSource.includes("if (startupSigninNode) startupSigninNode.hidden = false;")) throw new Error('Google 登入成功隱藏入口或登出後恢復入口的邏輯缺失');
if (indexHtml.includes('登入 Google 後，可在其他裝置找回同一座花園') || indexHtml.includes('雲端同步需要網路。同步失敗不會阻止遊玩')) {
  throw new Error('跨裝置存檔區仍包含已移除的常駐說明文字');
}
if (!cloudSaveSource.includes("const needsChoice = authenticated && statusNode.dataset.state === 'choice';")
  || !cloudSaveSource.includes("error.message === 'invalid_google_id_token' || error.message === 'authentication_required'")
  || !cloudSaveSource.includes("if (expired) {\n      // A stale cloud-save owner is not an expired login. Keep the long-lived\n      // game session so a page reload can rotate its refresh token and recover.\n      if (refreshToken) {\n        try { sessionStorage.removeItem(AUTH_OPENED_AT_KEY); } catch (_) { /* Start a fresh save claim after reload. */ }\n      } else {\n        // Legacy Google-ID-token sessions cannot survive a reload safely.\n        clearStoredAuthSession();\n      }\n      sessionOpenedAt = 0;\n      syncEnabled = false;\n      clearTimeout(pendingSyncTimer);")
  || !cloudSaveSource.includes("signinNode.hidden = true;\n      if (startupSigninNode) startupSigninNode.hidden = true;")
  || !cloudSaveSource.includes("if (!(accessToken || legacyIdToken) || sessionExpired) return;")
  || !cloudSaveSource.includes("function refreshCurrentPage() {\n    window.location.href = window.location.href;\n  }")
  || !gameSource.includes("cloudSessionExpired ? '暫停同步雲端進度' : '進度會自動儲存'")) {
  throw new Error('同步狀態、異地登入後隱藏登入入口、停止雲端請求或暫停同步提示邏輯缺失');
}
if (!skyWorldSource.includes("const renderingPauseReasons = new Set(galleryMode ? [] : ['startup']);")
  || !skyWorldSource.includes("setRenderingPaused,")
  || !skyWorldSource.includes("if (isRenderingPaused()) {")
  || !gameSource.includes("setRenderingPaused?.('startup', false)")
  || !versionCheckSource.includes("setRenderingPaused?.('version-update', true)")
  || !versionCheckSource.includes("setRenderingPaused?.('version-update', false)")
  || !cloudSaveSource.includes("setRenderingPaused?.('cloud-restore', true)")
  || !cloudSaveSource.includes("setRenderingPaused?.('cloud-restore', false)")) {
  throw new Error('登入／雲端還原／更新期間的繪圖暫停與失敗復原機制缺失');
}
if (!skyWorldSource.includes("const dockPositionsChanged = docks.map((dock, index) => {")
  || !skyWorldSource.includes("else if (dockPositionsChanged[index]) {")
  || !skyWorldSource.includes("if (animation.returning) animation.returnRoute = findDroneRoute(animation.target, [dock.x, dock.z], index);")) {
  throw new Error('任務225：無人機返航路徑仍可能在電量更新時反覆重算');
}
if (!cloudSaveSource.includes("localStorage.setItem(GUEST_MODE_KEY, 'true')")
  || !cloudSaveSource.includes("localStorage.removeItem(GUEST_MODE_KEY)")
  || !gameSource.includes("'sky-garden-guest-save-v1'")
  || !gameSource.includes("'sky-garden-guest-flower-variants-v1'")
  || !gameSource.includes("'sky-garden-guest-auto-crops-v1'")
  || gameSource.includes('Promise.race([window.diangardenCloudReady')) {
  throw new Error('訪客存檔隔離或啟動閘門程式規格不符');
}
const versionedResourceUrls = [...indexHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(match => match[1]);
if (!versionedResourceUrls.length || versionedResourceUrls.some(url => !new URL(url, 'https://example.test/').searchParams.has('v'))) {
  throw new Error('HTML 的 JavaScript／CSS 資源缺少部署版本參數：' + JSON.stringify(versionedResourceUrls));
}
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
checks.push('任務225：只有停靠座標改變才重算返航路徑，電量更新不再重設飛行插值');

const encyclopediaPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await encyclopediaPage.addInitScript(() => {
  window.__encyclopediaDrawCalls = 0;
  const originalDrawArrays = WebGLRenderingContext.prototype.drawArrays;
  WebGLRenderingContext.prototype.drawArrays = function (...args) {
    window.__encyclopediaDrawCalls += 1;
    return originalDrawArrays.apply(this, args);
  };
});
await encyclopediaPage.goto(`${baseURL}/encyclopedia.html`, { waitUntil: 'networkidle', timeout: 30000 });
await encyclopediaPage.locator('#sky-canvas').waitFor({ state: 'visible' });
await encyclopediaPage.waitForFunction(() => window.__encyclopediaDrawCalls > 0, null, { timeout: 8000 });
const initialEncyclopediaDrawCalls = await encyclopediaPage.evaluate(() => window.__encyclopediaDrawCalls);
// Task 227: encyclopedia rotation starts only after a 500ms hold, then follows the drag.
const galleryCanvas = encyclopediaPage.locator('#sky-canvas');
const galleryBounds = await galleryCanvas.boundingBox();
if (!galleryBounds) throw new Error('無法取得圖鑑預覽畫布位置');
const galleryX = galleryBounds.x + galleryBounds.width * 0.52;
const galleryY = galleryBounds.y + galleryBounds.height * 0.52;
await encyclopediaPage.mouse.move(galleryX, galleryY);
await encyclopediaPage.mouse.down();
await encyclopediaPage.waitForTimeout(550);
if (await galleryCanvas.getAttribute('data-rotate-hold-active') !== 'true') {
  throw new Error('圖鑑預覽長按 500ms 後未進入旋轉模式');
}
await encyclopediaPage.mouse.move(galleryX + 70, galleryY + 22, { steps: 5 });
await encyclopediaPage.mouse.up();
if (await galleryCanvas.getAttribute('data-rotate-hold-active') !== null) {
  throw new Error('圖鑑預覽放開後未退出長按旋轉模式');
}
checks.push('任務227：桌面圖鑑預覽長按後拖曳旋轉，放開後正確結束');
const galleryTouchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await galleryTouchPage.goto(`${baseURL}/encyclopedia.html`, { waitUntil: 'networkidle', timeout: 30000 });
const galleryTouchCanvas = galleryTouchPage.locator('#sky-canvas');
await galleryTouchCanvas.waitFor({ state: 'visible' });
const galleryTouchBounds = await galleryTouchCanvas.boundingBox();
if (!galleryTouchBounds) throw new Error('無法取得手機圖鑑預覽畫布位置');
const touchX = Math.round(galleryTouchBounds.x + galleryTouchBounds.width * 0.5);
const touchY = Math.round(galleryTouchBounds.y + galleryTouchBounds.height * 0.5);
const galleryTouchCDP = await galleryTouchPage.context().newCDPSession(galleryTouchPage);
await galleryTouchCDP.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY, id: 1 }] });
await galleryTouchPage.waitForTimeout(550);
if (await galleryTouchCanvas.getAttribute('data-rotate-hold-active') !== 'true') {
  throw new Error('手機圖鑑預覽長按後未進入旋轉模式');
}
await galleryTouchCDP.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX + 55, y: touchY + 18, id: 1 }] });
await galleryTouchCDP.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
if (await galleryTouchCanvas.getAttribute('data-rotate-hold-active') !== null) {
  throw new Error('手機圖鑑預覽觸控放開後未退出旋轉模式');
}
checks.push('任務227：手機觸控圖鑑預覽長按後拖曳旋轉通過');
await galleryTouchPage.close();
await encyclopediaPage.locator('#preview-fullscreen-toggle').click();
await encyclopediaPage.waitForFunction(() => document.fullscreenElement === document.querySelector('.encyclopedia-world')
  || document.querySelector('.encyclopedia-world')?.classList.contains('is-preview-expanded'), null, { timeout: 5000 });
await encyclopediaPage.waitForFunction((initial) => window.__encyclopediaDrawCalls > initial + 5, initialEncyclopediaDrawCalls, { timeout: 5000 });
const fullscreenCanvas = await encyclopediaPage.locator('#sky-canvas').evaluate(canvas => ({
  width: canvas.width,
  height: canvas.height,
  rect: { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height },
}));
if (fullscreenCanvas.width <= 0 || fullscreenCanvas.height <= 0 || fullscreenCanvas.rect.width < 300 || fullscreenCanvas.rect.height < 300) {
  throw new Error('圖鑑全螢幕後 WebGL 畫布尺寸失效：' + JSON.stringify(fullscreenCanvas));
}
await encyclopediaPage.locator('#preview-fullscreen-toggle').click();
await encyclopediaPage.waitForFunction(() => !document.fullscreenElement
  && !document.querySelector('.encyclopedia-world')?.classList.contains('is-preview-expanded'), null, { timeout: 5000 });
checks.push('任務226：圖鑑模型在一般與全螢幕狀態持續繪製，畫布尺寸有效且可正常退出');

await encyclopediaPage.setViewportSize({ width: 390, height: 844 });
const pickerHeading = encyclopediaPage.locator('#flower-picker-toggle');
const pickerIndicator = encyclopediaPage.locator('.flower-picker-collapse-indicator');
if (!(await pickerIndicator.getAttribute('src'))?.endsWith('assets/btn/收合.png')
  || await pickerHeading.getAttribute('aria-expanded') !== 'false') {
  throw new Error('手機圖鑑收合狀態應顯示展開像素圖及 aria-expanded=false');
}
await pickerIndicator.evaluate(image => image.decode());
if (!(await pickerIndicator.evaluate(image => image.naturalWidth > 0 && image.naturalHeight > 0))) {
  throw new Error('圖鑑選花標題的展開像素圖無法載入');
}
const pickerPanel = encyclopediaPage.locator('.flower-picker-panel');
const previewWorld = encyclopediaPage.locator('.encyclopedia-world');
const originalPickerBounds = await pickerPanel.boundingBox();
const originalPreviewBounds = await previewWorld.boundingBox();
if (!originalPickerBounds || !originalPreviewBounds || originalPickerBounds.y < originalPreviewBounds.y + originalPreviewBounds.height - 1) {
  throw new Error('手機圖鑑原始排版應為預覽在上、選花清單在下');
}
const dragHeading = async (distance) => {
  const bounds = await pickerHeading.boundingBox();
  if (!bounds) throw new Error('無法取得手機選花標題位置');
  const x = bounds.x + Math.min(80, bounds.width / 2);
  const y = bounds.y + bounds.height / 2;
  await encyclopediaPage.mouse.move(x, y);
  await encyclopediaPage.mouse.down();
  await encyclopediaPage.mouse.move(x, y + distance, { steps: 6 });
  await encyclopediaPage.mouse.up();
};
await dragHeading(-120);
if (!(await encyclopediaPage.locator('.encyclopedia-layout').evaluate(element => element.classList.contains('is-picker-expanded')))) {
  throw new Error('手機選花標題上拉後未展開面板');
}
if (!(await pickerIndicator.getAttribute('src'))?.endsWith('assets/btn/展開.png')
  || await pickerHeading.getAttribute('aria-expanded') !== 'true') {
  throw new Error('手機圖鑑展開狀態應顯示收合像素圖及 aria-expanded=true');
}
const expandedPickerBounds = await pickerPanel.boundingBox();
if (!expandedPickerBounds || expandedPickerBounds.y > originalPreviewBounds.y + 2
  || expandedPickerBounds.height <= originalPickerBounds.height) {
  throw new Error('上拉後選花面板未覆蓋預覽區或未增加清單空間');
}
await dragHeading(120);
if (await encyclopediaPage.locator('.encyclopedia-layout').evaluate(element => element.classList.contains('is-picker-expanded'))) {
  throw new Error('手機選花標題下拉後未恢復原始排版');
}
if (!(await pickerIndicator.getAttribute('src'))?.endsWith('assets/btn/收合.png')) {
  throw new Error('手機圖鑑下拉收合後未切回展開像素圖');
}
await pickerHeading.click();
if (!(await encyclopediaPage.locator('.encyclopedia-layout').evaluate(element => element.classList.contains('is-picker-expanded')))) {
  throw new Error('手機選花標題點擊無法展開面板');
}
if (!(await pickerIndicator.getAttribute('src'))?.endsWith('assets/btn/展開.png')) {
  throw new Error('手機圖鑑點擊展開後未切換收合像素圖');
}
await pickerHeading.click();
if (await encyclopediaPage.locator('.encyclopedia-layout').evaluate(element => element.classList.contains('is-picker-expanded'))) {
  throw new Error('手機選花標題再次點擊無法恢復原始排版');
}
await encyclopediaPage.setViewportSize({ width: 1280, height: 900 });
if (await encyclopediaPage.locator('.encyclopedia-layout').evaluate(element => element.classList.contains('is-picker-expanded'))) {
  throw new Error('切換回桌面版後不應保留手機選花面板展開狀態');
}
checks.push('任務230：手機選花標題像素圖隨展開／收合狀態切換，桌面版排版不受影響');
await encyclopediaPage.close();
const startupPage = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
const startupErrors = [];
startupPage.on('pageerror', error => startupErrors.push(`pageerror: ${error.message}`));
startupPage.on('console', message => { if (message.type() === 'error') startupErrors.push(`console: ${message.text()}`); });
await startupPage.addInitScript(() => {
  window.__startupWebglDrawCalls = 0;
  const originalDrawArrays = WebGLRenderingContext.prototype.drawArrays;
  WebGLRenderingContext.prototype.drawArrays = function (...args) {
    window.__startupWebglDrawCalls += 1;
    return originalDrawArrays.apply(this, args);
  };
  if (sessionStorage.getItem('task200-startup-test-initialized') !== 'true') {
    localStorage.removeItem('sky-garden-guest-mode-v1');
    localStorage.setItem('sky-garden-save-v1', '{"preserveOriginal":"yes"}');
    sessionStorage.setItem('task200-startup-test-initialized', 'true');
  }
});
await startupPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
await startupPage.locator('#startup-garden-dialog[open]').waitFor({ state: 'visible', timeout: 8000 });
await startupPage.waitForTimeout(150);
const drawCallsWhileWaitingForGardenChoice = await startupPage.evaluate(() => window.__startupWebglDrawCalls);
if (drawCallsWhileWaitingForGardenChoice !== 0) throw new Error('任務224：尚未選定花園時場景仍在繪圖');
await startupPage.locator('#start-guest-garden').click();
await startupPage.waitForFunction(() => localStorage.getItem('sky-garden-guest-mode-v1') === 'true'
  && !document.querySelector('#startup-garden-dialog')?.open, null, { timeout: 8000 });
await startupPage.locator('#sky-canvas').waitFor({ state: 'visible' });
try {
  await startupPage.waitForFunction(() => window.__startupWebglDrawCalls > 0, null, { timeout: 5000 });
} catch (_) {
  throw new Error(`任務224：選定訪客花園後場景未恢復繪圖；${JSON.stringify(startupErrors)}`);
}
checks.push('任務224：啟動選擇期間暫停 WebGL 繪圖，選定訪客花園後恢復');
const guestIsolation = await startupPage.evaluate(() => ({
  guestMode: localStorage.getItem('sky-garden-guest-mode-v1'),
  originalSave: localStorage.getItem('sky-garden-save-v1'),
  guestSave: localStorage.getItem('sky-garden-guest-save-v1'),
  dialogOpen: document.querySelector('#startup-garden-dialog')?.open,
}));
if (guestIsolation.guestMode !== 'true' || guestIsolation.originalSave !== '{"preserveOriginal":"yes"}'
  || guestIsolation.dialogOpen) throw new Error('訪客入口未保留原有本機存檔或未正確解除啟動閘門：' + JSON.stringify(guestIsolation));
checks.push('未自動登入時先顯示入口選擇；進入訪客模式不會覆寫原有本機存檔');
await startupPage.close();

const droneTeleportPage = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
await droneTeleportPage.addInitScript(() => {
  const now = Date.now();
  localStorage.setItem('sky-garden-guest-mode-v1', 'true');
  localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify({
    coins: 5000, cropCatalogVersion: 4, gardenName: '八機返航路徑測試', autoMode: false, autoCropSelection: [0],
    worldTimeMs: 60000, worldTimeAnchor: now, lastObservedRaining: false, droneCount: 8,
    deploymentSequence: 8, dockPosition: { x: -2.8, z: 2, y: 0 },
    drones: Array.from({ length: 8 }, (_, index) => ({
      dockPosition: { x: -2.8 + index * 0.8, z: 2, y: 0 }, deployed: true,
      deploymentOrder: index + 1, battery: 100, batteryUpdatedAt: now,
    })),
    plots: Array.from({ length: 8 }, (_, index) => ({
      crop: null, plantedAt: null, manual: false, grassOnly: false,
      x: -2.8 + index * 0.8, z: -1.5, y: 0,
    })),
  }));
  window.__dgWebglBuffers = [];
  window.__dgDroneFrames = [];
  window.__dgBoundBuffer = null;
  const originalCreateBuffer = WebGLRenderingContext.prototype.createBuffer;
  WebGLRenderingContext.prototype.createBuffer = function (...args) {
    const buffer = originalCreateBuffer.apply(this, args);
    window.__dgWebglBuffers.push(buffer);
    return buffer;
  };
  const originalBindBuffer = WebGLRenderingContext.prototype.bindBuffer;
  WebGLRenderingContext.prototype.bindBuffer = function (target, buffer) {
    window.__dgBoundBuffer = buffer;
    return originalBindBuffer.call(this, target, buffer);
  };
  const originalBufferData = WebGLRenderingContext.prototype.bufferData;
  WebGLRenderingContext.prototype.bufferData = function (target, data, usage) {
    const result = originalBufferData.call(this, target, data, usage);
    window.__dgDroneFrameCounter = (window.__dgDroneFrameCounter || 0) + 1;
    if (window.__dgWebglBuffers[2] && window.__dgBoundBuffer === window.__dgWebglBuffers[2]
      && data instanceof Float32Array && window.__dgDroneFrameCounter % 3 === 0) {
      if (window.__dgDroneFrames.length >= 120) window.__dgDroneFrames.shift();
      window.__dgDroneFrames.push(Array.from(data));
    }
    return result;
  };
});
await droneTeleportPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
await droneTeleportPage.locator('#sky-canvas').waitFor({ state: 'visible' });
await droneTeleportPage.waitForFunction(() => window.__dgDroneFrames.length > 3, null, { timeout: 8000 });
await droneTeleportPage.evaluate(async () => {
  const docks = Array.from({ length: 8 }, (_, index) => ({
    x: -2.8 + index * 0.8, z: 2, y: 0, deployed: true, deploymentOrder: index + 1, battery: 100,
  }));
  const plots = Array.from({ length: 8 }, (_, index) => ({ x: -2.8 + index * 0.8, z: -1.5, y: 0 }));
  window.skyWorld.setDockPosition({ x: docks[0].x, z: docks[0].z, y: 0 });
  window.skyWorld.setLandCount(8);
  window.skyWorld.setPlotPositions(plots);
  window.skyWorld.setDroneCount(8);
  window.skyWorld.setDroneDocks(docks);
  window.__dgDroneFrames.length = 0;
  for (let index = 0; index < 8; index += 1) {
    window.skyWorld.animatePlant(index, () => {}, () => {}, () => true, index);
  }
  for (let tick = 1; tick <= 24; tick += 1) {
    window.skyWorld.setDroneDocks(docks.map((dock, index) => ({
      ...dock, battery: Math.max(10, 100 - tick * 0.35 - index * 0.1),
    })));
    await new Promise(resolve => setTimeout(resolve, 150));
  }
});
const droneMotion = await droneTeleportPage.evaluate(() => {
  const frames = window.__dgDroneFrames;
  if (frames.length < 10) return { frameCount: frames.length, maxStep: Infinity, invalid: true };
  const positions = frames.map(values => {
    const vertices = values.length / 3;
    const perDrone = vertices / 8;
    if (!Number.isInteger(perDrone)) return null;
    return Array.from({ length: 8 }, (_, droneIndex) => {
      let x = 0, z = 0, count = 0;
      for (let vertex = droneIndex * perDrone; vertex < (droneIndex + 1) * perDrone; vertex += 1) {
        x += values[vertex * 3];
        z += values[vertex * 3 + 2];
        count += 1;
      }
      return [x / count, z / count];
    });
  });
  if (positions.some(frame => !frame)) return { frameCount: frames.length, maxStep: Infinity, invalid: true };
  let maxStep = 0;
  for (let frame = 1; frame < positions.length; frame += 1) {
    for (let drone = 0; drone < 8; drone += 1) {
      const distance = Math.hypot(
        positions[frame][drone][0] - positions[frame - 1][drone][0],
        positions[frame][drone][1] - positions[frame - 1][drone][1],
      );
      maxStep = Math.max(maxStep, distance);
    }
  }
  return { frameCount: frames.length, maxStep, invalid: false };
});
if (droneMotion.invalid || droneMotion.maxStep > 0.8) {
  throw new Error('任務225：八台無人機連續派工／返航時偵測到非預期跳位：' + JSON.stringify(droneMotion));
}
checks.push(`任務225：八台無人機持續更新電量時位置連續（${droneMotion.frameCount} 個取樣，最大位移 ${droneMotion.maxStep.toFixed(3)}）`);
await droneTeleportPage.close();

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  localStorage.setItem('sky-garden-guest-mode-v1', 'true');
  window.__webglDrawCalls = 0;
  const original = WebGLRenderingContext.prototype.drawArrays;
  WebGLRenderingContext.prototype.drawArrays = function (...args) {
    window.__webglDrawCalls += 1;
    return original.apply(this, args);
  };
});
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

try {
  await page.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#sky-canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(1800);

  const gameTitle = await page.title();
  if (!gameTitle.includes('花明摸魚花園')) throw new Error(`遊戲標題不符：${gameTitle}`);
  checks.push('遊戲首頁可正常開啟，所有 JavaScript／CSS 資源網址均含部署版本參數');

  const publishedVersion = await page.evaluate(async () => {
    const response = await fetch(new URL('version.json', window.location.href), { cache: 'no-store' });
    return response.ok ? response.json() : null;
  });
  if (!publishedVersion || typeof publishedVersion.version !== 'string' || !/^[0-9]{6}, [0-9]{3,}$/.test(publishedVersion.version)) {
    throw new Error('version.json 無法讀取或版本格式錯誤');
  }
  checks.push('version.json 可同源讀取且符合每日更新序號格式');

  const gameCanvas = await page.locator('#sky-canvas').evaluate(canvas => ({
    width: canvas.width,
    height: canvas.height,
    webgl: Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl')),
  }));
  if (!gameCanvas.webgl) throw new Error('遊戲首頁未能建立 WebGL context');
  if (gameCanvas.width < 100 || gameCanvas.height < 100) throw new Error('遊戲畫布尺寸異常');
  checks.push('遊戲 WebGL 畫布已建立');
  const grassRampLogicLoaded = await page.evaluate(() => typeof window.dianGardenGrassRampLogic?.getConnections === 'function');
  if (!grassRampLogicLoaded) throw new Error('草地斜坡連接邏輯未載入');
  const rampCases = await page.evaluate(() => { const f=window.dianGardenGrassRampLogic.getConnections, l=[-0.5,0,0.5]; let n=0; for(const a of l)for(const b of l)for(const c of l)for(const d of l){const p=[{x:0,z:0,y:0},{x:0,z:-1,y:a},{x:1,z:0,y:b},{x:0,z:1,y:c},{x:-1,z:0,y:d}],s=p.map(()=>({grassOnly:true})),r=f(p,s,0);if(r.north?.edgeHeight!==a/2||r.east?.edgeHeight!==b/2||r.south?.edgeHeight!==c/2||r.west?.edgeHeight!==d/2)return 0;n++;} return n; });
  if (rampCases !== 81) throw new Error('草地斜坡 81 種高度組合失敗：' + rampCases);
  checks.push('草地斜坡四邊 -0.5／0／+0.5 的 81 種排列使用對稱接縫高度');
  const rampCornerCases = await page.evaluate(() => {
    const f=window.dianGardenGrassRampLogic.getSharedCornerHeight, levels=[-0.5,0,0.5];
    let checked=0;
    for(const a of levels) for(const b of levels) for(const n of levels) for(const ne of levels) {
      const p=[{x:0,z:0,y:a},{x:1,z:0,y:b},{x:0,z:-1,y:n},{x:1,z:-1,y:ne}], s=p.map(()=>({grassOnly:true}));
      if(Math.abs(a-b)<=0.5+1e-8) {
        const fromA=f(p,s,0,0.5,-0.5), fromB=f(p,s,1,0.5,-0.5);
        if(Math.abs(fromA-fromB)>1e-8) return 0;
      }
      checked++;
    }
    const pair=[{x:0,z:0,y:0},{x:1,z:0,y:0.5}], states=[{grassOnly:true},{grassOnly:true}];
    const left=f(pair,states,0,0.5,-0.5), right=f(pair,states,1,0.5,-0.5);
    return checked===81 && Math.abs(left-0.25)<1e-8 && Math.abs(right-0.25)<1e-8 ? checked : 0;
  });
  if (rampCornerCases !== 81) throw new Error('草地相鄰地塊共用角點高度測試失敗：' + rampCornerCases);
  checks.push('草地相鄰地塊共用同一角點高度，0.25 單位接縫案例及 81 種高度組合通過');
  const grassFarmSeam = await page.evaluate(() => { const f=window.dianGardenGrassRampLogic.getSharedCornerHeight; const p=[{x:0,z:0,y:0},{x:1,z:0,y:0.5}], s=[{grassOnly:true},{grassOnly:false}]; return f(p,s,0,0.5,-0.5)===0.25 && f(p,s,1,0.5,-0.5)===0.25; });
  if (!grassFarmSeam) throw new Error('草地與農地交界沒有貼齊農地頂面');
  checks.push('草地與農地交界共用同一個坡面角點高度');
  const connectedLandBottom = await page.evaluate(() => {
    const logic = window.dianGardenGrassRampLogic;
    const positions = [
      { x: 0, z: 0, y: 0 },
      { x: 1, z: 0, y: 0.5 },
      { x: 2, z: 0, y: 0 },
      { x: 0, z: 0, y: 0.5 },
      { x: 6, z: 0, y: 2 },
    ];
    const states = [
      { grassOnly: true },
      { grassOnly: false },
      { grassOnly: false },
      { grassOnly: false },
      { grassOnly: true },
    ];
    return {
      bottom: logic.getConnectedGroupBottomY(positions, 0, 1, 0.5),
      upperHasBelow: logic.hasPlotDirectlyBelow(positions, 3, 1),
      lowerHasBelow: logic.hasPlotDirectlyBelow(positions, 0, 1),
      grassBelowUpper: states[0].grassOnly && logic.hasPlotDirectlyBelow(positions, 3, 1),
      isolatedBottom: logic.getConnectedGroupBottomY(positions, 4, 1, 0.5),
    };
  });
  if (connectedLandBottom.bottom !== -0.5 || !connectedLandBottom.upperHasBelow
    || connectedLandBottom.lowerHasBelow || !connectedLandBottom.grassBelowUpper
    || connectedLandBottom.isolatedBottom !== 1.5) {
    throw new Error('連接地塊整體底面／草地下方判定失敗：' + JSON.stringify(connectedLandBottom));
  }
  const stackedTileSideRule = await fs.readFile('src/sky-world.js', 'utf8');
  if (!stackedTileSideRule.includes('if (!hasPlotBelow) {')
    || !stackedTileSideRule.includes('// A tile with another tile directly below must not grow side walls downward.')) {
    throw new Error('下方已有地塊時仍可能產生側面延伸');
  }
  checks.push('連接地塊共用最低底面；下方有農地或草地時均不生成側面延伸');
  const farmRampGeometry = await page.evaluate(() => {
    const source = document.querySelector('script[src*="sky-world.js"]')?.src;
    return Boolean(source && window.dianGardenGrassRampLogic?.getSharedCornerHeight);
  });
  if (!farmRampGeometry) throw new Error('農地共用坡面邏輯未載入');
  checks.push('農地與草地共用坡面角點邏輯已載入');
  const plantBaseHeights = await page.evaluate(() => {
    const getBase = window.dianGardenGrassRampLogic.getPlantBaseHeight;
    const ramp = (x, z) => 0.3 + 0.2 * x - 0.1 * z;
    const grassRoot = getBase(ramp, 0, 0, true) + 0.055;
    const farmRoot = getBase(ramp, 0, 0, false) + 0.055;
    return { grassRoot, farmRoot, expectedGrass: ramp(0, 0), expectedFarm: ramp(0, 0) + 0.056 };
  });
  if (Math.abs(plantBaseHeights.grassRoot - plantBaseHeights.expectedGrass) > 1e-8
    || Math.abs(plantBaseHeights.farmRoot - plantBaseHeights.expectedFarm) > 1e-8) {
    throw new Error('植物根部沒有依草地中心或農田土壤床中心高度定位：' + JSON.stringify(plantBaseHeights));
  }
  checks.push('草地植物附著於坡面中心，農田植物附著於土壤床中心高度');
  const rampRenderingRules = await fs.readFile('src/sky-world.js', 'utf8');
  if (!rampRenderingRules.includes('const topColor = [0.43, 0.68, 0.39];')
    || !rampRenderingRules.includes('addGrassTexture(positions, colors, x, z, half, plotY, [0.43, 0.68, 0.39], surfaceHeightAt);')
    || !rampRenderingRules.includes('const half = bed / 2, bottomOffset = 0.001, thickness = 0.055;')
    || !rampRenderingRules.includes('const centerY = surfaceHeightAt(x, z) + bottomOffset + thickness;')
    || !rampRenderingRules.includes('surfaceHeightAt(px, pz) + 0.057')) {
    throw new Error('農地坡面頂色、土壤床中心或紋理坡面附著規則缺失');
  }
  checks.push('農地保留草皮與草皮紋理，土壤床高於草皮且土壤紋理跟隨坡面');


  const offlineCheck = await page.evaluate(() => {
    const now=Date.now(), sim=window.gardenEconomy.simulateOfflineProgress, env=window.skyEnvironment, crops=window.flowerCatalog;
    const makeState=autoMode=>({coins:120,lastOnlineAt:now-5*3600000,autoMode,droneCount:1,drones:[{deployed:true,battery:100,dockPosition:{x:0,z:1.55,y:0}}],autoCropSelection:[0],plots:[{crop:0,plantedAt:now-5*3600000-180000,plantHeight:1,manual:false,grassOnly:false,x:0,z:0,y:0,watered:false}],worldTimeMs:60000,worldTimeAnchor:now-5*3600000,lastObservedRaining:false});
    const enabledState=makeState(true), disabledState=makeState(false);
    const capped=sim(enabledState,now,crops,env), disabled=sim(disabledState,now,crops,env);
    return capped?.simulatedDuration===10800000 && capped.capped && capped.coinsDelta>0 && disabled?.simulatedDuration===0 && disabled.coinsDelta===0 && disabledState.plots[0].crop===0;
  });
  if (!offlineCheck) throw new Error('離線模擬未遵守單台無人機 3 小時上限或自動模式關閉規則');
  checks.push('任務191離線模擬：單台無人機 3 小時上限與關閉自動模式不生產通過');
  const invalidLinks = await page.evaluate(() => { const f=window.dianGardenGrassRampLogic.getConnections, none=x=>Object.values(x).every(v=>v===null), s=[{grassOnly:true},{grassOnly:false}]; return none(f([{x:0,z:0,y:0},{x:1,z:1,y:0}],s,0)) && none(f([{x:0,z:0,y:0},{x:0,z:-2,y:0}],s,0)) && none(f([{x:0,z:0,y:0},{x:1,z:0,y:0.50001}],s,0)); });
  if (!invalidLinks) throw new Error('草地斜坡錯誤連接了對角線、距離超過一格或高度差超過 0.5 的地塊');
  const grassEdgesMatch = await page.evaluate(() => { const f=window.dianGardenGrassRampLogic.getConnections; const a=f([{x:0,z:0,y:0},{x:1,z:0,y:0.5}],[{grassOnly:true},{grassOnly:true}],0); const b=f([{x:1,z:0,y:0.5},{x:0,z:0,y:0}],[{grassOnly:true},{grassOnly:true}],0); return a.east?.edgeHeight===b.west?.edgeHeight; });
  if (!grassEdgesMatch) throw new Error('相鄰草地的共用邊緣高度不一致');

  const mouseCanvasBounds = await page.locator('#sky-canvas').boundingBox();
  if (!mouseCanvasBounds) throw new Error('無法取得 PC 畫布位置');
  await page.mouse.move(mouseCanvasBounds.x + 24, mouseCanvasBounds.y + mouseCanvasBounds.height * 0.15);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const mouseRing = page.locator('.touch-hold-ring');
  if (await mouseRing.count() !== 1) throw new Error('PC 滑鼠按下時未建立長按計時環');
  if (await mouseRing.evaluate(element => getComputedStyle(element).visibility) !== 'hidden') throw new Error('PC 長按環未延遲 200ms 顯示');
  await page.waitForTimeout(120);
  if (await mouseRing.evaluate(element => getComputedStyle(element).visibility) !== 'visible') throw new Error('PC 長按環在按下 200ms 後仍未顯示');
  const mouseRingStyle = await mouseRing.evaluate(element => {
    const image = element.querySelector('.touch-hold-wreath');
    const style = getComputedStyle(element);
    return { imageSrc: image?.getAttribute('src'), imageWidth: image && getComputedStyle(image).width, riseDuration: style.animationDuration, riseDelay: style.animationDelay };
  });
  if (mouseRingStyle.imageSrc !== 'assets/wreath.webp' || mouseRingStyle.imageWidth !== '46px' || mouseRingStyle.riseDuration !== '0.5s' || mouseRingStyle.riseDelay !== '0.2s') throw new Error('PC 花草環素材或上升動畫錯誤：' + JSON.stringify(mouseRingStyle));
  await page.mouse.up();
  checks.push('PC 長按環前200ms隱藏，完整圓環上升50px、逐漸縮小並在結束時復原');

  if (await page.evaluate(() => window.dianGardenFlowerModels?.count) !== 11) throw new Error('花卉模型模組未完整註冊 11 種花');
  checks.push('11 種花卉模型模組已完整註冊');

  const topbarBounds = await page.locator('#world-topbar').boundingBox();
  const frameBounds = await page.locator('.world-frame').boundingBox();
  if (!topbarBounds || !frameBounds || topbarBounds.width < frameBounds.width - 40) {
    throw new Error('桌面版頂部花園資訊卡沒有延伸占滿橫幅');
  }
  for (const selector of ['#settings-toggle', '.encyclopedia-link', '#hud-toggle', '#drone-panel-toggle', '#farm-management-toggle']) {
    if (!(await page.locator(selector).isVisible())) throw new Error(`頂部控制按鈕未顯示：${selector}`);
  }
  const hudCollapseIcon = page.locator('#hud-toggle img.btn-icon-image');
  if (await hudCollapseIcon.getAttribute('src') !== 'assets/btn/收合.png' || !(await hudCollapseIcon.evaluate(image => image.complete && image.naturalWidth > 0))) throw new Error('頂部收合按鈕未載入指定圖示');
  await page.locator('#hud-toggle').click();
  if (!(await page.locator('#hud-toggle').isVisible()) || await page.locator('#hud-toggle').getAttribute('aria-expanded') !== 'false'
    || await hudCollapseIcon.getAttribute('src') !== 'assets/btn/展開.png') throw new Error('收合介面後沒有顯示正確展開圖示的可復原按鈕');
  await page.locator('#hud-toggle').click();
  if (await page.locator('#hud-toggle').getAttribute('aria-expanded') !== 'true' || await hudCollapseIcon.getAttribute('src') !== 'assets/btn/收合.png') throw new Error('再次點擊收合按鈕未恢復介面或圖示遺失');
  checks.push('任務220：桌面頂部收合按鈕圖示載入正確，收合／恢復行為及 aria-expanded 正常');
  await page.locator('#drone-panel-toggle').click();
  if (await page.locator('#drone-panel-toggle img.btn-icon-image').getAttribute('src') !== 'assets/btn/無人機管理.png') throw new Error('開啟無人機面板後，原始圖片圖示被替換或遺失');
  await page.locator('#drone-panel-toggle').click();
  if (await page.locator('#drone-panel-toggle img.btn-icon-image').getAttribute('src') !== 'assets/btn/無人機管理.png') throw new Error('關閉無人機面板後，原始圖片圖示被替換或遺失');
  const assertManagementPanelSize = async selector => {
    await page.waitForTimeout(220);
    const bounds = await page.locator(selector).evaluate(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
    const viewport = page.viewportSize();
    if (!viewport || bounds.width > 522 || bounds.width < Math.min(300, viewport.width - 28) || Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) > 2 || Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) > 2 || bounds.height > viewport.height * 0.82 + 2) {
      throw new Error('管理面板尺寸或置中位置未符合自訂頭像對話框規格：' + selector + ' ' + JSON.stringify({ bounds, viewport }));
    }
  };
  await page.locator('#settings-toggle').click();
  if (!(await page.locator('#settings-panel').isVisible())) throw new Error('設定按鈕未能開啟設定面板');
  await assertManagementPanelSize('#settings-panel');
  if (await page.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open')) || await page.locator('#farm-management-panel').isVisible()) throw new Error('開啟設定時未關閉無人機或農地管理面板');
  await page.locator('#farm-management-toggle').click();
  if (!(await page.locator('#farm-management-panel').isVisible()) || await page.locator('#settings-panel').isVisible() || await page.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open'))) throw new Error('農地管理面板沒有關閉其他兩個面板');
  await assertManagementPanelSize('#farm-management-panel');
  const farmTabs = page.locator('.farm-management-tabs');
  if (await farmTabs.count() !== 1 || await page.locator('#farm-tab-manual').getAttribute('role') !== 'tab'
    || await page.locator('#farm-tab-auto').getAttribute('role') !== 'tab') {
    throw new Error('農地管理未提供手動／自動地塊分頁');
  }
  if (await page.locator('#farm-tab-auto').getAttribute('aria-selected') !== 'true'
    || await page.locator('#plot-selector [data-plot-button]').count() !== 3
    || await page.locator('#plot-selector').getAttribute('aria-labelledby') !== 'farm-tab-auto') {
    throw new Error('自動地塊分頁未正確顯示預設自動地塊');
  }
  const desktopFarmGrid = await page.locator('#plot-selector').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  if (desktopFarmGrid !== 5) throw new Error('桌面農地管理網格應固定五欄，實際為 ' + desktopFarmGrid);
  await page.locator('#farm-tab-manual').click();
  if (await page.locator('#farm-tab-manual').getAttribute('aria-selected') !== 'true'
    || await page.locator('#plot-selector').getAttribute('aria-labelledby') !== 'farm-tab-manual'
    || !(await page.locator('#plot-selector .farm-empty-state').innerText()).includes('沒有手動地塊')) {
    throw new Error('手動地塊分頁切換或空狀態提示不正確');
  }
  await page.locator('#farm-tab-auto').click();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFarmGrid = await page.locator('#plot-selector').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  if (mobileFarmGrid !== 3 || await page.locator('#plot-selector [data-plot-button]').count() !== 3) {
    throw new Error('手機農地管理網格應維持可操作的響應式欄數，實際欄數：' + mobileFarmGrid);
  }
  const mobilePlotBounds = await page.locator('#plot-selector [data-plot-button]').first().boundingBox();
  const mobilePanelBounds = await page.locator('#farm-management-panel').boundingBox();
  if (!mobilePlotBounds || !mobilePanelBounds || mobilePlotBounds.x < mobilePanelBounds.x
    || mobilePlotBounds.x + mobilePlotBounds.width > mobilePanelBounds.x + mobilePanelBounds.width + 1) {
    throw new Error('手機地塊按鈕溢出農地管理面板');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('任務218：手動／自動分頁切換、桌面五欄及手機響應式地塊網格');

  await page.locator('.farm-management-heading strong').click();
  if (!(await page.locator('#farm-management-panel').isVisible())) throw new Error('點擊農地管理面板內部未能維持開啟狀態');
  await page.mouse.click(20, 500);
  if (await page.locator('#farm-management-panel').isVisible() || await page.locator('#farm-management-toggle').getAttribute('aria-expanded') !== 'false') throw new Error('點擊面板外空白處未關閉農地管理，或 aria-expanded 未同步');
  await page.locator('#farm-management-toggle').click();
  if (!(await page.locator('#farm-management-panel').isVisible())) throw new Error('農地管理面板在外部點擊關閉後無法重新開啟');
  await page.locator('#drone-panel-toggle').click();
  if (!(await page.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open')) ) || await page.locator('#settings-panel').isVisible() || await page.locator('#farm-management-panel').isVisible()) throw new Error('無人機面板沒有關閉其他兩個面板');
  await assertManagementPanelSize('#drone-jobs');
  await page.locator('#job-status').click();
  if (!(await page.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open')))) throw new Error('點擊無人機面板內部後面板意外關閉');
  await page.mouse.click(20, 500);
  if (await page.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open')) || await page.locator('#drone-panel-toggle').getAttribute('aria-expanded') !== 'false') throw new Error('點擊面板外空白處未關閉無人機管理，或 aria-expanded 未同步');
  await page.locator('#drone-panel-toggle').click();
  if (!(await page.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open')))) throw new Error('無人機管理面板在外部點擊關閉後無法重新開啟');
  await assertManagementPanelSize('#drone-jobs');
  const droneLayoutCheck = await page.evaluate(() => {
    const panel = document.querySelector('#drone-jobs');
    const fleet = document.querySelector('#drone-fleet');
    const card = fleet?.querySelector('.drone-fleet-item');
    const queue = document.querySelector('#job-queue');
    const panelRect = panel.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    const gridTemplateColumns = getComputedStyle(fleet).gridTemplateColumns;
    const columns = gridTemplateColumns.trim().split(/\s+/).length;
    const initialPanel = { x: panelRect.x, y: panelRect.y, width: panelRect.width, height: panelRect.height };
    for (let index = 0; index < 30; index += 1) {
      const item = document.createElement('li');
      item.dataset.testOverflow = 'true';
      item.textContent = `測試佇列工作 ${index + 1}`;
      queue.append(item);
    }
    const afterRect = panel.getBoundingClientRect();
    const result = {
      columns,
      gridTemplateColumns,
      fleetDisplay: getComputedStyle(fleet).display,
      fleetWidth: fleet.getBoundingClientRect().width,
      cardBounds: cardRect ? { width: cardRect.width, height: cardRect.height } : null,
      cardRatio: cardRect ? Math.abs(cardRect.width - cardRect.height) : null,
      initialPanel,
      afterPanel: { x: afterRect.x, y: afterRect.y, width: afterRect.width, height: afterRect.height },
      queueOverflow: queue.scrollHeight > queue.clientHeight,
      queueOverflowStyle: getComputedStyle(queue).overflowY,
    };
    queue.querySelectorAll('[data-test-overflow]').forEach(item => item.remove());
    return result;
  });
  if (droneLayoutCheck.columns !== 4 || droneLayoutCheck.cardRatio === null || droneLayoutCheck.cardRatio > 2
    || JSON.stringify(droneLayoutCheck.initialPanel) !== JSON.stringify(droneLayoutCheck.afterPanel)
    || !droneLayoutCheck.queueOverflow || droneLayoutCheck.queueOverflowStyle !== 'hidden') {
    throw new Error('任務214：無人機面板固定尺寸、四欄方形卡片或佇列溢出隱藏不符合預期：' + JSON.stringify(droneLayoutCheck));
  }
  checks.push('任務214：無人機面板固定尺寸、四欄方形卡片與佇列超出後隱藏通過');
  await page.waitForTimeout(5200);
  if (!(await page.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open'))) || !(await page.locator('#job-queue').isVisible()) || await page.locator('#job-queue > li').count() === 0) throw new Error('無人機管理面板在閒置 5 秒後消失，或工作佇列沒有空佇列提示');
  checks.push('任務205：無人機管理面板閒置超過5秒仍可見，空佇列提示正常');
  await page.locator('#settings-toggle').click();
  if (!(await page.locator('#settings-panel').isVisible()) || await page.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open')) || await page.locator('#farm-management-panel').isVisible()) throw new Error('設定面板沒有關閉其他兩個面板');
  await page.locator('#settings-toggle').click();
  const mobilePanelPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await mobilePanelPage.addInitScript(() => localStorage.setItem('sky-garden-guest-mode-v1', 'true'));
  await mobilePanelPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  const mobileHudIcon = mobilePanelPage.locator('#hud-toggle img.btn-icon-image');
  if (await mobileHudIcon.getAttribute('src') !== 'assets/btn/收合.png' || !(await mobileHudIcon.evaluate(image => image.complete && image.naturalWidth > 0))) throw new Error('任務220：手機頂部收合圖示未正確載入');
  await mobilePanelPage.locator('#hud-toggle').click();
  if (await mobilePanelPage.locator('#hud-toggle').getAttribute('aria-expanded') !== 'false' || await mobileHudIcon.getAttribute('src') !== 'assets/btn/展開.png') throw new Error('任務221：手機收合後未顯示展開圖示');
  await mobilePanelPage.locator('#hud-toggle').click();
  if (await mobilePanelPage.locator('#hud-toggle').getAttribute('aria-expanded') !== 'true'
    || await mobileHudIcon.getAttribute('src') !== 'assets/btn/收合.png') throw new Error('任務220：手機恢復介面操作失效或收合圖示遺失');
  checks.push('任務220：手機頂部收合圖示載入正確，收合／恢復操作正常');
  const assertMobilePanelSize = async selector => {
    await mobilePanelPage.waitForTimeout(120);
    const bounds = await mobilePanelPage.locator(selector).evaluate(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
    const viewport = mobilePanelPage.viewportSize();
    if (!viewport || bounds.width > viewport.width - 26 || bounds.x < -1 || bounds.y < -1 || bounds.x + bounds.width > viewport.width + 1 || bounds.y + bounds.height > viewport.height + 1 || Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) > 2 || Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) > 2) {
      throw new Error('手機管理面板尺寸超出視窗或未置中：' + selector + ' ' + JSON.stringify({ bounds, viewport }));
    }
  };
  await mobilePanelPage.locator('#settings-toggle').click();
  await assertMobilePanelSize('#settings-panel');
  await mobilePanelPage.locator('#settings-toggle').click();
  await mobilePanelPage.locator('#farm-management-toggle').click();
  await assertMobilePanelSize('#farm-management-panel');
  await mobilePanelPage.locator('.farm-management-heading strong').click();
  if (!(await mobilePanelPage.locator('#farm-management-panel').isVisible())) throw new Error('手機點擊農地管理面板內部後面板意外關閉');
  await mobilePanelPage.mouse.click(5, 400);
  if (await mobilePanelPage.locator('#farm-management-panel').isVisible() || await mobilePanelPage.locator('#farm-management-toggle').getAttribute('aria-expanded') !== 'false') throw new Error('手機點擊面板外空白處未關閉農地管理，或 aria-expanded 未同步');
  await mobilePanelPage.locator('#farm-management-toggle').click();
  await mobilePanelPage.locator('#farm-management-close').click();
  await mobilePanelPage.locator('#drone-panel-toggle').click();
  await assertMobilePanelSize('#drone-jobs');
  await mobilePanelPage.locator('#job-status').click();
  if (!(await mobilePanelPage.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open')))) throw new Error('手機點擊無人機面板內部後面板意外關閉');
  await mobilePanelPage.mouse.click(5, 400);
  if (await mobilePanelPage.locator('#drone-jobs').evaluate(el => el.classList.contains('is-open')) || await mobilePanelPage.locator('#drone-panel-toggle').getAttribute('aria-expanded') !== 'false') throw new Error('手機點擊面板外空白處未關閉無人機管理，或 aria-expanded 未同步');
  await mobilePanelPage.locator('#drone-panel-toggle').click();
  await mobilePanelPage.locator('#drone-panel-toggle').click();
  const assertStableTypography = async (testPage, viewportName) => {
    const typography = await testPage.evaluate(() => {
      const expected = [
        ['#job-status', '14px'],
        ['#buy-drone', '12px'],
        ['.farm-management-heading strong', '16px'],
        ['.world-plot-state', '11px'],
        ['#settings-panel > h2', '16px'],
        ['.settings-panel .settings-tab', '13px'],
        ['#cloud-save-status', '12px'],
        ['#avatar-dialog-title', '20px'],
        ['#avatar-dialog .avatar-settings label', '12px'],
        ['#avatar-mode', '13px'],
        ['#avatar-current-flower', '12px'],
        ['.avatar-flower-name', '11px'],
        ['.avatar-dialog-note', '12px'],
      ];
      const elements = expected.map(([selector, size]) => {
        const element = document.querySelector(selector);
        return { selector, size, element, actual: element ? getComputedStyle(element).fontSize : null };
      });
      const missing = elements.filter(item => !item.element).map(item => item.selector);
      const wrongSize = elements.filter(item => item.element && item.actual !== item.size)
        .map(item => ({ selector: item.selector, expected: item.size, actual: item.actual }));
      const mutations = elements.filter(item => item.element && !['#avatar-mode'].includes(item.selector));
      const originals = mutations.map(item => ({ element: item.element, text: item.element.textContent }));
      mutations.forEach(item => { item.element.textContent = '長內容字級穩定性驗收'.repeat(12); });
      const changed = mutations.filter(item => getComputedStyle(item.element).fontSize !== item.actual)
        .map(item => ({ selector: item.selector, before: item.actual, after: getComputedStyle(item.element).fontSize }));
      originals.forEach(item => { item.element.textContent = item.text; });
      return { missing, wrongSize, changed };
    });
    if (typography.missing.length || typography.wrongSize.length || typography.changed.length) {
      throw new Error(`${viewportName}字級固定驗收失敗：` + JSON.stringify(typography));
    }
    checks.push(`任務210：${viewportName}無人機、農地、設定及頭像介面字級固定，長文不觸發縮字`);
  };
  await mobilePanelPage.locator('#garden-avatar').click();
  await mobilePanelPage.locator('#avatar-dialog[open]').waitFor({ state: 'visible' });
  await mobilePanelPage.locator('[data-close-avatar-dialog]').click();
  await assertStableTypography(mobilePanelPage, '手機版');
  await mobilePanelPage.close();
  await page.locator('#garden-avatar').click();
  await page.locator('#avatar-dialog[open]').waitFor({ state: 'visible' });
  await page.locator('[data-close-avatar-dialog]').click();
  await assertStableTypography(page, '桌面版');
  checks.push('任務207：桌面與手機管理面板均符合頭像對話框尺寸並置中');
  const wheelActions = await page.locator('#garden-menu-wheel [data-wheel-action]').evaluateAll(nodes => nodes.map(node => node.dataset.wheelAction));
  if (wheelActions.join(',') !== 'drone,farm,settings,catalog,collapse,rotate') throw new Error('快捷輪盤選項不完整或順序錯誤：' + wheelActions.join(','));
  const buttonAssetChecks = await page.locator('.wheel-button-image, .topbar-actions .btn-icon-image').evaluateAll(images => images.map(image => ({
    src: image.getAttribute('src'),
    loaded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
  })));
  const expectedButtonAssetCounts = {
    'assets/btn/無人機管理.png': 2,
    'assets/btn/農地管理.png': 2,
    'assets/btn/設定.png': 2,
    'assets/btn/圖鑑.png': 2,
    'assets/btn/收合.png': 2,
    'assets/btn/旋轉.png': 1,
  };
  if (buttonAssetChecks.length !== 11 || buttonAssetChecks.some(image => !image.loaded)
    || Object.entries(expectedButtonAssetCounts).some(([src, count]) => buttonAssetChecks.filter(image => image.src === src).length !== count)) {
    throw new Error('輪盤及頂部介面的按鈕素材數量須符合目前實際配置且全部成功載入：' + JSON.stringify(buttonAssetChecks));
  }
  checks.push('輪盤與頂部資訊介面的農地、無人機、設定、圖鑑按鈕素材均成功載入');
  const wheelAccessibility = await page.locator('#garden-menu-wheel [data-wheel-action]').evaluateAll(buttons => buttons.map(button => ({
    action: button.dataset.wheelAction,
    label: button.getAttribute('aria-label'),
    role: button.getAttribute('role'),
    visibleLabel: [...button.querySelectorAll('small')].some(label => getComputedStyle(label).display !== 'none' && label.textContent.trim() !== ''),
  })));
  if (wheelAccessibility.length !== 6 || wheelAccessibility.some(button => button.role !== 'menuitem' || !button.label || button.visibleLabel)) {
    throw new Error('輪盤六個選項必須保留無障礙名稱且不顯示文字標籤：' + JSON.stringify(wheelAccessibility));
  }
  const wheelOverlayStyle = await page.locator('#garden-menu-wheel .wheel-icon-overlay').evaluateAll(nodes => nodes.map(node => ({
    action: node.dataset.wheelIcon,
    clipPath: getComputedStyle(node).clipPath,
    pointerEvents: getComputedStyle(node).pointerEvents,
    zIndex: Number.parseInt(getComputedStyle(node).zIndex, 10),
    src: node.querySelector('img').getAttribute('src'),
    imageWidth: Number.parseFloat(getComputedStyle(node.querySelector('img')).width),
    imageHeight: Number.parseFloat(getComputedStyle(node.querySelector('img')).height),
    filter: getComputedStyle(node.querySelector('img')).filter,
    loaded: node.querySelector('img').complete && node.querySelector('img').naturalWidth > 0,
  })));
  if (wheelOverlayStyle.length !== 6 || wheelOverlayStyle.some(icon => icon.clipPath !== 'none' || icon.pointerEvents !== 'none' || icon.zIndex < 1
    || icon.imageWidth !== 35 || icon.imageHeight !== 35 || !icon.filter.includes('drop-shadow') || !icon.filter.includes('rgb(255, 255, 255)') || !icon.loaded)
    || wheelOverlayStyle.filter(icon => icon.action === 'collapse').length !== 1
    || wheelOverlayStyle.find(icon => icon.action === 'collapse')?.src !== 'assets/btn/收合.png'
    || wheelOverlayStyle.filter(icon => icon.action === 'rotate').length !== 1
    || wheelOverlayStyle.find(icon => icon.action === 'rotate')?.src !== 'assets/btn/旋轉.png') {
    throw new Error('桌面版五個圖示需位於不受扇形裁切的獨立覆蓋層、尺寸35px並具白色外框，收合入口使用指定素材：' + JSON.stringify(wheelOverlayStyle));
  }
  checks.push('任務220／222：快捷圓環收合與旋轉入口使用指定且已載入的35px圖示，六個圖示皆位於裁切層外並具白框');
  if (await page.locator('#garden-menu-wheel .garden-menu-wreath').getAttribute('src') !== 'assets/wreath.webp') throw new Error('快捷輪盤未沿用花草環素材');
  const wheelGeometry = await page.evaluate(async () => {
    const wheel = document.querySelector('#garden-menu-wheel');
    const wasHidden = wheel.hidden;
    wheel.hidden = false;
    wheel.classList.add('is-active');
    const sector = wheel.querySelector('[data-wheel-action="drone"]');
    const wreath = wheel.querySelector('.garden-menu-wreath');
    const style = getComputedStyle(sector);
    sector.classList.add('is-selected');
    await new Promise(resolve => setTimeout(resolve, 180));
    const selectedScale = new DOMMatrixReadOnly(getComputedStyle(sector).transform).a;
    sector.classList.remove('is-selected');
    wheel.hidden = wasHidden;
    wheel.classList.remove('is-active');
    return {
      centerContent: getComputedStyle(wheel, '::before').content,
      sectorClip: style.clipPath,
      sectorBackground: style.backgroundColor,
      sectorBorder: style.borderWidth,
      wreathOpacity: getComputedStyle(wreath).opacity,
      wreathVisibility: getComputedStyle(wreath).visibility,
      selectedScale,
    };
  });
  if (!['none', 'normal', ''].includes(wheelGeometry.centerContent) || !wheelGeometry.sectorClip.startsWith('polygon(') || wheelGeometry.sectorBackground !== 'rgba(0, 0, 0, 0)' || wheelGeometry.sectorBorder !== '0px' || wheelGeometry.wreathOpacity !== '1' || wheelGeometry.wreathVisibility !== 'visible' || wheelGeometry.selectedScale < 1.1) throw new Error('花草環需無中央偽元素底板、透明扇形按鈕、選中區放大且可見度100%：' + JSON.stringify(wheelGeometry));
  const frameBox = await page.locator('.world-frame').boundingBox();
  const wheelOpened = await page.evaluate(({ x, y }) => window.gardenMenuWheel.openAt(x, y, 1), { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 });
  if (!wheelOpened || !(await page.locator('#garden-menu-wheel').isVisible())) throw new Error('長按快捷輪盤未能顯示');
  await page.screenshot({ path: `${outputDir}/garden-wheel-desktop.png`, fullPage: true });
  await page.evaluate(({ x, y }) => {
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: x + 70, clientY: y - 70, bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: x + 70, clientY: y - 70, bubbles: true, cancelable: true }));
  }, { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 });
  if (!(await page.locator('#farm-management-panel').isVisible()) || await page.locator('#garden-menu-wheel').isVisible()) throw new Error('滑動輪盤選擇農地管理未正確執行');
  await page.evaluate(({ x, y }) => window.gardenMenuWheel.openAt(x, y, 1), { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 });
  await page.evaluate(({ x, y }) => {
    const event = new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: x - 70, clientY: y - 40, bubbles: true, cancelable: true });
    document.querySelector('#sky-canvas').dispatchEvent(event);
  }, { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 });
  if (await page.locator('#garden-menu-wheel').isVisible()) throw new Error('滑到旋轉選項後輪盤沒有立即收起');
  if (await page.locator('#garden-menu-wheel [data-wheel-action="rotate"]').getAttribute('aria-pressed') !== 'true') throw new Error('滑到旋轉選項後未立即進入旋轉模式');
  await page.evaluate(({ x, y }) => {
    document.querySelector('#sky-canvas').dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: x - 70, clientY: y - 40, bubbles: true, cancelable: true }));
  }, { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 });
  if (await page.locator('#garden-menu-wheel [data-wheel-action="rotate"]').getAttribute('aria-pressed') !== 'false') throw new Error('放開指標後未退出旋轉模式');
  await page.locator('#settings-toggle').click();
  if (!(await page.locator('#settings-panel').isVisible())) throw new Error('設定面板未開啟');
  if (await page.locator('#settings-tab-sync').getAttribute('aria-selected') !== 'true' || !(await page.locator('#settings-sync').isVisible())) throw new Error('設定面板預設分頁不是同步');
  for (const selector of ['#current-version', '#latest-version', '#force-update-button', '#cloud-save-status', '#reset-progress']) {
    if (!(await page.locator(selector).isVisible())) throw new Error('同步分頁缺少版本、存檔或重置控制：' + selector);
  }
  if ((await page.locator('#current-version').innerText()).trim() === '' || (await page.locator('#latest-version').innerText()).trim() === '') throw new Error('設定面板版本號沒有顯示內容');
  const saveStatusPlacement = await page.locator('#save-status').evaluate(element => ({
    insideCloudSave: Boolean(element.closest('.cloud-save-settings')),
    text: element.textContent.trim(),
    warning: element.classList.contains('save-warning'),
  }));
  if (!saveStatusPlacement.insideCloudSave || saveStatusPlacement.text !== '進度會自動儲存' || await page.locator('#settings-sync > #save-status').count() !== 0) {
    throw new Error('自動儲存提示沒有移入跨裝置存檔區，或一般狀態文案異常：' + JSON.stringify(saveStatusPlacement));
  }
  checks.push('任務209：自動儲存提示位於跨裝置存檔區且只顯示一次');
  const saveWarningPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await saveWarningPage.addInitScript(() => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    localStorage.setItem('sky-garden-guest-save-v1', '{invalid-json');
  });
  await saveWarningPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await saveWarningPage.locator('#settings-toggle').click();
  const saveWarningState = await saveWarningPage.locator('#save-status').evaluate(element => ({
    insideCloudSave: Boolean(element.closest('.cloud-save-settings')),
    text: element.textContent.trim(),
    warning: element.classList.contains('save-warning'),
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }));
  if (!saveWarningState.insideCloudSave || !saveWarningState.warning || !saveWarningState.text.includes('存檔格式無法讀取')
    || saveWarningState.color !== 'rgb(155, 63, 45)' || saveWarningState.background !== 'rgb(255, 240, 235)') {
    throw new Error('本機存檔警告未在跨裝置存檔區清楚顯示：' + JSON.stringify(saveWarningState));
  }
  checks.push('任務209：本機存檔讀取失敗時，跨裝置存檔區顯示醒目警告');
  await saveWarningPage.close();

  const authApiPattern = 'https://diangarden-cloud-save.ry15968.workers.dev/api/**';
  const authCorsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-diangarden-opened-at',
    'content-type': 'application/json',
  };
  const restoredAuthPage = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const restoredAuthOpenedAt = Date.now() - 5000;
  await restoredAuthPage.addInitScript(({ openedAt }) => {
    localStorage.removeItem('sky-garden-guest-mode-v1');
    localStorage.setItem('sky-garden-auth-session-v1', JSON.stringify({
      version: 2, refreshToken: 'test-session-id.old-refresh-secret', currentSub: 'task232-session-account',
    }));
    sessionStorage.setItem('sky-garden-auth-opened-at-v1', String(openedAt));
    window.__task232GoogleInitializeCalls = 0;
    window.__task232GooglePromptCalls = 0;
    window.google = { accounts: { id: {
      initialize() { window.__task232GoogleInitializeCalls += 1; },
      renderButton() {},
      prompt() { window.__task232GooglePromptCalls += 1; },
      disableAutoSelect() {},
    } } };
  }, { openedAt: restoredAuthOpenedAt });
  const restoredAuthRequests = [];
  await restoredAuthPage.route(authApiPattern, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: authCorsHeaders });
      return;
    }
    restoredAuthRequests.push({ path: url.pathname, method: request.method(), authorization: request.headers()['authorization'], body: request.postDataJSON?.() });
    if (url.pathname === '/api/session/refresh') {
      await route.fulfill({ status: 200, headers: authCorsHeaders, body: JSON.stringify({
        accessToken: 'test-session-id.access-secret', accessExpiresAt: Math.floor(Date.now() / 1000) + 900,
        refreshToken: 'test-session-id.rotated-refresh-secret', idleExpiresAt: Math.floor(Date.now() / 1000) + 2592000,
        userId: 'task232-session-account',
      }) });
    } else if (url.pathname === '/api/save') {
      await route.fulfill({ status: 200, headers: authCorsHeaders, body: JSON.stringify({ status: 'not_found', revision: 0 }) });
    } else {
      await route.fulfill({ status: 200, headers: authCorsHeaders, body: JSON.stringify({ status: 'signed_out' }) });
    }
  });
  await restoredAuthPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await restoredAuthPage.waitForFunction(() => document.querySelector('#cloud-save-status')?.textContent.includes('雲端還沒有存檔'));
  const restoredAuthState = await restoredAuthPage.evaluate(() => ({
    session: JSON.parse(localStorage.getItem('sky-garden-auth-session-v1') || 'null'),
    openedAt: Number(sessionStorage.getItem('sky-garden-auth-opened-at-v1')),
    googleInitializeCalls: window.__task232GoogleInitializeCalls,
    googlePromptCalls: window.__task232GooglePromptCalls,
    startupDialogOpen: Boolean(document.querySelector('#startup-garden-dialog')?.open),
  }));
  if (restoredAuthRequests.length !== 2 || restoredAuthRequests[0].path !== '/api/session/refresh'
    || restoredAuthRequests[1].path !== '/api/save' || restoredAuthRequests[1].authorization !== 'Bearer test-session-id.access-secret'
    || restoredAuthRequests[1].body != null || restoredAuthState.session?.refreshToken !== 'test-session-id.rotated-refresh-secret'
    || restoredAuthState.openedAt !== restoredAuthOpenedAt || restoredAuthState.googleInitializeCalls !== 1
    || restoredAuthState.googlePromptCalls !== 0 || restoredAuthState.startupDialogOpen) {
    throw new Error('任務232：重新開啟遊戲未恢復長期登入並輪替更新憑證：' + JSON.stringify({ restoredAuthRequests, restoredAuthState }));
  }
  await restoredAuthPage.locator('#settings-toggle').click();
  await restoredAuthPage.locator('#cloud-save-signout').click();
  await restoredAuthPage.waitForFunction(() => localStorage.getItem('sky-garden-auth-session-v1') === null);
  const signedOutAuthState = await restoredAuthPage.evaluate(() => ({
    session: localStorage.getItem('sky-garden-auth-session-v1'),
    signInVisible: !document.querySelector('#cloud-save-signin')?.hidden,
    actionsHidden: document.querySelector('#cloud-save-actions')?.hidden,
  }));
  if (signedOutAuthState.session !== null || !signedOutAuthState.signInVisible || !signedOutAuthState.actionsHidden) {
    throw new Error('任務232：登出未清除長期登入憑證或未關閉雲端操作：' + JSON.stringify(signedOutAuthState));
  }
  checks.push('任務232：跨日登入恢復、更新憑證輪替及登出清除狀態');
  await restoredAuthPage.close();

  const credentialPersistencePage = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const loginTokenExp = Math.floor(Date.now() / 1000) + 3600;
  const loginToken = await credentialPersistencePage.evaluate(({ exp }) => {
    const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replaceAll('+', '-').replaceAll('/', '_');
    return 'header.' + encode({
      iss: 'https://accounts.google.com',
      aud: '433597292916-ju9hd3hmhfuka06l3t3kisbl6sir8cpu.apps.googleusercontent.com',
      sub: 'task232-login-account', exp,
    }) + '.signature';
  }, { exp: loginTokenExp });
  await credentialPersistencePage.addInitScript(() => {
    localStorage.removeItem('sky-garden-guest-mode-v1');
    window.__task232GoogleInitializeCalls = 0;
    window.__task232GooglePromptCalls = 0;
    window.google = { accounts: { id: {
      initialize(options) {
        window.__task232GoogleInitializeCalls += 1;
        window.__task232CredentialCallback = options.callback;
      },
      renderButton() {},
      prompt() { window.__task232GooglePromptCalls += 1; },
      disableAutoSelect() {},
    } } };
  });
  const credentialPersistenceRequests = [];
  await credentialPersistencePage.route(authApiPattern, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: authCorsHeaders });
      return;
    }
    credentialPersistenceRequests.push({ path: url.pathname, method: request.method(), authorization: request.headers()['authorization'], body: request.postDataJSON?.() });
    if (url.pathname === '/api/session') {
      await route.fulfill({ status: 201, headers: authCorsHeaders, body: JSON.stringify({
        accessToken: 'login-session.access-1', accessExpiresAt: Math.floor(Date.now() / 1000) + 900,
        refreshToken: 'login-session.refresh-1', idleExpiresAt: Math.floor(Date.now() / 1000) + 2592000,
        userId: 'task232-login-account',
      }) });
    } else if (url.pathname === '/api/session/refresh') {
      await route.fulfill({ status: 200, headers: authCorsHeaders, body: JSON.stringify({
        accessToken: 'login-session.access-2', accessExpiresAt: Math.floor(Date.now() / 1000) + 900,
        refreshToken: 'login-session.refresh-2', idleExpiresAt: Math.floor(Date.now() / 1000) + 2592000,
        userId: 'task232-login-account',
      }) });
    } else {
      await route.fulfill({ status: 200, headers: authCorsHeaders, body: JSON.stringify({ status: 'not_found', revision: 0 }) });
    }
  });
  await credentialPersistencePage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await credentialPersistencePage.waitForFunction(() => typeof window.__task232CredentialCallback === 'function');
  await credentialPersistencePage.evaluate(token => window.__task232CredentialCallback({ credential: token }), loginToken);
  await credentialPersistencePage.waitForFunction(() => document.querySelector('#cloud-save-status')?.textContent.includes('雲端還沒有存檔'));
  const persistedLogin = await credentialPersistencePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-auth-session-v1') || 'null'));
  if (!persistedLogin || persistedLogin.version !== 2 || persistedLogin.refreshToken !== 'login-session.refresh-1'
    || persistedLogin.currentSub !== 'task232-login-account' || JSON.stringify(persistedLogin).includes('header.')
    || credentialPersistenceRequests[0]?.path !== '/api/session'
    || credentialPersistenceRequests[0]?.body?.idToken !== loginToken
    || credentialPersistenceRequests[1]?.path !== '/api/save'
    || credentialPersistenceRequests[1]?.authorization !== 'Bearer login-session.access-1') {
    throw new Error('任務232：Google 登入後未建立遊戲專用工作階段或仍持久保存 Google ID Token：' + JSON.stringify({ persistedLogin, credentialPersistenceRequests }));
  }
  await credentialPersistencePage.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await credentialPersistencePage.waitForFunction(() => document.querySelector('#cloud-save-status')?.textContent.includes('雲端還沒有存檔'));
  const reloadedLogin = await credentialPersistencePage.evaluate(() => ({
    session: JSON.parse(localStorage.getItem('sky-garden-auth-session-v1') || 'null'),
    googleInitializeCalls: window.__task232GoogleInitializeCalls,
    googlePromptCalls: window.__task232GooglePromptCalls,
  }));
  if (credentialPersistenceRequests.filter(item => item.path === '/api/session/refresh').length !== 1
    || credentialPersistenceRequests.at(-1)?.authorization !== 'Bearer login-session.access-2'
    || reloadedLogin.session?.refreshToken !== 'login-session.refresh-2'
    || reloadedLogin.googleInitializeCalls !== 1 || reloadedLogin.googlePromptCalls !== 0) {
    throw new Error('任務232：頁面重新載入後未使用更新憑證恢復登入：' + JSON.stringify({ credentialPersistenceRequests, reloadedLogin }));
  }
  checks.push('任務232：Google ID Token 僅用於首次登入，之後以遊戲更新憑證恢復登入');
  await credentialPersistencePage.close();

  const expiredAuthPage = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await expiredAuthPage.addInitScript(() => {
    localStorage.removeItem('sky-garden-guest-mode-v1');
    localStorage.setItem('sky-garden-auth-session-v1', JSON.stringify({
      version: 2, refreshToken: 'expired-session.refresh-secret', currentSub: 'task232-expired-account',
    }));
    window.__task232GoogleInitializeCalls = 0;
    window.google = { accounts: { id: {
      initialize() { window.__task232GoogleInitializeCalls += 1; },
      renderButton() {},
      prompt() {},
      disableAutoSelect() {},
    } } };
  });
  await expiredAuthPage.route(authApiPattern, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: authCorsHeaders });
      return;
    }
    if (new URL(request.url()).pathname === '/api/session/refresh') {
      await route.fulfill({ status: 401, headers: authCorsHeaders, body: JSON.stringify({ error: 'session_expired' }) });
    } else {
      await route.fulfill({ status: 200, headers: authCorsHeaders, body: JSON.stringify({ status: 'not_found', revision: 0 }) });
    }
  });
  await expiredAuthPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await expiredAuthPage.waitForFunction(() => window.__task232GoogleInitializeCalls > 0);
  const expiredAuthState = await expiredAuthPage.evaluate(() => ({
    session: localStorage.getItem('sky-garden-auth-session-v1'),
    googleInitializeCalls: window.__task232GoogleInitializeCalls,
  }));
  if (expiredAuthState.session !== null || expiredAuthState.googleInitializeCalls !== 1) {
    throw new Error('任務232：過期長期登入未清除並回到 Google 登入流程：' + JSON.stringify(expiredAuthState));
  }
  checks.push('任務232：過期長期登入會清除並回到 Google 登入流程');
  await expiredAuthPage.close();

  const legacyFallbackPage = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const legacyTokenExp = Math.floor(Date.now() / 1000) + 3600;
  const legacyGoogleToken = await legacyFallbackPage.evaluate(({ exp }) => {
    const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replaceAll('+', '-').replaceAll('/', '_');
    return 'header.' + encode({
      iss: 'https://accounts.google.com',
      aud: '433597292916-ju9hd3hmhfuka06l3t3kisbl6sir8cpu.apps.googleusercontent.com',
      sub: 'task232-legacy-account', exp,
    }) + '.signature';
  }, { exp: legacyTokenExp });
  await legacyFallbackPage.addInitScript(() => {
    localStorage.removeItem('sky-garden-guest-mode-v1');
    window.google = { accounts: { id: {
      initialize(options) { window.__task232LegacyCallback = options.callback; },
      renderButton() {},
      prompt() {},
      disableAutoSelect() {},
    } } };
  });
  const legacyRequests = [];
  await legacyFallbackPage.route(authApiPattern, async route => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') {
      const oldWorkerHeaders = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, PUT, OPTIONS',
        'access-control-allow-headers': 'authorization,content-type,x-diangarden-opened-at',
        'content-type': 'application/json',
      };
      await route.fulfill({ status: 204, headers: oldWorkerHeaders });
      return;
    }
    if (path === '/api/session' && method === 'POST') {
      await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ error: 'not_found' }) });
      return;
    }
    legacyRequests.push({ path, method: request.method(), authorization: request.headers()['authorization'] });
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'not_found', revision: 0 }),
    });
  });
  await legacyFallbackPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await legacyFallbackPage.waitForFunction(() => typeof window.__task232LegacyCallback === 'function');
  await legacyFallbackPage.evaluate(token => window.__task232LegacyCallback({ credential: token }), legacyGoogleToken);
  await legacyFallbackPage.waitForFunction(() => document.querySelector('#cloud-save-status')?.textContent.includes('雲端還沒有存檔'));
  const legacyState = await legacyFallbackPage.evaluate(() => ({
    session: JSON.parse(sessionStorage.getItem('sky-garden-auth-session-v1') || 'null'),
    persistentSession: localStorage.getItem('sky-garden-auth-session-v1'),
  }));
  if (legacyRequests.length !== 1 || legacyRequests[0].path !== '/api/save'
    || legacyRequests[0].authorization !== 'Bearer ' + legacyGoogleToken
    || legacyState.session?.version !== 1 || legacyState.session?.idToken !== legacyGoogleToken
    || legacyState.persistentSession !== null) {
    throw new Error('任務232：舊版 Worker 尚未更新時，登入相容降級失敗：' + JSON.stringify({ legacyRequests, legacyState }));
  }
  checks.push('任務232：舊版 Worker 部署期間仍可使用短效 Google 登入');
  await legacyFallbackPage.close();

  const staleSessionPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await staleSessionPage.addInitScript(() => {
    localStorage.removeItem('sky-garden-guest-mode-v1');
    window.google = { accounts: { id: {
      initialize(options) { window.__task211CredentialCallback = options.callback; },
      renderButton() {},
      prompt() {},
      disableAutoSelect() {},
    } } };
  });
  const cloudRequests = [];
  await staleSessionPage.route('https://diangarden-cloud-save.ry15968.workers.dev/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-diangarden-opened-at',
      'access-control-max-age': '600',
      'content-type': 'application/json',
    };
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (path === '/api/session') {
      await route.fulfill({ status: 201, headers: corsHeaders, body: JSON.stringify({
        accessToken: 'task211-session.access', accessExpiresAt: Math.floor(Date.now() / 1000) + 900,
        refreshToken: 'task211-session.refresh', idleExpiresAt: Math.floor(Date.now() / 1000) + 2592000,
        userId: 'task211-test-account',
      }) });
      return;
    }
    if (path === '/api/session/refresh') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({
        accessToken: 'task211-session.access', accessExpiresAt: Math.floor(Date.now() / 1000) + 900,
        refreshToken: 'task211-session.refresh-next', idleExpiresAt: Math.floor(Date.now() / 1000) + 2592000,
        userId: 'task211-test-account',
      }) });
      return;
    }
    cloudRequests.push(method);
    await route.fulfill({
      status: 409,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'stale_session' }),
    });
  });
  await staleSessionPage.goto(baseURL + '/index.html', { waitUntil: 'networkidle', timeout: 30000 });
  await staleSessionPage.waitForFunction(() => typeof window.__task211CredentialCallback === 'function');
  await staleSessionPage.evaluate(() => {
    const payload = btoa(JSON.stringify({ iss: 'https://accounts.google.com', aud: '433597292916-ju9hd3hmhfuka06l3t3kisbl6sir8cpu.apps.googleusercontent.com', exp: Math.floor(Date.now() / 1000) + 3600, sub: 'task211-test-account' })).replace(/=/g, '');
    window.__task211CredentialCallback({ credential: 'header.' + payload + '.signature' });
  });
  await staleSessionPage.waitForFunction(() => !document.querySelector('#cloud-session-banner')?.hidden && !document.querySelector('#cloud-session-banner-settings')?.hidden);
  const inspectWindChimeBanner = () => staleSessionPage.evaluate(() => {
    const frame = document.querySelector('.world-frame');
    const banner = document.querySelector('#cloud-session-banner');
    const icon = banner?.querySelector('.cloud-session-wind-chime-icon');
    const button = document.querySelector('#cloud-session-refresh-main');
    const frameRect = frame.getBoundingClientRect();
    const bannerRect = banner.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const hitTarget = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
    const style = getComputedStyle(banner);
    return {
      visible: !banner.hidden && bannerRect.width > 0 && bannerRect.height > 0,
      centerGap: Math.abs((bannerRect.left + bannerRect.width / 2) - (frameRect.left + frameRect.width / 2)),
      bottomGap: frameRect.bottom - bannerRect.bottom,
      background: style.backgroundColor,
      color: style.color,
      pointerEvents: style.pointerEvents,
      buttonPointerEvents: getComputedStyle(button).pointerEvents,
      buttonHit: hitTarget === button || button.contains(hitTarget),
      buttonVisible: !button.hidden && buttonRect.width > 0 && buttonRect.height > 0,
      textNotClipped: [...banner.querySelectorAll('.cloud-session-banner-line')].every(line => line.scrollHeight <= line.clientHeight + 1),
      icon: {
        src: icon?.getAttribute('src'),
        loaded: Boolean(icon?.complete && icon.naturalWidth > 0 && icon.naturalHeight > 0),
        width: Number.parseFloat(getComputedStyle(icon).width),
        height: Number.parseFloat(getComputedStyle(icon).height),
        afterText: Boolean(icon && icon.previousSibling?.textContent?.includes('讓時間再度流動。')),
      },
    };
  });
  const mobileWindChimeBanner = await inspectWindChimeBanner();
  if (!mobileWindChimeBanner.visible || mobileWindChimeBanner.centerGap > 2
    || mobileWindChimeBanner.bottomGap < 46 || mobileWindChimeBanner.bottomGap > 50
    || !mobileWindChimeBanner.background.startsWith('rgba(247, 251, 240')
    || mobileWindChimeBanner.color !== 'rgb(82, 119, 99)'
    || mobileWindChimeBanner.pointerEvents !== 'none' || mobileWindChimeBanner.buttonPointerEvents !== 'auto'
    || !mobileWindChimeBanner.buttonHit || !mobileWindChimeBanner.buttonVisible || !mobileWindChimeBanner.textNotClipped
    || mobileWindChimeBanner.icon.src !== 'assets/btn/風鈴.png' || !mobileWindChimeBanner.icon.loaded
    || mobileWindChimeBanner.icon.width !== 32 || mobileWindChimeBanner.icon.height !== 32 || !mobileWindChimeBanner.icon.afterText) {
    throw new Error('任務219：手機風鈴提示位置、通知色系、32×32 圖示或按鈕命中錯誤：' + JSON.stringify(mobileWindChimeBanner));
  }
  await staleSessionPage.setViewportSize({ width: 1440, height: 900 });
  const desktopWindChimeBanner = await inspectWindChimeBanner();
  if (!desktopWindChimeBanner.visible || desktopWindChimeBanner.centerGap > 2
    || desktopWindChimeBanner.bottomGap < 46 || desktopWindChimeBanner.bottomGap > 50
    || !desktopWindChimeBanner.background.startsWith('rgba(247, 251, 240')
    || !desktopWindChimeBanner.buttonHit || !desktopWindChimeBanner.textNotClipped
    || !desktopWindChimeBanner.icon.loaded || desktopWindChimeBanner.icon.width !== 32 || desktopWindChimeBanner.icon.height !== 32) {
    throw new Error('任務219：桌面風鈴提示位置、通知色系、圖示尺寸或按鈕命中錯誤：' + JSON.stringify(desktopWindChimeBanner));
  }
  await staleSessionPage.setViewportSize({ width: 390, height: 844 });
  await staleSessionPage.locator('#settings-toggle').click();
  await staleSessionPage.locator('#cloud-session-refresh').waitFor({ state: 'visible' });
  const staleSessionState = await staleSessionPage.evaluate(() => ({
    loginHidden: document.querySelector('#cloud-save-signin')?.hidden,
    startupLoginHidden: document.querySelector('#startup-google-signin')?.hidden,
    refreshVisible: !document.querySelector('#cloud-session-refresh')?.hidden,
    mainRefreshVisible: !document.querySelector('#cloud-session-refresh-main')?.hidden,
    mainBannerVisible: !document.querySelector('#cloud-session-banner')?.hidden,
    settingsBannerVisible: !document.querySelector('#cloud-session-banner-settings')?.hidden,
    mainLines: [...document.querySelectorAll('#cloud-session-banner .cloud-session-banner-line')].map(node => node.textContent.trim()),
    settingsLines: [...document.querySelectorAll('#cloud-session-banner-settings .cloud-session-banner-line')].map(node => node.textContent.trim()),
    mainButtonText: document.querySelector('#cloud-session-refresh-main')?.textContent.trim(),
    settingsButtonText: document.querySelector('#cloud-session-refresh')?.textContent.trim(),
    settingsIcon: (() => { const image = document.querySelector('#cloud-session-banner-settings .cloud-session-wind-chime-icon'); return { src: image?.getAttribute('src'), loaded: Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0), width: Number.parseFloat(getComputedStyle(image).width), height: Number.parseFloat(getComputedStyle(image).height) }; })(),
    cloudStatus: document.querySelector('#cloud-save-status')?.textContent.trim(),
    authSession: JSON.parse(localStorage.getItem('sky-garden-auth-session-v1') || 'null'),
    openedAt: sessionStorage.getItem('sky-garden-auth-opened-at-v1'),
    saveStatus: document.querySelector('#save-status')?.textContent.trim(),
    saveWarning: document.querySelector('#save-status')?.classList.contains('save-warning'),
  }));
  const expectedSessionLines = ['蒲公英捎來你在彼岸駐足的信', '回家時，請搖響風鈴，讓時間再度流動。'];
  if (!staleSessionState.loginHidden || !staleSessionState.startupLoginHidden || !staleSessionState.refreshVisible
    || !staleSessionState.mainRefreshVisible || !staleSessionState.mainBannerVisible || !staleSessionState.settingsBannerVisible
    || JSON.stringify(staleSessionState.mainLines) !== JSON.stringify(expectedSessionLines)
    || JSON.stringify(staleSessionState.settingsLines) !== JSON.stringify(expectedSessionLines)
    || staleSessionState.mainButtonText !== '輕搖風鈴' || staleSessionState.settingsButtonText !== '輕搖風鈴'
    || staleSessionState.settingsIcon.src !== 'assets/btn/風鈴.png' || !staleSessionState.settingsIcon.loaded || staleSessionState.settingsIcon.width !== 32 || staleSessionState.settingsIcon.height !== 32
    || staleSessionState.cloudStatus !== '雲端同步已暫停；本機進度仍會保留。'
    || staleSessionState.authSession?.refreshToken !== 'task211-session.refresh'
    || staleSessionState.openedAt !== null
    || staleSessionState.saveStatus !== '暫停同步雲端進度' || !staleSessionState.saveWarning) {
    throw new Error('異地登入後的雙處提示、風鈴按鈕或離線存檔狀態錯誤：' + JSON.stringify(staleSessionState));
  }
  checks.push('任務219：桌面／手機風鈴提示置中於畫面中下方、通知色系和諧、圖示 32×32 且按鈕可命中；設定面板圖示載入通過');
  await staleSessionPage.locator('#garden-avatar').click();
  await staleSessionPage.locator('#avatar-mode').selectOption('manual');
  const localSaveAfterOfflineEdit = await staleSessionPage.evaluate(() => localStorage.getItem('sky-garden-save-v1'));
  if (!localSaveAfterOfflineEdit) throw new Error('異地登入後仍無法寫入本機遊戲存檔');
  await staleSessionPage.locator('[data-close-avatar-dialog]').click();
  await staleSessionPage.locator('#settings-toggle').click();
  await staleSessionPage.waitForTimeout(2800);
  if (cloudRequests.filter(method => method === 'GET').length !== 1 || cloudRequests.includes('PUT')) {
    throw new Error('異地登入後仍繼續發送雲端讀寫請求：' + JSON.stringify(cloudRequests));
  }
  checks.push('任務211：模擬 stale_session 後隱藏登入、暫停雲端同步且本機存檔仍可寫入');

  const assertRefreshButtonReloads = async selector => {
    if (selector === '#cloud-session-refresh-main') {
      await staleSessionPage.evaluate(() => {
        document.querySelector('#settings-panel').hidden = true;
        document.querySelector('#settings-toggle')?.setAttribute('aria-expanded', 'false');
      });
    }
    const hitTest = await staleSessionPage.evaluate(selector => {
      const button = document.querySelector(selector);
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        exists: Boolean(button),
        hidden: button?.hidden,
        disabled: button?.disabled,
        targetIsButton: target === button || button.contains(target),
        targetTag: target?.tagName,
        targetId: target?.id,
        targetClass: typeof target?.className === 'string' ? target.className : '',
        avatarDialogOpen: document.querySelector('#avatar-dialog')?.open,
        settingsHidden: document.querySelector('#settings-panel')?.hidden,
      };
    }, selector);
    if (!hitTest.exists || hitTest.hidden || hitTest.disabled || !hitTest.targetIsButton
      || hitTest.avatarDialogOpen || (selector === '#cloud-session-refresh-main' && !hitTest.settingsHidden)) {
      throw new Error(`${selector} 風鈴按鈕無法直接操作：` + JSON.stringify(hitTest));
    }
    const reloaded = staleSessionPage.waitForEvent('load');
    await staleSessionPage.locator(selector).click();
    await reloaded;
    await staleSessionPage.waitForFunction(() => !document.querySelector('#cloud-session-banner')?.hidden);
    const restoredState = await staleSessionPage.evaluate(() => ({
      localSave: localStorage.getItem('sky-garden-save-v1'),
      authSession: JSON.parse(localStorage.getItem('sky-garden-auth-session-v1') || 'null'),
      signInVisible: !document.querySelector('#cloud-save-signin')?.hidden,
    }));
    if (!restoredState.localSave || restoredState.authSession?.refreshToken !== 'task211-session.refresh-next'
      || restoredState.signInVisible) {
      throw new Error(`${selector} 重新整理後未保留登入狀態或本機存檔：` + JSON.stringify(restoredState));
    }
  };
  await assertRefreshButtonReloads('#cloud-session-refresh-main');
  await staleSessionPage.waitForFunction(() => !document.querySelector('#cloud-session-banner')?.hidden && !document.querySelector('#cloud-session-banner-settings')?.hidden);
  await staleSessionPage.locator('#settings-toggle').click();
  await staleSessionPage.locator('#cloud-session-refresh').waitFor({ state: 'visible' });
  await assertRefreshButtonReloads('#cloud-session-refresh');
  if (cloudRequests.filter(method => method === 'GET').length !== 3 || cloudRequests.includes('PUT')) {
    throw new Error('重新整理後的離線狀態仍產生非預期雲端請求：' + JSON.stringify(cloudRequests));
  }
  checks.push('任務212：手機版主畫面與設定頁「輕搖風鈴」均重新載入頁面並保留本機存檔');

  await staleSessionPage.setViewportSize({ width: 1280, height: 800 });
  await staleSessionPage.waitForFunction(() => !document.querySelector('#cloud-session-banner')?.hidden && !document.querySelector('#cloud-session-banner-settings')?.hidden);
  const desktopBannerLayout = await staleSessionPage.evaluate(() => {
    const banner = document.querySelector('#cloud-session-banner');
    const button = document.querySelector('#cloud-session-refresh-main');
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const bannerRect = rect(banner);
    const buttonRect = rect(button);
    const lines = [...banner.querySelectorAll('.cloud-session-banner-line')];
    return {
      viewportWidth: innerWidth,
      banner: bannerRect,
      button: buttonRect,
      linesFit: lines.every(line => line.scrollWidth <= line.clientWidth + 1),
      buttonInside: buttonRect.left >= bannerRect.left && buttonRect.right <= bannerRect.right
        && buttonRect.top >= bannerRect.top && buttonRect.bottom <= bannerRect.bottom,
      hitTarget: (() => {
        const target = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
        return target === button || button.contains(target);
      })(),
    };
  });
  if (desktopBannerLayout.banner.left < 0 || desktopBannerLayout.banner.right > desktopBannerLayout.viewportWidth
    || !desktopBannerLayout.linesFit || !desktopBannerLayout.buttonInside || !desktopBannerLayout.hitTarget) {
    throw new Error('桌面版主畫面蒲公英提示或風鈴按鈕超出範圍／被遮擋：' + JSON.stringify(desktopBannerLayout));
  }
  await staleSessionPage.locator('#settings-toggle').click();
  const desktopSettingsLayout = await staleSessionPage.evaluate(() => {
    const banner = document.querySelector('#cloud-session-banner-settings');
    const button = document.querySelector('#cloud-session-refresh');
    const bannerRect = banner.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const lines = [...banner.querySelectorAll('.cloud-session-banner-line')];
    const target = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
    return {
      visible: !banner.hidden,
      linesFit: lines.every(line => line.scrollWidth <= line.clientWidth + 1),
      buttonInside: buttonRect.left >= bannerRect.left && buttonRect.right <= bannerRect.right
        && buttonRect.top >= bannerRect.top && buttonRect.bottom <= bannerRect.bottom,
      hitTarget: target === button || button.contains(target),
    };
  });
  if (!desktopSettingsLayout.visible || !desktopSettingsLayout.linesFit || !desktopSettingsLayout.buttonInside || !desktopSettingsLayout.hitTarget) {
    throw new Error('桌面版設定頁蒲公英提示或風鈴按鈕超出範圍／被遮擋：' + JSON.stringify(desktopSettingsLayout));
  }
  checks.push('任務212：桌面版主畫面與設定頁提示文字不裁切，風鈴按鈕可直接操作');
  await staleSessionPage.close();
  const displayedVersions = await page.evaluate(() => ({ current: document.querySelector('#current-version')?.textContent?.trim(), latest: document.querySelector('#latest-version')?.textContent?.trim() }));
  if (!/^[0-9]{6}, [0-9]{3,}$/.test(displayedVersions.current || '') || !/^[0-9]{6}, [0-9]{3,}$/.test(displayedVersions.latest || '')) throw new Error('設定面板版本號未使用每日更新序號格式：' + JSON.stringify(displayedVersions));
  checks.push('設定同步分頁顯示版本資訊、存檔與重置進度');
  await page.locator('#settings-tab-accessibility').click();
  if (await page.locator('#settings-tab-accessibility').getAttribute('aria-selected') !== 'true' || !(await page.locator('#settings-accessibility').isVisible())) throw new Error('輔助功能分頁未能開啟');
  for (const selector of ['#camera-mode', '#power-save-toggle', '.operation-help']) if (!(await page.locator(selector).isVisible())) throw new Error('輔助功能分頁缺少控制項：' + selector);
  if (await page.locator('#current-version').isVisible() || await page.locator('#cloud-save-status').isVisible() || await page.locator('#reset-progress').isVisible()) throw new Error('切換至輔助功能時仍顯示同步分頁內容');
  await page.locator('#settings-tab-sync').click();
  const settingsPanelSize = await page.locator('#settings-panel').evaluate(element => ({ width: element.getBoundingClientRect().width, padding: getComputedStyle(element).paddingTop, versionCardPadding: getComputedStyle(element.querySelector('.version-settings')).paddingTop }));
  if (settingsPanelSize.width > 522 || settingsPanelSize.width < 300) throw new Error('設定面板寬度未符合自訂頭像對話框規格：' + JSON.stringify(settingsPanelSize));
  if (Number.parseFloat(settingsPanelSize.padding) < 10 || Number.parseFloat(settingsPanelSize.versionCardPadding) < 10) throw new Error('全畫面設定面板內距沒有隨版面放大：' + JSON.stringify(settingsPanelSize));
  checks.push('任務203：設定兩個分頁可切換，分類內容正確且全畫面版面保留');
  if (await page.locator('#avatar-dialog').isVisible()) throw new Error('頭像設定對話框不應在預設狀態顯示');
  await page.locator('#garden-avatar').click();
  if (!(await page.locator('#avatar-dialog[open]').isVisible())) throw new Error('點擊花園頭像未開啟獨立頭像設定');
  if (await page.locator('.avatar-flower-option').count() !== 11) throw new Error('頭像選擇清單未顯示 11 種花卉');
  if (!(await page.locator('#avatar-flower-picker').isVisible())) throw new Error('自動頭像模式應仍顯示全部花卉清單');
  if (await page.locator('.avatar-flower-name').count() !== 11) throw new Error('頭像花種清單未顯示全部花名');
  const autoAvatar = page.locator('#garden-avatar img');
  const autoSelectedOption = page.locator('.avatar-flower-option.is-auto-selected');
  if (await autoSelectedOption.count() !== 1 || !(await autoSelectedOption.isDisabled()) || await autoSelectedOption.getAttribute('aria-pressed') !== 'true') throw new Error('自動模式沒有唯一標示目前選中的花卉，或仍允許手動指定');
  if (!(await page.locator('#avatar-current-flower').innerText()).includes('目前自動選擇：')) throw new Error('自動頭像狀態文字沒有說明目前選中的花卉');
  if (!(await autoSelectedOption.locator('img').getAttribute('src')) || await autoSelectedOption.locator('img').getAttribute('src') !== await autoAvatar.getAttribute('src')) throw new Error('自動選中標示與花園名稱旁的實際頭像不一致');
  const avatarImages = await page.locator('.avatar-flower-image').evaluateAll(images => images.map(image => ({ loaded: image.complete && image.naturalWidth > 0, pixelated: getComputedStyle(image).imageRendering === 'pixelated' })));
  if (avatarImages.length !== 11 || avatarImages.some(image => !image.loaded || !image.pixelated)) throw new Error('頭像選擇中的花卉點陣圖未全部載入或未使用 pixelated');
  await page.locator('#avatar-mode').selectOption('manual');
  if (!(await page.locator('#avatar-flower-picker').isVisible())) throw new Error('手動頭像模式未顯示花卉選擇介面');
  await page.locator('[data-avatar-crop="3"]').click();
  const avatarImage = page.locator('#garden-avatar img');
  if (!(await avatarImage.isVisible()) || !(await avatarImage.getAttribute('src')).endsWith('玫瑰.png') || await avatarImage.evaluate(image => getComputedStyle(image).imageRendering) !== 'pixelated' || await page.locator('[data-avatar-crop="3"]').getAttribute('aria-pressed') !== 'true') throw new Error('花園名稱左側頭像未顯示所選點陣圖素材');
  await page.locator('[data-close-avatar-dialog]').click();
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#garden-avatar').click();
  if (await page.locator('#avatar-mode').inputValue() !== 'manual' || await page.locator('#avatar-flower-picker').isHidden() || await page.locator('[data-avatar-crop="3"]').getAttribute('aria-pressed') !== 'true' || !(await page.locator('#garden-avatar img').getAttribute('src')).endsWith('玫瑰.png')) throw new Error('自訂花卉頭像未在重新載入後保存');
  await page.locator('#avatar-mode').selectOption('auto');
  if (!(await page.locator('#avatar-flower-picker').isVisible()) || !(await page.locator('.avatar-flower-option').first().isDisabled())) throw new Error('切換至自動模式後未保留花種清單，或仍允許手動指定');
  if (await page.locator('.avatar-flower-option.is-auto-selected').count() !== 1 || !(await page.locator('#avatar-current-flower').innerText()).includes('目前自動選擇：')) throw new Error('切換自動模式後未更新目前自動頭像標示');
  await page.locator('[data-close-avatar-dialog]').click();
  checks.push('任務202：頭像獨立彈出、11種點陣圖、模式切換及存檔通過');
  await page.locator('#settings-toggle').click();
  await page.locator('#settings-tab-accessibility').click();
  await page.locator('#power-save-toggle').click();
  if (await page.locator('#power-save-toggle').getAttribute('aria-pressed') !== 'true') throw new Error('省電模式未能開啟');
  if (!(await page.locator('.world-frame').evaluate(element => element.classList.contains('is-power-save')))) throw new Error('省電模式未切換畫布清空樣式');
  const canvasClearAlpha = await page.locator('#sky-canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return gl ? gl.getParameter(gl.COLOR_CLEAR_VALUE)[3] : null;
  });
  if (canvasClearAlpha !== 0) throw new Error('省電模式清空畫布時未使用透明清除色');
  const drawCallsAtPowerSave = await page.evaluate(() => window.__webglDrawCalls);
  await page.waitForTimeout(700);
  const drawCallsDuringPowerSave = await page.evaluate(() => window.__webglDrawCalls);
  if (drawCallsDuringPowerSave !== drawCallsAtPowerSave) throw new Error('省電模式啟用時仍呼叫 WebGL drawArrays');
  await page.locator('#power-save-toggle').click();
  await page.waitForTimeout(400);
  if (await page.evaluate(() => window.__webglDrawCalls) <= drawCallsDuringPowerSave) throw new Error('關閉省電模式後 WebGL 繪圖未恢復');
  checks.push('收合／恢復、無人機圖示、設定面板及省電模式繪圖暫停／恢復通過');

  await page.locator('#farm-management-toggle').click();
  if (await page.locator('#farm-management-toggle').getAttribute('aria-expanded') !== 'true') throw new Error('農地管理按鈕未能開啟整合面板');
  if (!(await page.locator('#world-buy-manual-plot').isVisible())) throw new Error('農地管理面板未顯示手動地塊購買入口');
  if (!(await page.locator('#world-expand').isVisible())) throw new Error('農地管理面板未顯示自動地塊購買入口');
  const desktopFarmTabs = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector('#plot-selector')).gridTemplateColumns.trim().split(/\s+/).length,
    autoSelected: document.querySelector('#farm-tab-auto').getAttribute('aria-selected'),
    autoLabels: [...document.querySelectorAll('#plot-selector [data-plot-button]')].map(button => button.getAttribute('aria-label')),
  }));
  if (desktopFarmTabs.columns !== 5 || desktopFarmTabs.autoSelected !== 'true'
    || desktopFarmTabs.autoLabels.some(label => !label.startsWith('自動地塊 '))) {
    throw new Error('桌面農地管理預設分頁或五欄網格不正確：' + JSON.stringify(desktopFarmTabs));
  }
  await page.locator('#farm-tab-manual').click();
  if (await page.locator('#farm-tab-manual').getAttribute('aria-selected') !== 'true'
    || await page.locator('#plot-selector').getAttribute('aria-labelledby') !== 'farm-tab-manual'
    || (await page.locator('#plot-selector [data-plot-button]').allTextContents()).some(text => !/^\\s*\\d+/.test(text))) {
    throw new Error('桌面手動地塊分頁切換或可存取狀態不正確');
  }
  if (await page.locator('#plot-selector [data-plot-button]').count() === 0 && !(await page.locator('.farm-empty-state').innerText()).includes('沒有手動地塊')) {
    throw new Error('沒有手動地塊時未顯示空狀態提示');
  }
  await page.locator('#farm-tab-auto').click();
  if (await page.locator('#farm-tab-auto').getAttribute('aria-selected') !== 'true') throw new Error('桌面無法切回自動地塊分頁');
  await page.locator('[data-plot-button="0"]').click();
  if (await page.locator('#farm-dialog .plot-mode-switch').count() !== 0) throw new Error('自動地塊仍顯示地塊性質切換開關');
  await page.locator('[data-close-farm-dialog]').click();
  await page.locator('#world-buy-manual-plot').click();
  if (!(await page.locator('#farm-dialog').innerText()).includes('143')) throw new Error('手動地塊購買對話框未顯示固定 75 金幣價格');
  await page.locator('[data-dialog-cancel]').click();
  await page.locator('#farm-management-close').click();
  checks.push('農地管理整合購買入口、操作說明移入設定、自動地塊不提供性質切換');

  const worldMessage = await page.locator('#world-message').innerText().catch(() => '');
  if (worldMessage.includes('載入失敗') || worldMessage.includes('無法啟用 WebGL')) {
    throw new Error(`遊戲場景載入失敗：${worldMessage}`);
  }
  await page.screenshot({ path: `${outputDir}/garden-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(350);
  const landscapeTopbar = await page.locator('#world-topbar').boundingBox();
  const landscapeFrame = await page.locator('.world-frame').boundingBox();
  if (!landscapeTopbar || !landscapeFrame || landscapeTopbar.width < landscapeFrame.width - 30) throw new Error('手機橫向頂部資訊卡未占滿橫幅');
  await page.screenshot({ path: `${outputDir}/garden-mobile-landscape.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  if (await page.locator('#zoom-in, #zoom-out, .mobile-zoom-controls').count() !== 0) throw new Error('手機版仍顯示場景＋／−縮放按鈕');
  const mainViewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  if (!mainViewport?.includes('user-scalable=no') || !mainViewport.includes('maximum-scale=1')) throw new Error('主畫面 viewport 未限制瀏覽器頁面縮放');
  await page.screenshot({ path: `${outputDir}/garden-mobile.png`, fullPage: true });
  const mobileFrameBox = await page.locator('.world-frame').boundingBox();
  const mobileWheelOpened = await page.evaluate(({ x, y }) => window.gardenMenuWheel.openAt(x, y, 91), {
    x: mobileFrameBox.x + mobileFrameBox.width / 2,
    y: mobileFrameBox.y + mobileFrameBox.height / 2,
  });
  if (!mobileWheelOpened) throw new Error('手機版無法開啟快捷輪盤以進行圖示驗收');
  const mobileWheelIcons = await page.locator('#garden-menu-wheel .wheel-icon-overlay').evaluateAll(nodes => nodes.map(node => {
    const image = node.querySelector('img'), rect = image.getBoundingClientRect();
    const wheel = document.querySelector('#garden-menu-wheel').getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - (wheel.left + wheel.width / 2);
    const dy = rect.top + rect.height / 2 - (wheel.top + wheel.height / 2);
    return { action: node.dataset.wheelIcon, src: image.getAttribute('src'), width: parseFloat(getComputedStyle(image).width), height: parseFloat(getComputedStyle(image).height), radius: Math.hypot(dx, dy), loaded: image.complete && image.naturalWidth > 0 };
  }));
  if (mobileWheelIcons.length !== 6 || mobileWheelIcons.some(icon => icon.width !== 32 || icon.height !== 32 || Math.abs(icon.radius - 100) > 2 || !icon.loaded)
    || mobileWheelIcons.find(icon => icon.action === 'rotate')?.src !== 'assets/btn/旋轉.png') {
    throw new Error('手機版六個圖示需為32px並沿圓環外側定位，旋轉入口使用指定素材：' + JSON.stringify(mobileWheelIcons));
  }
  await page.screenshot({ path: `${outputDir}/garden-wheel-mobile.png`, fullPage: true });
  await page.keyboard.press('Escape');
  if (await page.locator('#garden-menu-wheel').isVisible()) throw new Error('手機版快捷輪盤無法透過 Escape 關閉');
  checks.push('任務222：手機版六個圖示為32px，徑向距離100px且素材載入正常；旋轉入口使用指定素材，輪盤可正常關閉');
  await page.locator('#farm-management-toggle').click();
  await page.locator('[data-plot-button="0"]').click();
  const deleteButtonBounds = await page.locator('#farm-dialog [data-delete-plot]').boundingBox();
  const dialogBounds = await page.locator('#farm-dialog').boundingBox();
  if (!deleteButtonBounds || !dialogBounds || deleteButtonBounds.y + deleteButtonBounds.height > 844 || await page.locator('#farm-dialog').evaluate(dialog => dialog.scrollHeight > dialog.clientHeight + 2)) {
    throw new Error('手機直向選種介面仍需要捲動才能看見刪除地塊按鈕');
  }
  await page.locator('[data-close-farm-dialog]').click();
  await page.locator('#farm-management-close').click();
  checks.push('桌面版、手機直向與橫向版截圖及手機免捲動刪除按鈕檢查完成');

  const touchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await touchPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  const touchCanvas = await touchPage.locator('#sky-canvas').boundingBox();
  if (!touchCanvas) throw new Error('無法取得手機觸控畫布位置');
  const touchX = Math.round(touchCanvas.x + touchCanvas.width * 0.5);
  const touchY = Math.round(touchCanvas.y + touchCanvas.height * 0.5);
  const environmentCheck = await touchPage.evaluate(() => {
    const at = worldTimeMs => window.skyEnvironment.getState({ worldTimeMs, worldTimeAnchor: 0 }, 0);
    return {
      dawnStart: at(0).daylightProgress,
      dawnHalf: at(30000).daylightProgress,
      dawnEnd: at(60000).daylightProgress,
      duskHalf: at(630000).daylightProgress,
      nightStart: at(660000).daylightProgress,
      rainBefore: at(475000).rainBlend,
      rainMid: at(477000).rainBlend,
      rainStart: at(480000).rainBlend,
      rainEndStart: at(595000).rainBlend,
      rainEndMid: at(597000).rainBlend,
      clearStart: at(600000).rainBlend,
      logicalRainBefore: at(477000).isRaining,
      logicalRainStart: at(480000).isRaining,
      logicalRainEnd: at(600000).isRaining,
    };
  });
  if (environmentCheck.dawnStart !== 0 || environmentCheck.dawnHalf !== 0.5 || environmentCheck.dawnEnd !== 1
    || environmentCheck.duskHalf !== 0.5 || environmentCheck.nightStart !== 0) throw new Error('日夜漸變未依每秒線性進度計算：' + JSON.stringify(environmentCheck));
  if (environmentCheck.rainBefore !== 0 || Math.abs(environmentCheck.rainMid - 0.4) > 0.001 || environmentCheck.rainStart !== 1
    || environmentCheck.rainEndStart !== 1 || Math.abs(environmentCheck.rainEndMid - 0.6) > 0.001 || environmentCheck.clearStart !== 0
    || environmentCheck.logicalRainBefore !== false || environmentCheck.logicalRainStart !== true || environmentCheck.logicalRainEnd !== false) throw new Error('晴雨視覺漸變應只在交替前五秒且不應提前改變遊戲天氣狀態：' + JSON.stringify(environmentCheck));
  checks.push('日夜漸變每秒線性進度、晴雨交替前 5 秒視覺過渡通過');
  await touchPage.evaluate(() => {
    window.__touchPointerEvents = [];
    ['pointerdown', 'pointerup', 'pointercancel', 'pointermove'].forEach(type => {
      document.addEventListener(type, event => window.__touchPointerEvents.push({
        type, pointerId: event.pointerId, pointerType: event.pointerType,
        x: event.clientX, y: event.clientY, target: event.target?.id || event.target?.className || event.target?.tagName,
      }), true);
    });
  });
  // Isolate hold-ring animation from the separate 500ms empty-scene menu gesture.
  // The radial menu has its own coverage; opening it would intentionally remove this ring.
  await touchPage.evaluate(() => {
    if (window.gardenMenuWheel) window.gardenMenuWheel.openAt = () => false;
  });
  const cdp = await touchPage.context().newCDPSession(touchPage);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY, id: 1 }] });
  await touchPage.waitForTimeout(100);
  const touchState = await touchPage.evaluate(() => ({
    ringExists: Boolean(document.querySelector('.touch-hold-ring')),
    events: window.__touchPointerEvents,
    activePointers: document.querySelectorAll('.touch-feedback-layer .touch-hold-ring').length,
  }));
  if (!touchState.ringExists) throw new Error('單指觸控後長按環被提前移除：' + JSON.stringify(touchState));
  const touchRing = touchPage.locator('.touch-hold-ring');
  const ringInitialState = await touchPage.evaluate(() => {
    const ring = document.querySelector('.touch-hold-ring');
    return { exists: Boolean(ring), visibility: ring ? getComputedStyle(ring).visibility : null, events: window.__touchPointerEvents };
  });
  if (!ringInitialState.exists || ringInitialState.visibility !== 'hidden') throw new Error('手機長按環應在前200ms存在但隱藏：' + JSON.stringify(ringInitialState));
  await touchPage.waitForTimeout(120);
  const ringRevealState = await touchPage.evaluate(() => {
    const ring = document.querySelector('.touch-hold-ring');
    return { exists: Boolean(ring), visibility: ring ? getComputedStyle(ring).visibility : null, events: window.__touchPointerEvents };
  });
  if (!ringRevealState.exists || ringRevealState.visibility !== 'visible') throw new Error('手機長按環在按下200ms後未保持顯示：' + JSON.stringify(ringRevealState));
  await touchPage.waitForTimeout(420);
  const ringGeometry = await touchPage.evaluate(() => {
    const element = document.querySelector('.touch-hold-ring');
    if (!element) return { missing: true, events: window.__touchPointerEvents };
    const image = element.querySelector('.touch-hold-wreath');
    const style = getComputedStyle(element);
    const imageStyle = image && getComputedStyle(image);
    return { imageSrc: image?.getAttribute('src'), imageWidth: imageStyle?.width, ringTransform: style.transform, animationDuration: style.animationDuration, animationDelay: style.animationDelay };
  });
  if (ringGeometry.missing) throw new Error('手機長按環在動畫驗收前被移除：' + JSON.stringify(ringGeometry));
  if (ringGeometry.imageSrc !== 'assets/wreath.webp' || ringGeometry.imageWidth !== '46px' || ringGeometry.animationDuration !== '0.5s' || ringGeometry.animationDelay !== '0.2s') throw new Error(`花草環素材或動畫時序錯誤：${JSON.stringify(ringGeometry)}`);
  const riseMatrix = ringGeometry.ringTransform.match(/matrix\(([^)]+)\)/);
  if (!riseMatrix || Math.abs(Number(riseMatrix[1].split(',')[5]) + (60 + 50)) > 1) throw new Error(`花草環未上升50px：${ringGeometry.ringTransform}`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX + 28, y: touchY + 12, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchPage.waitForTimeout(50);
  const feedbackDot = touchPage.locator('.touch-feedback-dot').first();
  if (await touchPage.locator('.touch-feedback-dot').count() !== 1) throw new Error('觸控放開後未顯示點擊位置回饋');
  const dotStyle = await feedbackDot.evaluate(element => ({ width: getComputedStyle(element).width, height: getComputedStyle(element).height, background: getComputedStyle(element).backgroundImage, opacity: getComputedStyle(element).opacity, animationDuration: getComputedStyle(element).animationDuration }));
  if (dotStyle.width !== '76px' || dotStyle.height !== '76px' || !dotStyle.background.includes('radial-gradient') || !dotStyle.background.includes('0.3') || dotStyle.animationDuration !== '0.5s') throw new Error('點擊位置回饋的 30% 中心、邊緣透明漸層、大小或淡出時間錯誤：' + JSON.stringify(dotStyle));
  await touchPage.waitForTimeout(520);
  if (await touchPage.locator('.touch-feedback-dot').count() !== 0) throw new Error('藍色回饋點沒有在 500ms 後消失');
  const multiPoints = [
    { x: touchX + 18, y: touchY - 20, id: 2 },
    { x: touchX + 66, y: touchY - 20, id: 3 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: multiPoints });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchPage.waitForTimeout(50);
  if (await touchPage.locator('.touch-feedback-dot').count() !== 2) throw new Error('多指觸控放開後沒有各自顯示藍色回饋點');
  await touchPage.close();
  const worldSource = await fs.readFile('src/sky-world.js', 'utf8');
  if (!worldSource.includes("heightEdit?.kind === 'plot' && heightEdit.index === pressedPlot && heightEdit.mode === 'move'") || !worldSource.includes("wreath.src = 'assets/wreath.webp';") || worldSource.includes('touch-hold-progress')) throw new Error('移動模式即時拖曳或花草環素材實作不符');
  if (!worldSource.includes('plotWasInMoveModeAtPointerDown') || !worldSource.includes('!plotWasInMoveModeAtPointerDown')) throw new Error('地塊移動模式短按切換高度模式的修正未包含');
  if (!worldSource.includes('rotateHoldGesture') || worldSource.includes('rotateTouchGesture') || !worldSource.includes('if (pointerPlotIndex === null && dockHitAtPointer === null)')) throw new Error('PC 與手機的相機手勢尚未統一');
  if (!worldSource.includes('window.gardenMenuWheel?.openAt?.(pointerStartX, pointerStartY, pressPointerId)') || !indexHtml.includes("data-wheel-action=\"drone\"")) throw new Error('空白場景長按未連接五項快捷輪盤');
  if (!worldSource.includes("wreath.src = 'assets/wreath.webp';") || !worldSource.includes("className = 'touch-hold-wreath'")) throw new Error('長按花草環未使用 assets 內的透明圖片素材');
  const styleSource = await fs.readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  if (!styleSource.includes('@keyframes touch-ring-rise{') || !styleSource.includes('translateY(-50px) scale(.72)') || !styleSource.includes('.touch-hold-ring{animation:touch-ring-rise') || !styleSource.includes('width:46px;height:46px')) throw new Error('花草環圖片的上升、停留、放大復原動畫未設定');
  checks.push('白色花草圓環無進度條：上升50px、停留0.2秒並於0.1秒放大復原');
  if (!worldSource.includes("heightEdit?.kind === 'dock' && heightEdit.index === pressedDock && heightEdit.mode === 'move'") || !worldSource.includes('screenToGround(pointerStartX, pointerStartY, 1.36 + getDockHeight(pressedDock))')) throw new Error('無人機坪台移動模式未支援直接拖曳或未使用坪台高度平面');
  if (worldSource.includes('if (dragPreview && Number.isInteger(dragPreview.index))')) throw new Error('拖曳預覽仍保留重複十字箭頭');
  checks.push('手機花草環圖片載入、上升50px、停留0.2秒、放大復原及放開回饋點通過');
  checks.push('地塊短按可由移動模式切換高度模式；PC 與手機相機手勢共用');

  const maturePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  maturePage.on('pageerror', error => errors.push(`mature pageerror: ${error.message}`));
  maturePage.on('console', message => { if (message.type() === 'error') errors.push(`mature console: ${message.text()}`); });
  await maturePage.addInitScript(() => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    const now = Date.now();
    const dockPosition = { x: 0, z: 1.55, y: 0 };
    localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify({
      coins: 120, cropCatalogVersion: 4, gardenName: '成熟植物測試', hudCollapsed: false, autoMode: false,
      autoCropSelection: [0], flowerVariants: [], worldTimeMs: 60000, worldTimeAnchor: now,
      lastObservedRaining: false, droneCount: 1, deploymentSequence: 1, lastOnlineAt: null,
      lastOfflineReturnAt: null, dockPosition,
      drones: [{ dockPosition, deployed: true, deploymentOrder: 1, battery: 100, batteryUpdatedAt: now }],
      plots: [
        { crop: 3, plantedAt: now, manual: false, grassOnly: false, x: -1, z: 0, y: 0, plantHeight: 1, watered: false },
        { crop: 3, plantedAt: now, manual: false, grassOnly: false, x: 0, z: 0, y: 0, plantHeight: 1, watered: false },
        { crop: 0, plantedAt: 1, manual: true, grassOnly: false, x: 1, z: 0, y: 0, plantHeight: 1, watered: false }
      ]
    }));
  });
  await maturePage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  if (!(await maturePage.locator('#garden-avatar img').getAttribute('src')).endsWith('玫瑰.png')) throw new Error('舊存檔未預設為自動頭像，或未依種植數量最多的花種顯示點陣圖');
  await maturePage.locator('#farm-management-toggle').click();
  const manualModesBeforeTabs = await maturePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')).plots.map(plot => plot.manual === true));
  await maturePage.locator('#farm-tab-manual').click();
  const mobileManualTab = await maturePage.evaluate(() => ({
    selected: document.querySelector('#farm-tab-manual').getAttribute('aria-selected'),
    columns: getComputedStyle(document.querySelector('#plot-selector')).gridTemplateColumns.trim().split(/\s+/).length,
    labels: [...document.querySelectorAll('#plot-selector [data-plot-button]')].map(button => button.getAttribute('aria-label')),
    bounds: [...document.querySelectorAll('#plot-selector [data-plot-button]')].map(button => {
      const rect = button.getBoundingClientRect();
      const panel = document.querySelector('#farm-management-panel').getBoundingClientRect();
      return { left: rect.left, right: rect.right, panelLeft: panel.left, panelRight: panel.right };
    }),
  }));
  if (mobileManualTab.selected !== 'true' || mobileManualTab.columns !== 3 || mobileManualTab.labels.length !== 1
    || mobileManualTab.labels.some(label => !label.startsWith('手動地塊 '))
    || mobileManualTab.bounds.some(rect => rect.left < rect.panelLeft || rect.right > rect.panelRight)) {
    throw new Error('手機手動地塊分頁分類、三欄網格或邊界不正確：' + JSON.stringify(mobileManualTab));
  }
  await maturePage.locator('#farm-tab-auto').click();
  const mobileAutoTab = await maturePage.locator('#plot-selector [data-plot-button]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
  if (await maturePage.locator('#farm-tab-auto').getAttribute('aria-selected') !== 'true'
    || mobileAutoTab.length !== 2 || mobileAutoTab.some(label => !label.startsWith('自動地塊 '))) throw new Error('手機自動地塊分頁沒有正確分類');
  const manualModesAfterTabs = await maturePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')).plots.map(plot => plot.manual === true));
  if (JSON.stringify(manualModesBeforeTabs) !== JSON.stringify(manualModesAfterTabs)) throw new Error('切換農地分頁改動了存檔內的手動／自動地塊分類');
  checks.push('任務218：桌面五欄、手機三欄，手動／自動地塊正確分類且不改存檔');
  await maturePage.evaluate(() => window.onSkyPlotActivate?.(2));
  const matureSwitch = maturePage.locator('#farm-dialog [data-plot-mode-switch]');
  if (!(await matureSwitch.isEnabled())) throw new Error('成熟植物所在手動地塊不能切換為草地');
  await matureSwitch.click();
  if (!(await maturePage.locator('#farm-dialog .manual-plant-card-heading strong').innerText()).includes('已成熟')) throw new Error('成熟植物轉成草地後沒有保留');
  if (await maturePage.locator('#farm-dialog [data-plot-mode-switch]').getAttribute('data-mode') !== 'grass') throw new Error('成熟植物所在地塊未切換為草地');
  checks.push('成熟植物可隨手動地塊切換成草地並保留');
  await maturePage.close();

  const immaturePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await immaturePage.addInitScript(() => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    const now = Date.now();
    const dockPosition = { x: 0, z: 1.55, y: 0 };
    localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify({
      coins: 120, cropCatalogVersion: 4, gardenName: '未成熟植物測試', autoMode: false, autoCropSelection: [0],
      worldTimeMs: 60000, worldTimeAnchor: now, lastObservedRaining: false, droneCount: 1,
      deploymentSequence: 1, dockPosition, drones: [{ dockPosition, deployed: true, deploymentOrder: 1, battery: 100, batteryUpdatedAt: now }],
      plots: [
        { crop: null, plantedAt: null, manual: false, grassOnly: false, x: -1, z: 0, y: 0 },
        { crop: null, plantedAt: null, manual: false, grassOnly: false, x: 0, z: 0, y: 0 },
        { crop: 0, plantedAt: now, manual: true, grassOnly: false, x: 1, z: 0, y: 0, plantHeight: 1, watered: false }
      ]
    }));
  });
  await immaturePage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await immaturePage.locator('#farm-management-toggle').click();
  await immaturePage.evaluate(() => window.onSkyPlotActivate?.(2));
  if (!(await immaturePage.locator('#farm-dialog [data-plot-mode-switch]').isDisabled())) throw new Error('未成熟植物所在手動地塊仍可切換成草地');
  checks.push('未成熟植物存在時禁止切換成草地');
  await immaturePage.close();

  const plotTabSave = (now = Date.now()) => ({
    coins: 5000, cropCatalogVersion: 4, gardenName: '地塊分頁測試', autoMode: false, autoCropSelection: [0],
    worldTimeMs: 60000, worldTimeAnchor: now, lastObservedRaining: false, droneCount: 1,
    deploymentSequence: 1, dockPosition: { x: 0, z: 2, y: 0 },
    drones: [{ dockPosition: { x: 0, z: 2, y: 0 }, deployed: true, deploymentOrder: 1, battery: 100, batteryUpdatedAt: now }],
    plots: [
      { crop: null, plantedAt: null, manual: false, grassOnly: false, x: -2, z: 0, y: 0 },
      { crop: null, plantedAt: null, manual: false, grassOnly: false, x: -1, z: 0, y: 0 },
      { crop: null, plantedAt: null, manual: false, grassOnly: false, x: 0, z: 0, y: 0 },
      { crop: null, plantedAt: null, manual: true, grassOnly: true, x: 1, z: 0, y: 0 },
      { crop: 0, plantedAt: now - 200000, manual: true, grassOnly: false, x: 2, z: 0, y: 0, plantHeight: 1, watered: false }
    ]
  });
  const plotTabsPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await plotTabsPage.addInitScript(save => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify(save));
  }, plotTabSave());
  await plotTabsPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await plotTabsPage.locator('#farm-management-toggle').click();
  const autoTab = plotTabsPage.locator('#farm-tab-auto');
  const manualTab = plotTabsPage.locator('#farm-tab-manual');
  if (await autoTab.getAttribute('aria-selected') !== 'true' || await plotTabsPage.locator('#plot-selector [data-plot-button]').count() !== 3) {
    throw new Error('任務218：預設自動地塊分頁未正確顯示三塊自動地');
  }
  const desktopPlotGrid = await plotTabsPage.locator('#plot-selector').evaluate(el => ({
    columns: getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
    overflowX: getComputedStyle(el).overflowX,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }));
  if (desktopPlotGrid.columns !== 5 || desktopPlotGrid.overflowX === 'visible' || desktopPlotGrid.scrollWidth > desktopPlotGrid.clientWidth + 1) {
    throw new Error('任務218：桌面地塊網格未維持五欄或出現水平溢出：' + JSON.stringify(desktopPlotGrid));
  }
  const plotsBeforeTabs = await plotTabsPage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')).plots.map(({ manual, x, z, crop }) => ({ manual, x, z, crop })));
  await manualTab.click();
  if (await manualTab.getAttribute('aria-selected') !== 'true' || await autoTab.getAttribute('aria-selected') !== 'false') throw new Error('任務218：手動地塊分頁的 aria-selected 狀態錯誤');
  const manualPlotIndexes = await plotTabsPage.locator('#plot-selector [data-plot-button]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.plotButton)));
  if (JSON.stringify(manualPlotIndexes) !== JSON.stringify([3, 4])) throw new Error('任務218：手動分頁顯示錯誤地塊：' + JSON.stringify(manualPlotIndexes));
  await autoTab.click();
  const autoPlotIndexes = await plotTabsPage.locator('#plot-selector [data-plot-button]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.plotButton)));
  if (JSON.stringify(autoPlotIndexes) !== JSON.stringify([0, 1, 2])) throw new Error('任務218：自動分頁顯示錯誤地塊：' + JSON.stringify(autoPlotIndexes));
  await plotTabsPage.evaluate(() => window.onSkyPlotSelect?.(3));
  await plotTabsPage.waitForFunction(() => document.querySelector('#farm-tab-manual')?.getAttribute('aria-selected') === 'true'
    && document.querySelector('#plot-selector [data-plot-button="3"]')?.getAttribute('aria-pressed') === 'true');
  await plotTabsPage.waitForTimeout(1100);
  const selectedGrassIndex = await plotTabsPage.locator('#plot-selector [data-plot-button].is-selected').getAttribute('data-plot-button');
  if (selectedGrassIndex !== '3' || await manualTab.getAttribute('aria-selected') !== 'true') {
    throw new Error('任務223：選取草地後被自動地塊1覆蓋：' + JSON.stringify({ selectedGrassIndex, tab: await manualTab.getAttribute('aria-selected') }));
  }
  await plotTabsPage.evaluate(() => window.onSkyPlotSelect?.(4));
  await plotTabsPage.waitForFunction(() => document.querySelector('#plot-selector [data-plot-button="4"]')?.getAttribute('aria-pressed') === 'true');
  await plotTabsPage.waitForTimeout(1100);
  const selectedManualIndex = await plotTabsPage.locator('#plot-selector [data-plot-button].is-selected').getAttribute('data-plot-button');
  if (selectedManualIndex !== '4' || await manualTab.getAttribute('aria-selected') !== 'true') {
    throw new Error('任務223：選取手動農地後被自動地塊1覆蓋：' + JSON.stringify({ selectedManualIndex, tab: await manualTab.getAttribute('aria-selected') }));
  }
  checks.push('任務223：草地與手動農地選取在週期重繪後仍保持正確');
  await autoTab.click();
  await plotTabsPage.evaluate(() => {
    window.onSkyEmptySelect?.();
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'sky-garden-guest-auto-crops-v1',
      newValue: '[0]'
    }));
  });
  await plotTabsPage.waitForTimeout(1100);
  const selectedPlotsAfterEmptyClick = await plotTabsPage.locator('#plot-selector [data-plot-button].is-selected').count();
  const pressedPlotsAfterEmptyClick = await plotTabsPage.locator('#plot-selector [data-plot-button][aria-pressed="true"]').count();
  if (selectedPlotsAfterEmptyClick !== 0 || pressedPlotsAfterEmptyClick !== 0) {
    throw new Error('任務223：取消場景地塊選取後，重新繪製又選取了自動地塊：' + JSON.stringify({ selectedPlotsAfterEmptyClick, pressedPlotsAfterEmptyClick }));
  }
  checks.push('任務223：取消場景選取後，週期重繪不會重新選取自動地塊1');
  const plotsAfterTabs = await plotTabsPage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')).plots.map(({ manual, x, z, crop }) => ({ manual, x, z, crop })));
  if (JSON.stringify(plotsAfterTabs) !== JSON.stringify(plotsBeforeTabs)) throw new Error('任務218：切換分頁改動了存檔地塊資料');
  checks.push('任務218：桌面手動／自動分頁分類、五欄網格與存檔不變通過');
  await plotTabsPage.close();

  // 任務228：多株手動地塊載入、獨立狀態、穩定株位與舊存檔遷移。
  const multiPlantSave = plotTabSave();
  const multiPlantNow = Date.now();
  multiPlantSave.plots[4] = {
    crop: 0, plantedAt: multiPlantNow - 200000, manual: true, grassOnly: false, x: 2, z: 0, y: 0,
    plantHeight: 1, watered: false, capacityLevel: 3, nextPlantPosition: 4,
    plants: [
      { crop: 0, plantedAt: multiPlantNow - 200000, plantHeight: 1, positionIndex: 1, watered: false, growthBonusMs: 0 },
      { crop: 1, plantedAt: multiPlantNow - 1000, plantHeight: 1, positionIndex: 2, watered: false, growthBonusMs: 0 },
      { crop: 2, plantedAt: multiPlantNow - 200000, plantHeight: 1, positionIndex: 3, watered: false, growthBonusMs: 0 },
    ],
  };
  const multiPlantPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await multiPlantPage.addInitScript(save => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify(save));
  }, multiPlantSave);
  await multiPlantPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  const placementResult = await multiPlantPage.evaluate(() => {
    const api = window.dianGardenManualPlantPlacement;
    if (!api) return null;
    const first = api.getPosition(1);
    const samples = Array.from({ length: 24 }, (_, index) => api.getPosition(index + 1));
    return {
      first, samples,
      repeatable: JSON.stringify(samples) === JSON.stringify(Array.from({ length: 24 }, (_, index) => api.getPosition(index + 1))),
    };
  });
  if (!placementResult || placementResult.first.x !== 0.5 || placementResult.first.z !== 0.5
    || !placementResult.repeatable
    || placementResult.samples.some(point => point.x < -0.25 || point.x > 1.25 || point.z < -0.25 || point.z > 1.25)
    || new Set(placementResult.samples.map(point => `${point.x.toFixed(4)},${point.z.toFixed(4)}`)).size !== placementResult.samples.length
    || !placementResult.samples.some(point => point.x < 0 || point.x > 1 || point.z < 0 || point.z > 1)) {
    throw new Error('任務228：手動地塊位置函數未符合置中、可重現、不重複及有限越界要求：' + JSON.stringify(placementResult));
  }
  await multiPlantPage.evaluate(() => window.onSkyPlotActivate?.(4));
  await multiPlantPage.locator('#farm-dialog[open] .manual-plant-card').first().waitFor({ state: 'visible', timeout: 8000 });
  const multiPlantCardCount = await multiPlantPage.locator('#farm-dialog .manual-plant-card').count();
  if (multiPlantCardCount !== 3) throw new Error(`任務228：預期顯示3株獨立花卉，實際為 ${multiPlantCardCount} 株`);
  const multiPlantSaveAfterLoad = await multiPlantPage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')));
  if (multiPlantSaveAfterLoad.plots[4].plants?.length !== 3 || multiPlantSaveAfterLoad.plots[4].capacityLevel !== 3) {
    throw new Error('任務228：多株資料或容量未在載入後保留');
  }
  const stablePositionsBeforeReload = multiPlantSaveAfterLoad.plots[4].plants.map(plant => plant.positionIndex);
  await multiPlantPage.reload({ waitUntil: 'networkidle', timeout: 30000 });
  const stablePositionsAfterReload = await multiPlantPage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')).plots[4].plants.map(plant => plant.positionIndex));
  if (JSON.stringify(stablePositionsBeforeReload) !== JSON.stringify(stablePositionsAfterReload)) {
    throw new Error('任務228：重新載入後株位索引發生變化');
  }
  await multiPlantPage.evaluate(() => window.onSkyPlotActivate?.(4));
  const maturePlantActions = await multiPlantPage.locator('#farm-dialog .manual-plant-actions .harvest').count();
  const growingPlantActions = await multiPlantPage.locator('#farm-dialog .manual-plant-actions .water').count();
  if (maturePlantActions !== 2 || growingPlantActions !== 1) {
    throw new Error(`任務228：各株成熟／生長狀態未獨立計算：${JSON.stringify({ maturePlantActions, growingPlantActions })}`);
  }
  await multiPlantPage.locator('#farm-dialog .manual-plant-actions .harvest').first().click();
  const remainingPlantsAfterHarvest = await multiPlantPage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')).plots[4].plants);
  if (remainingPlantsAfterHarvest.length !== 2 || JSON.stringify(remainingPlantsAfterHarvest.map(plant => plant.positionIndex)) !== JSON.stringify([2, 3])) {
    throw new Error('任務228：收成單株時影響其他花株或重排其株位');
  }
  checks.push('任務228：手動地塊多株獨立生長與收成、穩定不規則座標、有限越界及重載持久性通過');
  await multiPlantPage.close();

  const legacyPlantPage = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  await legacyPlantPage.addInitScript(save => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify(save));
  }, plotTabSave());
  await legacyPlantPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await legacyPlantPage.evaluate(() => window.onSkyPlotActivate?.(4));
  await legacyPlantPage.locator('#farm-dialog[open] .manual-plant-card-heading strong').waitFor({ state: 'visible', timeout: 8000 });
  const migratedLegacyPlantTitle = await legacyPlantPage.locator('#farm-dialog .manual-plant-card-heading strong').innerText();
  if (!migratedLegacyPlantTitle.includes('向日葵') || !migratedLegacyPlantTitle.includes('已成熟')) {
    throw new Error('任務228：舊版單株手動地塊存檔遷移未保留花種或成熟狀態：' + migratedLegacyPlantTitle);
  }
  checks.push('任務228：舊版單株手動地塊存檔自動遷移通過');
  await legacyPlantPage.close();

  // 任務229：容量升級價格、付款、容量限制、存檔與自動地塊隔離。
  const upgradeSave = plotTabSave();
  upgradeSave.coins = 5000;
  upgradeSave.plots[3] = {
    crop: null, plantedAt: null, manual: true, grassOnly: false, x: 1, z: 0, y: 0,
    capacityLevel: 1, nextPlantPosition: 1, plants: [],
  };
  const manualUpgradePage = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  await manualUpgradePage.addInitScript(save => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    // addInitScript 也會在 reload 時執行；只初始化空存檔，避免覆寫升級後的實際進度。
    if (!localStorage.getItem('sky-garden-guest-save-v1')) {
      localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify(save));
    }
  }, upgradeSave);
  await manualUpgradePage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await manualUpgradePage.evaluate(() => window.onSkyPlotActivate?.(0));
  if (await manualUpgradePage.locator('#farm-dialog [data-upgrade-manual-plot]').count() !== 0) {
    throw new Error('任務229：自動地塊不應出現手動容量升級按鈕');
  }
  await manualUpgradePage.evaluate(() => window.onSkyPlotActivate?.(3));
  const upgradeButton = manualUpgradePage.locator('#farm-dialog [data-upgrade-manual-plot]');
  await upgradeButton.waitFor({ state: 'visible', timeout: 8000 });
  const upgradeCosts = [];
  for (const expectedCost of [40, 106, 186]) {
    const buttonText = await manualUpgradePage.locator('#farm-dialog [data-upgrade-manual-plot]').innerText();
    if (!buttonText.includes(String(expectedCost))) throw new Error(`任務229：容量等級升級費用不符，預期 ${expectedCost}，實際 ${buttonText}`);
    upgradeCosts.push(expectedCost);
    await manualUpgradePage.locator('#farm-dialog [data-upgrade-manual-plot]').click();
  }
  const afterThreeUpgrades = await manualUpgradePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')));
  if (afterThreeUpgrades.plots[3].capacityLevel !== 4 || afterThreeUpgrades.coins !== 4668) {
    throw new Error('任務229：連續升級三次後容量或扣款錯誤：' + JSON.stringify({ level: afterThreeUpgrades.plots[3].capacityLevel, coins: afterThreeUpgrades.coins }));
  }
  await manualUpgradePage.locator('#farm-dialog .seed-option').first().click();
  await manualUpgradePage.evaluate(() => window.onSkyPlotActivate?.(3));
  for (let index = 0; index < 3; index += 1) {
    await manualUpgradePage.locator('#farm-dialog [data-manual-seed-options] .seed-option').first().click();
  }
  const fullCapacity = await manualUpgradePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')).plots[3]);
  // 關閉可能仍顯示舊內容的操作視窗，再開啟該地塊，確認最新的滿載狀態。
  await manualUpgradePage.evaluate(() => {
    const dialog = document.querySelector('#farm-dialog');
    if (dialog?.open) dialog.close();
    window.onSkyPlotActivate?.(3);
  });
  await manualUpgradePage.locator('#farm-dialog[open] .manual-plant-card').first().waitFor({ state: 'visible', timeout: 8000 });
  const visiblePlantCardsAtCapacity = await manualUpgradePage.locator('#farm-dialog .manual-plant-card').count();
  const fullCapacityHeading = await manualUpgradePage.locator('#farm-dialog .manual-seed-heading').innerText();
  const seedOptionsAtCapacity = await manualUpgradePage.locator('#farm-dialog [data-manual-seed-options] .seed-option').count();
  if (fullCapacity.plants.length !== 4 || visiblePlantCardsAtCapacity !== 4 || seedOptionsAtCapacity !== 0 || !fullCapacityHeading.includes('名額已滿')) {
    throw new Error('任務229：容量滿載後仍可新增花株，或容量限制不正確：' + JSON.stringify({
      plantCount: fullCapacity.plants?.length,
      capacityLevel: fullCapacity.capacityLevel,
      visiblePlantCardsAtCapacity,
      seedOptionsAtCapacity,
      fullCapacityHeading,
      dialogOpen: await manualUpgradePage.locator('#farm-dialog').evaluate(dialog => dialog.open),
      dialogTitle: await manualUpgradePage.locator('#farm-dialog [data-manual-seed-options]').evaluate(el => el.parentElement?.innerText),
      coins: (await manualUpgradePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')))).coins,
    }));
  }
  checks.push('任務229：升級價格40／106／186、連續付款、容量滿載限制、自動地塊隔離與重載持久性通過');
  await manualUpgradePage.reload({ waitUntil: 'networkidle', timeout: 30000 });
  const persistedUpgrade = await manualUpgradePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')).plots[3]);
  if (persistedUpgrade.capacityLevel !== 4 || persistedUpgrade.plants.length !== 4) {
    throw new Error('任務229：升級等級／容量在重新載入後未保留：' + JSON.stringify({
      capacityLevel: persistedUpgrade.capacityLevel,
      plantCount: persistedUpgrade.plants?.length,
      crop: persistedUpgrade.crop,
      plantedAt: persistedUpgrade.plantedAt,
      manual: persistedUpgrade.manual,
      grassOnly: persistedUpgrade.grassOnly,
      saveCoins: (await manualUpgradePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')))).coins,
    }));
  }
  checks.push('任務229：升級價格40／106／186、連續付款、容量滿載限制、自動地塊隔離與重載持久性通過');
  await manualUpgradePage.close();

  const insufficientUpgradeSave = plotTabSave();
  insufficientUpgradeSave.coins = 39;
  insufficientUpgradeSave.plots[3] = {
    crop: null, plantedAt: null, manual: true, grassOnly: false, x: 1, z: 0, y: 0,
    capacityLevel: 1, nextPlantPosition: 1, plants: [],
  };
  const insufficientUpgradePage = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  await insufficientUpgradePage.addInitScript(save => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify(save));
  }, insufficientUpgradeSave);
  await insufficientUpgradePage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await insufficientUpgradePage.evaluate(() => window.onSkyPlotActivate?.(3));
  const unaffordableUpgrade = insufficientUpgradePage.locator('#farm-dialog [data-upgrade-manual-plot]');
  await unaffordableUpgrade.waitFor({ state: 'visible', timeout: 8000 });
  if (!(await unaffordableUpgrade.isDisabled())) throw new Error('任務229：金幣不足時升級按鈕仍可操作');
  const insufficientState = await insufficientUpgradePage.evaluate(() => JSON.parse(localStorage.getItem('sky-garden-guest-save-v1')));
  if (insufficientState.coins !== 39 || insufficientState.plots[3].capacityLevel !== 1) {
    throw new Error('任務229：金幣不足時仍扣款或升級');
  }
  checks.push('任務229：金幣不足時不扣款、不升級且按鈕停用');
  await insufficientUpgradePage.close();

  const mobilePlotTabsPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await mobilePlotTabsPage.addInitScript(save => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    localStorage.setItem('sky-garden-guest-save-v1', JSON.stringify(save));
  }, plotTabSave());
  await mobilePlotTabsPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await mobilePlotTabsPage.locator('#farm-management-toggle').click();
  await mobilePlotTabsPage.locator('#farm-tab-manual').click();
  const mobilePlotLayout = await mobilePlotTabsPage.locator('#plot-selector').evaluate(el => {
    const panel = el.getBoundingClientRect();
    const cards = [...el.querySelectorAll('[data-plot-button]')].map(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return { columns: getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length, panel: { left: panel.left, right: panel.right }, cards };
  });
  if (mobilePlotLayout.columns !== 3 || mobilePlotLayout.cards.length !== 2 || mobilePlotLayout.cards.some(rect => rect.left < mobilePlotLayout.panel.left - 1 || rect.right > mobilePlotLayout.panel.right + 1)) {
    throw new Error('任務218：手機地塊分頁未能正常排列或超出清單：' + JSON.stringify(mobilePlotLayout));
  }
  checks.push('任務218：手機手動／自動分頁可操作且地塊卡片不水平溢出通過');
  await mobilePlotTabsPage.close();

  await page.goto(`${baseURL}/encyclopedia.html`, { waitUntil: 'networkidle', timeout: 30000 });
  const galleryViewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  if (!galleryViewport?.includes('user-scalable=no') || !galleryViewport.includes('maximum-scale=1')) throw new Error('花卉圖鑑 viewport 未限制瀏覽器頁面縮放');
  await page.locator('.encyclopedia-card').first().waitFor({ state: 'visible' });
  const cardCount = await page.locator('.encyclopedia-card').count();
  if (cardCount !== 11) throw new Error(`花卉圖鑑應有 11 種花卉，實際為 ${cardCount} 種`);
  checks.push('花卉圖鑑 11 種花卉資料均已載入');
  const flowerImages = await page.locator('.encyclopedia-card img.flower-pixel-icon').evaluateAll(images => images.map(image => ({
    src: image.getAttribute('src'),
    loaded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
    width: Number.parseFloat(getComputedStyle(image).width),
    height: Number.parseFloat(getComputedStyle(image).height),
  })));
  if (flowerImages.length !== 11 || flowerImages.some(image => !image.loaded || image.width !== 32 || image.height !== 32)) {
    throw new Error(`花卉像素圖未全部載入或顯示尺寸不是 32×32：${JSON.stringify(flowerImages)}`);
  }
  checks.push('11 種花卉圖鑑像素圖均成功載入並以 32×32 顯示');

  await page.setViewportSize({ width: 1440, height: 1000 });
  const galleryCanvas = page.locator('#sky-canvas');
  const galleryWebgl = await galleryCanvas.evaluate(canvas => Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  if (!galleryWebgl) throw new Error('花卉圖鑑的 WebGL 畫布未能建立');

  const flowerNames = await page.evaluate(() => window.flowerCatalog.map(flower => flower.name));
  for (let index = 0; index < flowerNames.length; index += 1) {
    const flowerName = flowerNames[index];
    const card = page.locator(`.encyclopedia-card[data-flower-index="${index}"]`);
    await card.locator('.encyclopedia-card-select').click();
    await page.waitForFunction(name => document.querySelector('#selected-flower-status')?.textContent?.includes(name), flowerName);
    await page.waitForTimeout(350);

    const prefix = `flower-${String(index).padStart(2, '0')}`;
    await galleryCanvas.screenshot({ path: `${outputDir}/${prefix}-canvas.png` });
    await page.screenshot({ path: `${outputDir}/${prefix}-gallery.png`, fullPage: true });
    checks.push(`${flowerName}（索引 ${index}）可選取並產生模型截圖`);
  }

  const fullscreenButton = page.locator('#preview-fullscreen-toggle');
  if (!(await fullscreenButton.isVisible())) throw new Error('圖鑑預覽右下角沒有全螢幕按鈕');
  await fullscreenButton.click();
  await page.waitForFunction(() => {
    const preview = document.querySelector('.encyclopedia-world');
    return document.fullscreenElement === preview || preview?.classList.contains('is-preview-expanded');
  }, null, { timeout: 5000 });
  const fullscreenState = await page.evaluate(() => {
    const preview = document.querySelector('.encyclopedia-world');
    const button = document.querySelector('#preview-fullscreen-toggle');
    const rect = preview.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      active: document.fullscreenElement === preview || preview.classList.contains('is-preview-expanded'),
      pressed: button.getAttribute('aria-pressed'),
      previewBounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      buttonRightGap: window.innerWidth - buttonRect.right,
      buttonBottomGap: window.innerHeight - buttonRect.bottom,
    };
  });
  if (!fullscreenState.active || fullscreenState.pressed !== 'true'
    || fullscreenState.previewBounds.x > 1 || fullscreenState.previewBounds.y > 1
    || fullscreenState.previewBounds.width < 1438 || fullscreenState.previewBounds.height < 998
    || Math.abs(fullscreenState.buttonRightGap - 12) > 2 || Math.abs(fullscreenState.buttonBottomGap - 12) > 2) {
    throw new Error('圖鑑預覽全螢幕範圍或右下角退出按鈕位置不正確：' + JSON.stringify(fullscreenState));
  }
  await fullscreenButton.click();
  await page.waitForFunction(() => {
    const preview = document.querySelector('.encyclopedia-world');
    return document.fullscreenElement !== preview && !preview?.classList.contains('is-preview-expanded');
  }, null, { timeout: 5000 });
  checks.push('任務217：桌面圖鑑預覽可進入／退出全螢幕，控制位於右下角');

  const mobileGalleryPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await mobileGalleryPage.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.reject(new Error('測試全螢幕 API fallback')),
    });
  });
  await mobileGalleryPage.goto(`${baseURL}/encyclopedia.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await mobileGalleryPage.locator('.encyclopedia-card').first().waitFor({ state: 'visible' });
  await mobileGalleryPage.locator('#preview-fullscreen-toggle').click();
  const fallbackFullscreen = await mobileGalleryPage.evaluate(() => {
    const preview = document.querySelector('.encyclopedia-world');
    const rect = preview.getBoundingClientRect();
    return {
      active: preview.classList.contains('is-preview-expanded'),
      pressed: document.querySelector('#preview-fullscreen-toggle').getAttribute('aria-pressed'),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  if (!fallbackFullscreen.active || fallbackFullscreen.pressed !== 'true'
    || fallbackFullscreen.bounds.x !== 0 || fallbackFullscreen.bounds.y !== 0
    || fallbackFullscreen.bounds.width < 388 || fallbackFullscreen.bounds.height < 842) {
    throw new Error('手機瀏覽器全螢幕 API 不可用時，替代全螢幕模式未填滿視窗：' + JSON.stringify(fallbackFullscreen));
  }
  await mobileGalleryPage.locator('#preview-fullscreen-toggle').click();
  if (await mobileGalleryPage.locator('.encyclopedia-world').evaluate(el => el.classList.contains('is-preview-expanded'))) throw new Error('手機替代全螢幕模式無法退出');
  await mobileGalleryPage.locator('#flower-picker-toggle').click();
  if (!(await mobileGalleryPage.locator('.encyclopedia-layout').evaluate(el => el.classList.contains('is-picker-expanded')))
    || await mobileGalleryPage.locator('#flower-picker-toggle').getAttribute('aria-expanded') !== 'true'
    || !(await mobileGalleryPage.locator('.encyclopedia-preview-column').isVisible())) throw new Error('手機點擊「選擇花種」標題後未展開選花面板');
  await mobileGalleryPage.locator('.encyclopedia-card[data-flower-index="1"] .encyclopedia-card-select').click();
  await mobileGalleryPage.waitForFunction(() => !document.querySelector('.encyclopedia-layout')?.classList.contains('is-picker-expanded')
    && document.querySelector('#selected-flower-status')?.textContent?.includes(window.flowerCatalog[1].name));
  if (await mobileGalleryPage.locator('#flower-picker-toggle').getAttribute('aria-expanded') !== 'false'
    || !(await mobileGalleryPage.locator('.encyclopedia-preview-column').isVisible())) throw new Error('手機選擇花種後未恢復預覽原排版');
  checks.push('任務226：手機可展開選花面板、API 失敗時可替代全螢幕，選花後恢復原排版');
  await mobileGalleryPage.close();

  const versionPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await versionPage.addInitScript(() => { localStorage.setItem('sky-garden-guest-mode-v1', 'true'); localStorage.setItem('diangarden-seen-version-v1', '000000, 001'); localStorage.setItem('diangarden-auto-update-v1', 'false'); });
  await versionPage.route('**/version.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: '261023, 002' }),
  }));
  await versionPage.route(url => url.pathname.endsWith('/build-version.js'), route => route.fulfill({ status: 200, contentType: 'application/javascript', body: "window.__DIANGARDEN_BUILD_VERSION__ = '000000, 001';" }));
  await versionPage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  const updateBanner = versionPage.locator('.diangarden-version-update');
  await updateBanner.waitFor({ state: 'visible', timeout: 5000 });
  if (!(await updateBanner.innerText()).includes('花園有新版本')) throw new Error('版本更新提示文字異常');
  await updateBanner.getByRole('button', { name: '稍後' }).click();
  if (await updateBanner.count() !== 0) throw new Error('版本更新提示的稍後按鈕未能關閉提示');
  checks.push('偵測到版本差異時顯示更新提示，稍後按鈕可延後處理');
  await versionPage.close();

  const forceUpdatePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await forceUpdatePage.addInitScript(() => { localStorage.setItem('sky-garden-guest-mode-v1', 'true'); localStorage.setItem('diangarden-auto-update-v1', 'false'); });
  const forceUpdateRequests = [];
  forceUpdatePage.on('request', request => {
    const url = new URL(request.url());
    if (/\.(js|css)$/i.test(url.pathname)) forceUpdateRequests.push({ path: url.pathname, search: url.search });
  });
  await forceUpdatePage.route(url => url.pathname.endsWith('/version.json'), route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ version: '261023, 002' }),
  }));
  const freshIndexHtml = await fs.readFile('src/index.html', 'utf8');
  await forceUpdatePage.route(url => url.pathname.endsWith('/index.html') && url.searchParams.has('__dg_update'), route => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: freshIndexHtml,
  }));
  await forceUpdatePage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await forceUpdatePage.locator('#settings-toggle').click();
  forceUpdateRequests.length = 0;
  await forceUpdatePage.locator('#force-update-button').click();
  await forceUpdatePage.waitForURL(url => url.searchParams.has('__dg_force_refresh'), { timeout: 10000 });
  await forceUpdatePage.waitForLoadState('domcontentloaded', { timeout: 10000 });
  await forceUpdatePage.locator('#sky-canvas').waitFor({ state: 'visible', timeout: 10000 });
  await forceUpdatePage.waitForTimeout(700);
  const coreResourcePaths = ['/game.js', '/version-check.js', '/styles.css'];
  for (const path of coreResourcePaths) {
    const request = forceUpdateRequests.find(item => item.path.endsWith(path));
    if (!request || !new URLSearchParams(request.search).has('v')) {
      throw new Error('立即更新後核心資源沒有使用部署版本參數：' + path + ' ' + JSON.stringify(forceUpdateRequests));
    }
  }
  if (await forceUpdatePage.evaluate(() => document.querySelectorAll('#sky-canvas').length) !== 1) {
    throw new Error('立即更新後頁面出現重複遊戲畫布');
  }
  checks.push('立即更新使用完整頁面導覽，重新初始化遊戲且只保留一個畫布');
  await forceUpdatePage.close();

  const autoUpdatePreferencePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await autoUpdatePreferencePage.addInitScript(() => localStorage.setItem('sky-garden-guest-mode-v1', 'true'));
  await autoUpdatePreferencePage.route('**/version.json*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ version: '261023, 002' }),
  }));
  await autoUpdatePreferencePage.route(url => url.pathname.endsWith('/build-version.js'), route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: "window.__DIANGARDEN_BUILD_VERSION__ = '261023, 002';",
  }));
  await autoUpdatePreferencePage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await autoUpdatePreferencePage.locator('#settings-toggle').click();
  const autoUpdateToggle = autoUpdatePreferencePage.locator('#auto-update-toggle');
  if (!(await autoUpdateToggle.isChecked())) throw new Error('自動更新預設應為開啟');
  const updateControlGeometry = await autoUpdatePreferencePage.evaluate(() => {
    const update = document.querySelector('#force-update-button').getBoundingClientRect();
    const toggle = document.querySelector('.auto-update-toggle').getBoundingClientRect();
    return { updateY: update.y, toggleY: toggle.y, updateRight: update.right, toggleX: toggle.x };
  });
  if (Math.abs(updateControlGeometry.updateY - updateControlGeometry.toggleY) > 2 || updateControlGeometry.toggleX < updateControlGeometry.updateRight) {
    throw new Error('自動更新開關沒有與立即更新按鈕並排：' + JSON.stringify(updateControlGeometry));
  }
  await autoUpdateToggle.uncheck();
  if (await autoUpdatePreferencePage.evaluate(() => localStorage.getItem('diangarden-auto-update-v1')) !== 'false') throw new Error('關閉自動更新後未保存偏好');
  await autoUpdatePreferencePage.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await autoUpdatePreferencePage.locator('#settings-toggle').click();
  if (await autoUpdatePreferencePage.locator('#auto-update-toggle').isChecked()) throw new Error('重新載入後自動更新偏好未被保留');
  checks.push('任務216：自動更新開關預設啟用、與立即更新並排且偏好可保存');
  await autoUpdatePreferencePage.close();

  const autoUpdatePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await autoUpdatePage.addInitScript(() => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    localStorage.setItem('diangarden-auto-update-v1', 'true');
  });
  await autoUpdatePage.route('**/version.json*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ version: '261023, 002' }),
  }));
  let buildVersionRequestCount = 0;
  await autoUpdatePage.route(url => url.pathname.endsWith('/build-version.js'), route => {
    buildVersionRequestCount += 1;
    const version = buildVersionRequestCount === 1 ? '000000, 001' : '261023, 002';
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: `window.__DIANGARDEN_BUILD_VERSION__ = '${version}';` });
  });
  await autoUpdatePage.route(url => url.pathname.endsWith('/index.html') && url.searchParams.has('__dg_update'), route => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: freshIndexHtml,
  }));
  await autoUpdatePage.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await autoUpdatePage.waitForURL(url => url.searchParams.has('__dg_force_refresh'), { timeout: 15000 });
  await autoUpdatePage.locator('#sky-canvas').waitFor({ state: 'visible', timeout: 10000 });
  await autoUpdatePage.waitForFunction(() => document.querySelector('#current-version')?.textContent === '261023, 002', null, { timeout: 10000 });
  if (buildVersionRequestCount < 2 || await autoUpdatePage.locator('.diangarden-version-update').count() !== 0) {
    throw new Error('偵測到新版本後未自動完整重新載入至最新版本：' + JSON.stringify({ buildVersionRequestCount, url: autoUpdatePage.url() }));
  }
  checks.push('任務216：啟用自動更新時偵測版本差異後自動完整重新載入');
  await autoUpdatePage.close();

  const versionFailurePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await versionFailurePage.addInitScript(() => {
    localStorage.setItem('sky-garden-guest-mode-v1', 'true');
    localStorage.setItem('diangarden-auto-update-v1', 'true');
  });
  await versionFailurePage.route('**/version.json*', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
  await versionFailurePage.goto(`${baseURL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await versionFailurePage.locator('#sky-canvas').waitFor({ state: 'visible', timeout: 10000 });
  checks.push('任務216：版本檢查失敗不會阻擋遊戲啟動');
  await versionFailurePage.close();

  if (errors.length) throw new Error(`瀏覽器發現錯誤：\n${errors.join('\n')}`);
  console.log(JSON.stringify({ result: 'PASS', checks, screenshots: [
    `${outputDir}/garden-desktop.png`,
    `${outputDir}/garden-mobile.png`,
    `${outputDir}/garden-mobile-landscape.png`,
    ...flowerNames.flatMap((_, index) => {
      const prefix = `flower-${String(index).padStart(2, '0')}`;
      return [`${outputDir}/${prefix}-canvas.png`, `${outputDir}/${prefix}-gallery.png`];
    }),
  ], browserErrors: errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${outputDir}/failure-page.png`, fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ result: 'FAIL', checks, error: error.stack || String(error), browserErrors: errors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
