const normalizeListingImageType = (file) => {
  if (!file || typeof file !== 'object') {
    return null;
  }

  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';

  if (type === 'image/jpeg' || type === 'image/jpg') {
    return 'image/jpeg';
  }

  if (type === 'image/png' || type === 'image/webp') {
    return type;
  }

  const extension = typeof file.name === 'string'
    ? file.name.toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[0]
    : null;

  if (!extension) {
    return null;
  }

  if (extension.endsWith('.jpg') || extension.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (extension.endsWith('.png')) {
    return 'image/png';
  }

  if (extension.endsWith('.webp')) {
    return 'image/webp';
  }

  return null;
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector(
    '[data-listing-editor-form]',
  );

  if (!form) {
    return;
  }

  /* ======================================================
     CẤU HÌNH
     ====================================================== */

  const maxImages = Number(
    form.dataset.maxImages || 5,
  );

  const existingImageCount = Number(
    form.dataset.existingImages || 0,
  );

  const canSubmitFromServer =
    form.dataset.canSubmit !== 'false';


  /* ======================================================
     ELEMENT
     ====================================================== */

  const imageInput = form.querySelector(
    '[data-listing-image-input]',
  );

  const imageSlots = Array.from(
    form.querySelectorAll(
      '[data-image-slot]',
    ),
  );

  const selectedCount = form.querySelector(
    '[data-selected-image-count]',
  );

  const slotText = form.querySelector(
    '[data-image-slot-text]',
  );

  const imageClientError = form.querySelector(
    '[data-image-client-error]',
  );

  const removeExistingInputs = Array.from(
    form.querySelectorAll(
      '[data-remove-existing-image]',
    ),
  );

  const submitButton = form.querySelector(
    '[data-listing-submit]',
  );

  const titleInput = form.querySelector(
    '[data-title-input]',
  );

  const titleCounter = form.querySelector(
    '[data-title-counter]',
  );

  const descriptionInput = form.querySelector(
    '[data-description-input]',
  );

  const descriptionCounter = form.querySelector(
    '[data-description-counter]',
  );

  const priceInput = form.querySelector(
    '[data-price-input]',
  );

  const pricePreview = form.querySelector(
    '[data-price-preview]',
  );


  /* ======================================================
     STATE ẢNH
     ====================================================== */

  let selectedFiles = [];
  let previewUrls = [];


  /* ======================================================
     ẢNH CŨ KHI SỬA TIN
     ====================================================== */

  const getRemovedExistingCount = () =>
    removeExistingInputs.filter(
      (input) => input.checked,
    ).length;


  const getKeptExistingCount = () =>
    Math.max(
      0,
      existingImageCount -
        getRemovedExistingCount(),
    );


  const getAvailableNewSlots = () =>
    Math.max(
      0,
      maxImages -
        getKeptExistingCount(),
    );


  /* ======================================================
     OBJECT URL
     ====================================================== */

  const clearPreviewUrls = () => {
    previewUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });

    previewUrls = [];
  };


  /* ======================================================
     ĐỒNG BỘ selectedFiles → input.files
     ====================================================== */

  const syncInputFiles = () => {
    if (!imageInput) {
      return;
    }

    const transfer = new DataTransfer();

    selectedFiles.forEach((file) => {
      transfer.items.add(file);
    });

    imageInput.files = transfer.files;
  };


  /* ======================================================
     SUBMIT STATE
     ====================================================== */

  const updateSubmitState = () => {
    if (!submitButton) {
      return;
    }

    const totalImages =
      getKeptExistingCount() +
      selectedFiles.length;

    submitButton.disabled =
      !canSubmitFromServer ||
      totalImages > maxImages;
  };


  /* ======================================================
     RENDER 5 Ô ẢNH
     ====================================================== */

  const renderImageSlots = () => {
    clearPreviewUrls();

    const availableNewSlots =
      getAvailableNewSlots();

    imageSlots.forEach(
      (slot, index) => {
        const preview = slot.querySelector(
          '[data-image-slot-preview]',
        );

        const placeholder = slot.querySelector(
          '[data-image-slot-placeholder]',
        );

        const number = slot.querySelector(
          '[data-image-slot-number]',
        );

        const remove = slot.querySelector(
          '[data-image-slot-remove]',
        );

        const file = selectedFiles[index];

        /*
         * Trường hợp trang Edit:
         * ảnh cũ đang chiếm giới hạn 5 ảnh.
         */
        const unavailable =
          index >= availableNewSlots &&
          !file;

        slot.classList.toggle(
          'is-unavailable',
          unavailable,
        );

        slot.disabled = unavailable;


        if (file) {
          const objectUrl =
            URL.createObjectURL(file);

          previewUrls.push(objectUrl);

          if (preview) {
            preview.src = objectUrl;
            preview.alt =
              `Ảnh sản phẩm ${index + 1}`;

            preview.hidden = false;
          }

          if (placeholder) {
            placeholder.hidden = true;
          }

          if (number) {
            number.hidden = false;
          }

          if (remove) {
            remove.hidden = false;
          }

          slot.classList.add(
            'has-image',
          );
        } else {
          if (preview) {
            preview.removeAttribute('src');
            preview.hidden = true;
          }

          if (placeholder) {
            placeholder.hidden = false;
          }

          if (number) {
            number.hidden = true;
          }

          if (remove) {
            remove.hidden = true;
          }

          slot.classList.remove(
            'has-image',
          );
        }
      },
    );


    /* SỐ LƯỢNG */

    const keptExisting =
      getKeptExistingCount();

    const total =
      keptExisting +
      selectedFiles.length;


    if (selectedCount) {
      if (total === 0) {
        selectedCount.textContent =
          'Chưa chọn ảnh';
      } else {
        selectedCount.textContent =
          `Đã có ${total}/${maxImages} ảnh`;
      }
    }


    if (slotText) {
      const remaining =
        Math.max(
          0,
          maxImages - total,
        );

      slotText.textContent =
        remaining > 0
          ? `Còn ${remaining} vị trí ảnh.`
          : `Đã đủ ${maxImages} ảnh.`;
    }


    updateSubmitState();
  };


  /* ======================================================
     CLICK Ô → MỞ CHỌN ẢNH
     ====================================================== */

  imageSlots.forEach((slot) => {
    slot.addEventListener(
      'click',
      (event) => {
        /*
         * Bấm dấu X thì không mở picker.
         */
        if (
          event.target.closest(
            '[data-image-slot-remove]',
          )
        ) {
          return;
        }

        if (!imageInput) {
          return;
        }

        const available =
          getAvailableNewSlots();

        if (
          selectedFiles.length >= available
        ) {
          if (imageClientError) {
            imageClientError.textContent =
              `Bạn chỉ được đăng tối đa ${maxImages} ảnh.`;
          }

          return;
        }

        /*
         * Đây chính là dòng mở cửa sổ chọn ảnh.
         */
        imageInput.click();
      },
    );
  });


  /* ======================================================
     SAU KHI USER CHỌN FILE
     ====================================================== */

  if (imageInput) {
    imageInput.addEventListener(
      'change',
      () => {
        const chosenFiles =
          Array.from(
            imageInput.files || [],
          );


        if (
          chosenFiles.length === 0
        ) {
          return;
        }


        const validFiles =
          chosenFiles.filter(
            (file) => {
              const validType =
                normalizeListingImageType(file) !== null;

              const validSize =
                file.size <=
                5 * 1024 * 1024;

              return (
                validType &&
                validSize
              );
            },
          );


        const available =
          getAvailableNewSlots() -
          selectedFiles.length;


        const filesToAdd =
          validFiles.slice(
            0,
            Math.max(0, available),
          );


        selectedFiles.push(
          ...filesToAdd,
        );


        /* ERROR FILE */

        if (imageClientError) {
          if (
            validFiles.length <
            chosenFiles.length
          ) {
            imageClientError.textContent =
              'Chỉ chấp nhận JPG, JPEG, PNG hoặc WEBP và tối đa 5 MB/ảnh.';
          } else if (
            chosenFiles.length >
            available
          ) {
            imageClientError.textContent =
              `Bạn chỉ còn ${Math.max(
                0,
                available,
              )} vị trí ảnh.`;
          } else {
            imageClientError.textContent =
              '';
          }
        }


        /*
         * Quan trọng:
         * input vừa chọn phải được đồng bộ lại
         * với toàn bộ selectedFiles.
         */
        syncInputFiles();

        renderImageSlots();
      },
    );
  }


  /* ======================================================
     XÓA ẢNH MỚI
     ====================================================== */

  imageSlots.forEach(
    (slot, index) => {
      const remove =
        slot.querySelector(
          '[data-image-slot-remove]',
        );

      if (!remove) {
        return;
      }

      remove.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          selectedFiles.splice(
            index,
            1,
          );

          syncInputFiles();

          renderImageSlots();

          if (imageClientError) {
            imageClientError.textContent =
              '';
          }
        },
      );
    },
  );


  /* ======================================================
     XÓA ẢNH CŨ TRANG EDIT
     ====================================================== */

  removeExistingInputs.forEach(
    (input) => {
      input.addEventListener(
        'change',
        () => {
          const card = input.closest(
            '[data-existing-image-card]',
          );

          if (card) {
            card.classList.toggle(
              'is-selected-for-removal',
              input.checked,
            );
          }


          /*
           * Nếu đánh dấu xóa ảnh cũ,
           * sẽ có thêm vị trí cho ảnh mới.
           */
          const available =
            getAvailableNewSlots();

          if (
            selectedFiles.length >
            available
          ) {
            selectedFiles =
              selectedFiles.slice(
                0,
                available,
              );

            syncInputFiles();
          }

          renderImageSlots();
        },
      );
    },
  );


  /* ======================================================
     COUNTER
     ====================================================== */

  const bindCounter = (
    input,
    counter,
    maxLength,
  ) => {
    if (!input || !counter) {
      return;
    }

    const update = () => {
      counter.textContent =
        `${input.value.length}/${maxLength}`;
    };

    input.addEventListener(
      'input',
      update,
    );

    update();
  };


  bindCounter(
    titleInput,
    titleCounter,
    150,
  );

  bindCounter(
    descriptionInput,
    descriptionCounter,
    3000,
  );


  /* ======================================================
     FORMAT GIÁ
     ====================================================== */

  const updatePricePreview = () => {
    if (
      !priceInput ||
      !pricePreview
    ) {
      return;
    }

    const raw =
      priceInput.value.trim();

    if (!raw) {
      pricePreview.textContent = '';
      return;
    }

    const value =
      Number(raw);

    if (
      !Number.isFinite(value) ||
      value < 0
    ) {
      pricePreview.textContent = '';
      return;
    }

    pricePreview.textContent =
      `${new Intl.NumberFormat(
        'vi-VN',
      ).format(value)} VNĐ`;
  };


  if (priceInput) {
    priceInput.addEventListener(
      'input',
      updatePricePreview,
    );

    updatePricePreview();
  }


  /* ======================================================
     INIT
     ====================================================== */

  renderImageSlots();


  window.addEventListener(
    'beforeunload',
    clearPreviewUrls,
  );
});