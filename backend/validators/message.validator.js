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
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Vui lòng nhập nội dung tin nhắn.')
    .bail()
    .trim()
    .custom((value, { req }) => {
      const contentIsEmpty = !value || !value.trim();
      const attachments = req.body?.attachments;
      const hasAttachments = Array.isArray(attachments)
        ? attachments.length > 0
        : typeof attachments === 'string' && attachments.trim().length > 0;

      if (contentIsEmpty && !hasAttachments) {
        throw new Error('Vui lòng nhập nội dung tin nhắn.');
      }

      if (typeof value === 'string' && value.trim().length > 2000) {
        throw new Error('Tin nhắn không được vượt quá 2.000 ký tự.');
      }

      return true;
    }),
  body('attachments')
    .optional()
    .custom((value) => {
      if (value === undefined || value === null || value === '') {
        return true;
      }

      let attachments;
      try {
        attachments = Array.isArray(value) ? value : JSON.parse(value);
      } catch {
        throw new Error('Định dạng file đính kèm không hợp lệ.');
      }
      if (!Array.isArray(attachments)) {
        throw new Error('Định dạng file đính kèm không hợp lệ.');
      }

      for (const attachment of attachments) {
        if (!attachment || typeof attachment !== 'object') {
          throw new Error('Định dạng file đính kèm không hợp lệ.');
        }

        if (!['image', 'video'].includes(String(attachment.type || '').toLowerCase())) {
          throw new Error('Chỉ hỗ trợ ảnh hoặc video.');
        }

        if (typeof attachment.url !== 'string' || !attachment.url.trim()) {
          throw new Error('Đường dẫn file đính kèm không hợp lệ.');
        }
      }

      return true;
    }),
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
