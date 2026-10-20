/** 离线界面回归。不生成截图；需要 Playwright 和 Edge，模块位置可通过环境变量指定。 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ offline: true, viewport: { width: 1192, height: 900 } });
    const errors = [],
      externalRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) externalRequests.push(request.url());
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    assert.equal(await page.locator('.city-card').count(), 305);
    assert.equal(await page.locator('.zone-card').count(), 39);
    // 六种常见宽度下，卡片内容不能越过自身边界，也不能撑出页面横向滚动。
    for (const width of [1536, 1192, 900, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...document.querySelectorAll('.city-card')].some((card) => {
          const details = card.querySelector('.region-detail-link').getBoundingClientRect();
          return details.bottom > card.getBoundingClientRect().bottom - 8;
        }),
      }));
      assert.equal(layout.overflow, false, `页面溢出：${width}px`);
      assert.equal(layout.clipped, false, `卡片截断：${width}px`);
    }
    await page.setViewportSize({ width: 1192, height: 900 });
    await page.locator('#search').fill('上海');
    await page.locator('.city-card').click();
    assert.match(await page.locator('#regionTitle').textContent(), /上海/);
    assert.equal(await page.locator('.city-card.selected').count(), 1);
    await page.waitForFunction(() =>
      document.querySelector('.globe-city.selected')?.textContent.includes('上海')
    );
    await page.locator('#rotate').click();
    assert.equal(await page.evaluate(() => Globe.diagnostics().autoRotate), false);
    await page.locator('#rotate').click();
    assert.equal(await page.evaluate(() => Globe.diagnostics().autoRotate), true);
    await page.locator('#clearSearch').click();
    assert.equal(await page.locator('.city-card').count(), 305);
    await page.evaluate(() => showRegionDetails(12));
    assert.equal(await page.locator('.region-facts dd').first().textContent(), '乌兰巴托');

    // 使用真实选择器提交来源，覆盖隐藏值模型与搜索框的同步。
    await page.locator('#sourceSearch').fill('New York');
    await page.locator('#sourceSearch').press('Enter');
    await page.locator('#sourceTime').fill('2026-03-08T02:30');
    await page.locator('#convertNow').click();
    assert.match(await page.locator('#convertMessage').textContent(), /不存在/);
    await page.locator('#sourceTime').fill('2026-11-01T01:30');
    await page.locator('#convertNow').click();
    assert.equal(await page.locator('#ambiguity button').count(), 2);

    await page.locator('#shiftZoneSearch').fill('北京');
    await page.locator('#shiftZoneSearch').press('Enter');
    await page.locator('#shiftBase').evaluate((input) => {
      input.value = '2026-01-01T00:00:00';
    });
    await page.locator('#shiftHours').fill('100');
    await page.locator('#shiftForm button[type="submit"]').click();
    assert.match(await page.locator('#shiftResult').textContent(), /2026\/01\/05.*04:00:00/);
    await page.locator('#shiftClear').click();
    assert.equal(await page.locator('#shiftHours').inputValue(), '');
    assert.equal(await page.locator('#shiftResult').isVisible(), false);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.locator('.mobile-nav-toggle').click();
    assert.equal(await page.locator('header nav a').count(), 6);
    await page.locator('header nav a[href="#shift"]').click();
    assert.equal(await page.locator('header nav').isVisible(), false);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);

    // GPU 初始化失败时仍可进入 Canvas 2D；全部 Canvas 不可用时保留静态地图。
    const fallback = await browser.newPage({ offline: true });
    await fallback.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl' ? null : getContext.call(this, type, ...args);
      };
    });
    await fallback.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    assert.match(await fallback.evaluate(() => Globe.diagnostics().renderer), /2d/i);
    await fallback.close();
    const staticPage = await browser.newPage({ offline: true });
    await staticPage.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await staticPage.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    assert.equal(await staticPage.locator('#globeFallback svg').count(), 1);
    assert.equal(await staticPage.locator('.city-card').count(), 305);
    await staticPage.close();
    console.log('通过：离线加载、搜索/选择同步、首都、夏令时、推算、清空和手机导航。');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
