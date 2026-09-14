const mongoose = require('mongoose');

const Listing = require('../models/Listing');
const User = require('../models/User');
const { isManagedAvatarPath } = require('../utils/avatarStorage');

const RECENT_LISTINGS_LIMIT = 4;
const PUBLIC_SELLER_LISTINGS_LIMIT = 12;
const PROFILE_USER_NOT_FOUND = 'PROFILE_USER_NOT_FOUND';
const PROFILE_USER_NOT_FOUND_MESSAGE = 'Không tìm thấy tài khoản.';
const INVALID_PROFILE_AVATAR = 'INVALID_PROFILE_AVATAR';
const INVALID_PROFILE_AVATAR_MESSAGE = 'Ảnh đại diện không hợp lệ.';
const SAFE_USER_FIELDS =
  '_id name email phone avatar address role status createdAt updatedAt';

const createProfileError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getProfileUser = (userId) => {
  if (!mongoose.isValidObjectId(userId)) {
    return null;
  }

  return User.findById(userId).select(SAFE_USER_FIELDS).lean();
};

const getProfileOverview = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) {
    return null;
  }
  


  const sellerFilter = { seller: userId };
  const [profileUser, activeListings, soldListings, hiddenListings, recentListings] =
    await Promise.all([
      getProfileUser(userId),
      Listing.countDocuments({ ...sellerFilter, status: 'active' }),
      Listing.countDocuments({ ...sellerFilter, status: 'sold' }),
      Listing.countDocuments({ ...sellerFilter, status: 'hidden' }),
      Listing.find(sellerFilter)
        .select(
          'title price category location condition images status createdAt updatedAt',
        )
        .populate('category', 'name slug')
        .sort({ createdAt: -1, _id: -1 })
        .limit(RECENT_LISTINGS_LIMIT)
        .lean(),
    ]);

  if (!profileUser) {
    return null;
  }

  return {
    profileUser,
    stats: {
      totalListings: activeListings + soldListings + hiddenListings,
      activeListings,
      soldListings,
      hiddenListings,
    },
    recentListings,
  };
};

const getPublicSellerOverview = async (
  sellerId,
  requestedPage = 1,
) => {
  if (!mongoose.isValidObjectId(sellerId)) {
    return null;
  }

  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0
      ? requestedPage
      : 1;

  const seller = await User.findOne({
    _id: sellerId,
    status: 'active',
  })
    .select('_id name avatar createdAt')
    .lean();

  if (!seller) {
    return null;
  }

  const sellerFilter = {
    seller: sellerId,
  };

  const activeFilter = {
    ...sellerFilter,
    status: 'active',
  };

  const [
    activeListings,
    soldListings,
  ] = await Promise.all([
    Listing.countDocuments(activeFilter),

    Listing.countDocuments({
      ...sellerFilter,
      status: 'sold',
    }),
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(
      activeListings /
      PUBLIC_SELLER_LISTINGS_LIMIT,
    ),
  );

  const normalizedPage =
    activeListings === 0
      ? 1
      : Math.min(page, totalPages);

  const skip =
    (normalizedPage - 1) *
    PUBLIC_SELLER_LISTINGS_LIMIT;

  const listings = await Listing.find(
    activeFilter,
  )
    .select(
      [
        'title',
        'price',
        'category',
        'seller',
        'location',
        'condition',
        'images',
        'status',
        'moderation',
        'createdAt',
        'updatedAt',
      ].join(' '),
    )
    .populate(
      'category',
      'name slug',
    )
    .sort({
      createdAt: -1,
      _id: -1,
    })
    .skip(skip)
    .limit(
      PUBLIC_SELLER_LISTINGS_LIMIT,
    )
    .lean();

  return {
    seller,

    stats: {
      activeListings,
      soldListings,
    },

    listings,

    pagination: {
      page: normalizedPage,

      limit:
        PUBLIC_SELLER_LISTINGS_LIMIT,

      totalItems:
        activeListings,

      totalPages,

      hasPrev:
        normalizedPage > 1,

      hasNext:
        normalizedPage < totalPages,
    },
  };
};

const updateProfile = async (userId, data) => {
  if (!mongoose.isValidObjectId(userId)) {
    throw createProfileError(
      PROFILE_USER_NOT_FOUND,
      PROFILE_USER_NOT_FOUND_MESSAGE,
    );
  }

  const user = await User.findById(userId).select(SAFE_USER_FIELDS);

  if (!user) {
    throw createProfileError(
      PROFILE_USER_NOT_FOUND,
      PROFILE_USER_NOT_FOUND_MESSAGE,
    );
  }

  const nextAvatar = typeof data.avatar === 'string' ? data.avatar : user.avatar;
  const avatarIsAllowed =
    nextAvatar === '' ||
    nextAvatar === user.avatar ||
    isManagedAvatarPath(nextAvatar);

  if (!avatarIsAllowed) {
    throw createProfileError(
      INVALID_PROFILE_AVATAR,
      INVALID_PROFILE_AVATAR_MESSAGE,
    );
  }

  user.name = typeof data.name === 'string' ? data.name.trim() : '';
  user.phone = typeof data.phone === 'string' ? data.phone.trim() : '';
  user.address = typeof data.address === 'string' ? data.address.trim() : '';
  user.avatar = nextAvatar;

  return user.save();
};

module.exports = {
  INVALID_PROFILE_AVATAR,
  INVALID_PROFILE_AVATAR_MESSAGE,
  PROFILE_USER_NOT_FOUND,
  PROFILE_USER_NOT_FOUND_MESSAGE,
  RECENT_LISTINGS_LIMIT,
  
  getPublicSellerOverview,
  getProfileOverview,
  getProfileUser,
  updateProfile,
};
