import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseURL = process.env.GARDEN_TEST_URL || 'http://127.0.0.1:4173';
const outputDir = 'test-results/screenshots';
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
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

  const worldMessage = await page.locator('#world-message').innerText().catch(() => '');
  if (worldMessage.includes('載入失敗') || worldMessage.includes('無法啟用 WebGL')) {
    throw new Error(`遊戲場景載入失敗：${worldMessage}`);
  }
  await page.screenshot({ path: `${outputDir}/garden-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outputDir}/garden-mobile.png`, fullPage: true });
  checks.push('桌面版與手機版畫面截圖已產生');

  await page.goto(`${baseURL}/encyclopedia.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('.encyclopedia-card').first().waitFor({ state: 'visible' });
  const cardCount = await page.locator('.encyclopedia-card').count();
  if (cardCount !== 11) throw new Error(`花卉圖鑑應有 11 種花卉，實際為 ${cardCount} 種`);
  checks.push('花卉圖鑑 11 種花卉資料均已載入');

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
