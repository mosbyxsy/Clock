/**
 * 时间计算基础模块，同时支持浏览器普通脚本和 Node.js 测试。
 * Date 表示绝对瞬间；IANA 字符串表示随日期变化的地区规则；数字表示固定 UTC 分钟偏移。
 * 不使用 Date 的本地字符串解析，避免计算依赖运行设备所在时区。
 */
(function (root) {
  // Intl 格式化器创建成本较高，按时区缓存；时区规则由浏览器/系统提供。
  const cache = new Map();

  /** 提取指定瞬间在目标地区的日历字段。h23 将午夜固定为 00，避免 24 点带来的日期歧义。 */
  function parts(date, zone) {
    let formatter = cache.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      cache.set(zone, formatter);
    }
    return Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, +part.value])
    );
  }

  /** 把当地日历字段暂当 UTC 编码，与原瞬间相减，得到当日实际偏移（单位：分钟）。 */
  function offset(date, zone) {
    const p = parts(date, zone);
    // formatToParts 不含毫秒，比较前将原时间也截到整秒。
    return Math.round(
      (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
        Math.floor(+date / 1000) * 1000) /
        60000
    );
  }

  const pad = (number) => String(number).padStart(2, '0');

  /** 保留半小时、45分钟等非整点偏移，不把 UTC 偏移误当作唯一地区标识。 */
  function label(minutes) {
    return (
      'UTC' +
      (minutes < 0 ? '−' : '+') +
      Math.floor(Math.abs(minutes) / 60) +
      (Math.abs(minutes) % 60 ? ':' + pad(Math.abs(minutes) % 60) : '')
    );
  }

  /** 统一视图模型：日期、星期、钟点、表单值和实际偏移，供全部界面复用。 */
  function view(date, zone) {
    let p;
    if (typeof zone === 'number') {
      // 固定偏移没有夏令时；先平移瞬间，再使用 UTC getter 读取，避免设备本地规则介入。
      const shifted = new Date(+date + zone * 60000);
      p = {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
      };
    } else p = parts(date, zone);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
      new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
    ];
    return {
      ...p,
      time: `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`,
      date: `${p.year}/${pad(p.month)}/${pad(p.day)}`,
      input: `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`,
      weekday,
      offset: typeof zone === 'number' ? zone : offset(date, zone),
    };
  }

  /**
   * 将分钟精度的当地时间反解成所有可能的 UTC 瞬间，按先后排序。
   * 返回 []：无效日期或夏令时拨快跳过；一项：唯一时间；多项：拨回导致重复。
   * 调用方必须让用户选择重复时间，不能擅自固定为第一个结果。
   */
  function resolve(value, zone) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return [];
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    if (
      year < 1900 ||
      year > 2100 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      hour > 23 ||
      minute > 59
    )
      return [];
    const naive = Date.UTC(year, month - 1, day, hour, minute),
      check = new Date(naive);
    // Date.UTC 会自动把2月30日滚入3月，必须反向检查以拒绝无效日期。
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return [];
    if (typeof zone === 'number') return [new Date(naive - zone * 60000)];
    // 在附近两天内采样可能出现的偏移，覆盖常见季节切换及非整小时调整。
    const offsets = new Set();
    for (let hours = -48; hours <= 48; hours += 6)
      offsets.add(offset(new Date(naive + hours * 3600000), zone));
    return [...offsets]
      .map((minutes) => new Date(naive - minutes * 60000))
      .filter((instant) => {
        // 候选值必须正向转换后与输入的全部日历字段相等，才能算有效解。
        const p = parts(instant, zone);
        return (
          p.year === year &&
          p.month === month &&
          p.day === day &&
          p.hour === hour &&
          p.minute === minute
        );
      })
      .sort((a, b) => a - b);
  }

  const yearChangesCache = new Map();

  /** 计算所选城市本年度的偏移变化并按 时区+年份 缓存。逐日检测偏移差，再二分到分钟；这是民用年度概览，不是完整历史转换数据库。 */
  function getYearOffsetChanges(zone, year) {
    const key = `${zone}:${year}`;
    if (yearChangesCache.has(key)) return yearChangesCache.get(key);
    const start = Date.UTC(year, 0, 1),
      end = Date.UTC(year + 1, 0, 1);
    const changes = [],
      offsets = new Set();
    let previous = offset(new Date(start), zone);
    offsets.add(previous);
    for (let instant = start + 86400000; instant <= end; instant += 86400000) {
      const next = offset(new Date(instant), zone);
      if (next !== previous) {
        let lo = instant - 86400000,
          hi = instant;
        while (hi - lo > 60000) {
          const mid = Math.floor((lo + hi) / 120000) * 60000;
          if (offset(new Date(mid), zone) === previous) lo = mid;
          else hi = mid;
        }
        if (hi < end) {
          changes.push({ instant: hi, from: previous, to: next });
          offsets.add(next);
        }
      }
      previous = next;
    }
    const result = { changes, offsets: [...offsets].sort((a, b) => a - b) };
    yearChangesCache.set(key, result);
    return result;
  }

  root.ClockTime = { getYearOffsetChanges, parts, offset, label, view, resolve, pad };
})(typeof window === 'undefined' ? globalThis : window);
