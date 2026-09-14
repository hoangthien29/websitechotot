const mongoose = require('mongoose');

const Favorite = require('../models/Favorite');
const Listing = require('../models/Listing');

const FAVORITES_PER_PAGE = 12;
const FAVORITE_LISTING_NOT_FOUND = 'FAVORITE_LISTING_NOT_FOUND';
const FAVORITE_LISTING_NOT_FOUND_MESSAGE = 'Không tìm thấy bài đăng.';
const FAVORITE_OWN_LISTING = 'FAVORITE_OWN_LISTING';
const FAVORITE_OWN_LISTING_MESSAGE =
  'Bạn không thể lưu bài đăng của chính mình.';
const PUBLIC_LISTING_STATUSES = ['active', 'sold'];
const FAVORITE_LISTING_SELECT =
  'title description price category seller location condition images status createdAt updatedAt';

const createFavoriteError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const toObjectId = (value) =>
  new mongoose.Types.ObjectId(String(value));

const isDuplicateKeyError = (error) => error?.code === 11000;

const addFavorite = async (userId, listingId) => {
  if (
    !mongoose.isValidObjectId(userId) ||
    !mongoose.isValidObjectId(listingId)
  ) {
    throw createFavoriteError(
      FAVORITE_LISTING_NOT_FOUND,
      FAVORITE_LISTING_NOT_FOUND_MESSAGE,
    );
  }

  const listing = await Listing.findById(listingId)
    .select('_id seller status')
    .lean();

  if (!listing || !PUBLIC_LISTING_STATUSES.includes(listing.status)) {
    throw createFavoriteError(
      FAVORITE_LISTING_NOT_FOUND,
      FAVORITE_LISTING_NOT_FOUND_MESSAGE,
    );
  }

  if (listing.seller?.toString() === userId.toString()) {
    throw createFavoriteError(
      FAVORITE_OWN_LISTING,
      FAVORITE_OWN_LISTING_MESSAGE,
    );
  }

  try {
    const result = await Favorite.updateOne(
      {
        user: userId,
        listing: listingId,
      },
      {
        $setOnInsert: {
          user: userId,
          listing: listingId,
        },
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return {
      created: result.upsertedCount === 1,
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { created: false };
    }

    throw error;
  }
};

const removeFavorite = async (userId, listingId) => {
  if (
    !mongoose.isValidObjectId(userId) ||
    !mongoose.isValidObjectId(listingId)
  ) {
    return { removed: false };
  }

  const result = await Favorite.deleteOne({
    user: userId,
    listing: listingId,
  });

  return {
    removed: result.deletedCount === 1,
  };
};

const getFavoriteListingIds = async (userId, listingIds = []) => {
  if (!mongoose.isValidObjectId(userId) || !Array.isArray(listingIds)) {
    return new Set();
  }

  const validListingIds = [
    ...new Set(
      listingIds
        .filter((listingId) => mongoose.isValidObjectId(listingId))
        .map(String),
    ),
  ];

  if (validListingIds.length === 0) {
    return new Set();
  }

  const favorites = await Favorite.find({
    user: userId,
    listing: { $in: validListingIds },
  })
    .select('listing -_id')
    .lean();

  return new Set(favorites.map((favorite) => favorite.listing.toString()));
};

const isListingFavorited = async (userId, listingId) => {
  if (
    !mongoose.isValidObjectId(userId) ||
    !mongoose.isValidObjectId(listingId)
  ) {
    return false;
  }

  const favorite = await Favorite.exists({
    user: userId,
    listing: listingId,
  });

  return Boolean(favorite);
};

const getUserFavoritesPage = async (
  userId,
  page = 1,
  limit = FAVORITES_PER_PAGE,
) => {
  if (!mongoose.isValidObjectId(userId)) {
    return {
      items: [],
      pagination: {
        page: 1,
        limit: FAVORITES_PER_PAGE,
        totalItems: 0,
        totalPages: 1,
        hasPrev: false,
        hasNext: false,
        previousPage: null,
        nextPage: null,
      },
    };
  }

  const safeLimit =
    Number.isSafeInteger(limit) && limit === FAVORITES_PER_PAGE
      ? limit
      : FAVORITES_PER_PAGE;
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const skip = (safePage - 1) * safeLimit;
  const [result = {}] = await Favorite.aggregate([
    {
      $match: {
        user: toObjectId(userId),
      },
    },
    {
      $lookup: {
        from: Listing.collection.name,
        localField: 'listing',
        foreignField: '_id',
        as: 'listingDocument',
      },
    },
    {
      $unwind: '$listingDocument',
    },
    {
      $match: {
        'listingDocument.status': { $in: PUBLIC_LISTING_STATUSES },
      },
    },
    {
      $sort: {
        createdAt: -1,
        _id: -1,
      },
    },
    {
      $facet: {
        metadata: [{ $count: 'totalItems' }],
        rows: [
          { $skip: skip },
          { $limit: safeLimit },
          { $project: { _id: 0, listing: 1 } },
        ],
      },
    },
  ]);

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const listingIds = rows.map((row) => row.listing);
  let items = [];

  if (listingIds.length > 0) {
    const listings = await Listing.find({
      _id: { $in: listingIds },
      status: { $in: PUBLIC_LISTING_STATUSES },
    })
      .select(FAVORITE_LISTING_SELECT)
      .populate('category', 'name slug')
      .populate('seller', 'name avatar')
      .lean();
    const listingsById = new Map(
      listings.map((listing) => [listing._id.toString(), listing]),
    );

    items = listingIds
      .map((listingId) => listingsById.get(listingId.toString()))
      .filter(Boolean);
  }

  const totalItems = result.metadata?.[0]?.totalItems || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit));
  const normalizedPage = totalItems === 0 ? 1 : safePage;

  return {
    items,
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
  FAVORITES_PER_PAGE,
  FAVORITE_LISTING_NOT_FOUND,
  FAVORITE_LISTING_NOT_FOUND_MESSAGE,
  FAVORITE_OWN_LISTING,
  FAVORITE_OWN_LISTING_MESSAGE,
  addFavorite,
  getFavoriteListingIds,
  getUserFavoritesPage,
  isListingFavorited,
  removeFavorite,
};
