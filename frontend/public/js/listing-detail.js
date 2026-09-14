document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.querySelector('[data-product-gallery]');

  if (!gallery) {
    return;
  }

  const mainImage = gallery.querySelector('[data-gallery-main]');
  const mainLink = gallery.querySelector('[data-gallery-link]');
  const counter = gallery.querySelector('[data-gallery-counter]');
  const thumbnails = Array.from(gallery.querySelectorAll('[data-gallery-thumbnail]'));

  if (!mainImage || thumbnails.length === 0) {
    return;
  }

  const selectImage = (thumbnail) => {
    const source = thumbnail.dataset.gallerySrc;
    const alt = thumbnail.dataset.galleryAlt;
    const index = thumbnail.dataset.galleryIndex;

    if (!source || thumbnail.getAttribute('aria-pressed') === 'true') {
      return;
    }

    mainImage.src = source;
    mainImage.alt = alt || mainImage.alt;

    if (mainLink) {
      mainLink.href = source;
    }

    if (counter && index) {
      counter.textContent = `Ảnh ${index} / ${thumbnails.length}`;
    }

    thumbnails.forEach((item) => {
      const isSelected = item === thumbnail;
      item.classList.toggle('is-active', isSelected);
      item.setAttribute('aria-pressed', String(isSelected));
    });
  };

  thumbnails.forEach((thumbnail) => {
    thumbnail.addEventListener('click', () => selectImage(thumbnail));
  });
});
// ==========================================================
// HIỆN SỐ ĐIỆN THOẠI NGƯỜI BÁN
// ==========================================================

document.addEventListener('click', (event) => {
  const button = event.target.closest('.listing-phone-reveal');

  if (!button) {
    return;
  }

  const fullPhone = button.getAttribute('data-full-phone');

  const phoneNumber = button.querySelector(
    '.listing-phone-number',
  );

  const phoneLabel = button.querySelector(
    '.listing-phone-label',
  );

  if (!fullPhone || !phoneNumber) {
    return;
  }

  // Hiện số điện thoại đầy đủ
  phoneNumber.textContent = fullPhone;

  // Ẩn chữ "Hiện số"
  if (phoneLabel) {
    phoneLabel.style.display = 'none';
  }

  // Đánh dấu đã hiện
  button.classList.add('is-revealed');

  // Không cho xử lý reveal lần nữa
  button.removeAttribute('data-full-phone');
});
