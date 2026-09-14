const { body, checkExact, param, query } = require('express-validator');

const listingIdRule = param('id')
  .isString()
  .withMessage('Bài đăng không tồn tại.')
  .bail()
  .isMongoId()
  .withMessage('Bài đăng không tồn tại.');

const emptyActionBodyRule = body().custom((value) => {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return true;
  }

  throw new Error('Dữ liệu thay đổi bài đăng không được hỗ trợ.');
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

const adminListingIdValidator = checkExact(
  [listingIdRule, emptyActionBodyRule],
  {
    locations: ['params', 'body'],
    message: 'Dữ liệu thay đổi bài đăng không được hỗ trợ.',
  },
);

const hideListingValidator = checkExact(
  [
    listingIdRule,
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
  ],
  {
    locations: ['params', 'body'],
    message: 'Dữ liệu kiểm duyệt bài đăng không được hỗ trợ.',
  },
);

module.exports = {
  adminListingIdValidator,
  adminListingsQueryValidator,
  hideListingValidator,
};
