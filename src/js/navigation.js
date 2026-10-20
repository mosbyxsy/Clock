/**
 * 桌面导航与移动端折叠菜单共用同一组锚点。
 * 移动端显示当前栏目，选择后收起；支持外部点击和 Escape，桌面恢复普通导航。
 */
(() => {
  const header = document.querySelector('header'),
    nav = header.querySelector('nav');
  const mobile = matchMedia('(max-width:760px)');
  const button = header.querySelector('.mobile-nav-toggle');
  const title = button.querySelector('.mobile-nav-title');
  /** 关闭菜单并同步 aria-expanded；键盘 Escape 关闭时将焦点还给开关。 */
  function close(focus = false) {
    header.classList.remove('nav-open');
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  }
  button.onclick = () => {
    const open = header.classList.toggle('nav-open');
    button.setAttribute('aria-expanded', String(open));
  };
  nav.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    title.textContent = link.textContent;
    close();
    if (mobile.matches) {
      const target = document.querySelector(link.hash);
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!header.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && header.classList.contains('nav-open')) close(true);
  });
  mobile.addEventListener('change', () => close());
  let frame = 0;
  /** 按各节顶部位置确定当前栏目；考虑页头、scroll-padding 和 scroll-margin，避免锚点跳转后高亮前一栏目。 */
  function update() {
    frame = 0;
    const links = [...nav.querySelectorAll('a')];
    let current = links[0];
    const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    for (const link of links) {
      const section = document.querySelector(link.hash);
      if (section) {
        const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
        if (
          section.getBoundingClientRect().top <=
          Math.max(header.offsetHeight + 24, padding + margin + 24)
        )
          current = link;
      }
    }
    for (const link of links) {
      link.classList.toggle('active', link === current);
      if (link === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    title.textContent = current.textContent;
    button.setAttribute('aria-label', `导航菜单，当前：${current.textContent}`);
  }
  window.addEventListener(
    'scroll',
    () => {
      if (!frame) frame = requestAnimationFrame(update);
    },
    { passive: true }
  );
  document.addEventListener('scrollend', update);
  window.addEventListener('hashchange', () => {
    setTimeout(update, 500);
  });
  window.addEventListener('resize', () => {
    close();
    update();
  });
  update();
})();
