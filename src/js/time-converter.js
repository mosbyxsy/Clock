/** 时间转换：来源解析、重复时间选择、目的城市和结果均封装在此模块。 */
window.ClockFeatures.createTimeConverter = function () {
  'use strict';
  const {
    getById,
    createElement,
    createOption,
    supportedCities,
    supportedCityIds,
    allOffsets,
    parseZoneValue,
  } = ClockUI;
  let destinations = ['北京', '伦敦', '纽约'].map(
    (name) => CITIES.find((city) => city.name === name).id
  );
  let conversionInstant = null;
  let conversionBase = null;
  for (const c of supportedCities) {
    getById('source').append(
      createOption('c' + c.id, `${c.name} · ${c.en} / ${c.country} · ${c.zone}`)
    );
    getById('destination').append(createOption(c.id, `${c.name} · ${c.country} · ${c.zone}`));
  }
  const group = createElement('optgroup');
  group.label = '固定 UTC 偏移';
  for (const o of allOffsets)
    group.append(createOption('o' + o, ClockTime.label(o) + ' · 固定偏移'));
  getById('source').append(group);
  getById('source').value = 'c0';
  getById('destination').prepend(createOption('', '选择城市添加…'));
  getById('destination').value = '';
  getById('sourceTime').value = ClockTime.view(new Date(), 'Asia/Shanghai').input;
  /** 来源值以 c 开头表示城市 id，以 o 开头表示固定 UTC 分钟偏移；返回对应的两种算法输入。 */
  function sourceZone() {
    return parseZoneValue(getById('source').value);
  }
  /** 解析来源当地时间：0 个结果表示无效/跳时，1 个为唯一瞬间，2 个表示回拨重复，必须由用户选择。 */
  function convert() {
    conversionInstant = null;
    conversionBase = null;
    getById('ambiguity').replaceChildren();
    getById('conversionResults').replaceChildren();
    const value = getById('sourceTime').value,
      zone = sourceZone(),
      matches = ClockTime.resolve(value, zone);
    getById('convertMessage').className = '';
    if (!matches.length) {
      getById('convertMessage').textContent =
        '该当地时间不存在，或日期无效（支持1900—2100年）。夏令时跳时会跳过部分时间，请重新选择。';
      getById('convertMessage').className = 'error';
      return;
    }
    if (matches.length > 1) {
      getById('convertMessage').textContent = '该时间在夏令时回拨时出现两次，请选择来源偏移：';
      for (const t of matches) {
        const b = createElement(
          'button',
          '',
          ClockTime.label(ClockTime.offset(t, zone)) +
            ' · ' +
            zone +
            ' · ' +
            t.toISOString().replace('.000Z', ' UTC')
        );
        b.onclick = () => {
          Array.from(getById('ambiguity').children).forEach((n) => n.classList.remove('primary'));
          b.classList.add('primary');
          setConversion(t, zone);
        };
        getById('ambiguity').append(b);
      }
    } else setConversion(matches[0], zone);
  }
  /** 保存唯一的 UTC 瞬间及来源日历日期，再投影到多个目的城市。 */
  function setConversion(t, zone) {
    conversionInstant = t;
    conversionBase = ClockTime.view(t, zone);
    getById('convertMessage').textContent =
      '来源时区：' +
      (typeof zone === 'number' ? ClockTime.label(zone) + '（固定偏移）' : zone) +
      ' · 基准瞬间：' +
      t.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
    renderConversions();
  }
  /** 对同一个 UTC 瞬间生成目的地结果；跨日差使用日历日期的 UTC 编码相减，避免把夏令时误当成天数差。 */
  function renderConversions() {
    getById('conversionResults').replaceChildren();
    if (!conversionInstant) return;
    for (const id of destinations) {
      const c = CITIES[id];
      if (!supportedCityIds.has(id)) continue;
      const v = ClockTime.view(conversionInstant, c.zone),
        card = createElement('article', 'result-card'),
        remove = createElement('button', 'remove', '×');
      remove.setAttribute('aria-label', '移除' + c.name);
      remove.onclick = () => {
        destinations = destinations.filter((d) => d !== id);
        renderConversions();
      };
      const dayDiff = Math.round(
        (Date.UTC(v.year, v.month - 1, v.day) -
          Date.UTC(conversionBase.year, conversionBase.month - 1, conversionBase.day)) /
          86400000
      );
      card.append(
        createElement('h3', '', c.name + ' · ' + c.country),
        remove,
        createElement('div', 'time', v.time),
        createElement(
          'p',
          '',
          v.date +
            ' ' +
            v.weekday +
            ' · ' +
            (dayDiff === 0 ? '同日' : dayDiff > 0 ? `次日 / +${dayDiff}天` : `前日 / ${dayDiff}天`)
        ),
        createElement('p', '', ClockTime.label(v.offset) + ' · ' + c.zone)
      );
      getById('conversionResults').append(card);
    }
    if (!destinations.length)
      getById('conversionResults').append(createElement('p', 'empty', '请从上方添加目的城市。'));
  }
  getById('convertNow').onclick = convert;
  getById('source').onchange = convert;
  getById('sourceTime').onchange = convert;
  getById('destination').onchange = () => {
    const id = +getById('destination').value;
    if (getById('destination').value !== '' && !destinations.includes(id)) destinations.push(id);
    getById('destination').value = '';
    if (conversionInstant) renderConversions();
    else convert();
  };

  createCityPicker(getById('source'), '输入国家、城市或时区搜索…');
  createCityPicker(getById('destination'), '搜索并添加目的城市…');
  convert();
};
