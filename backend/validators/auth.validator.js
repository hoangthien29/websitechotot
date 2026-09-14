const { body } = require('express-validator');

const registerValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Họ và tên không được để trống.')
    .bail()
    .isLength({ min: 2 })
    .withMessage('Họ và tên phải có ít nhất 2 ký tự.')
    .isLength({ max: 100 })
    .withMessage('Họ và tên không được vượt quá 100 ký tự.'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email không được để trống.')
    .bail()
    .isLength({ max: 254 })
    .withMessage('Email không được vượt quá 254 ký tự.')
    .bail()
    .isEmail()
    .withMessage('Email không hợp lệ.')
    .bail()
    .normalizeEmail({ gmail_remove_dots: false }),
  body('password')
    .notEmpty()
    .withMessage('Mật khẩu không được để trống.')
    .bail()
    .isLength({ min: 8 })
    .withMessage('Mật khẩu phải có ít nhất 8 ký tự.')
    .isLength({ max: 72 })
    .withMessage('Mật khẩu không được vượt quá 72 ký tự.')
    .matches(/[A-Za-z]/)
    .withMessage('Mật khẩu phải có ít nhất một chữ cái.')
    .matches(/[0-9]/)
    .withMessage('Mật khẩu phải có ít nhất một chữ số.'),
  body('confirmPassword')
    .notEmpty()
    .withMessage('Vui lòng xác nhận mật khẩu.')
    .bail()
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Mật khẩu xác nhận không khớp.'),
];

const loginValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email không được để trống.')
    .bail()
    .isLength({ max: 254 })
    .withMessage('Email không được vượt quá 254 ký tự.')
    .bail()
    .isEmail()
    .withMessage('Email không hợp lệ.')
    .bail()
    .normalizeEmail({ gmail_remove_dots: false }),
  body('password')
    .isString()
    .withMessage('Mật khẩu phải là chuỗi ký tự.')
    .bail()
    .notEmpty()
    .withMessage('Mật khẩu không được để trống.')
    .bail()
    .isLength({ max: 72 })
    .withMessage('Mật khẩu không được vượt quá 72 ký tự.'),
];

module.exports = {
  loginValidator,
  registerValidator,
};
