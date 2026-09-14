document.addEventListener('DOMContentLoaded', () => {
  const toggleButtons = document.querySelectorAll(
    '[data-password-toggle]',
  );

  toggleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const inputId =
        button.dataset.passwordToggle;

      const input =
        document.getElementById(inputId);

      if (!input) {
        return;
      }

      const shouldShow =
        input.type === 'password';

      input.type =
        shouldShow
          ? 'text'
          : 'password';

      button.setAttribute(
        'aria-label',
        shouldShow
          ? 'Ẩn mật khẩu'
          : 'Hiện mật khẩu',
      );
    });
  });
});