const { checkExact, param, query } = require('express-validator');

const favoriteListingIdValidator = [
  param('id')
    .isString()
    .withMessage('Bài đăng không tồn tại.')
    .bail()
    .isMongoId()
    .withMessage('Bài đăng không tồn tại.'),
];

const favoritesPageValidator = checkExact(
  [
    query('page')
      .optional()
      .isString()
      .withMessage('Trang phải là số nguyên từ 1 đến 10.000.')
      .bail()
      .isInt({ min: 1, max: 10000 })
      .withMessage('Trang phải là số nguyên từ 1 đến 10.000.')
      .bail()
      .toInt(),
  ],
  {
    locations: ['query'],
    message: 'Tham số trang không được hỗ trợ.',
  },
);

module.exports = {
  favoriteListingIdValidator,
  favoritesPageValidator,
};
