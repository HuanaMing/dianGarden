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

  const gameCanvas = await page.locator('#sky-canvas').evaluate(canvas => ({
    width: canvas.width,
    height: canvas.height,
    webgl: Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl')),
  }));
  if (!gameCanvas.webgl) throw new Error('遊戲首頁未能建立 WebGL context');
  if (gameCanvas.width < 100 || gameCanvas.height < 100) throw new Error('遊戲畫布尺寸異常');
  checks.push('遊戲 WebGL 畫布已建立');
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
  if (!(await page.locator('#avatar-mode').isVisible()) || !(await page.locator('#avatar-flower').isVisible())) throw new Error('設定中未顯示自訂頭像控制');
  await page.locator('#avatar-mode').selectOption('manual');
  await page.locator('#avatar-flower').selectOption('3');
  if (await page.locator('#garden-avatar').innerText() !== '🌹') throw new Error('手動頭像未顯示所選花卉 emoji');
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#settings-toggle').click();
  if (await page.locator('#avatar-mode').inputValue() !== 'manual' || await page.locator('#avatar-flower').inputValue() !== '3' || await page.locator('#garden-avatar').innerText() !== '🌹') throw new Error('自訂花卉頭像未在重新載入後保存');
  await page.locator('#avatar-mode').selectOption('auto');
  if (await page.locator('#avatar-flower').isEnabled()) throw new Error('自動頭像模式仍允許指定花種');
  checks.push('自訂花卉頭像可切換、顯示並在重新載入後保存');
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
  const cdp = await touchPage.context().newCDPSession(touchPage);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY, id: 1 }] });
  await touchPage.waitForTimeout(100);
  if (await touchPage.locator('.touch-hold-ring').count() !== 1) throw new Error('單指按下時未顯示長按環形進度');
  await touchPage.waitForTimeout(450);
  const ringOffset = Number(await touchPage.locator('.touch-hold-progress').evaluate(element => getComputedStyle(element).strokeDashoffset));
  if (ringOffset > 2) throw new Error(`長按環形進度未在 500ms 左右完成：${ringOffset}`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX + 28, y: touchY + 12, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchPage.waitForTimeout(50);
  if (await touchPage.locator('.touch-feedback-dot').count() !== 1) throw new Error('觸控放開後未顯示藍色回饋點');
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
  checks.push('手機單指長按環形進度、放開回饋點及多指獨立回饋通過');

  const maturePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
  if (await maturePage.locator('#garden-avatar').innerText() !== '🌹') throw new Error('舊存檔未預設為自動頭像，或未依種植數量最多的花種選擇頭像');
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
