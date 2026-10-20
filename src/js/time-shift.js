/**
 * 时间推算：把基准当地时间解析成 UTC 瞬间，再加减实际毫秒时长。
 * 天/时/分/秒均允许任意非负安全整数，不强制小时小于24或分秒小于60。
 * 1天固定为24小时；跨夏令时后显示的当地钟点可能改变，不按“日历日”加减。
 */
window.ClockFeatures.createTimeShift = function () {
  'use strict';
  const { getById, parseZoneValue } = ClockUI;
  const durationFields = [
    { id: 'shiftDays', label: '天', seconds: 86400 },
    { id: 'shiftHours', label: '小时', seconds: 3600 },
    { id: 'shiftMinutes', label: '分', seconds: 60 },
    { id: 'shiftSeconds', label: '秒', seconds: 1 },
  ];
  getById('shiftZone').append(...[...getById('source').children].map((n) => n.cloneNode(true)));
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const deviceCity = CITIES.find((city) => city.zone === deviceZone);
  getById('shiftZone').value = deviceCity
    ? 'c' + deviceCity.id
    : 'o' + -new Date().getTimezoneOffset();
  if (!getById('shiftZone').value) getById('shiftZone').value = 'c0';
  const getSelectedZone = () => parseZoneValue(getById('shiftZone').value);
  const formatLocalTime = (date) => {
    const v = ClockTime.view(date, getSelectedZone());
    return `${v.date} ${v.weekday} ${v.time} · ${ClockTime.label(v.offset)}`;
  };
  /** 按当前选择的城市/固定偏移填入设备此刻，并保留秒精度。 */
  function useCurrentTime() {
    const v = ClockTime.view(new Date(), getSelectedZone());
    getById('shiftBase').value = v.input + ':' + ClockTime.pad(v.second);
    clearResult();
  }
  /** 输入变化即作废旧结果与重复时间选择，同时移除结果外框，避免出现空容器。 */
  function clearResult() {
    getById('shiftResult').replaceChildren();
    getById('shiftResult').className = '';
    getById('shiftAmbiguity').replaceChildren();
  }
  function showError(message) {
    getById('shiftResult').className = 'error';
    getById('shiftResult').textContent = message;
  }
  /** 在确定基准 UTC 瞬间后做加减，检查 Date 范围，再投影回来源时区显示。 */
  function showResult(base, { seconds, values }) {
    const result = new Date(+base + Number(getById('shiftDirection').value) * seconds * 1000);
    if (!Number.isFinite(+result) || result.getUTCFullYear() < 1 || result.getUTCFullYear() > 9999)
      return showError('计算结果超出可显示的年份范围（1–9999 年），请减小时长。');
    getById('shiftResult').replaceChildren();
    getById('shiftResult').className = 'shift-result';
    for (const [tag, text] of [
      ['h3', '推算结果'],
      ['p', formatLocalTime(result)],
      ['small', `基准：${formatLocalTime(base)}`],
      [
        'small',
        `${getById('shiftDirection').value === '1' ? '加上' : '减去'} ${
          values
            .map((n, i) => (n ? n + ' ' + durationFields[i].label : ''))
            .filter(Boolean)
            .join(' ') || '0 秒'
        } · 共 ${seconds.toLocaleString('zh-CN')} 秒`,
      ],
      [
        'small',
        `时区：${typeof getSelectedZone() === 'number' ? ClockTime.label(getSelectedZone()) + '（固定偏移）' : getSelectedZone()}`,
      ],
    ]) {
      const n = document.createElement(tag);
      n.textContent = text;
      getById('shiftResult').append(n);
    }
  }

  /** 先检查整数、总时长精度和日期范围，再复用 ClockTime.resolve 处理夏令时跳过与重复。秒在分钟解析完成后追加。 */
  function calculate(event) {
    event?.preventDefault();
    clearResult();
    getById('shiftResult').className = '';
    const ids = durationFields.map((field) => field.id);
    const values = ids.map((id) =>
      getById(id).value.trim() === '' ? 0 : Number(getById(id).value)
    );
    if (values.some((n) => !Number.isSafeInteger(n) || n < 0))
      return showError('请输入非负整数；未填写的项目按 0 计算。');
    const seconds = values.reduce((sum, n, i) => sum + n * durationFields[i].seconds, 0);
    if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(seconds * 1000))
      return showError('输入的时长过大，请减小数值。');
    if (!ids.some((id) => getById(id).value.trim() !== ''))
      return showError('请至少填写一项时长。');
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/.exec(getById('shiftBase').value);
    if (!match) return showError('请选择有效的基准日期与时间。');
    const candidates = ClockTime.resolve(match[1], getSelectedZone()).map(
      (d) => new Date(+d + Number(match[2] || 0) * 1000)
    );
    if (!candidates.length)
      return showError(
        '该当地时间不存在（可能处于夏令时跳过区间），或超出 1900–2100 年输入范围，请重新选择。'
      );
    if (candidates.length > 1) {
      const title = document.createElement('p');
      title.textContent = '该当地时间因时钟拨回出现两次，请选择基准：';
      getById('shiftAmbiguity').append(title);
      for (const base of candidates) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${formatLocalTime(base)} / ${base.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}`;
        button.onclick = () => {
          [...getById('shiftAmbiguity').querySelectorAll('button')].forEach((b) =>
            b.setAttribute('aria-pressed', String(b === button))
          );
          showResult(base, { seconds, values });
        };
        getById('shiftAmbiguity').append(button);
      }
    } else showResult(candidates[0], { seconds, values });
  }
  getById('shiftForm').onsubmit = calculate;
  getById('shiftForm').addEventListener('input', clearResult);
  getById('shiftForm').addEventListener('change', clearResult);
  getById('shiftNow').onclick = useCurrentTime;
  getById('shiftClear').onclick = () => {
    for (const { id } of durationFields) getById(id).value = '';
    clearResult();
    getById('shiftDays').focus();
  };
  createCityPicker(getById('shiftZone'), '搜索城市或 UTC 偏移…');
  useCurrentTime();
};
