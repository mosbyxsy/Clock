/** 数字输入统一增减操作，沿用原生 min/max/step 规则及键盘能力。 */
window.ClockFeatures.createNumberSteppers = function () {
  'use strict';
  for (const wrapper of document.querySelectorAll('.number-stepper')) {
    const input = wrapper.querySelector('input[type="number"]');
    const label = input.labels?.[0]?.textContent.trim() || '数值';
    for (const button of wrapper.querySelectorAll('[data-number-step]')) {
      const increase = Number(button.dataset.numberStep) > 0;
      button.setAttribute('aria-label', `${increase ? '增加' : '减少'}${label}`);
      button.setAttribute('aria-controls', input.id);
      button.addEventListener('click', () => {
        if (input.disabled || input.readOnly) return;
        const previous = input.value;
        if (increase) input.stepUp();
        else input.stepDown();
        // 与手动输入共用通知，立即清理已经失效的计算结果。
        if (input.value !== previous) {
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
  }
};
