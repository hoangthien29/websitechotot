document.addEventListener(
  'DOMContentLoaded',
  () => {

    const page =
      document.querySelector(
        '[data-my-listings-page]',
      );


    if (!page) {
      return;
    }


    const tabs =
      Array.from(
        page.querySelectorAll(
          '[data-listing-filter]',
        ),
      );


    const cards =
      Array.from(
        page.querySelectorAll(
          '[data-my-listing-card]',
        ),
      );


    const summary =
      page.querySelector(
        '[data-listing-filter-summary]',
      );


    const emptyState =
      page.querySelector(
        '[data-listing-filter-empty]',
      );


    if (
      tabs.length === 0 ||
      cards.length === 0
    ) {
      return;
    }


    const labels = {
      active:
        'Đang bán',

      sold:
        'Đã bán',

      hidden:
        'Đã ẩn',
    };



    /* ======================================================
       FILTER
       ====================================================== */

    const setFilter =
      (filter) => {

        let visibleCount =
          0;


        cards.forEach(
          (card) => {

            const isVisible =
              card.dataset.listingStatus ===
              filter;


            card.hidden =
              !isVisible;


            if (isVisible) {
              visibleCount += 1;
            }

          },
        );


        /* TAB ACTIVE */

        tabs.forEach(
          (tab) => {

            const isActive =
              tab.dataset.listingFilter ===
              filter;


            tab.classList.toggle(
              'is-active',
              isActive,
            );


            tab.setAttribute(
              'aria-selected',
              String(isActive),
            );

          },
        );


        /* SUMMARY */

        if (summary) {

          summary.textContent =
            `${
              labels[filter] ||
              'Bài đăng'
            }: ${visibleCount} tin`;

        }


        /* EMPTY */

        if (emptyState) {

          emptyState.hidden =
            visibleCount !== 0;

        }

      };



    /* ======================================================
       CLICK TAB
       ====================================================== */

    tabs.forEach(
      (tab) => {

        tab.addEventListener(
          'click',
          () => {

            setFilter(
              tab.dataset.listingFilter,
            );

          },
        );

      },
    );

    /* ======================================================
       INIT
       ====================================================== */

    const defaultFilter =
      page.dataset.defaultFilter ||
      'active';


    setFilter(
      defaultFilter,
    );

  },
);