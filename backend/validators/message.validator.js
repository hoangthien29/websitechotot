const { body, checkExact, param, query } = require('express-validator');

const PAGE_ERROR_MESSAGE = 'Trang phải là số nguyên từ 1 đến 10.000.';

const conversationIdValidator = [
  param('conversationId')
    .isString()
    .withMessage('Không tìm thấy cuộc trò chuyện.')
    .bail()
    .isMongoId()
    .withMessage('Không tìm thấy cuộc trò chuyện.'),
];

const listingConversationValidator = [
  param('id')
    .isString()
    .withMessage('Không tìm thấy bài đăng.')
    .bail()
    .isMongoId()
    .withMessage('Không tìm thấy bài đăng.'),
];

const sendMessageValidator = [
  body('content')
    .isString()
    .withMessage('Vui lòng nhập nội dung tin nhắn.')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Vui lòng nhập nội dung tin nhắn.')
    .bail()
    .isLength({ max: 2000 })
    .withMessage('Tin nhắn không được vượt quá 2.000 ký tự.'),
];

const createPageValidator = () =>
  checkExact(
    [
      query('page')
        .optional()
        .isString()
        .withMessage(PAGE_ERROR_MESSAGE)
        .bail()
        .isInt({ min: 1, max: 10000 })
        .withMessage(PAGE_ERROR_MESSAGE)
        .bail()
        .toInt(),
    ],
    {
      locations: ['query'],
      message: 'Tham số trang không được hỗ trợ.',
    },
  );

const conversationsPageValidator = createPageValidator();
const messagesPageValidator = createPageValidator();

module.exports = {
  conversationIdValidator,
  conversationsPageValidator,
  listingConversationValidator,
  messagesPageValidator,
  sendMessageValidator,
};
