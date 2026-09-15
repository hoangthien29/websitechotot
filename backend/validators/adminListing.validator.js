const { body, checkExact, param, query } = require('express-validator');

const ACTION_META_KEYS = new Set(['_csrf', '_method']);

const listingIdRule = param('id')
  .isString()
  .withMessage('Bài đăng không tồn tại.')
  .bail()
  .isMongoId()
  .withMessage('Bài đăng không tồn tại.');

const validateActionBody = (value, allowedKeys = [], errorMessage) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return true;
  }

  const allowed = new Set([...ACTION_META_KEYS, ...allowedKeys]);
  const keys = Object.keys(value);

  if (keys.length === 0) {
    return true;
  }

  const hasOnlyAllowedKeys = keys.every((key) => allowed.has(key));

  if (hasOnlyAllowedKeys) {
    return true;
  }

  throw new Error(errorMessage);
};

const emptyActionBodyRule = body().custom((value) => {
  validateActionBody(
    value,
    ['reason'],
    'Dữ liệu thay đổi bài đăng không được hỗ trợ.',
  );
  return true;
});

const hideActionBodyRule = body().custom((value) => {
  validateActionBody(
    value,
    ['reason'],
    'Dữ liệu kiểm duyệt bài đăng không được hỗ trợ.',
  );
  return true;
});

const adminListingsQueryValidator = checkExact(
  [
    query('keyword')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Từ khóa không hợp lệ.')
      .bail()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Từ khóa không được vượt quá 100 ký tự.'),
    query('category')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Danh mục không hợp lệ.')
      .bail()
      .trim()
      .isLength({ max: 150 })
      .withMessage('Danh mục không được vượt quá 150 ký tự.'),
    query('status')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Trạng thái bài đăng không hợp lệ.')
      .bail()
      .trim()
      .isIn(['all', 'active', 'sold', 'hidden'])
      .withMessage('Trạng thái bài đăng không hợp lệ.'),
    query('moderation')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Bộ lọc kiểm duyệt không hợp lệ.')
      .bail()
      .trim()
      .isIn(['all', 'admin-hidden', 'owner-hidden', 'not-hidden'])
      .withMessage('Bộ lọc kiểm duyệt không hợp lệ.'),
    query('seller')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Người bán không hợp lệ.')
      .bail()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Từ khóa người bán không được vượt quá 100 ký tự.'),
    query('sort')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Kiểu sắp xếp không hợp lệ.')
      .bail()
      .trim()
      .isIn([
        'newest',
        'oldest',
        'price-asc',
        'price-desc',
        'title-asc',
      ])
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
    message: 'Tham số quản lý bài đăng không được hỗ trợ.',
  },
);

const adminListingIdValidator = [
  listingIdRule,
  emptyActionBodyRule,
];

const hideListingValidator = [
  listingIdRule,
  hideActionBodyRule,
  body('reason')
    .isString()
    .withMessage('Lý do kiểm duyệt không hợp lệ.')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Vui lòng nhập lý do kiểm duyệt.')
    .bail()
    .isLength({ min: 10, max: 500 })
    .withMessage('Lý do kiểm duyệt phải có từ 10 đến 500 ký tự.'),
];

module.exports = {
  adminListingIdValidator,
  adminListingsQueryValidator,
  hideListingValidator,
};
