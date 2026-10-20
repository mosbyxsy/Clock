/**
 * 地区时间详情：由本地城市/首都数据和浏览器时区规则生成。
 * 首都关联优先使用显式首都映射与领土 id，不能依赖“蒙古/蒙古国”等中文名称完全一致。
 * 说明只覆盖内置城市；不把数据库标识数量误称为国家实际时区数量。
 */
window.ClockFeatures.createRegionDetails = function () {
  'use strict';
  const select = document.getElementById('regionCity');
  const content = document.getElementById('regionContent');
  let current = CITIES[0],
    picker,
    lastOffset;
  const createTextElement = (tag, text, cls) => {
    const n = document.createElement(tag);
    n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  for (const city of CITIES) {
    if (!ClockUI.isZoneSupported(city.zone)) continue;
    const option = createTextElement(
      'option',
      `${city.country} / ${city.countryEn} · ${city.name} / ${city.en} · ${city.zone}`
    );
    option.value = city.id;
    select.append(option);
  }
  /** 把有符号分钟差转为“快/慢”说明，保留印度、尼泊尔等非整点差值。 */
  function difference(minutes) {
    if (!minutes) return '时间相同';
    const abs = Math.abs(minutes);
    return `${minutes > 0 ? '快' : '慢'} ${Math.floor(abs / 60) ? Math.floor(abs / 60) + ' 小时' : ''}${abs % 60 ? ' ' + (abs % 60) + ' 分钟' : ''}`;
  }
  function paragraph(parent, title, text) {
    parent.append(createTextElement('h3', title), createTextElement('p', text));
  }
  /** 实时信息卡片只处理展示，国家关联与时间规则由调用方提供。 */
  function createSummary(city, capital, view, now) {
    const summary = createTextElement('div', '', 'region-summary');
    const live = createTextElement('div', '', 'region-live');
    live.append(
      createTextElement('span', '当地当前时间', 'muted'),
      createTextElement('div', view.time, 'region-clock'),
      createTextElement('p', `${view.date} ${view.weekday}`, 'region-date')
    );
    const facts = createTextElement('dl', '', 'region-facts');
    for (const [key, value] of [
      ['首都 / 行政中心', capital?.name || '内置资料暂未收录'],
      ['IANA 时区', city.zone],
      ['当前 UTC 偏移', ClockTime.label(view.offset)],
      [
        '当地时间名称',
        new Intl.DateTimeFormat('zh-CN', { timeZone: city.zone, timeZoneName: 'long' })
          .formatToParts(now)
          .find((p) => p.type === 'timeZoneName').value,
      ],
    ]) {
      const pair = createTextElement('div', '');
      pair.append(createTextElement('dt', key), createTextElement('dd', value));
      facts.append(pair);
    }
    summary.append(live, facts);
    return summary;
  }

  /** 说明区使用显式输入构建，不改动城市选择或计时器状态。 */
  function createGuide(selectedCity, capital, view, now, cities, yearData) {
    const guide = createTextElement('div', '', 'region-guide');
    paragraph(
      guide,
      '时区与地区说明',
      `${selectedCity.name}使用 ${selectedCity.zone}，此刻为 ${ClockTime.label(view.offset)}。本网站收录${selectedCity.country} ${cities.length} 座城市、${new Set(cities.map((c) => c.zone)).size} 个 IANA 时区标识；此数量仅代表内置城市覆盖范围，不代表该国家或地区的全部时区。不同标识也可能采用相同时间。`
    );
    paragraph(
      guide,
      `${view.year} 年时间调整`,
      yearData.changes.length
        ? `浏览器时区规则显示，本年度存在 ${yearData.changes.length} 次 UTC 偏移变化，使用 ${yearData.offsets.map(ClockTime.label).join('、')}。这些变化通常与夏令时有关，也可能来自政策调整；具体时间名称见上方。`
        : `按浏览器时区规则，${selectedCity.name}在 ${view.year} 年全年采用 ${ClockTime.label(yearData.offsets[0])}，未发现夏令时或其他 UTC 偏移切换。`
    );
    if (yearData.changes.length) {
      const list = createTextElement('ul', '', 'region-changes');
      for (const change of yearData.changes) {
        const before = ClockTime.view(new Date(change.instant - 60000), selectedCity.zone),
          after = ClockTime.view(new Date(change.instant), selectedCity.zone);
        list.append(
          createTextElement(
            'li',
            `${before.date} ${before.time.slice(0, 5)} → ${after.date} ${after.time.slice(0, 5)}（${ClockTime.label(change.from)} → ${ClockTime.label(change.to)}，${change.to > change.from ? '拨快' : '拨回'} ${Math.abs(change.to - change.from)} 分钟；切换前最后一分钟 → 切换后第一分钟）`
          )
        );
      }
      guide.append(list);
    }
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    paragraph(
      guide,
      '与北京及设备所在地的时差',
      `${selectedCity.name}此刻比北京${difference(view.offset - ClockTime.offset(now, 'Asia/Shanghai'))}；比设备所在地（${localZone}）${difference(view.offset - ClockTime.offset(now, localZone))}。时差以当前日期计算，未来会议请使用时间转换工具选择实际日期。`
    );
    paragraph(
      guide,
      '安排会议与出行',
      `请用“${selectedCity.name} · ${selectedCity.zone} + 日期 + 当地时间”记录预约。遇到时钟拨快，部分当地时间可能不存在；遇到拨回，同一当地时间可能出现两次。本站时间转换会提示跳过时间，并为重复时间提供不同 UTC 偏移选项。`
    );
    const convert = createTextElement('button', '用此城市换算时间 →', 'primary');
    convert.type = 'button';
    convert.onclick = () => {
      const source = document.getElementById('source');
      source.value = 'c' + selectedCity.id;
      source.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('convert').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    guide.append(convert, createTextElement('h3', '同国家 / 地区的内置城市'));
    const related = createTextElement('div', '', 'region-related');
    for (const city of cities) {
      const button = createTextElement(
        'button',
        `${city.name}${city.id === capital?.id ? ' ★' : ''} · ${city.zone}`
      );
      button.type = 'button';
      button.setAttribute('aria-pressed', String(city.id === selectedCity.id));
      button.onclick = () => window.showRegionDetails(city.id, false);
      related.append(button);
    }
    guide.append(related);
    for (const [q, a] of [
      [
        '“冬令时”是什么？',
        '通常指夏令时结束后恢复的标准时间，不是额外的一套时区。部分地区全年采用标准时间，部分地区按日期调整偏移。',
      ],
      [
        '国家所有城市的时间都一样吗？',
        '不一定。多时区国家需要按具体城市查询；同一国家不同地区也可能采用不同的夏令时规则。',
      ],
      [
        '这些说明依据什么更新？',
        '实时时间、时间名称和年度偏移变化均由设备时钟及浏览器内置 IANA 时区数据计算。更新浏览器可获得较新的规则；内置城市列表不是完整行政区划。',
      ],
    ]) {
      const faq = createTextElement('details', '');
      faq.append(createTextElement('summary', q), createTextElement('p', a));
      guide.append(faq);
    }
    return guide;
  }

  /** 重建所选城市详情：显示实时事实、年度变化、当前时差与关联城市。所有可变内容用安全文本节点写入。 */
  function render(id) {
    current = CITIES[id] || current;
    select.value = current.id;
    picker?.sync();
    const now = new Date(),
      view = ClockTime.view(now, current.zone),
      year = view.year;
    lastOffset = view.offset;
    const country =
      COUNTRIES.find((c) => c.capital === current.id) ||
      ClockUI.countriesById.get(current.territory) ||
      COUNTRIES.find((c) => c.name === current.country || c.en === current.countryEn);
    const data = ClockTime.getYearOffsetChanges(current.zone, year),
      cities = CITIES.filter(
        (c) =>
          c.id === current.id ||
          (country && c.territory ? c.territory === country.id : c.country === current.country)
      );
    const capital = country?.capital != null ? CITIES[country.capital] : null;
    document.getElementById('regionTitle').textContent =
      `${current.country} / ${country?.en || current.countryEn} · ${current.name}时间`;
    content.replaceChildren();
    content.append(createSummary(current, capital, view, now));
    content.append(createGuide(current, capital, view, now, cities, data));
  }
  window.showRegionDetails = (id, scroll = false) => {
    render(id);
    if (scroll)
      document
        .getElementById('regionDetails')
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  select.onchange = () => render(+select.value);
  picker = createCityPicker(select, '搜索国家或城市…');
  window.addEventListener('cityselect', (event) => render(event.detail));
  setInterval(() => {
    if (document.hidden) return;
    const view = ClockTime.view(new Date(), current.zone);
    if (
      view.offset !== lastOffset ||
      content.querySelector('.region-date')?.textContent !== `${view.date} ${view.weekday}`
    )
      render(current.id);
    else content.querySelector('.region-clock').textContent = view.time;
  }, 1000);
  render(0);
};
