const { body, checkExact, param, query } = require('express-validator');

const userIdRule = param('id')
  .isString()
  .withMessage('Tài khoản không tồn tại.')
  .bail()
  .isMongoId()
  .withMessage('Tài khoản không tồn tại.');

const emptyActionBodyRule = body().custom((value) => {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return true;
  }

  throw new Error('Dữ liệu thay đổi tài khoản không được hỗ trợ.');
});

const adminUsersQueryValidator = checkExact(
  [
    query('keyword')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Từ khóa không hợp lệ.')
      .bail()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Từ khóa không được vượt quá 100 ký tự.'),
    query('status')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Trạng thái tài khoản không hợp lệ.')
      .bail()
      .trim()
      .isIn(['all', 'active', 'pending', 'blocked'])
      .withMessage('Trạng thái tài khoản không hợp lệ.'),
    query('role')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Vai trò tài khoản không hợp lệ.')
      .bail()
      .trim()
      .isIn(['all', 'user', 'admin'])
      .withMessage('Vai trò tài khoản không hợp lệ.'),
    query('sort')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Kiểu sắp xếp không hợp lệ.')
      .bail()
      .trim()
      .isIn(['newest', 'oldest', 'name-asc', 'name-desc'])
      .withMessage('Kiểu sắp xếp không hợp lệ.'),
    query('page')
      .optional({ values: 'falsy' })
      .isInt({ min: 1, max: 10000 })
      .withMessage('Trang phải là số nguyên từ 1 đến 10.000.')
      .bail()
      .toInt(),
  ],
  {
    locations: ['query'],
    message: 'Tham số quản lý tài khoản không được hỗ trợ.',
  },
);

const adminUserIdValidator = checkExact(
  [userIdRule, emptyActionBodyRule],
  {
  locations: ['params', 'body'],
  message: 'Dữ liệu thay đổi tài khoản không được hỗ trợ.',
  },
);

const blockUserValidator = checkExact(
  [
    userIdRule,
    body('reason')
      .isString()
      .withMessage('Lý do khóa không hợp lệ.')
      .bail()
      .trim()
      .notEmpty()
      .withMessage('Vui lòng nhập lý do khóa tài khoản.')
      .bail()
      .isLength({ min: 10, max: 500 })
      .withMessage('Lý do khóa phải có từ 10 đến 500 ký tự.'),
  ],
  {
    locations: ['params', 'body'],
    message: 'Dữ liệu khóa tài khoản không được hỗ trợ.',
  },
);

module.exports = {
  adminUserIdValidator,
  adminUsersQueryValidator,
  blockUserValidator,
};
