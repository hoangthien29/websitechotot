const mongoose = require('mongoose');

const Conversation = require('../models/Conversation');
const Listing = require('../models/Listing');
const Message = require('../models/Message');

const CONVERSATIONS_PER_PAGE = 20;
const CONVERSATION_NOT_FOUND = 'CONVERSATION_NOT_FOUND';
const CONVERSATION_NOT_FOUND_MESSAGE = 'Không tìm thấy cuộc trò chuyện.';
const CONVERSATION_LISTING_NOT_FOUND = 'CONVERSATION_LISTING_NOT_FOUND';
const CONVERSATION_LISTING_NOT_FOUND_MESSAGE = 'Không tìm thấy bài đăng.';
const CONVERSATION_OWN_LISTING = 'CONVERSATION_OWN_LISTING';
const CONVERSATION_OWN_LISTING_MESSAGE =
  'Bạn không thể bắt đầu cuộc trò chuyện với chính mình.';
const CONVERSATION_LISTING_SOLD = 'CONVERSATION_LISTING_SOLD';
const CONVERSATION_LISTING_SOLD_MESSAGE =
  'Bài đăng đã bán nên không thể bắt đầu cuộc trò chuyện mới.';
const PARTICIPANT_SELECT = 'name avatar';
const LISTING_SELECT = 'title status images price';

const createConversationError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const toObjectId = (value) =>
  new mongoose.Types.ObjectId(String(value));

const isDuplicateKeyError = (error) => error?.code === 11000;

const getEmptyPage = () => ({
  items: [],
  pagination: {
    page: 1,
    limit: CONVERSATIONS_PER_PAGE,
    totalItems: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
    previousPage: null,
    nextPage: null,
  },
});

const findExistingConversationForListing = (
  listingId,
  buyerId,
  sellerId,
) => {
  if (
    !mongoose.isValidObjectId(listingId) ||
    !mongoose.isValidObjectId(buyerId) ||
    !mongoose.isValidObjectId(sellerId)
  ) {
    return null;
  }

  return Conversation.findOne({
    listing: listingId,
    buyer: buyerId,
    seller: sellerId,
  })
    .select('_id listing buyer seller')
    .lean();
};

const findOrCreateConversation = async (listingId, userId) => {
  if (
    !mongoose.isValidObjectId(listingId) ||
    !mongoose.isValidObjectId(userId)
  ) {
    throw createConversationError(
      CONVERSATION_LISTING_NOT_FOUND,
      CONVERSATION_LISTING_NOT_FOUND_MESSAGE,
    );
  }

  const listing = await Listing.findById(listingId)
    .select('_id seller status')
    .lean();

  if (!listing || !mongoose.isValidObjectId(listing.seller)) {
    throw createConversationError(
      CONVERSATION_LISTING_NOT_FOUND,
      CONVERSATION_LISTING_NOT_FOUND_MESSAGE,
    );
  }

  const sellerId = listing.seller.toString();
  const buyerId = userId.toString();

  if (listing.status === 'hidden') {
    const hiddenConversation = await findExistingConversationForListing(
      listing._id,
      buyerId,
      sellerId,
    );

    if (hiddenConversation) {
      return hiddenConversation;
    }

    throw createConversationError(
      CONVERSATION_LISTING_NOT_FOUND,
      CONVERSATION_LISTING_NOT_FOUND_MESSAGE,
    );
  }

  if (sellerId === buyerId) {
    throw createConversationError(
      CONVERSATION_OWN_LISTING,
      CONVERSATION_OWN_LISTING_MESSAGE,
    );
  }

  const existingConversation = await findExistingConversationForListing(
    listing._id,
    buyerId,
    sellerId,
  );

  if (existingConversation) {
    return existingConversation;
  }

  if (listing.status === 'sold') {
    throw createConversationError(
      CONVERSATION_LISTING_SOLD,
      CONVERSATION_LISTING_SOLD_MESSAGE,
    );
  }

  if (listing.status !== 'active') {
    throw createConversationError(
      CONVERSATION_LISTING_NOT_FOUND,
      CONVERSATION_LISTING_NOT_FOUND_MESSAGE,
    );
  }

  const filter = {
    listing: listing._id,
    buyer: userId,
    seller: listing.seller,
  };

  try {
    return await Conversation.findOneAndUpdate(
      filter,
      {
        $setOnInsert: filter,
      },
      {
        returnDocument: 'after',
        runValidators: true,
        setDefaultsOnInsert: true,
        upsert: true,
      },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    const concurrentConversation =
      await findExistingConversationForListing(
        listing._id,
        buyerId,
        sellerId,
      );

    if (concurrentConversation) {
      return concurrentConversation;
    }

    throw error;
  }
};

const getConversationForParticipant = (conversationId, userId) => {
  if (
    !mongoose.isValidObjectId(conversationId) ||
    !mongoose.isValidObjectId(userId)
  ) {
    return null;
  }

  return Conversation.findOne({
    _id: conversationId,
    $or: [{ buyer: userId }, { seller: userId }],
  })
    .select(
      'listing buyer seller lastMessagePreview lastMessageAt lastSender createdAt updatedAt',
    )
    .populate('listing', LISTING_SELECT)
    .populate('buyer', PARTICIPANT_SELECT)
    .populate('seller', PARTICIPANT_SELECT)
    .lean();
};

const getUserConversationsPage = async (
  userId,
  page = 1,
  limit = CONVERSATIONS_PER_PAGE,
) => {
  if (!mongoose.isValidObjectId(userId)) {
    return getEmptyPage();
  }

  const safeLimit =
    Number.isSafeInteger(limit) && limit === CONVERSATIONS_PER_PAGE
      ? limit
      : CONVERSATIONS_PER_PAGE;
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const skip = (safePage - 1) * safeLimit;
  const participantFilter = {
    $or: [{ buyer: userId }, { seller: userId }],
  };

  const [items, totalItems] = await Promise.all([
    Conversation.find(participantFilter)
      .select(
        'listing buyer seller lastMessagePreview lastMessageAt lastSender createdAt updatedAt',
      )
      .populate('listing', LISTING_SELECT)
      .populate('buyer', PARTICIPANT_SELECT)
      .populate('seller', PARTICIPANT_SELECT)
      .sort({ lastMessageAt: -1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Conversation.countDocuments(participantFilter),
  ]);

  const conversationIds = items.map((conversation) => conversation._id);
  let unreadByConversation = new Map();

  if (conversationIds.length > 0) {
    const unreadRows = await Message.aggregate([
      {
        $match: {
          conversation: { $in: conversationIds },
          recipient: toObjectId(userId),
          readAt: null,
        },
      },
      {
        $group: {
          _id: '$conversation',
          unreadCount: { $sum: 1 },
        },
      },
    ]);

    unreadByConversation = new Map(
      unreadRows.map((row) => [
        row._id.toString(),
        row.unreadCount,
      ]),
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit));
  const normalizedPage = totalItems === 0 ? 1 : safePage;

  return {
    items: items.map((conversation) => ({
      ...conversation,
      unreadCount:
        unreadByConversation.get(conversation._id.toString()) || 0,
    })),
    pagination: {
      page: normalizedPage,
      limit: safeLimit,
      totalItems,
      totalPages,
      hasPrev: normalizedPage > 1,
      hasNext: normalizedPage < totalPages,
      previousPage: normalizedPage > 1 ? normalizedPage - 1 : null,
      nextPage: normalizedPage < totalPages ? normalizedPage + 1 : null,
    },
  };
};

module.exports = {
  CONVERSATIONS_PER_PAGE,
  CONVERSATION_LISTING_NOT_FOUND,
  CONVERSATION_LISTING_NOT_FOUND_MESSAGE,
  CONVERSATION_LISTING_SOLD,
  CONVERSATION_LISTING_SOLD_MESSAGE,
  CONVERSATION_NOT_FOUND,
  CONVERSATION_NOT_FOUND_MESSAGE,
  CONVERSATION_OWN_LISTING,
  CONVERSATION_OWN_LISTING_MESSAGE,
  findExistingConversationForListing,
  findOrCreateConversation,
  getConversationForParticipant,
  getUserConversationsPage,
};
