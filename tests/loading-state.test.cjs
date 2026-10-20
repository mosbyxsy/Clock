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
      hidden: true,
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
  vm.runInNewContext(source, context);
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
    classes,
    main,
  };
}

const fast = createHarness();
fast.advance(100);
fast.loader.finish();
fast.advance(1000);
assert.equal(fast.overlay.hidden, true);
assert.equal(fast.main.inert, false);
assert.equal(fast.classes.has('is-leaving'), false);

const slow = createHarness();
slow.advance(199);
assert.equal(slow.overlay.hidden, true);
slow.advance(1);
assert.equal(slow.overlay.hidden, false);
slow.advance(100);
slow.loader.finish();
slow.advance(199);
assert.equal(slow.classes.has('is-leaving'), false);
slow.advance(1);
assert.equal(slow.classes.has('is-leaving'), true);
slow.advance(149);
assert.equal(slow.overlay.hidden, false);
slow.advance(1);
assert.equal(slow.overlay.hidden, true);
assert.equal(slow.main.inert, false);

const failure = createHarness();
failure.advance(10);
failure.loader.fail('资源缺失');
assert.equal(failure.overlay.hidden, false);
assert.equal(failure.retry.hidden, false);
failure.loader.finish();
failure.advance(1000);
assert.equal(failure.overlay.hidden, false);
assert.equal(failure.main.inert, true);

const reduced = createHarness(true);
reduced.advance(250);
reduced.loader.finish();
reduced.advance(250);
assert.equal(reduced.overlay.hidden, true);
console.log(
  '通过：快速无闪现、200ms 延迟、300ms 最短展示、150ms 淡出、错误立即显示和减少动态效果。'
);
