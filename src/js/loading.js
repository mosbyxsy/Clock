/** 尽早注册加载状态与失败处理；不依赖城市数据或业务组件。 */
(() => {
  'use strict';
  let failed = false;
  let ready = false;
  const get = (id) => document.getElementById(id);

  function fail(message) {
    if (ready) return;
    failed = true;
    const show = () => {
      get('startupMessage').textContent = message;
      get('startupRetry').hidden = false;
      get('startupLoading').classList.add('loading-failed');
      get('startupLoading').setAttribute('aria-busy', 'false');
    };
    if (get('startupLoading')) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  window.ClockLoading = {
    fail,
    message(text) {
      if (!failed && get('startupMessage')) get('startupMessage').textContent = text;
    },
    finish() {
      if (failed) return;
      ready = true;
      clearTimeout(timeout);
      get('startupLoading').hidden = true;
      document
        .querySelectorAll('header[inert], main[inert]')
        .forEach((node) => node.removeAttribute('inert'));
      document.documentElement.dataset.appState = 'ready';
    },
    // 等浏览器绘制当前状态，再在新任务中继续工作；后台页不能等待停发的动画帧。
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
        const optional = /\/(?:globe(?:-shaders)?|d3-array\.min|d3-geo\.min)\.js(?:\?|$)/;
        if (!optional.test(event.target.src))
          fail('基础资源加载失败，请检查文件是否完整后重新加载。');
      } else if (/\/src\/(?:js|data)\//.test(event.filename || '')) {
        fail('基础资源初始化失败，请确认文件完整后重新加载。');
      }
    },
    true
  );
  document.addEventListener('DOMContentLoaded', () => {
    get('startupRetry').onclick = () => location.reload();
  });
  const timeout = setTimeout(
    () => fail('加载时间较长，请检查文件是否完整，或重新加载页面。'),
    20000
  );
})();
