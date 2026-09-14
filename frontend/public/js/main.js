document.addEventListener('DOMContentLoaded', () => {
  const navbar = document.querySelector('.site-navbar');

  if (!navbar) {
    return;
  }

  const updateNavbar = () => {
    navbar.classList.toggle('is-scrolled', window.scrollY > 12);
  };

  let frameRequested = false;

  const requestNavbarUpdate = () => {
    if (frameRequested) {
      return;
    }

    frameRequested = true;
    window.requestAnimationFrame(() => {
      updateNavbar();
      frameRequested = false;
    });
  };

  updateNavbar();
  window.addEventListener('scroll', requestNavbarUpdate, { passive: true });
});
