/** 启动加载回归：本机临时 HTTP 服务用于模拟延迟/失败，正常页面仍由离线测试覆盖。 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const type = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      };
      response.setHeader('Content-Type', type[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(() => {
          if (document.documentElement.dataset.appState === 'ready' && !window.readyAt) {
            window.readyAt = performance.now();
          }
          if (
            ['prepared', 'ready'].includes(document.documentElement.dataset.appState) &&
            !window.readySnapshot
          ) {
            window.readySnapshot = {
              globePending: !window.Globe,
              cards: document.querySelectorAll('.city-card').length,
            };
          }
        }).observe(document.documentElement, { attributes: true });
      });
    });
    let releaseData;
    const dataGate = new Promise((resolve) => {
      releaseData = resolve;
    });
    await page.route('**/src/data/country-info.js', async (route) => {
      await dataGate;
      await route.continue();
    });
    let releaseMap;
    const mapGate = new Promise((resolve) => {
      releaseMap = resolve;
    });
    await page.route('**/src/data/countries-geometry.js', async (route) => {
      await mapGate;
      await route.continue();
    });
    const navigation = page.goto(url);
    await page.locator('#startupLoading').waitFor({ state: 'visible' });
    assert.equal(await page.locator('main').evaluate((node) => node.inert), true);
    releaseData();
    await navigation;
    await page.waitForFunction(() => document.documentElement.dataset.appState === 'ready');
    await page.locator('#startupLoading').waitFor({ state: 'hidden' });
    const timing = await page.evaluate(() => ({
      readyAt: window.readyAt,
      firstPaint: performance
        .getEntriesByType('paint')
        .find((entry) => entry.name === 'first-paint')?.startTime,
    }));
    if (timing.firstPaint !== undefined) assert.ok(timing.readyAt - timing.firstPaint >= 430);
    const snapshot = await page.evaluate(() => window.readySnapshot);
    assert.equal(snapshot.globePending, true);
    assert.ok(snapshot.cards > 0 && snapshot.cards < 305);
    assert.equal(await page.locator('#shift').getAttribute('data-tool-state'), 'idle');
    await page.locator('nav a[href="#shift"]').click();
    await page.waitForFunction(
      () => document.getElementById('shift').dataset.toolState === 'ready'
    );
    assert.equal(await page.locator('#convert').getAttribute('data-tool-state'), 'ready');
    assert.equal(await page.locator('#shift').getAttribute('data-tool-state'), 'ready');
    assert.equal(await page.evaluate(() => Boolean(window.COUNTRY_GEOMETRIES)), false);
    releaseMap();

    // 快速更改查询后，旧批次不能把其他城市重新插入当前结果。
    await page.locator('#search').fill('中国');
    await page.locator('#clearSearch').click();
    await page.locator('#search').fill('上海');
    await page.waitForFunction(
      () => document.getElementById('cityCards').getAttribute('aria-busy') === 'false'
    );
    assert.equal(await page.locator('.city-card').count(), 1);
    await page.locator('.city-card').click();
    await page.waitForFunction(() => document.documentElement.dataset.globeState === 'ready');
    await page.waitForFunction(() =>
      document.querySelector('.globe-city.selected')?.textContent.includes('上海')
    );
    await page.locator('#clearSearch').click();
    await page.waitForFunction(
      () => document.getElementById('cityCards').getAttribute('aria-busy') === 'false'
    );
    assert.equal(await page.locator('.city-card').count(), 305);

    const missingData = await browser.newPage();
    await missingData.route('**/src/data/country-info.js', (route) => route.abort());
    await missingData.goto(url);
    await missingData.locator('#startupRetry').waitFor({ state: 'visible' });
    assert.equal(await missingData.locator('main').evaluate((node) => node.inert), true);

    const missingGlobe = await browser.newPage();
    await missingGlobe.route('**/src/vendor/d3-geo.min.js', (route) => route.abort());
    await missingGlobe.goto(url);
    await missingGlobe.waitForFunction(
      () =>
        document.documentElement.dataset.appState === 'ready' &&
        document.documentElement.dataset.globeState === 'failed'
    );
    assert.equal(await missingGlobe.locator('main').evaluate((node) => node.inert), false);
    await missingGlobe.locator('#search').fill('北京');
    assert.equal(await missingGlobe.locator('.city-card').count(), 1);
    await missingGlobe.unroute('**/src/vendor/d3-geo.min.js');
    await missingGlobe.locator('#globeLoading button').click();
    await missingGlobe.waitForFunction(
      () => document.documentElement.dataset.globeState === 'ready'
    );
    const missingTool = await browser.newPage();
    await missingTool.route('**/src/js/time-shift.js', (route) => route.abort());
    await missingTool.goto(url);
    await missingTool.waitForFunction(() => document.documentElement.dataset.appState === 'ready');
    await missingTool.evaluate(() => ClockTools.ensure('shift').catch(() => {}));
    assert.equal(await missingTool.locator('#shift').getAttribute('data-tool-state'), 'failed');
    assert.equal(await missingTool.locator('#convert').getAttribute('data-tool-state'), 'ready');
    console.log('通过：数据等待、首屏分批、页面先于地球就绪、快速搜索、城市定位及资源失败提示。');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
