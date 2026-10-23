import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.GARDEN_TEST_URL || 'http://127.0.0.1:4173';
const outputDir = 'test-results/screenshots';
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
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
  checks.push('遊戲首頁可正常開啟');

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
  const mouseRingStyle = await mouseRing.locator('.touch-hold-progress').evaluate(element => ({ width: Number.parseFloat(getComputedStyle(element.closest('.touch-hold-ring')).width), strokeWidth: Number.parseFloat(getComputedStyle(element).getPropertyValue('stroke-width')) }));
  if (mouseRingStyle.width !== 120 || mouseRingStyle.strokeWidth !== 6) throw new Error('PC 長按環尺寸或線寬錯誤：' + JSON.stringify(mouseRingStyle));
  await page.mouse.up();
  checks.push('PC 長按環延遲 200ms 顯示、尺寸 120px、線寬 6px');

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
  await page.locator('#hud-toggle').click();
  if (!(await page.locator('#hud-toggle').isVisible()) || await page.locator('#hud-toggle').textContent() !== '🔽') throw new Error('收合介面後沒有保留可復原的按鈕');
  await page.locator('#hud-toggle').click();
  if (await page.locator('#hud-toggle').textContent() !== '🔼') throw new Error('再次點擊收合按鈕未恢復介面');
  await page.locator('#drone-panel-toggle').click();
  if (await page.locator('#drone-panel-toggle').textContent() !== '🚁') throw new Error('無人機按鈕圖示異常，不應變成文字');
  await page.locator('#drone-panel-toggle').click();
  await page.locator('#settings-toggle').click();
  if (!(await page.locator('#settings-panel').isVisible())) throw new Error('設定按鈕未能開啟設定面板');
  if (!(await page.locator('.operation-help').isVisible())) throw new Error('操作說明未移至設定面板');
  if (!(await page.locator('#avatar-mode').isVisible())) throw new Error('設定中未顯示自訂頭像控制');
  for (const selector of ['#current-version', '#latest-version', '#force-update-button']) {
    if (!(await page.locator(selector).isVisible())) throw new Error('設定面板缺少版本資訊或立即更新按鈕：' + selector);
  }
  if ((await page.locator('#current-version').innerText()).trim() === '' || (await page.locator('#latest-version').innerText()).trim() === '') {
    throw new Error('設定面板版本號沒有顯示內容');
  }
  const displayedVersions = await page.evaluate(() => ({ current: document.querySelector('#current-version')?.textContent?.trim(), latest: document.querySelector('#latest-version')?.textContent?.trim() }));
  if (!/^[0-9]{6}, [0-9]{3,}$/.test(displayedVersions.current || '') || !/^[0-9]{6}, [0-9]{3,}$/.test(displayedVersions.latest || '')) {
    throw new Error('設定面板版本號未使用每日更新序號格式：' + JSON.stringify(displayedVersions));
  }
  checks.push('設定面板顯示目前版本、最新版本與立即更新按鈕，版本號符合每日更新序號格式');

  const settingsPanelSize = await page.locator('#settings-panel').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const versionCard = element.querySelector('.version-settings').getBoundingClientRect();
    const avatarOptions = [...element.querySelectorAll('.avatar-flower-option')];
    return {
      width: rect.width,
      padding: getComputedStyle(element).paddingTop,
      versionCardPadding: getComputedStyle(element.querySelector('.version-settings')).paddingTop,
      avatarOptionCount: avatarOptions.length,
      avatarOptionHeight: avatarOptions[0]?.getBoundingClientRect().height ?? 0,
      avatarTextLabelCount: element.querySelectorAll('.avatar-flower-name').length,
      avatarPickerLabelVisible: getComputedStyle(element.querySelector('.avatar-flower-label')).display !== 'none',
      avatarOptionContents: avatarOptions.map(option => ({ imageCount: option.querySelectorAll('.avatar-flower-image').length, text: option.textContent.trim() })),
      versionCardHeight: versionCard.height,
    };
  });
  if (settingsPanelSize.width > 240) throw new Error('設定面板未縮窄：' + JSON.stringify(settingsPanelSize));
  if (settingsPanelSize.avatarOptionCount !== 11 || settingsPanelSize.avatarOptionHeight > 30) throw new Error('頭像選擇器未壓縮或花種缺漏：' + JSON.stringify(settingsPanelSize));
  if (settingsPanelSize.avatarTextLabelCount !== 0 || settingsPanelSize.avatarPickerLabelVisible || settingsPanelSize.avatarOptionContents.some(option => option.imageCount !== 1 || option.text !== '')) throw new Error('頭像選擇器仍顯示文字或缺少純像素圖：' + JSON.stringify(settingsPanelSize));
  if (Number.parseFloat(settingsPanelSize.padding) > 9 || Number.parseFloat(settingsPanelSize.versionCardPadding) > 8) throw new Error('設定面板內距仍過大：' + JSON.stringify(settingsPanelSize));
  checks.push('設定面板寬度、內距、版本卡片與 11 種純像素圖頭像選擇器已精簡');

  if (await page.locator('#avatar-flower-picker').isVisible()) throw new Error('自動頭像模式未隱藏花卉選擇介面');
  const avatarOptions = page.locator('.avatar-flower-option');
  if (await avatarOptions.count() !== 11) throw new Error('頭像選擇清單未顯示 11 種花卉');
  const avatarImages = await page.locator('.avatar-flower-image').evaluateAll(images => images.map(image => ({ loaded: image.complete && image.naturalWidth > 0, pixelated: getComputedStyle(image).imageRendering === 'pixelated' })));
  if (avatarImages.length !== 11 || avatarImages.some(image => !image.loaded || !image.pixelated)) throw new Error('頭像選擇中的花卉點陣圖未全部載入或未使用 pixelated');
  await page.locator('#avatar-mode').selectOption('manual');
  if (!(await page.locator('#avatar-flower-picker').isVisible())) throw new Error('手動頭像模式未顯示花卉選擇介面');
  await page.locator('[data-avatar-crop="3"]').click();
  const avatarImage = page.locator('#garden-avatar img');
  if (!(await avatarImage.isVisible()) || !(await avatarImage.getAttribute('src')).endsWith('玫瑰.png') || await avatarImage.evaluate(image => getComputedStyle(image).imageRendering) !== 'pixelated' || await page.locator('[data-avatar-crop="3"]').getAttribute('aria-pressed') !== 'true') throw new Error('花園名稱左側頭像未顯示所選點陣圖素材');
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#settings-toggle').click();
  if (await page.locator('#avatar-mode').inputValue() !== 'manual' || await page.locator('#avatar-flower-picker').isHidden() || await page.locator('[data-avatar-crop="3"]').getAttribute('aria-pressed') !== 'true' || !(await page.locator('#garden-avatar img').getAttribute('src')).endsWith('玫瑰.png')) throw new Error('自訂花卉頭像未在重新載入後保存');
  await page.locator('#avatar-mode').selectOption('auto');
  if (await page.locator('#avatar-flower-picker').isVisible() || !(await page.locator('.avatar-flower-option').first().isDisabled())) throw new Error('自動頭像模式未隱藏或仍允許指定花種');
  checks.push('自訂頭像點陣圖、來源切換、選花介面顯示規則與存檔通過');
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
  await page.locator('[data-plot-button="0"]').click();
  if (await page.locator('#farm-dialog .plot-mode-switch').count() !== 0) throw new Error('自動地塊仍顯示地塊性質切換開關');
  await page.locator('[data-close-farm-dialog]').click();
  await page.locator('#world-buy-manual-plot').click();
  if (!(await page.locator('#farm-dialog').innerText()).includes('75')) throw new Error('手動地塊購買對話框未顯示固定 75 金幣價格');
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
  const touchX = Math.round(touchCanvas.x + 24);
  const touchY = Math.round(touchCanvas.y + touchCanvas.height * 0.72);
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
  const cdp = await touchPage.context().newCDPSession(touchPage);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY, id: 1 }] });
  await touchPage.waitForTimeout(100);
  const touchRing = touchPage.locator('.touch-hold-ring');
  if (await touchRing.count() !== 1) throw new Error('單指按下時未建立長按環形進度');
  if (await touchRing.evaluate(element => getComputedStyle(element).visibility) !== 'hidden') throw new Error('手機長按環未延遲 200ms 顯示');
  await touchPage.waitForTimeout(120);
  if (await touchRing.evaluate(element => getComputedStyle(element).visibility) !== 'visible') throw new Error('手機長按環在按下 200ms 後仍未顯示');
  await touchPage.waitForTimeout(330);
  const ringGeometry = await touchPage.locator('.touch-hold-progress').evaluate(element => ({
    radius: Number(element.getAttribute('r')),
    strokeWidth: Number.parseFloat(getComputedStyle(element).getPropertyValue('stroke-width')),
    stroke: getComputedStyle(element).stroke,
    strokeOpacity: Number.parseFloat(getComputedStyle(element).getPropertyValue('stroke-opacity')),
    viewBox: element.ownerSVGElement.getAttribute('viewBox'),
    width: Number.parseFloat(getComputedStyle(element.closest('.touch-hold-ring')).width),
    dashArray: Number.parseFloat(getComputedStyle(element).getPropertyValue('stroke-dasharray')),
    dashOffset: Number.parseFloat(getComputedStyle(element).getPropertyValue('stroke-dashoffset')),
    mask: getComputedStyle(element.ownerSVGElement).maskImage,
    trackCount: element.ownerSVGElement.querySelectorAll('.touch-hold-track').length,
  }));
  if (ringGeometry.radius !== 22 || ringGeometry.strokeWidth !== 6 || ringGeometry.viewBox !== '0 0 120 120' || ringGeometry.width !== 120
    || ringGeometry.stroke.toLowerCase() !== 'rgb(93, 129, 199)' || ringGeometry.strokeOpacity !== 0.5 || ringGeometry.trackCount !== 0
    || Math.abs(ringGeometry.dashArray - 138.23) > 0.1 || !ringGeometry.mask.includes('radial-gradient') || !ringGeometry.mask.includes('29.5px') || !ringGeometry.mask.includes('32.5px')) throw new Error(`長按環顏色、透明漸層、內徑或尺寸不符：${JSON.stringify(ringGeometry)}`);
  if (ringGeometry.dashOffset > 2) throw new Error(`長按環形進度未在 500ms 左右完成：${ringGeometry.dashOffset}`);
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
  if (!worldSource.includes("heightEdit?.kind === 'plot' && heightEdit.index === pressedPlot && heightEdit.mode === 'move'") || !worldSource.includes("progress.setAttribute('cx', '60'); progress.setAttribute('cy', '60'); progress.setAttribute('r', '22');") || worldSource.includes("track.setAttribute('class', 'touch-hold-track')")) throw new Error('移動模式即時拖曳或無白色底環的長按幾何未包含預期實作');
  if (!worldSource.includes('plotWasInMoveModeAtPointerDown') || !worldSource.includes('!plotWasInMoveModeAtPointerDown')) throw new Error('地塊移動模式短按切換高度模式的修正未包含');
  if (!worldSource.includes('rotateHoldGesture') || worldSource.includes('rotateTouchGesture') || !worldSource.includes('if (pointerPlotIndex === null && dockHitAtPointer === null)')) throw new Error('PC 與手機的相機手勢尚未統一');
  if (!worldSource.includes("heightEdit?.kind === 'dock' && heightEdit.index === pressedDock && heightEdit.mode === 'move'") || !worldSource.includes('screenToGround(pointerStartX, pointerStartY, 1.36 + getDockHeight(pressedDock))')) throw new Error('無人機坪台移動模式未支援直接拖曳或未使用坪台高度平面');
  if (worldSource.includes('if (dragPreview && Number.isInteger(dragPreview.index))')) throw new Error('拖曳預覽仍保留重複十字箭頭');
  checks.push('手機長按環形進度、雙倍線寬、放開回饋點及多指獨立回饋通過');
  checks.push('地塊短按可由移動模式切換高度模式；PC 與手機相機手勢共用');

  const maturePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  maturePage.on('pageerror', error => errors.push(`mature pageerror: ${error.message}`));
  maturePage.on('console', message => { if (message.type() === 'error') errors.push(`mature console: ${message.text()}`); });
  await maturePage.addInitScript(() => {
    const now = Date.now();
    const dockPosition = { x: 0, z: 1.55, y: 0 };
    localStorage.setItem('sky-garden-save-v1', JSON.stringify({
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
  await maturePage.locator('[data-plot-button="2"]').click();
  const matureSwitch = maturePage.locator('#farm-dialog [data-plot-mode-switch]');
  if (!(await matureSwitch.isEnabled())) throw new Error('成熟植物所在手動地塊不能切換為草地');
  await matureSwitch.click();
  if (!(await maturePage.locator('#farm-dialog .dialog-crop').innerText()).includes('已成熟')) throw new Error('成熟植物轉成草地後沒有保留');
  if (await maturePage.locator('#farm-dialog [data-plot-mode-switch]').getAttribute('data-mode') !== 'grass') throw new Error('成熟植物所在地塊未切換為草地');
  checks.push('成熟植物可隨手動地塊切換成草地並保留');
  await maturePage.close();

  const immaturePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await immaturePage.addInitScript(() => {
    const now = Date.now();
    const dockPosition = { x: 0, z: 1.55, y: 0 };
    localStorage.setItem('sky-garden-save-v1', JSON.stringify({
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
  await immaturePage.locator('[data-plot-button="2"]').click();
  if (!(await immaturePage.locator('#farm-dialog [data-plot-mode-switch]').isDisabled())) throw new Error('未成熟植物所在手動地塊仍可切換成草地');
  checks.push('未成熟植物存在時禁止切換成草地');
  await immaturePage.close();

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

  const versionPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await versionPage.addInitScript(() => localStorage.setItem('diangarden-seen-version-v1', '000000, 001'));
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
  await forceUpdatePage.locator('#force-update-button').click();
  await forceUpdatePage.waitForURL(url => url.searchParams.has('__dg_force_refresh'), { timeout: 10000 });
  await forceUpdatePage.waitForLoadState('domcontentloaded', { timeout: 10000 });
  await forceUpdatePage.locator('#sky-canvas').waitFor({ state: 'visible', timeout: 10000 });
  await forceUpdatePage.waitForTimeout(700);
  if (!forceUpdateRequests.some(request => request.path.endsWith('/game.js')) ||
      !forceUpdateRequests.some(request => request.path.endsWith('/version-check.js')) ||
      !forceUpdateRequests.some(request => request.path.endsWith('/styles.css'))) {
    throw new Error('立即更新後遊戲頁面或核心資源未重新載入：' + JSON.stringify(forceUpdateRequests));
  }
  if (await forceUpdatePage.evaluate(() => document.querySelectorAll('#sky-canvas').length) !== 1) {
    throw new Error('立即更新後頁面出現重複遊戲畫布');
  }
  checks.push('立即更新使用完整頁面導覽，重新初始化遊戲且只保留一個畫布');
  await forceUpdatePage.close();

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
