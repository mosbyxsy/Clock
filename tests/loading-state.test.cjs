/** 可控时钟验证遮罩时序，无需浏览器或真实等待。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/js/loading.js'), 'utf8');

function createHarness(reducedMotion = false) {
  let now = 0,
    nextId = 0;
  const timers = new Map();
  const classes = new Set();
  const elements = {
    startupLoading: {
      hidden: false,
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      setAttribute() {},
    },
    startupRetry: { hidden: true },
    startupMessage: { textContent: '' },
  };
  const main = {
    inert: true,
    removeAttribute() {
      this.inert = false;
    },
  };
  const document = {
    getElementById: (id) => elements[id],
    querySelectorAll: () => [main],
    documentElement: { dataset: {} },
    addEventListener() {},
  };
  const window = { addEventListener() {} };
  const context = {
    document,
    window,
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    matchMedia: () => ({ matches: reducedMotion }),
  };
  context.requestAnimationFrame = (callback) => context.setTimeout(callback, 16);
  vm.runInNewContext(source, context);
  window.ClockLoading.markVisible();
  function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
    }
    now = target;
  }
  return {
    advance,
    loader: window.ClockLoading,
    overlay: elements.startupLoading,
    retry: elements.startupRetry,
    message: elements.startupMessage,
    classes,
    main,
  };
}

const fast = createHarness();
assert.equal(fast.overlay.hidden, false);
fast.advance(100);
fast.loader.finish();
assert.equal(fast.main.inert, true);
fast.advance(215);
assert.equal(fast.classes.has('is-leaving'), false);
fast.advance(1);
assert.equal(fast.classes.has('is-leaving'), true);
assert.equal(fast.main.inert, true);
fast.advance(149);
assert.equal(fast.overlay.hidden, false);
fast.advance(1);
assert.equal(fast.overlay.hidden, true);
assert.equal(fast.main.inert, false);

const slow = createHarness();
slow.advance(1000);
assert.equal(slow.overlay.hidden, false);
slow.loader.finish();
slow.advance(0);
assert.equal(slow.classes.has('is-leaving'), true);
assert.equal(slow.main.inert, true);
slow.advance(150);
assert.equal(slow.overlay.hidden, true);
assert.equal(slow.main.inert, false);

const waiting = createHarness();
waiting.advance(3000);
assert.match(waiting.message.textContent, /加载较慢/);
waiting.advance(12000);
assert.equal(waiting.retry.hidden, false);
assert.equal(typeof waiting.retry.onclick, 'function');
assert.equal(waiting.classes.has('loading-failed'), false);
waiting.loader.finish();
waiting.advance(150);
assert.equal(waiting.overlay.hidden, true);

const failure = createHarness();
failure.advance(10);
failure.loader.fail('资源缺失');
assert.equal(failure.retry.hidden, false);
failure.loader.finish();
failure.advance(1000);
assert.equal(failure.overlay.hidden, false);
assert.equal(failure.main.inert, true);

const reduced = createHarness(true);
reduced.advance(100);
reduced.loader.finish();
reduced.advance(216);
assert.equal(reduced.overlay.hidden, true);
console.log(
  '通过：立即显示、首绘后至少300ms、准备并行推进、淡出防误触、慢加载/重试、错误和减少动态效果。'
);
