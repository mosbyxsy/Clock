/**
 * 页面启动入口。各面板独立维护状态；这里仅确定初始化顺序及统一刷新节奏。
 * 先初始化转换来源，时间推算才能复用同一组选项。
 */
(() => {
  'use strict';
  const cityPanel = ClockFeatures.createCitiesPanel();
  const zoneOverview = ClockFeatures.createZoneOverview();
  ClockFeatures.createTimeConverter();
  const timeReverse = ClockFeatures.createTimeReverse();
  const zoneSection = ClockUI.getById('zones');
  let lastMinute = -1;

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
})();
