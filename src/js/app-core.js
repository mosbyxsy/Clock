/**
 * 页面共享基础设施。只提供数据查询和小工具，不保存具体面板的交互状态。
 * 使用普通脚本注册全局命名空间，保持 file:// 下无需服务器即可运行。
 */
(() => {
  'use strict';

  const countriesById = new Map(COUNTRIES.map((country) => [country.id, country]));
  const supportedZones = new Map();
  const scriptTasks = new Map();
  let liveSecond = -1;
  const liveViews = new Map();

  /** 地图资源使用普通脚本按需加载，兼容 file://；失败后清缓存以便单独重试。 */
  function loadScript(source, validate = () => true) {
    if (scriptTasks.has(source)) return scriptTasks.get(source);
    const task = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(source, document.baseURI).href;
      script.onerror = () => {
        script.remove();
        scriptTasks.delete(source);
        reject(new Error(`资源加载失败：${source}`));
      };
      script.onload = () => {
        if (validate()) resolve();
        else script.onerror();
      };
      document.body.append(script);
    });
    scriptTasks.set(source, task);
    return task;
  }

  /** 实时钟按秒、时区复用视图；日期转换仍直接调用 ClockTime，避免污染缓存。 */
  function liveView(instant, zone) {
    const second = Math.floor(+instant / 1000);
    if (second !== liveSecond) {
      liveSecond = second;
      liveViews.clear();
    }
    if (!liveViews.has(zone)) liveViews.set(zone, ClockTime.view(instant, zone));
    return liveViews.get(zone);
  }
  const wholeHourOffsets = Array.from({ length: 27 }, (_, index) => (index - 12) * 60);
  const fractionalOffsets = [-570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765, 825];
  const allOffsets = [...new Set([...wholeHourOffsets, ...fractionalOffsets])].sort(
    (a, b) => a - b
  );

  function isZoneSupported(zone) {
    if (!supportedZones.has(zone)) {
      try {
        ClockTime.parts(new Date(), zone);
        supportedZones.set(zone, true);
      } catch {
        supportedZones.set(zone, false);
      }
    }
    return supportedZones.get(zone);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createOption(value, text) {
    const option = createElement('option', '', text);
    option.value = value;
    return option;
  }

  function readPreference(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function savePreference(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 存储不可用时仅放弃持久化，面板状态仍保留在当前会话中。
    }
  }

  const supportedCities = CITIES.filter((city) => isZoneSupported(city.zone));
  const supportedCityIds = new Set(supportedCities.map((city) => city.id));

  function groupCitiesByOffset(instant) {
    const groups = new Map();
    const zoneOffsets = new Map();
    for (const city of supportedCities) {
      if (!zoneOffsets.has(city.zone))
        zoneOffsets.set(city.zone, ClockTime.offset(instant, city.zone));
      const offset = zoneOffsets.get(city.zone);
      if (!groups.has(offset)) groups.set(offset, []);
      groups.get(offset).push(city);
    }
    return groups;
  }

  /** select 的 c 前缀表示城市，o 前缀表示固定分钟偏移；纯数字值用于目的城市。 */
  function parseZoneValue(value) {
    if (value.startsWith('o')) return Number(value.slice(1));
    const cityId = Number(value.startsWith('c') ? value.slice(1) : value);
    return CITIES[cityId]?.zone;
  }

  window.ClockUI = {
    loadScript,
    liveView,
    getById: (id) => document.getElementById(id),
    createElement,
    createOption,
    readPreference,
    savePreference,
    isZoneSupported,
    countriesById,
    supportedCities,
    supportedCityIds,
    wholeHourOffsets,
    allOffsets,
    groupCitiesByOffset,
    parseZoneValue,
  };
  window.ClockFeatures = {};
})();
