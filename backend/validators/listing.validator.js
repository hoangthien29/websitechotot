const { body, checkExact, param, query } = require('express-validator');

const MAX_FILTER_PRICE = 100000000000;

const listListingsQueryValidator = checkExact(
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
      .withMessage('Danh mục không hợp lệ.'),
    query('condition')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Tình trạng sản phẩm không hợp lệ.')
      .bail()
      .trim()
      .isIn(['new', 'used'])
      .withMessage('Tình trạng sản phẩm không hợp lệ.'),
    query('minPrice')
      .optional({ values: 'falsy' })
      .isInt({ min: 0, max: MAX_FILTER_PRICE })
      .withMessage('Giá tối thiểu phải là số nguyên hợp lệ từ 0 đến 100.000.000.000.')
      .bail()
      .toInt(),
    query('maxPrice')
      .optional({ values: 'falsy' })
      .isInt({ min: 0, max: MAX_FILTER_PRICE })
      .withMessage('Giá tối đa phải là số nguyên hợp lệ từ 0 đến 100.000.000.000.')
      .bail()
      .toInt()
      .custom((value, { req }) => {
        if (
          req.query.minPrice !== undefined &&
          Number(req.query.minPrice) > Number(value)
        ) {
          throw new Error('Giá tối thiểu không được lớn hơn giá tối đa.');
        }

        return true;
      }),
    query('location')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Địa điểm không hợp lệ.')
      .bail()
      .trim()
      .isLength({ max: 150 })
      .withMessage('Địa điểm không được vượt quá 150 ký tự.'),
    query('status')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Trạng thái bài đăng không hợp lệ.')
      .bail()
      .trim()
      .isIn(['all', 'active', 'sold'])
      .withMessage('Trạng thái bài đăng không hợp lệ.'),
    query('sort')
      .optional({ values: 'falsy' })
      .isString()
      .withMessage('Kiểu sắp xếp không hợp lệ.')
      .bail()
      .trim()
      .isIn(['newest', 'oldest', 'price-asc', 'price-desc'])
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
    message: 'Tham số tìm kiếm không được hỗ trợ.',
  },
);

const listingValidator = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Tiêu đề không được để trống.')
    .bail()
    .isLength({ min: 5, max: 150 })
    .withMessage('Tiêu đề phải có từ 5 đến 150 ký tự.'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Mô tả không được để trống.')
    .bail()
    .isLength({ min: 20, max: 3000 })
    .withMessage('Mô tả phải có từ 20 đến 3000 ký tự.'),
  body('price')
    .notEmpty()
    .withMessage('Giá sản phẩm không được để trống.')
    .bail()
    .isFloat({ min: 0, max: 100000000000 })
    .withMessage('Giá phải là số từ 0 đến 100.000.000.000.')
    .bail()
    .custom((value) => Number.isFinite(Number(value)))
    .withMessage('Giá sản phẩm phải là một số hữu hạn.')
    .toFloat(),
  body('category')
    .notEmpty()
    .withMessage('Vui lòng chọn danh mục.')
    .bail()
    .isMongoId()
    .withMessage('Danh mục không hợp lệ.'),
  body('location')
    .trim()
    .notEmpty()
    .withMessage('Địa điểm không được để trống.')
    .bail()
    .isLength({ min: 2, max: 150 })
    .withMessage('Địa điểm phải có từ 2 đến 150 ký tự.'),
  body('condition')
    .notEmpty()
    .withMessage('Tình trạng sản phẩm là bắt buộc.')
    .bail()
    .isIn(['new', 'used'])
    .withMessage('Tình trạng sản phẩm không hợp lệ.'),
];

const updateListingStatusValidator = [
  body('status')
    .notEmpty()
    .withMessage('Trạng thái bài đăng là bắt buộc.')
    .bail()
    .isIn(['active', 'sold', 'hidden'])
    .withMessage('Trạng thái bài đăng không hợp lệ.'),
];

const listingIdValidator = [
  param('id').isMongoId().withMessage('Bài đăng không tồn tại.'),
];

module.exports = {
  createListingValidator: listingValidator,
  listListingsQueryValidator,
  listingIdValidator,
  updateListingStatusValidator,
  updateListingValidator: listingValidator,
};
