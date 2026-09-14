const mongoose = require('mongoose');

const Category = require('../models/Category');
const Conversation = require('../models/Conversation');
const Favorite = require('../models/Favorite');
const Listing = require('../models/Listing');
const Message = require('../models/Message');
const User = require('../models/User');
const escapeRegex = require('../utils/escapeRegex');

const ADMIN_LISTINGS_PER_PAGE = 20;
const ADMIN_LISTING_NOT_FOUND = 'ADMIN_LISTING_NOT_FOUND';
const ADMIN_LISTING_NOT_FOUND_MESSAGE = 'Không tìm thấy bài đăng.';
const ADMIN_LISTING_STATE_INVALID = 'ADMIN_LISTING_STATE_INVALID';
const ADMIN_LISTING_STATE_INVALID_MESSAGE =
  'Trạng thái bài đăng không phù hợp với thao tác kiểm duyệt này.';
const ADMIN_LISTING_REASON_INVALID = 'ADMIN_LISTING_REASON_INVALID';
const ADMIN_LISTING_REASON_INVALID_MESSAGE =
  'Lý do kiểm duyệt phải có từ 10 đến 500 ký tự.';
const SAFE_LISTING_SELECT =
  '_id title description price category seller location condition images status moderation createdAt updatedAt';
const LISTING_SORT_OPTIONS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  'price-asc': { price: 1, createdAt: -1, _id: -1 },
  'price-desc': { price: -1, createdAt: -1, _id: -1 },
  'title-asc': { title: 1, _id: 1 },
};

const createAdminListingError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const assertValidId = (value) => {
  if (!mongoose.isValidObjectId(value)) {
    throw createAdminListingError(
      ADMIN_LISTING_NOT_FOUND,
      ADMIN_LISTING_NOT_FOUND_MESSAGE,
    );
  }
};

const populateAdminListing = (query) =>
  query
    .populate('category', 'name slug status')
    .populate('seller', 'name email avatar status')
    .populate('moderation.moderatedBy', 'name');

const createPagination = (page, totalItems) => {
  const totalPages = Math.max(
    1,
    Math.ceil(totalItems / ADMIN_LISTINGS_PER_PAGE),
  );
  const normalizedPage = totalItems === 0 ? 1 : page;

  return {
    page: normalizedPage,
    limit: ADMIN_LISTINGS_PER_PAGE,
    totalItems,
    totalPages,
    hasPrev: normalizedPage > 1,
    hasNext: normalizedPage < totalPages,
    previousPage: normalizedPage > 1 ? normalizedPage - 1 : null,
    nextPage: normalizedPage < totalPages ? normalizedPage + 1 : null,
  };
};

const resolveCategoryId = async (slug) => {
  if (!slug) {
    return undefined;
  }

  const category = await Category.findOne({ slug })
    .select('_id')
    .lean();

  return category?._id || null;
};

const resolveSellerIds = async (sellerKeyword) => {
  if (!sellerKeyword) {
    return undefined;
  }

  const sellerRegex = new RegExp(escapeRegex(sellerKeyword), 'i');
  const sellers = await User.find({
    $or: [{ name: sellerRegex }, { email: sellerRegex }],
  })
    .select('_id')
    .lean();

  return sellers.map((seller) => seller._id);
};

const createListingFilter = async (filters) => {
  const mongoFilter = {};

  if (filters.keyword) {
    const keyword = new RegExp(escapeRegex(filters.keyword), 'i');
    mongoFilter.$or = [{ title: keyword }, { description: keyword }];
  }

  const [categoryId, sellerIds] = await Promise.all([
    resolveCategoryId(filters.category),
    resolveSellerIds(filters.seller),
  ]);

  if (categoryId !== undefined) {
    mongoFilter.category = categoryId || { $in: [] };
  }

  if (sellerIds !== undefined) {
    mongoFilter.seller = { $in: sellerIds };
  }

  if (['active', 'sold', 'hidden'].includes(filters.status)) {
    mongoFilter.status = filters.status;
  }

  if (filters.moderation === 'admin-hidden') {
    mongoFilter.status = 'hidden';
    mongoFilter['moderation.isHiddenByAdmin'] = true;
  } else if (filters.moderation === 'owner-hidden') {
    mongoFilter.status = 'hidden';
    mongoFilter['moderation.isHiddenByAdmin'] = { $ne: true };
  } else if (filters.moderation === 'not-hidden') {
    mongoFilter.status = { $in: ['active', 'sold'] };
  }

  return mongoFilter;
};

const getListingsPage = async (filters) => {
  const mongoFilter = await createListingFilter(filters);
  const page = filters.page;
  const skip = (page - 1) * ADMIN_LISTINGS_PER_PAGE;
  const sort =
    LISTING_SORT_OPTIONS[filters.sort] || LISTING_SORT_OPTIONS.newest;
  const [items, totalItems] = await Promise.all([
    populateAdminListing(
      Listing.find(mongoFilter)
        .select(SAFE_LISTING_SELECT)
        .sort(sort)
        .skip(skip)
        .limit(ADMIN_LISTINGS_PER_PAGE),
    ).lean(),
    Listing.countDocuments(mongoFilter),
  ]);

  return {
    items,
    pagination: createPagination(page, totalItems),
  };
};

const getListingAdminDetail = async (listingId) => {
  if (!mongoose.isValidObjectId(listingId)) {
    return null;
  }

  const listing = await populateAdminListing(
    Listing.findById(listingId).select(SAFE_LISTING_SELECT),
  ).lean();

  if (!listing) {
    return null;
  }

  const [favoriteCount, conversations] = await Promise.all([
    Favorite.countDocuments({ listing: listingId }),
    Conversation.find({ listing: listingId }).select('_id').lean(),
  ]);
  const conversationIds = conversations.map(
    (conversation) => conversation._id,
  );
  const messageCount =
    conversationIds.length === 0
      ? 0
      : await Message.countDocuments({
          conversation: { $in: conversationIds },
        });

  return {
    listing,
    stats: {
      favoriteCount,
      conversationCount: conversations.length,
      messageCount,
    },
  };
};

const classifyModerationFailure = async (listingId) => {
  const listing = await Listing.findById(listingId)
    .select('_id status moderation')
    .lean();

  if (!listing) {
    throw createAdminListingError(
      ADMIN_LISTING_NOT_FOUND,
      ADMIN_LISTING_NOT_FOUND_MESSAGE,
    );
  }

  throw createAdminListingError(
    ADMIN_LISTING_STATE_INVALID,
    ADMIN_LISTING_STATE_INVALID_MESSAGE,
  );
};

const hideListingByAdmin = async (listingId, adminId, reason) => {
  assertValidId(listingId);
  assertValidId(adminId);

  const normalizedReason =
    typeof reason === 'string' ? reason.trim() : '';

  if (
    normalizedReason.length < 10 ||
    normalizedReason.length > 500
  ) {
    throw createAdminListingError(
      ADMIN_LISTING_REASON_INVALID,
      ADMIN_LISTING_REASON_INVALID_MESSAGE,
    );
  }

  const moderatedBy = new mongoose.Types.ObjectId(String(adminId));
  const listing = await Listing.findOneAndUpdate(
    {
      _id: listingId,
      status: { $in: ['active', 'sold'] },
      'moderation.isHiddenByAdmin': { $ne: true },
    },
    [
      {
        $set: {
          moderation: {
            isHiddenByAdmin: true,
            reason: normalizedReason,
            moderatedAt: new Date(),
            moderatedBy,
            previousStatus: '$status',
          },
          status: 'hidden',
        },
      },
    ],
    {
      returnDocument: 'after',
      updatePipeline: true,
    },
  );

  if (!listing) {
    return classifyModerationFailure(listingId);
  }

  return listing;
};

const restoreListingByAdmin = async (listingId) => {
  assertValidId(listingId);

  const current = await Listing.findOne({
    _id: listingId,
    status: 'hidden',
    'moderation.isHiddenByAdmin': true,
  })
    .select('_id moderation.previousStatus')
    .lean();

  if (!current) {
    return classifyModerationFailure(listingId);
  }

  const previousStatus = current.moderation?.previousStatus;
  const restoredStatus = ['active', 'sold'].includes(previousStatus)
    ? previousStatus
    : 'active';
  const previousStatusFilter = ['active', 'sold'].includes(previousStatus)
    ? previousStatus
    : { $nin: ['active', 'sold'] };
  const listing = await Listing.findOneAndUpdate(
    {
      _id: listingId,
      status: 'hidden',
      'moderation.isHiddenByAdmin': true,
      'moderation.previousStatus': previousStatusFilter,
    },
    {
      $set: {
        status: restoredStatus,
        moderation: {
          isHiddenByAdmin: false,
          reason: '',
          moderatedAt: null,
          moderatedBy: null,
          previousStatus: null,
        },
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    },
  );

  if (!listing) {
    return classifyModerationFailure(listingId);
  }

  return {
    listing,
    restoredStatus,
    usedFallback: !['active', 'sold'].includes(previousStatus),
  };
};

module.exports = {
  ADMIN_LISTINGS_PER_PAGE,
  ADMIN_LISTING_NOT_FOUND,
  ADMIN_LISTING_NOT_FOUND_MESSAGE,
  ADMIN_LISTING_REASON_INVALID,
  ADMIN_LISTING_REASON_INVALID_MESSAGE,
  ADMIN_LISTING_STATE_INVALID,
  ADMIN_LISTING_STATE_INVALID_MESSAGE,
  getListingAdminDetail,
  getListingsPage,
  hideListingByAdmin,
  restoreListingByAdmin,
};
