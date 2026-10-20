/** 城市面板：独立管理搜索、收藏及选中状态，不承担其他时间工具的业务。 */
window.ClockFeatures.createCitiesPanel = function () {
  'use strict';
  const {
    getById,
    createElement,
    readPreference,
    savePreference,
    countriesById,
    supportedCityIds,
  } = ClockUI;
  const defaultFavorites = ['北京', '东京', '新加坡', '伦敦', '纽约', '悉尼'].map(
    (name) => CITIES.find((city) => city.name === name).id
  );
  const storedFavorites = readPreference('worldclock.favorites', defaultFavorites);
  let favorites = Array.isArray(storedFavorites)
    ? [...new Set(storedFavorites.filter((id) => Number.isInteger(id) && CITIES[id]))]
    : defaultFavorites;
  let selectedCityId = 0;
  let showAllCities = true;
  let clockBindings = [];
  let renderGeneration = 0;
  let bindingsByCard = new WeakMap();
  const list = getById('cityCards');
  const search = getById('search');
  const visibilityObserver =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            let newlyVisible = false;
            for (const entry of entries) {
              const binding = bindingsByCard.get(entry.target);
              if (!binding) continue;
              binding.visible = entry.isIntersecting;
              newlyVisible ||= entry.isIntersecting;
            }
            if (newlyVisible) tick();
          },
          { root: list, rootMargin: '80px 0px' }
        )
      : null;

  function getVisibleCities() {
    const query = search.value.trim().toLowerCase();
    if (!query) return showAllCities ? CITIES : favorites.map((id) => CITIES[id]);
    return CITIES.filter((city) =>
      [city.name, city.en, city.country, city.countryEn, city.region, city.zone].some((value) =>
        value?.toLowerCase().includes(query)
      )
    );
  }

  function toggleFavorite(cityId) {
    favorites = favorites.includes(cityId)
      ? favorites.filter((id) => id !== cityId)
      : [...favorites, cityId];
    savePreference('worldclock.favorites', favorites);
    render();
  }

  function selectCity(city) {
    if (!supportedCityIds.has(city.id)) return;
    window.Globe?.focus(city);
    // 卡片与地球点击共用事件，详情面板也能收到同一选择，避免状态不同步。
    window.dispatchEvent(new CustomEvent('cityselect', { detail: city.id }));
  }

  function createCityCard(city) {
    const card = createElement('article', 'city-card');
    card.classList.toggle('selected', city.id === selectedCityId);
    card.dataset.cityId = city.id;
    card.tabIndex = 0;
    card.setAttribute('aria-label', `定位${city.name}`);
    const favorite = favorites.includes(city.id);
    const star = createElement('button', 'star', favorite ? '★' : '☆');
    star.type = 'button';
    star.setAttribute('aria-label', `${favorite ? '取消收藏' : '收藏'}${city.name}`);
    star.setAttribute('aria-pressed', String(favorite));
    star.onclick = (event) => {
      event.stopPropagation();
      toggleFavorite(city.id);
    };

    const countryEnglish = countriesById.get(city.territory)?.en || city.countryEn;
    const time = createElement('div', 'clock');
    const meta = createElement('div', 'card-meta');
    const date = createElement('span');
    const offset = createElement('span');
    time.dataset.clock = city.id;
    meta.dataset.meta = city.id;
    meta.append(date, offset);
    const binding = { city, time, date, offset, visible: true };
    clockBindings.push(binding);
    bindingsByCard.set(card, binding);
    const details = createElement('button', 'region-detail-link', '时间详情 ↗');
    details.type = 'button';
    details.onclick = (event) => {
      event.stopPropagation();
      window.showRegionDetails(city.id, true);
    };
    card.append(
      createElement('h3', '', city.name),
      createElement('div', 'english', city.en),
      createElement('div', 'city-country', `${city.region || city.country} · ${countryEnglish}`),
      star,
      time,
      meta,
      createElement('div', 'zone-id', city.zone),
      details
    );
    card.onclick = () => selectCity(city);
    card.onkeydown = (event) => {
      if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        selectCity(city);
      }
    };
    return card;
  }

  async function render() {
    const generation = ++renderGeneration;
    const cities = getVisibleCities();
    const searching = Boolean(search.value.trim());
    getById('clearSearch').hidden = search.value.length === 0;
    getById('citiesTitle').textContent = searching
      ? '搜索结果'
      : showAllCities
        ? '全部城市'
        : '我的城市';
    getById('showAll').textContent = showAllCities ? '仅看收藏' : '查看全部';
    getById('searchCount').textContent =
      showAllCities || searching
        ? `共 ${cities.length} 座城市 · 点击星标收藏`
        : favorites.length
          ? `${favorites.length} 座收藏城市 · 点击城市定位地球`
          : '点击“查看全部”，为城市添加星标';
    visibilityObserver?.disconnect();
    clockBindings = [];
    bindingsByCard = new WeakMap();
    list.replaceChildren();
    list.setAttribute('aria-busy', 'true');
    // 每批先显示少量卡片再让出主线程。新搜索/收藏切换会取消旧批次，避免旧结果回流。
    for (let index = 0; index < cities.length; index += 16) {
      if (generation !== renderGeneration) return;
      const cards = cities.slice(index, index + 16).map(createCityCard);
      list.append(...cards);
      cards.forEach((card) => visibilityObserver?.observe(card));
      tick();
      if (index + 16 < cities.length) await ClockLoading.yieldToBrowser();
    }
    if (generation !== renderGeneration) return;
    if (!cities.length)
      list.append(createElement('p', 'empty', '没有匹配城市，请尝试国家名、中文或英文城市名。'));
    list.setAttribute('aria-busy', 'false');
  }

  /** 每次刷新只计算一次城市视图；日期未变化时不重建节点，保留焦点和滚动位置。 */
  function tick(instant = new Date()) {
    for (const { city, time, date, offset, visible } of clockBindings) {
      if (!visible) continue;
      if (!supportedCityIds.has(city.id)) {
        time.textContent = '不支持此时区';
        date.textContent = '请升级浏览器的时区数据';
        continue;
      }
      const view = ClockTime.view(instant, city.zone);
      time.textContent = view.time;
      const dateText = `${view.date} ${view.weekday}`;
      const offsetText = ClockTime.label(view.offset);
      if (date.textContent !== dateText) date.textContent = dateText;
      if (offset.textContent !== offsetText) offset.textContent = offsetText;
    }
  }

  function clearSearch() {
    search.value = '';
    render();
    list.scrollTop = 0;
    search.focus();
  }
  search.oninput = render;
  search.onkeydown = (event) => {
    if (event.key === 'Escape' && search.value) {
      event.preventDefault();
      clearSearch();
    }
  };
  getById('clearSearch').onclick = clearSearch;
  getById('showAll').onclick = () => {
    showAllCities = !showAllCities;
    search.value = '';
    render();
  };
  window.addEventListener('cityselect', (event) => {
    if (!CITIES[event.detail]) return;
    selectedCityId = event.detail;
    // 仅切换选中类，不重建列表，键盘焦点不会因为定位操作而丢失。
    for (const card of list.querySelectorAll('[data-city-id]')) {
      card.classList.toggle('selected', Number(card.dataset.cityId) === selectedCityId);
    }
  });
  render();
  return { tick };
};
