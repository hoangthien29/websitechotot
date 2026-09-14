document.addEventListener('DOMContentLoaded', () => {
  const form =
    document.querySelector(
      '[data-profile-edit-form]',
    );

  if (!form) {
    return;
  }


  const avatarInput =
    form.querySelector(
      '[data-profile-avatar-input]',
    );

  const avatarPreview =
    form.querySelector(
      '[data-profile-avatar-preview]',
    );

  const removeAvatar =
    form.querySelector(
      '[data-remove-avatar]',
    );

  const address =
    form.querySelector('#address');

  const addressCounter =
    form.querySelector(
      '[data-address-counter]',
    );


  let previewUrl = null;


  /* ========================================================
     AVATAR PREVIEW
     ======================================================== */

  if (
    avatarInput &&
    avatarPreview
  ) {

    avatarInput.addEventListener(
      'change',
      () => {

        const file =
          avatarInput.files?.[0];

        if (!file) {
          return;
        }


        if (previewUrl) {
          URL.revokeObjectURL(
            previewUrl,
          );
        }


        previewUrl =
          URL.createObjectURL(
            file,
          );


        avatarPreview.src =
          previewUrl;


        /*
         * Nếu chọn ảnh mới thì bỏ chọn
         * "Xóa ảnh hiện tại".
         */
        if (removeAvatar) {
          removeAvatar.checked =
            false;
        }

      },
    );

  }


  /* ========================================================
     ADDRESS COUNTER
     ======================================================== */

  const updateAddressCounter =
    () => {

      if (
        !address ||
        !addressCounter
      ) {
        return;
      }


      addressCounter.textContent =
        `${address.value.length} / 200`;

    };


  if (address) {

    address.addEventListener(
      'input',
      updateAddressCounter,
    );


    updateAddressCounter();

  }


  /* ========================================================
     CLEAN URL
     ======================================================== */

  window.addEventListener(
    'beforeunload',
    () => {

      if (previewUrl) {
        URL.revokeObjectURL(
          previewUrl,
        );
      }

    },
  );

});