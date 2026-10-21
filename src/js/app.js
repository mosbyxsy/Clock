/** 首屏只等待基础资料与城市列表；下方工具按需初始化，地图独立下载并可单独重试。 */
(async () => {
  'use strict';
  if (!window.CITIES?.length || !window.COUNTRIES?.length || !window.ClockTime || !window.ClockUI) {
    ClockLoading.fail('基础城市或时区数据不可用，请确认本地文件完整后重新加载。');
    return;
  }
  try {
    ClockLoading.message('正在准备城市查询…');
    await ClockLoading.yieldToBrowser();
    ClockFeatures.createNavigation();
    const cityPanel = ClockFeatures.createCitiesPanel();
    let selectedCityId = null;
    window.addEventListener('cityselect', (event) => {
      selectedCityId = event.detail;
    });
    if (ClockFeatures.createNumberSteppers) ClockFeatures.createNumberSteppers();
    else
      document.querySelectorAll('.number-stepper-actions').forEach((node) => {
        node.hidden = true;
      });
    const tools = ClockFeatures.createToolLoader([
      {
        id: 'regionDetails',
        initialize() {
          ClockFeatures.createRegionDetails();
          if (selectedCityId !== null) window.showRegionDetails(selectedCityId);
        },
      },
      { id: 'zones', initialize: () => ClockFeatures.createZoneOverview() },
      { id: 'convert', initialize: () => ClockFeatures.createTimeConverter() },
      { id: 'shift', dependencies: ['convert'], initialize: () => ClockFeatures.createTimeShift() },
      { id: 'reverse', initialize: () => ClockFeatures.createTimeReverse() },
    ]);
    window.ClockTools = tools;
    // 首次详情请求也经过同一初始化任务；尚未打开详情时只保留最后一次城市选择。
    window.showRegionDetails = (id, scroll = false) => {
      selectedCityId = id;
      return tools
        .ensure('regionDetails')
        .then(() => window.showRegionDetails(id, scroll))
        .catch(() => {});
    };
    let lastReverseMinute = -1;
    function refreshVisibleTools() {
      if (document.hidden) return;
      const instant = new Date();
      cityPanel.tick(instant);
      const visible = (id) => {
        const bounds = document.getElementById(id).getBoundingClientRect();
        return bounds.top < innerHeight && bounds.bottom > 0;
      };
      if (tools.isReady('zones') && visible('zones')) tools.get('zones').tick();
      const minute = Math.floor(+instant / 60000);
      if (tools.isReady('reverse') && visible('reverse') && minute !== lastReverseMinute) {
        lastReverseMinute = minute;
        tools.get('reverse').refresh();
      }
    }
    setInterval(refreshVisibleTools, 1000);
    document.addEventListener('visibilitychange', refreshVisibleTools);
    ClockLoading.finish();

    const status = document.getElementById('globeLoading');
    const panel = document.querySelector('.globe-panel');
    const rotate = document.getElementById('rotate');
    const reset = document.getElementById('reset');
    function showGlobeError(error) {
      status.classList.add('has-error');
      status.textContent = '地图加载失败，其他时间工具仍可使用。';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重试地图';
      retry.onclick = initializeGlobe;
      status.append(retry);
      document.documentElement.dataset.globeState = 'failed';
      console.warn('地球初始化失败：', error);
    }
    async function initializeGlobe() {
      status.hidden = false;
      status.classList.remove('has-error');
      status.textContent = '正在加载地图…';
      panel.setAttribute('aria-busy', 'true');
      document.documentElement.dataset.globeState = 'loading';
      rotate.disabled = reset.disabled = true;
      try {
        await Promise.all([
          ClockUI.loadScript('src/data/land.js', () => Boolean(window.LAND?.length)),
          ClockUI.loadScript('src/data/countries-geometry.js', () =>
            Boolean(window.COUNTRY_GEOMETRIES?.length)
          ),
          ClockUI.loadScript('src/vendor/d3-array.min.js', () => Boolean(window.d3?.range)).then(
            () => ClockUI.loadScript('src/vendor/d3-geo.min.js', () => Boolean(window.d3?.geoArea))
          ),
        ]);
        if (!window.LAND?.length || !window.COUNTRY_GEOMETRIES?.length || !window.d3?.geoArea) {
          showGlobeError('地图资料不完整');
          return;
        }
        status.textContent = '正在准备地球…';
        await ClockLoading.yieldToBrowser();
        await ClockFeatures.createGlobe();
        if (window.Globe) {
          rotate.disabled = reset.disabled = false;
          if (selectedCityId !== null) Globe.focus(CITIES[selectedCityId]);
        }
        status.hidden = true;
        document.documentElement.dataset.globeState = 'ready';
      } catch (error) {
        showGlobeError(error);
      } finally {
        panel.setAttribute('aria-busy', 'false');
      }
    }
    await ClockLoading.yieldToBrowser();
    await initializeGlobe();
  } catch (error) {
    ClockLoading.fail('城市查询初始化失败，请确认本地文件完整后重新加载。');
    console.error('页面初始化失败：', error);
  }
})();
