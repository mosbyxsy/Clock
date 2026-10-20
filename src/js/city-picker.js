/**
 * 可搜索选择组件：隐藏的原生 select 是值模型，输入框只是展示与筛选层。
 * 选项弹层挂到 body，使用 fixed 定位，避免被面板 overflow 裁剪；无网络依赖。
 */
/* Searchable local city selectors. Native selects remain the value model. */
(function () {
  'use strict';
  let active = null,
    positionFrame = 0;
  const normalize = (text) =>
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[−–]/g, '-')
      .trim();
  /** 把滚动和视口变化合并到下一动画帧；弹层自身滚动不必重定位。 */
  function schedulePosition(event) {
    if (!active || (event && active.popup.contains(event.target))) return;
    if (!positionFrame)
      positionFrame = requestAnimationFrame(() => {
        positionFrame = 0;
        active?.position();
      });
  }
  window.addEventListener('resize', schedulePosition);
  document.addEventListener('scroll', schedulePosition, true);
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', schedulePosition);
    visualViewport.addEventListener('scroll', schedulePosition);
  }
  document.addEventListener('pointerdown', (event) => {
    if (active && !active.wrapper.contains(event.target) && !active.popup.contains(event.target))
      active.close(true);
  });

  window.createCityPicker = function (select, placeholder) {
    const wrapper = document.createElement('div');
    wrapper.className = 'city-picker';
    const input = document.createElement('input');
    input.id = select.id + 'Search';
    input.type = 'text';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'city-picker-toggle';
    toggle.textContent = '⌄';
    toggle.setAttribute('aria-label', '展开城市或时区选项');
    toggle.tabIndex = -1;
    const popup = document.createElement('div');
    popup.className = 'city-picker-options';
    popup.id = select.id + 'Options';
    popup.setAttribute('role', 'listbox');
    popup.hidden = true;
    popup.setAttribute('aria-label', select.id === 'source' ? '来源城市或固定偏移' : '目的城市');
    input.setAttribute('aria-controls', popup.id);
    select.after(wrapper);
    wrapper.append(input, toggle);
    document.body.append(popup);
    const label = select.closest('label');
    if (label) {
      input.setAttribute('aria-label', label.firstChild.textContent.trim());
      label.htmlFor = input.id;
    }
    select.hidden = true;
    const entries = Array.from(select.options)
      .filter((option) => option.value !== '')
      .map((option) => {
        // 来源/推算用 c城市id 或 o固定偏移；目的/详情使用纯数字城市id。
        // 按值格式识别，不依赖 select 的 DOM id，新增选择器时无需再加分支。
        const id = option.value.startsWith('o')
          ? null
          : Number(option.value.startsWith('c') ? option.value.slice(1) : option.value);
        const city = id === null ? null : window.CITIES[id];
        return {
          value: option.value,
          label: option.textContent,
          city,
          query: normalize(
            [option.textContent, city?.en, city?.countryEn, city?.region, city?.country]
              .filter(Boolean)
              .join(' ')
          ),
        };
      });
    let matches = [],
      index = -1,
      composing = false;
    const selectedLabel = () => entries.find((entry) => entry.value === select.value)?.label || '';
    /** 用已经提交的 select 值恢复输入框显示；输入文字本身不代表选择成功。 */
    function sync() {
      input.value = selectedLabel();
    }
    /** 关闭弹层并清除键盘高亮；restore 为真时撤销尚未提交的文本。 */
    function close(restore) {
      popup.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      if (restore) sync();
      if (active?.popup === popup) active = null;
    }
    /** 根据可视视口、固定页头和剩余空间选择向上/向下展开，并限制弹层宽高。 */
    function position() {
      if (popup.hidden) return;
      const vv = window.visualViewport,
        left = vv?.offsetLeft || 0,
        top = vv?.offsetTop || 0;
      const right = left + (vv?.width || innerWidth),
        bottom = top + (vv?.height || innerHeight);
      const rect = input.getBoundingClientRect(),
        safeTop = Math.max(
          top + 12,
          document.querySelector('header').getBoundingClientRect().bottom + 8
        );
      if (rect.bottom < safeTop || rect.top > bottom - 12) {
        close(true);
        return;
      }
      popup.style.width = Math.min(Math.max(rect.width, 240), right - left - 24) + 'px';
      const below = Math.max(0, bottom - rect.bottom - 18),
        above = Math.max(0, rect.top - safeTop - 6);
      const down = below >= 260 || below >= above;
      popup.style.maxHeight = Math.min(320, down ? below : above) + 'px';
      popup.style.left =
        Math.max(left + 12, Math.min(rect.left, right - 12 - popup.offsetWidth)) + 'px';
      popup.style.top = (down ? rect.bottom + 6 : rect.top - 6 - popup.offsetHeight) + 'px';
    }
    /** 更新键盘活动项与 ARIA 引用；必要时只滚动选项容器，使当前项进入可见范围。 */
    function highlight(next, scroll) {
      index = next;
      for (const node of popup.querySelectorAll('[role="option"]')) {
        const current = +node.dataset.index === index;
        node.classList.toggle('active', current);
        node.setAttribute('aria-selected', String(current));
        if (current) {
          input.setAttribute('aria-activedescendant', node.id);
          if (scroll) node.scrollIntoView({ block: 'nearest' });
        }
      }
      if (index < 0) input.removeAttribute('aria-activedescendant');
    }
    /** 对预先规范化的选项进行过滤；动态节点用 textContent 创建，不拼接外部文本为 HTML。 */
    function render(query, keepSelection) {
      const terms = normalize(query).split(/\s+/).filter(Boolean);
      matches = entries.filter((entry) => terms.every((term) => entry.query.includes(term)));
      popup.replaceChildren();
      for (let i = 0; i < matches.length; i++) {
        const entry = matches[i],
          node = document.createElement('div');
        node.className = 'city-picker-option';
        node.id = popup.id + '-' + i;
        node.dataset.index = i;
        node.setAttribute('role', 'option');
        const title = document.createElement('div'),
          detail = document.createElement('small');
        title.textContent = entry.city
          ? entry.city.name + ' · ' + (entry.city.region || entry.city.country)
          : entry.label;
        detail.textContent = entry.city
          ? entry.city.en + ' · ' + entry.city.zone
          : '固定 UTC 偏移，不随夏令时变化';
        node.append(title, detail);
        popup.append(node);
      }
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'city-picker-empty';
        empty.setAttribute('role', 'status');
        empty.textContent = '没有匹配项，请尝试国家、城市或时区名称';
        popup.append(empty);
      }
      const selected = keepSelection
        ? matches.findIndex((entry) => entry.value === select.value)
        : -1;
      highlight(selected >= 0 ? selected : matches.length ? 0 : -1, false);
      popup.scrollTop = 0;
      position();
      if (selected >= 0) popup.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    }
    /** 同一时间只允许一个选择器展开；保留已提交项的高亮，普通输入则采用新筛选。 */
    function open(query = '', keepSelection = true) {
      if (active?.popup !== popup) active?.close(true);
      active = { popup, wrapper, position, close };
      popup.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      render(query, keepSelection);
    }
    /** 提交当前高亮项，派发 change 以复用页面原有逻辑，再同步展示并收起。 */
    function commit(next) {
      const entry = matches[next];
      if (!entry) return;
      select.value = entry.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close(false);
    }
    input.addEventListener('focus', () => {
      input.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      open();
      input.select();
    });
    input.addEventListener('input', () => {
      input.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      open(input.value, false);
    });
    input.addEventListener('compositionstart', () => (composing = true));
    input.addEventListener('compositionend', () => {
      composing = false;
      open(input.value, false);
    });
    input.addEventListener('keydown', (event) => {
      if (composing || event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (popup.hidden) open();
        if (matches.length)
          highlight(
            (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
            true
          );
      } else if (event.key === 'Enter' && !popup.hidden) {
        event.preventDefault();
        commit(index);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') close(true);
    });
    input.addEventListener('blur', () => close(true));
    toggle.addEventListener('pointerdown', (event) => event.preventDefault());
    toggle.onclick = () => {
      if (!popup.hidden) close(true);
      else {
        input.focus();
        open();
        input.select();
      }
    };
    popup.addEventListener('pointerdown', (event) => event.preventDefault());
    popup.addEventListener('click', (event) => {
      const option = event.target.closest('[role="option"]');
      if (option) commit(+option.dataset.index);
    });
    select.addEventListener('change', sync);
    sync();
    return { sync, close };
  };
})();
