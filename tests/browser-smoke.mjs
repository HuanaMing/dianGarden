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

  const topbarBounds = await page.locator('#world-topbar').boundingBox();
  const frameBounds = await page.locator('.world-frame').boundingBox();
  if (!topbarBounds || !frameBounds || topbarBounds.width < frameBounds.width - 40) {
    throw new Error('桌面版頂部花園資訊卡沒有延伸占滿橫幅');
  }
  for (const selector of ['#settings-toggle', '.encyclopedia-link', '#hud-toggle', '#drone-panel-toggle']) {
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
  await page.locator('#power-save-toggle').click();
  if (await page.locator('#power-save-toggle').getAttribute('aria-pressed') !== 'true') throw new Error('省電模式未能開啟');
  const drawCallsAtPowerSave = await page.evaluate(() => window.__webglDrawCalls);
  await page.waitForTimeout(700);
  const drawCallsDuringPowerSave = await page.evaluate(() => window.__webglDrawCalls);
  if (drawCallsDuringPowerSave !== drawCallsAtPowerSave) throw new Error('省電模式啟用時仍呼叫 WebGL drawArrays');
  await page.locator('#power-save-toggle').click();
  await page.waitForTimeout(400);
  if (await page.evaluate(() => window.__webglDrawCalls) <= drawCallsDuringPowerSave) throw new Error('關閉省電模式後 WebGL 繪圖未恢復');
  checks.push('收合／恢復、無人機圖示、設定面板及省電模式繪圖暫停／恢復通過');

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
  await page.screenshot({ path: `${outputDir}/garden-mobile.png`, fullPage: true });
  checks.push('桌面版、手機直向與橫向版畫面截圖已產生');

  await page.goto(`${baseURL}/encyclopedia.html`, { waitUntil: 'networkidle', timeout: 30000 });
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
