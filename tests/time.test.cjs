// 核心时间规则回归：在项目根目录执行 node tests/time.test.cjs。
const assert = require('node:assert/strict');
require('../src/js/time.js');
const time = globalThis.ClockTime;
assert.equal(time.offset(new Date('2026-01-01T00:00:00Z'), 'Asia/Shanghai'), 480);
assert.equal(time.offset(new Date('2026-01-01T00:00:00Z'), 'Asia/Kathmandu'), 345);
assert.equal(time.resolve('2026-03-08T02:30', 'America/New_York').length, 0);
assert.equal(time.resolve('2026-11-01T01:30', 'America/New_York').length, 2);
assert.equal(time.resolve('2026-02-30T12:00', 'Asia/Shanghai').length, 0);
assert.equal(time.view(new Date('2026-01-01T23:00:00Z'), 480).date, '2026/01/02');
const changes = time.getYearOffsetChanges('Europe/Amsterdam', 2026);
assert.deepEqual(changes.offsets, [60, 120]);
assert.equal(changes.changes.length, 2);
assert.equal(time.getYearOffsetChanges('Asia/Shanghai', 2026).changes.length, 0);
console.log('通过：偏移、夏令时跳过/重复、无效日期、跨日和年度变化。');
