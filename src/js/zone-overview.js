/** 固定偏移总览：卡片缓存、实时偏移分组与独立悬停弹层。 */
window.ClockFeatures.createZoneOverview = function () {
  'use strict';
  const {
    getById,
    createElement,
    readPreference,
    savePreference,
    allOffsets,
    wholeHourOffsets,
    groupCitiesByOffset,
  } = ClockUI;
  getById('fractional').checked = readPreference('worldclock.fractional', true) !== false;
  const zoneNodes = new Map();
  let zoneLayout = '',
    zoneMinute = -1,
    activeZoneHint = null,
    zonePositionFrame = 0;
  /** 合并同一帧内的滚动与尺寸变化事件，避免弹层反复测量布局。 */
  function repositionZoneHint() {
    if (!zonePositionFrame)
      zonePositionFrame = requestAnimationFrame(() => {
        zonePositionFrame = 0;
        activeZoneHint?.position();
      });
  }
  window.addEventListener('resize', repositionZoneHint);
  document.addEventListener(
    'scroll',
    (e) => {
      if (activeZoneHint && !activeZoneHint.popup.contains(e.target)) repositionZoneHint();
    },
    true
  );
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', repositionZoneHint);
    visualViewport.addEventListener('scroll', repositionZoneHint);
  }
  /** 创建一张卡片及对应的弹层生命周期；实时刷新不重复执行。 */
  function createZoneCard(o) {
    const card = createElement('article', 'zone-card'),
      clock = createElement('div', 'zone-time'),
      date = createElement('p'),
      diff = createElement('p'),
      cities = createElement('p');
    const hint = createElement('div', 'zone-name-hint'),
      trigger = createElement('button', 'zone-name-trigger', '时区名称 ⓘ'),
      popup = createElement('div', 'zone-name-tooltip zone-id');
    const heading = createElement(
        'strong',
        'zone-name-heading',
        ClockTime.label(o) + ' · 对应时区'
      ),
      names = createElement('div', 'zone-name-list'),
      scrollHint = createElement('div', 'zone-name-scroll-hint', '↕ 滚动查看全部时区');
    scrollHint.hidden = true;
    popup.append(heading, names, scrollHint);
    popup.id = 'zone-names-' + (o + 720);
    popup.hidden = true;
    popup.setAttribute('role', 'tooltip');
    trigger.type = 'button';
    trigger.setAttribute('aria-describedby', popup.id);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', ClockTime.label(o) + ' 对应的 IANA 时区名称');
    let closeTimer = 0;
    const close = () => {
      clearTimeout(closeTimer);
      popup.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (activeZoneHint?.popup === popup) activeZoneHint = null;
    };
    const position = () => {
      if (popup.hidden) return;
      const vv = window.visualViewport,
        top = vv?.offsetTop || 0,
        left = vv?.offsetLeft || 0,
        bottom = top + (vv?.height || innerHeight),
        right = left + (vv?.width || innerWidth);
      const rect = trigger.getBoundingClientRect(),
        safeTop = Math.max(
          top + 12,
          document.querySelector('header').getBoundingClientRect().bottom + 8
        ),
        safeBottom = bottom - 12;
      if (rect.bottom < safeTop || rect.top > safeBottom) {
        close();
        return;
      }
      popup.style.width = Math.max(100, Math.min(320, right - left - 24)) + 'px';
      popup.style.maxHeight = 'none';
      scrollHint.hidden = true;
      const natural = popup.scrollHeight + 2,
        below = Math.max(0, safeBottom - rect.bottom - 6),
        above = Math.max(0, rect.top - safeTop - 6);
      const down = natural <= below || (natural > above && below >= above),
        available = down ? below : above,
        maxHeight = Math.min(420, available);
      if (maxHeight < 48) {
        close();
        return;
      }
      popup.style.maxHeight = maxHeight + 'px';
      scrollHint.hidden = natural <= maxHeight;
      popup.style.left =
        Math.max(left + 12, Math.min(rect.left, right - 12 - popup.offsetWidth)) + 'px';
      popup.style.top = (down ? rect.bottom + 6 : rect.top - 6 - popup.offsetHeight) + 'px';
    };
    const open = () => {
      clearTimeout(closeTimer);
      if (activeZoneHint?.popup !== popup) activeZoneHint?.close();
      popup.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      activeZoneHint = { popup, trigger, close, position };
      position();
    };
    const leave = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(close, 140);
    };
    hint.onpointerenter = open;
    hint.onpointerleave = leave;
    popup.onpointerenter = () => clearTimeout(closeTimer);
    popup.onpointerleave = leave;
    trigger.onfocus = open;
    trigger.onclick = open;
    const focusOut = (e) => {
      if (!hint.contains(e.relatedTarget) && !popup.contains(e.relatedTarget)) leave();
    };
    hint.onfocusout = focusOut;
    popup.onfocusout = focusOut;
    const escape = (e) => {
      if (e.key === 'Escape') {
        trigger.focus({ preventScroll: true });
        close();
        e.stopPropagation();
      } else if (e.key === 'ArrowDown' && e.target === trigger) {
        e.preventDefault();
        open();
        names.focus({ preventScroll: true });
      }
    };
    hint.onkeydown = escape;
    popup.onkeydown = escape;
    names.tabIndex = 0;
    hint.append(trigger);
    document.body.append(popup);
    card.append(
      createElement('strong', '', ClockTime.label(o) + ' · 固定偏移'),
      clock,
      date,
      diff,
      cities,
      hint
    );
    zoneNodes.set(o, { card, clock, date, diff, cities, popup, names, close });
    getById('zoneGrid').append(card);
  }

  /** 固定偏移卡片只在布局变化时重建。时钟逐秒更新，城市分组逐分钟重算，避免刷新时关闭悬停弹层。 */
  function renderZones() {
    const now = new Date(),
      list = getById('fractional').checked ? allOffsets : wholeHourOffsets,
      local = -now.getTimezoneOffset(),
      layout = list.join(',');
    if (layout !== zoneLayout) {
      zoneLayout = layout;
      zoneMinute = -1;
      for (const nodes of zoneNodes.values()) {
        nodes.close();
        nodes.popup.remove();
      }
      zoneNodes.clear();
      getById('zoneGrid').replaceChildren();
      for (const o of list) {
        createZoneCard(o);
      }
    }
    const minute = Math.floor(+now / 60000),
      map = minute !== zoneMinute ? groupCitiesByOffset(now) : null;
    for (const [o, nodes] of zoneNodes) {
      const v = ClockTime.view(now, o);
      nodes.clock.textContent = v.time;
      nodes.date.textContent = v.date + ' ' + v.weekday;
      nodes.diff.textContent = `比设备本地${o === local ? '相同' : o > local ? '快 ' + duration(o - local) : '慢 ' + duration(local - o)}`;
      if (map) {
        const cities = map.get(o) || [];
        nodes.cities.textContent =
          cities
            .slice(0, 3)
            .map((c) => c.name)
            .join(' · ') || '内置城市暂无匹配';
        nodes.names.textContent =
          [...new Set(cities.map((c) => c.zone))].join('\n') || '固定偏移 · 暂无匹配的城市时区';
      }
    }
    zoneMinute = minute;
    if (map && activeZoneHint) repositionZoneHint();
  }
  document.addEventListener('pointerdown', (e) => {
    for (const nodes of zoneNodes.values())
      if (!nodes.card.contains(e.target) && !nodes.popup.contains(e.target)) nodes.close();
  });
  function duration(n) {
    return `${Math.floor(n / 60)}小时${n % 60 ? `${n % 60}分钟` : ''}`;
  }
  getById('fractional').onchange = () => {
    savePreference('worldclock.fractional', getById('fractional').checked);
    renderZones();
  };

  renderZones();
  return { tick: renderZones };
};
