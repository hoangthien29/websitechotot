(() => {
  const counters = document.querySelectorAll('[data-admin-count]');

  if (counters.length === 0) {
    return;
  }

  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  const formatter = new Intl.NumberFormat('vi-VN');

  counters.forEach((counter) => {
    const target = Number(counter.dataset.adminCount);

    if (!Number.isFinite(target) || target < 0 || reduceMotion) {
      counter.textContent = formatter.format(target || 0);
      return;
    }

    const duration = 400;
    const startedAt = performance.now();

    const render = (time) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 4;
      counter.textContent = formatter.format(
        Math.round(target * eased),
      );

      if (progress < 1) {
        requestAnimationFrame(render);
      }
    };

    requestAnimationFrame(render);
  });
})();
