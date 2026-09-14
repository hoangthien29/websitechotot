const mongoose = require('mongoose');

const Conversation = require('../models/Conversation');
const Favorite = require('../models/Favorite');
const Listing = require('../models/Listing');
const Message = require('../models/Message');
const User = require('../models/User');
const escapeRegex = require('../utils/escapeRegex');

const ADMIN_USERS_PER_PAGE = 20;
const ADMIN_USER_NOT_FOUND = 'ADMIN_USER_NOT_FOUND';
const ADMIN_USER_NOT_FOUND_MESSAGE = 'Không tìm thấy tài khoản.';
const ADMIN_USER_PROTECTED = 'ADMIN_USER_PROTECTED';
const ADMIN_USER_PROTECTED_MESSAGE =
  'Không thể thay đổi trạng thái của tài khoản quản trị.';
const ADMIN_USER_TRANSITION_INVALID = 'ADMIN_USER_TRANSITION_INVALID';
const ADMIN_USER_TRANSITION_INVALID_MESSAGE =
  'Trạng thái tài khoản không phù hợp với thao tác này.';
const ADMIN_BLOCK_REASON_INVALID = 'ADMIN_BLOCK_REASON_INVALID';
const ADMIN_BLOCK_REASON_INVALID_MESSAGE =
  'Lý do khóa phải có từ 10 đến 500 ký tự.';
const SAFE_USER_SELECT =
  '_id name email phone avatar address role status accountModeration createdAt updatedAt';
const USER_SORT_OPTIONS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  'name-asc': { name: 1, _id: 1 },
  'name-desc': { name: -1, _id: -1 },
};

const createAdminUserError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const assertValidUserId = (userId) => {
  if (!mongoose.isValidObjectId(userId)) {
    throw createAdminUserError(
      ADMIN_USER_NOT_FOUND,
      ADMIN_USER_NOT_FOUND_MESSAGE,
    );
  }
};

const createPagination = (page, totalItems) => {
  const totalPages = Math.max(
    1,
    Math.ceil(totalItems / ADMIN_USERS_PER_PAGE),
  );
  const normalizedPage = totalItems === 0 ? 1 : page;

  return {
    page: normalizedPage,
    limit: ADMIN_USERS_PER_PAGE,
    totalItems,
    totalPages,
    hasPrev: normalizedPage > 1,
    hasNext: normalizedPage < totalPages,
    previousPage: normalizedPage > 1 ? normalizedPage - 1 : null,
    nextPage: normalizedPage < totalPages ? normalizedPage + 1 : null,
  };
};

const getUsersPage = async (filters) => {
  const mongoFilter = {};

  if (filters.keyword) {
    const keyword = new RegExp(escapeRegex(filters.keyword), 'i');
    mongoFilter.$or = [{ name: keyword }, { email: keyword }];
  }

  if (['active', 'pending', 'blocked'].includes(filters.status)) {
    mongoFilter.status = filters.status;
  }

  if (['user', 'admin'].includes(filters.role)) {
    mongoFilter.role = filters.role;
  }

  const page = filters.page;
  const skip = (page - 1) * ADMIN_USERS_PER_PAGE;
  const sort = USER_SORT_OPTIONS[filters.sort] || USER_SORT_OPTIONS.newest;
  const [items, totalItems] = await Promise.all([
    User.find(mongoFilter)
      .select(SAFE_USER_SELECT)
      .sort(sort)
      .skip(skip)
      .limit(ADMIN_USERS_PER_PAGE)
      .lean(),
    User.countDocuments(mongoFilter),
  ]);

  return {
    items,
    pagination: createPagination(page, totalItems),
  };
};

const getUserAdminDetail = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) {
    return null;
  }

  const user = await User.findById(userId)
    .select(SAFE_USER_SELECT)
    .populate('accountModeration.blockedBy', 'name')
    .populate('accountModeration.approvedBy', 'name')
    .lean();

  if (!user) {
    return null;
  }

  const sellerFilter = { seller: userId };
  const [
    totalListings,
    activeListings,
    soldListings,
    hiddenListings,
    favoriteCount,
    conversationCount,
    sentMessageCount,
    recentListings,
  ] = await Promise.all([
    Listing.countDocuments(sellerFilter),
    Listing.countDocuments({ ...sellerFilter, status: 'active' }),
    Listing.countDocuments({ ...sellerFilter, status: 'sold' }),
    Listing.countDocuments({ ...sellerFilter, status: 'hidden' }),
    Favorite.countDocuments({ user: userId }),
    Conversation.countDocuments({
      $or: [{ buyer: userId }, { seller: userId }],
    }),
    Message.countDocuments({ sender: userId }),
    Listing.find(sellerFilter)
      .select(
        '_id title price status condition images moderation category createdAt',
      )
      .populate('category', 'name slug')
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .lean(),
  ]);

  return {
    user,
    stats: {
      totalListings,
      activeListings,
      soldListings,
      hiddenListings,
      favoriteCount,
      conversationCount,
      sentMessageCount,
    },
    recentListings,
  };
};

const classifyTransitionFailure = async (userId) => {
  const target = await User.findById(userId)
    .select('_id role status')
    .lean();

  if (!target) {
    throw createAdminUserError(
      ADMIN_USER_NOT_FOUND,
      ADMIN_USER_NOT_FOUND_MESSAGE,
    );
  }

  if (target.role === 'admin') {
    throw createAdminUserError(
      ADMIN_USER_PROTECTED,
      ADMIN_USER_PROTECTED_MESSAGE,
    );
  }

  throw createAdminUserError(
    ADMIN_USER_TRANSITION_INVALID,
    ADMIN_USER_TRANSITION_INVALID_MESSAGE,
  );
};

const approveUser = async (userId, adminId) => {
  assertValidUserId(userId);
  assertValidUserId(adminId);

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      role: 'user',
      status: 'pending',
    },
    {
      $set: {
        status: 'active',
        'accountModeration.approvedAt': new Date(),
        'accountModeration.approvedBy': adminId,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    },
  ).select(SAFE_USER_SELECT);

  if (!user) {
    return classifyTransitionFailure(userId);
  }

  return user;
};

const blockUser = async (userId, adminId, reason) => {
  assertValidUserId(userId);
  assertValidUserId(adminId);

  const normalizedReason =
    typeof reason === 'string' ? reason.trim() : '';

  if (
    normalizedReason.length < 10 ||
    normalizedReason.length > 500
  ) {
    throw createAdminUserError(
      ADMIN_BLOCK_REASON_INVALID,
      ADMIN_BLOCK_REASON_INVALID_MESSAGE,
    );
  }

  if (userId.toString() === adminId.toString()) {
    throw createAdminUserError(
      ADMIN_USER_PROTECTED,
      ADMIN_USER_PROTECTED_MESSAGE,
    );
  }

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      role: 'user',
      status: 'active',
    },
    {
      $set: {
        status: 'blocked',
        'accountModeration.blockedReason': normalizedReason,
        'accountModeration.blockedAt': new Date(),
        'accountModeration.blockedBy': adminId,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    },
  ).select(SAFE_USER_SELECT);

  if (!user) {
    return classifyTransitionFailure(userId);
  }

  return user;
};

const unblockUser = async (userId, adminId) => {
  assertValidUserId(userId);
  assertValidUserId(adminId);

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      role: 'user',
      status: 'blocked',
    },
    {
      $set: {
        status: 'active',
        'accountModeration.blockedReason': '',
        'accountModeration.blockedAt': null,
        'accountModeration.blockedBy': null,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    },
  ).select(SAFE_USER_SELECT);

  if (!user) {
    return classifyTransitionFailure(userId);
  }

  return user;
};

module.exports = {
  ADMIN_BLOCK_REASON_INVALID,
  ADMIN_BLOCK_REASON_INVALID_MESSAGE,
  ADMIN_USERS_PER_PAGE,
  ADMIN_USER_NOT_FOUND,
  ADMIN_USER_NOT_FOUND_MESSAGE,
  ADMIN_USER_PROTECTED,
  ADMIN_USER_PROTECTED_MESSAGE,
  ADMIN_USER_TRANSITION_INVALID,
  ADMIN_USER_TRANSITION_INVALID_MESSAGE,
  approveUser,
  blockUser,
  getUserAdminDetail,
  getUsersPage,
  unblockUser,
};
