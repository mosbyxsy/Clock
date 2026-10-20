/** 启动分阶段进行：基础工具就绪即开放页面；城市卡片和地球继续独立渐进渲染。 */
(async () => {
  'use strict';
  try {
    if (
      !window.CITIES?.length ||
      !window.COUNTRIES?.length ||
      !window.ClockTime ||
      !window.ClockUI
    ) {
      throw new Error('基础城市或时区数据不可用');
    }
    ClockLoading.message('数据已就绪，正在准备时间工具…');
    await ClockLoading.yieldToBrowser();
    ClockFeatures.createNavigation();
    const cityPanel = ClockFeatures.createCitiesPanel();
    await ClockLoading.yieldToBrowser();
    ClockFeatures.createTimeConverter();
    ClockFeatures.createTimeShift();
    ClockFeatures.createNumberSteppers();
    await ClockLoading.yieldToBrowser();
    ClockFeatures.createRegionDetails();
    const zoneOverview = ClockFeatures.createZoneOverview();
    await ClockLoading.yieldToBrowser();
    const timeReverse = ClockFeatures.createTimeReverse();
    const zoneSection = ClockUI.getById('zones');
    let lastMinute = Math.floor(Date.now() / 60000);

    function refreshVisibleTools() {
      if (document.hidden) return;
      const instant = new Date();
      cityPanel.tick(instant);
      const bounds = zoneSection.getBoundingClientRect();
      if (bounds.top < innerHeight && bounds.bottom > 0) zoneOverview.tick();
      const minute = Math.floor(+instant / 60000);
      if (minute !== lastMinute) {
        lastMinute = minute;
        timeReverse.refresh();
      }
    }
    setInterval(refreshVisibleTools, 1000);
    document.addEventListener('visibilitychange', refreshVisibleTools);
    ClockLoading.finish();

    // 用户可在地球准备期间先选择城市；渲染就绪后补上最后一次定位。
    let pendingCityId = null;
    const queueSelection = (event) => {
      pendingCityId = event.detail;
    };
    window.addEventListener('cityselect', queueSelection);
    const globeStatus = ClockUI.getById('globeLoading');
    const globePanel = document.querySelector('.globe-panel');
    const rotateButton = ClockUI.getById('rotate');
    const resetButton = ClockUI.getById('reset');
    rotateButton.disabled = resetButton.disabled = true;
    globePanel.setAttribute('aria-busy', 'true');
    try {
      await ClockLoading.yieldToBrowser();
      await ClockFeatures.createGlobe();
      if (window.Globe) {
        rotateButton.disabled = resetButton.disabled = false;
        if (pendingCityId !== null) Globe.focus(CITIES[pendingCityId]);
      }
      globeStatus.hidden = true;
      document.documentElement.dataset.globeState = 'ready';
    } catch (error) {
      globeStatus.replaceChildren(
        document.createTextNode('地球加载失败，城市查询和时间工具仍可使用。刷新页面可重试。')
      );
      document.documentElement.dataset.globeState = 'failed';
      console.warn('地球初始化失败：', error);
    } finally {
      globePanel.setAttribute('aria-busy', 'false');
      window.removeEventListener('cityselect', queueSelection);
    }
  } catch (error) {
    ClockLoading.fail('时间工具初始化失败，请确认本地文件完整后重新加载。');
    console.error('页面初始化失败：', error);
  }
})();
