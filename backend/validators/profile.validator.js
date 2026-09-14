const { body } = require('express-validator');

const updateProfileValidator = [
  body('name')
    .isString()
    .withMessage('Họ và tên không hợp lệ.')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Họ và tên không được để trống.')
    .bail()
    .isLength({ min: 2, max: 100 })
    .withMessage('Họ và tên phải có từ 2 đến 100 ký tự.'),
  body('phone')
    .optional({ nullable: true })
    .isString()
    .withMessage('Số điện thoại không hợp lệ.')
    .bail()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Số điện thoại không được vượt quá 20 ký tự.')
    .bail()
    .custom((value) => {
      if (!value) {
        return true;
      }

      if (!/^\+?[0-9\s-]+$/.test(value)) {
        throw new Error(
          'Số điện thoại chỉ được chứa chữ số, khoảng trắng, dấu cộng ở đầu hoặc dấu gạch ngang.',
        );
      }

      const digits = value.replace(/[\s-]/g, '').replace(/^\+/, '');

      if (!/^\d{8,15}$/.test(digits)) {
        throw new Error('Số điện thoại phải có từ 8 đến 15 chữ số.');
      }

      return true;
    }),
  body('address')
    .optional({ nullable: true })
    .isString()
    .withMessage('Địa chỉ không hợp lệ.')
    .bail()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Địa chỉ không được vượt quá 200 ký tự.'),
  body('removeAvatar')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Yêu cầu xóa ảnh đại diện không hợp lệ.')
    .bail()
    .isIn(['1', 'on'])
    .withMessage('Yêu cầu xóa ảnh đại diện không hợp lệ.'),
];

module.exports = {
  updateProfileValidator,
};
