/** 时间反查：按设备当前瞬间在24小时环内比较钟点差。 */
window.ClockFeatures.createTimeReverse = function () {
  'use strict';
  const { getById, createElement, allOffsets, groupCitiesByOffset } = ClockUI;
  /** 反查“此刻”哪些城市接近目标钟点。分钟距离按 24 小时环形计算，以正确匹配午夜两侧的容差。 */
  function reverse() {
    const value = getById('targetTime').value;
    if (!/^\d{2}:\d{2}$/.test(value)) {
      getById('reverseSummary').textContent = '请输入有效时间。';
      getById('reverseResults').replaceChildren();
      return;
    }
    const [hh, mm] = value.split(':').map(Number),
      target = hh * 60 + mm,
      tolerance = +getById('tolerance').value,
      now = new Date(),
      map = groupCitiesByOffset(now);
    function match(o) {
      const v = ClockTime.view(now, o),
        diff = Math.abs(v.hour * 60 + v.minute - target);
      return Math.min(diff, 1440 - diff) <= tolerance;
    }
    const matching = allOffsets.filter(match),
      cityCount = matching.reduce((n, o) => n + (map.get(o) || []).length, 0);
    getById('reverseSummary').textContent =
      `查询基准 ${now.toLocaleTimeString('zh-CN', { hour12: false })}（设备时间） · ${matching.length} 个偏移，${cityCount} 座城市 · 范围 ${tolerance ? '±' + tolerance + '分钟' : '精确到分钟'} · 城市库 ${CITIES.length} 座`;
    getById('reverseResults').replaceChildren();
    for (const o of matching) {
      const v = ClockTime.view(now, o),
        card = createElement('article', 'result-card');
      card.append(
        createElement('h3', '', ClockTime.label(o) + ' · 固定偏移'),
        createElement('div', 'time', v.time),
        createElement('p', '', v.date + ' ' + v.weekday),
        createElement(
          'p',
          '',
          (map.get(o) || [])
            .map((c) => c.name + '（' + c.country + ' · ' + c.zone + '）')
            .join('、') || '该偏移在内置城市库中暂无城市'
        )
      );
      getById('reverseResults').append(card);
    }
    if (!matching.length)
      getById('reverseResults').append(
        createElement('p', 'empty', '此刻没有匹配的时区或城市。请扩大匹配范围或调整目标时间。')
      );
  }
  getById('reverseNow').onclick = reverse;
  getById('targetTime').onchange = reverse;
  getById('tolerance').onchange = reverse;

  reverse();
  return { refresh: reverse };
};
