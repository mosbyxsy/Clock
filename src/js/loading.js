/** 启动页立即显示；首屏就绪且已展示300ms后退出，所有准备工作始终并行推进。 */
(() => {
  'use strict';
  const MIN_VISIBLE_MS = 300;
  const FADE_MS = 150;
  const criticalResource =
    /\/src\/(?:data\/(?:cities|country-info)|js\/(?:time|app-core|app|cities-panel|navigation|tool-loader))\.js(?:\?|$)/;
  let failed = false;
  let prepared = false;
  let revealed = false;
  let shownAt = null;
  let paintScheduled = false;
  let exitTimer;
  let fadeTimer;
  let slowMessage = '';
  let paintObserver = null;
  const get = (id) => document.getElementById(id);

  function withMarkup(callback) {
    if (get('startupLoading')) callback();
    else document.addEventListener('DOMContentLoaded', callback, { once: true });
  }

  function revealPage() {
    if (failed || revealed) return;
    revealed = true;
    const overlay = get('startupLoading');
    overlay.hidden = true;
    overlay.setAttribute('aria-busy', 'false');
    document
      .querySelectorAll('header[inert], main[inert]')
      .forEach((node) => node.removeAttribute('inert'));
    document.documentElement.dataset.appState = 'ready';
  }

  function scheduleExit() {
    if (failed || !prepared || shownAt === null || exitTimer !== undefined) return;
    exitTimer = setTimeout(
      () => {
        if (failed) return;
        const overlay = get('startupLoading');
        overlay.classList.add('is-leaving');
        // 淡出期间仍保持页面 inert 和遮罩命中，防止点击穿透到下方控件。
        const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : FADE_MS;
        fadeTimer = setTimeout(revealPage, duration);
      },
      Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt))
    );
  }

  function markVisible() {
    // DOMContentLoaded可能仍被慢速defer资源阻塞，重试按钮必须在节点出现时即可操作。
    if (get('startupRetry')) get('startupRetry').onclick = () => location.reload();
    if (paintScheduled || shownAt !== null || failed || document.hidden) return;
    if (paintObserver) {
      const paint = performance
        .getEntriesByType('paint')
        .find((entry) => entry.name === 'first-paint');
      if (paint) recordFirstPaint(paint.startTime);
      return;
    }
    paintScheduled = true;
    // rAF后的新任务让浏览器有机会先绘制启动页；不从head脚本执行时刻计时。
    requestAnimationFrame(() =>
      setTimeout(() => {
        paintScheduled = false;
        if (document.hidden) return;
        shownAt = performance.now();
        scheduleExit();
      }, 0)
    );
  }

  function recordFirstPaint(time) {
    if (shownAt !== null || failed || document.hidden) return;
    shownAt = time;
    paintObserver?.disconnect();
    scheduleExit();
  }

  function fail(message) {
    if (revealed || failed) return;
    failed = true;
    clearTimeout(exitTimer);
    clearTimeout(fadeTimer);
    clearTimeout(slowTimer);
    clearTimeout(retryTimer);
    withMarkup(() => {
      const overlay = get('startupLoading');
      overlay.hidden = false;
      overlay.classList.remove('is-leaving');
      overlay.classList.add('loading-failed');
      overlay.setAttribute('aria-busy', 'false');
      get('startupMessage').textContent = message;
      get('startupRetry').hidden = false;
    });
  }

  window.ClockLoading = {
    fail,
    markVisible,
    message(text) {
      if (!failed && get('startupMessage')) get('startupMessage').textContent = slowMessage || text;
    },
    finish() {
      if (failed || prepared) return;
      prepared = true;
      clearTimeout(slowTimer);
      clearTimeout(retryTimer);
      document.documentElement.dataset.appState = 'prepared';
      get('startupMessage').textContent = '首页已准备就绪…';
      get('startupRetry').hidden = true;
      markVisible();
      scheduleExit();
    },
    yieldToBrowser() {
      return new Promise((resolve) => {
        if (document.hidden) setTimeout(resolve, 0);
        else requestAnimationFrame(() => setTimeout(resolve, 0));
      });
    },
  };
  window.addEventListener(
    'error',
    (event) => {
      if (event.target instanceof HTMLScriptElement) {
        if (criticalResource.test(event.target.src))
          fail('基础资源加载失败，请检查文件是否完整后重新加载。');
      } else if (criticalResource.test(event.filename || '')) {
        fail('基础资源初始化失败，请确认文件完整后重新加载。');
      }
    },
    true
  );
  document.addEventListener('DOMContentLoaded', () => {
    get('startupRetry').onclick = () => location.reload();
    markVisible();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) markVisible();
  });
  const slowTimer = setTimeout(() => {
    if (prepared || failed) return;
    slowMessage = '加载较慢，正在继续准备首页…';
    withMarkup(() => {
      if (!prepared && !failed) get('startupMessage').textContent = slowMessage;
    });
  }, 3000);
  const retryTimer = setTimeout(() => {
    if (prepared || failed) return;
    slowMessage = '仍在等待基础资源，可继续等待或重新加载。';
    withMarkup(() => {
      if (prepared || failed) return;
      get('startupMessage').textContent = slowMessage;
      get('startupRetry').hidden = false;
    });
  }, 15000);
  // 支持Paint Timing时使用真实首绘时间；旧浏览器才使用动画帧后的保守计时。
  if (
    typeof PerformanceObserver === 'function' &&
    PerformanceObserver.supportedEntryTypes?.includes('paint')
  ) {
    try {
      paintObserver = new PerformanceObserver((list) => {
        const paint = list.getEntries().find((entry) => entry.name === 'first-paint');
        if (paint) recordFirstPaint(paint.startTime);
      });
      paintObserver.observe({ type: 'paint', buffered: true });
    } catch {
      paintObserver = null;
    }
  }
})();
