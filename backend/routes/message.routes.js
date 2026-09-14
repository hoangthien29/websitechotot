const express = require('express');

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

router.get(
  '/messages',
  requireAuth,
  conversationsPageValidator,
  messageController.listConversations,
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
  '/messages/:conversationId',
  requireAuth,
  messageLimiter,
  conversationIdValidator,
  sendMessageValidator,
  messageController.sendMessage,
);

module.exports = router;
