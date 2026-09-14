const { body } = require('express-validator');

const createSlug = require('../utils/createSlug');

const categoryValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Tên danh mục không được để trống.')
    .bail()
    .isLength({ min: 2 })
    .withMessage('Tên danh mục phải có ít nhất 2 ký tự.')
    .isLength({ max: 100 })
    .withMessage('Tên danh mục không được vượt quá 100 ký tự.')
    .bail()
    .custom((value) => Boolean(createSlug(value)))
    .withMessage('Tên danh mục phải có ít nhất một chữ hoặc số.'),
  body('description')
    .optional({ nullable: true })
    .isString()
    .withMessage('Mô tả phải là chuỗi ký tự.')
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Mô tả không được vượt quá 500 ký tự.'),
  body('removeImage')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Yêu cầu xóa ảnh danh mục không hợp lệ.')
    .bail()
    .isIn(['1', 'on'])
    .withMessage('Yêu cầu xóa ảnh danh mục không hợp lệ.'),
  body('status')
    .notEmpty()
    .withMessage('Trạng thái danh mục là bắt buộc.')
    .bail()
    .isIn(['active', 'inactive'])
    .withMessage('Trạng thái danh mục không hợp lệ.'),
];

const updateCategoryStatusValidator = [
  body('status')
    .notEmpty()
    .withMessage('Trạng thái danh mục là bắt buộc.')
    .bail()
    .isIn(['active', 'inactive'])
    .withMessage('Trạng thái danh mục không hợp lệ.'),
];

module.exports = {
  createCategoryValidator: categoryValidator,
  updateCategoryStatusValidator,
  updateCategoryValidator: categoryValidator,
};
