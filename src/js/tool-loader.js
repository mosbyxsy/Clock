/** 按接近可视区域或导航点击初始化工具；依赖关系显式声明，失败限制在对应面板。 */
window.ClockFeatures.createToolLoader = function (definitions) {
  const records = new Map();
  let navigationGeneration = 0;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) ensure(entry.target.id).catch(() => {});
    },
    { rootMargin: '160px 0px' }
  );

  for (const definition of definitions) {
    const section = document.getElementById(definition.id);
    const status = document.createElement('div');
    status.className = 'tool-loading';
    status.setAttribute('role', 'status');
    status.textContent = '工具按需准备…';
    section.append(status);
    section.inert = true;
    section.dataset.toolState = 'idle';
    records.set(definition.id, { ...definition, section, status, task: null, value: null });
    observer.observe(section);
  }

  function ensure(id) {
    const record = records.get(id);
    if (!record) return Promise.resolve();
    if (record.task) return record.task;
    record.section.dataset.toolState = 'loading';
    record.section.setAttribute('aria-busy', 'true');
    record.status.textContent = '正在准备时间工具…';
    record.task = Promise.resolve()
      .then(async () => {
        for (const dependency of record.dependencies || []) await ensure(dependency);
        await ClockLoading.yieldToBrowser();
        record.value = record.initialize();
        record.status.remove();
        record.section.inert = false;
        record.section.dataset.toolState = 'ready';
        observer.unobserve(record.section);
        return record.value;
      })
      .catch((error) => {
        record.section.inert = false;
        record.section.dataset.toolState = 'failed';
        record.section.querySelectorAll('input,select,button').forEach((control) => {
          control.disabled = true;
        });
        record.status.textContent = '此工具初始化失败，其他工具仍可使用。';
        const retry = document.createElement('button');
        retry.textContent = '重新加载';
        retry.type = 'button';
        retry.onclick = () => location.reload();
        record.status.append(retry);
        console.warn(`工具初始化失败：${id}`, error);
        throw error;
      })
      .finally(() => record.section.setAttribute('aria-busy', 'false'));
    return record.task;
  }

  document.querySelector('nav').addEventListener(
    'click',
    (event) => {
      const link = event.target.closest('a');
      if (!link) return;
      const generation = ++navigationGeneration;
      const id = link?.hash.slice(1);
      if (!records.has(id) || records.get(id).section.dataset.toolState === 'ready') return;
      event.preventDefault();
      link.dataset.loading = 'true';
      ensure(id)
        .then(() => {
          // 先前的工具可以继续准备，但不能覆盖用户后来点击的导航目的地。
          if (generation !== navigationGeneration) return;
          history.pushState(null, '', '#' + id);
          records.get(id).section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        })
        .catch(() => {})
        .finally(() => {
          delete link.dataset.loading;
        });
    },
    true
  );
  const openHash = () => ensure(location.hash.slice(1)).catch(() => {});
  window.addEventListener('hashchange', openHash);
  openHash();
  return {
    ensure,
    get: (id) => records.get(id)?.value,
    isReady: (id) => records.get(id)?.section.dataset.toolState === 'ready',
  };
};
