const mongoose = require('mongoose');

const Conversation = require('../models/Conversation');
const Listing = require('../models/Listing');
const Message = require('../models/Message');

const MESSAGES_PER_PAGE = 50;
const MESSAGE_CONTENT_INVALID = 'MESSAGE_CONTENT_INVALID';
const MESSAGE_CONTENT_REQUIRED_MESSAGE = 'Vui lòng nhập nội dung tin nhắn.';
const MESSAGE_CONTENT_TOO_LONG_MESSAGE =
  'Tin nhắn không được vượt quá 2.000 ký tự.';
const MESSAGE_CONVERSATION_NOT_FOUND = 'MESSAGE_CONVERSATION_NOT_FOUND';
const MESSAGE_CONVERSATION_NOT_FOUND_MESSAGE =
  'Không tìm thấy cuộc trò chuyện.';
const MESSAGE_LISTING_HIDDEN = 'MESSAGE_LISTING_HIDDEN';
const MESSAGE_LISTING_HIDDEN_MESSAGE =
  'Bài đăng đã được ẩn nên không thể gửi tin nhắn mới.';
const MESSAGE_METADATA_UPDATE_FAILED = 'MESSAGE_METADATA_UPDATE_FAILED';

const createMessageError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getReferenceId = (value) => value?._id || value;

const getEmptyPage = () => ({
  items: [],
  pagination: {
    page: 1,
    limit: MESSAGES_PER_PAGE,
    totalItems: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
    previousPage: null,
    nextPage: null,
    hasOlderPage: false,
    olderPage: null,
  },
});

const normalizeMessageContent = (content) => {
  if (typeof content !== 'string') {
    throw createMessageError(
      MESSAGE_CONTENT_INVALID,
      MESSAGE_CONTENT_REQUIRED_MESSAGE,
    );
  }

  const normalizedContent = content.trim();

  if (!normalizedContent) {
    throw createMessageError(
      MESSAGE_CONTENT_INVALID,
      MESSAGE_CONTENT_REQUIRED_MESSAGE,
    );
  }

  if (normalizedContent.length > 2000) {
    throw createMessageError(
      MESSAGE_CONTENT_INVALID,
      MESSAGE_CONTENT_TOO_LONG_MESSAGE,
    );
  }

  return normalizedContent;
};

const getMessagesPage = async (
  conversationId,
  page = 1,
  limit = MESSAGES_PER_PAGE,
) => {
  if (!mongoose.isValidObjectId(conversationId)) {
    return getEmptyPage();
  }

  const safeLimit =
    Number.isSafeInteger(limit) && limit === MESSAGES_PER_PAGE
      ? limit
      : MESSAGES_PER_PAGE;
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const skip = (safePage - 1) * safeLimit;
  const filter = { conversation: conversationId };

  const [newestFirstItems, totalItems] = await Promise.all([
    Message.find(filter)
      .select('conversation sender recipient content readAt createdAt')
      .populate('sender', 'name avatar')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Message.countDocuments(filter),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit));
  const normalizedPage = totalItems === 0 ? 1 : safePage;

  return {
    items: newestFirstItems.reverse(),
    pagination: {
      page: normalizedPage,
      limit: safeLimit,
      totalItems,
      totalPages,
      hasPrev: normalizedPage > 1,
      hasNext: normalizedPage < totalPages,
      previousPage: normalizedPage > 1 ? normalizedPage - 1 : null,
      nextPage: normalizedPage < totalPages ? normalizedPage + 1 : null,
      hasOlderPage: normalizedPage < totalPages,
      olderPage:
        normalizedPage < totalPages ? normalizedPage + 1 : null,
    },
  };
};

const sendMessage = async ({ conversation, senderId, content }) => {
  const conversationId = getReferenceId(conversation);
  const buyerId = getReferenceId(conversation?.buyer);
  const sellerId = getReferenceId(conversation?.seller);
  const listingId = getReferenceId(conversation?.listing);

  if (
    !mongoose.isValidObjectId(conversationId) ||
    !mongoose.isValidObjectId(senderId) ||
    !mongoose.isValidObjectId(buyerId) ||
    !mongoose.isValidObjectId(sellerId) ||
    !mongoose.isValidObjectId(listingId)
  ) {
    throw createMessageError(
      MESSAGE_CONVERSATION_NOT_FOUND,
      MESSAGE_CONVERSATION_NOT_FOUND_MESSAGE,
    );
  }

  const sender = senderId.toString();
  const buyer = buyerId.toString();
  const seller = sellerId.toString();

  if (sender !== buyer && sender !== seller) {
    throw createMessageError(
      MESSAGE_CONVERSATION_NOT_FOUND,
      MESSAGE_CONVERSATION_NOT_FOUND_MESSAGE,
    );
  }

  const recipientId = sender === buyer ? sellerId : buyerId;
  const normalizedContent = normalizeMessageContent(content);
  const lastMessagePreview = normalizedContent.slice(0, 200);
  const session = await mongoose.startSession();
  let createdMessage = null;

  try {
    await session.withTransaction(async () => {
      const listing = await Listing.findById(listingId)
        .select('_id status')
        .session(session)
        .lean();

      if (!listing || !['active', 'sold'].includes(listing.status)) {
        throw createMessageError(
          MESSAGE_LISTING_HIDDEN,
          MESSAGE_LISTING_HIDDEN_MESSAGE,
        );
      }

      const [message] = await Message.create(
        [
          {
            conversation: conversationId,
            sender: senderId,
            recipient: recipientId,
            content: normalizedContent,
            readAt: null,
          },
        ],
        { session },
      );
      const lastMessageAt = message.createdAt;
      const metadataResult = await Conversation.updateOne(
        {
          _id: conversationId,
          buyer: buyerId,
          seller: sellerId,
        },
        {
          $set: {
            lastMessagePreview,
            lastMessageAt,
            lastSender: senderId,
          },
        },
        {
          runValidators: true,
          session,
        },
      );

      if (metadataResult.matchedCount !== 1) {
        throw createMessageError(
          MESSAGE_METADATA_UPDATE_FAILED,
          'Không thể cập nhật cuộc trò chuyện.',
        );
      }

      createdMessage = message;
    });

    return createdMessage;
  } finally {
    await session.endSession();
  }
};

const markConversationAsRead = async (
  conversationId,
  userId,
  readAt = new Date(),
) => {
  if (
    !mongoose.isValidObjectId(conversationId) ||
    !mongoose.isValidObjectId(userId)
  ) {
    return { markedCount: 0 };
  }

  const result = await Message.updateMany(
    {
      conversation: conversationId,
      recipient: userId,
      readAt: null,
    },
    {
      $set: {
        readAt,
      },
    },
  );

  return {
    markedCount: result.modifiedCount || 0,
  };
};

const countUnreadMessages = (userId) => {
  if (!mongoose.isValidObjectId(userId)) {
    return 0;
  }

  return Message.countDocuments({
    recipient: userId,
    readAt: null,
  });
};

module.exports = {
  MESSAGES_PER_PAGE,
  MESSAGE_CONTENT_INVALID,
  MESSAGE_CONTENT_REQUIRED_MESSAGE,
  MESSAGE_CONTENT_TOO_LONG_MESSAGE,
  MESSAGE_CONVERSATION_NOT_FOUND,
  MESSAGE_CONVERSATION_NOT_FOUND_MESSAGE,
  MESSAGE_LISTING_HIDDEN,
  MESSAGE_LISTING_HIDDEN_MESSAGE,
  MESSAGE_METADATA_UPDATE_FAILED,
  countUnreadMessages,
  getMessagesPage,
  markConversationAsRead,
  normalizeMessageContent,
  sendMessage,
};
