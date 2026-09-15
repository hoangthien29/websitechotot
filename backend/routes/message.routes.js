const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');

const messageController = require('../controllers/message.controller');
const {
  conversationLimiter,
  messageLimiter,
} = require('../config/rateLimit');
const { requireAuth } = require('../middlewares/auth.middleware');
const {
  conversationIdValidator,
  conversationsPageValidator,
  listingConversationValidator,
  messagesPageValidator,
  sendMessageValidator,
} = require('../validators/message.validator');

const router = express.Router();

const chatUploadDir = path.resolve(__dirname, '..', '..', 'uploads', 'chat');
fs.mkdirSync(path.join(chatUploadDir, 'images'), { recursive: true });
fs.mkdirSync(path.join(chatUploadDir, 'videos'), { recursive: true });

const chatStorage = multer.diskStorage({
  destination(req, file, callback) {
    const targetDir = file.mimetype.startsWith('video/')
      ? path.join(chatUploadDir, 'videos')
      : path.join(chatUploadDir, 'images');
    callback(null, targetDir);
  },
  filename(req, file, callback) {
    const extension = path.extname(file.originalname) || '';
    callback(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`);
  },
});

const mediaUpload = multer({
  storage: chatStorage,
  limits: { files: 10, fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const allowed = ['image/', 'video/'];
    const isAllowed = allowed.some((prefix) => file.mimetype.startsWith(prefix));

    if (!isAllowed) {
      return callback(new Error('Chỉ hỗ trợ ảnh hoặc video.'));
    }

    return callback(null, true);
  },
});

const uploadMediaForConversation = async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const attachments = files.map((file) => ({
    type: file.mimetype.startsWith('video/') ? 'video' : 'image',
    url: `/uploads/chat/${file.mimetype.startsWith('video/') ? 'videos' : 'images'}/${path.basename(file.path)}`,
    mimeType: file.mimetype,
    size: file.size,
  }));

  return res.status(200).json({ attachments });
};

router.get(
  '/messages',
  requireAuth,
  conversationsPageValidator,
  messageController.listConversations,
);
router.get(
  '/messages/:conversationId/panel',
  requireAuth,
  conversationIdValidator,
  messageController.getConversationPanel,
);
router.get(
  '/messages/:conversationId',
  requireAuth,
  conversationIdValidator,
  messagesPageValidator,
  messageController.showConversation,
);
router.post(
  '/listings/:id/conversations',
  requireAuth,
  conversationLimiter,
  listingConversationValidator,
  messageController.startConversation,
);
router.post(
  '/messages/:conversationId/media',
  requireAuth,
  conversationIdValidator,
  mediaUpload.array('files', 10),
  async (req, res, next) => {
    try {
      return await uploadMediaForConversation(req, res);
    } catch (error) {
      return next(error);
    }
  },
);
router.post(
  '/messages/:conversationId',
  requireAuth,
  messageLimiter,
  multer().none(),
  conversationIdValidator,
  sendMessageValidator,
  messageController.sendMessage,
);

module.exports = router;
