const mongoose = require('mongoose');

const Category = require('../models/Category');
const Listing = require('../models/Listing');
const escapeRegex = require('../utils/escapeRegex');
const { isListingImagePublicPath } = require('../utils/fileStorage');

const LISTING_NOT_FOUND = 'LISTING_NOT_FOUND';
const LISTING_NOT_FOUND_MESSAGE = 'Không tìm thấy bài đăng.';
const CATEGORY_NOT_FOUND = 'CATEGORY_NOT_FOUND';
const CATEGORY_NOT_FOUND_MESSAGE = 'Danh mục không tồn tại.';
const CATEGORY_INACTIVE = 'CATEGORY_INACTIVE';
const CATEGORY_INACTIVE_MESSAGE =
  'Danh mục này hiện không hoạt động. Vui lòng chọn danh mục khác.';
const INVALID_LISTING_STATUS = 'INVALID_LISTING_STATUS';
const INVALID_LISTING_STATUS_MESSAGE = 'Trạng thái bài đăng không hợp lệ.';
const LISTING_ADMIN_HIDDEN = 'LISTING_ADMIN_HIDDEN';
const LISTING_ADMIN_HIDDEN_MESSAGE =
  'Bài đăng đang bị quản trị viên ẩn và không thể chỉnh sửa.';
const ALLOWED_STATUSES = ['active', 'sold', 'hidden'];
const PUBLIC_STATUSES = ['active', 'sold'];
const LISTINGS_PER_PAGE = 12;
const PUBLIC_LISTING_SELECT =
  'title description price category seller location condition images status moderation createdAt updatedAt';
const PUBLIC_SORT_OPTIONS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  'price-asc': { price: 1, createdAt: -1, _id: -1 },
  'price-desc': { price: -1, createdAt: -1, _id: -1 },
};

const createListingError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const populatePublicListing = (query) =>
  query
    .populate('category', 'name slug')
    .populate('seller', 'name avatar');

const createPublicListingFilter = (filters, categoryId) => {
  const mongoFilter = {
    status:
      filters.status === 'active' || filters.status === 'sold'
        ? filters.status
        : { $in: PUBLIC_STATUSES },
  };

  if (filters.keyword) {
    const keywordRegex = new RegExp(escapeRegex(filters.keyword), 'i');
    mongoFilter.$or = [
      { title: keywordRegex },
      { description: keywordRegex },
    ];
  }

  if (categoryId && mongoose.isValidObjectId(categoryId)) {
    mongoFilter.category = categoryId;
  }

  if (filters.condition === 'new' || filters.condition === 'used') {
    mongoFilter.condition = filters.condition;
  }

  if (filters.minPrice !== null || filters.maxPrice !== null) {
    mongoFilter.price = {};

    if (filters.minPrice !== null) {
      mongoFilter.price.$gte = filters.minPrice;
    }

    if (filters.maxPrice !== null) {
      mongoFilter.price.$lte = filters.maxPrice;
    }
  }

  if (filters.location) {
    mongoFilter.location = new RegExp(escapeRegex(filters.location), 'i');
  }

  return mongoFilter;
};

const getPublicListings = async (filters, categoryId = null) => {
  const mongoFilter = createPublicListingFilter(filters, categoryId);
  const page = filters.page;
  const skip = (page - 1) * LISTINGS_PER_PAGE;
  const sort = PUBLIC_SORT_OPTIONS[filters.sort] || PUBLIC_SORT_OPTIONS.newest;

  const [items, totalItems] = await Promise.all([
    populatePublicListing(
      Listing.find(mongoFilter)
        .select(PUBLIC_LISTING_SELECT)
        .sort(sort)
        .skip(skip)
        .limit(LISTINGS_PER_PAGE),
    ).lean(),
    Listing.countDocuments(mongoFilter),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalItems / LISTINGS_PER_PAGE));
  const normalizedPage = totalItems === 0 ? 1 : page;

  return {
    items,
    pagination: {
      page: normalizedPage,
      limit: LISTINGS_PER_PAGE,
      totalItems,
      totalPages,
      hasPrev: normalizedPage > 1,
      hasNext: normalizedPage < totalPages,
      previousPage: normalizedPage > 1 ? normalizedPage - 1 : null,
      nextPage: normalizedPage < totalPages ? normalizedPage + 1 : null,
    },
  };
};

const getLatestListings = (limit = 8) =>
  populatePublicListing(
    Listing.find({ status: 'active' })
      .select(
      'title price category seller location condition images status createdAt',
      )
      .sort({ createdAt: -1 })
      .limit(limit),
  ).lean();

const getListingById = (listingId) => {
  if (!mongoose.isValidObjectId(listingId)) {
    return null;
  }

  return Listing.findById(listingId)
    .select(
      'title description price category seller location condition images status moderation createdAt updatedAt',
    )
    .populate('category', 'name slug status')
    .populate('seller', 'name avatar phone')
    .lean();
};

const getRelatedListings = (
  listingId,
  categoryId,
  limit = 5,
) => {
  if (
    !mongoose.isValidObjectId(listingId) ||
    !mongoose.isValidObjectId(categoryId)
  ) {
    return [];
  }

  return populatePublicListing(
    Listing.find({
      _id: {
        $ne: listingId,
      },

      category: categoryId,

      status: 'active',
    })
      .select(
        'title description price category seller location condition images status moderation createdAt updatedAt',
      )
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .limit(limit),
  ).lean();
};

const getListingDocumentById = (listingId) => {
  if (!mongoose.isValidObjectId(listingId)) {
    return null;
  }

  return Listing.findById(listingId).select(
    '_id seller images status moderation',
  );
};

const getListingsByCategory = (category) => {
  const categoryId = category?._id || category;

  if (!mongoose.isValidObjectId(categoryId)) {
    return [];
  }

  return populatePublicListing(
    Listing.find({
      category: categoryId,
      status: { $in: PUBLIC_STATUSES },
    })
      .select(
        'title description price category seller location condition images status moderation createdAt updatedAt',
      )
      .sort({ createdAt: -1 }),
  ).lean();
};

const getListingsBySeller = (sellerId) => {
  if (!mongoose.isValidObjectId(sellerId)) {
    return [];
  }

  return populatePublicListing(
    Listing.find({ seller: sellerId })
      .select(
        'title description price category seller location condition images status moderation createdAt updatedAt',
      )
      .sort({ createdAt: -1 }),
  ).lean();
};

const getActiveCategory = async (categoryId) => {
  if (!mongoose.isValidObjectId(categoryId)) {
    throw createListingError(CATEGORY_NOT_FOUND, CATEGORY_NOT_FOUND_MESSAGE);
  }

  const category = await Category.findById(categoryId).select('_id status');

  if (!category) {
    throw createListingError(CATEGORY_NOT_FOUND, CATEGORY_NOT_FOUND_MESSAGE);
  }

  if (category.status !== 'active') {
    throw createListingError(CATEGORY_INACTIVE, CATEGORY_INACTIVE_MESSAGE);
  }

  return category;
};

const normalizeListingData = (data) => ({
  title: typeof data.title === 'string' ? data.title.trim() : '',
  description:
    typeof data.description === 'string' ? data.description.trim() : '',
  price: Number(data.price),
  category: data.category,
  location: typeof data.location === 'string' ? data.location.trim() : '',
  condition: data.condition,
});

const normalizeListingImages = (images) => {
  if (!Array.isArray(images)) {
    return [];
  }

  return [
    ...new Set(images.filter(isListingImagePublicPath)),
  ];
};

const createListing = async (data) => {
  const normalizedData = normalizeListingData(data);
  const category = await getActiveCategory(normalizedData.category);

  return Listing.create({
    title: normalizedData.title,
    description: normalizedData.description,
    price: normalizedData.price,
    category: category._id,
    seller: data.seller,
    location: normalizedData.location,
    condition: normalizedData.condition,
    images: normalizeListingImages(data.images),
    status: 'active',
  });
};

const updateListing = async (listingId, data) => {
  if (!mongoose.isValidObjectId(listingId)) {
    throw createListingError(LISTING_NOT_FOUND, LISTING_NOT_FOUND_MESSAGE);
  }

  const listing = await Listing.findById(listingId);

  if (!listing) {
    throw createListingError(LISTING_NOT_FOUND, LISTING_NOT_FOUND_MESSAGE);
  }

  if (listing.moderation?.isHiddenByAdmin === true) {
    throw createListingError(
      LISTING_ADMIN_HIDDEN,
      LISTING_ADMIN_HIDDEN_MESSAGE,
    );
  }

  const normalizedData = normalizeListingData(data);
  const category = await getActiveCategory(normalizedData.category);

  listing.title = normalizedData.title;
  listing.description = normalizedData.description;
  listing.price = normalizedData.price;
  listing.category = category._id;
  listing.location = normalizedData.location;
  listing.condition = normalizedData.condition;

  if (Array.isArray(data.images)) {
    listing.images = normalizeListingImages(data.images);
  }

  return listing.save();
};

const updateListingStatus = async (listingId, status) => {
  if (!ALLOWED_STATUSES.includes(status)) {
    throw createListingError(
      INVALID_LISTING_STATUS,
      INVALID_LISTING_STATUS_MESSAGE,
    );
  }

  if (!mongoose.isValidObjectId(listingId)) {
    throw createListingError(LISTING_NOT_FOUND, LISTING_NOT_FOUND_MESSAGE);
  }

  const listing = await Listing.findById(listingId);

  if (!listing) {
    throw createListingError(LISTING_NOT_FOUND, LISTING_NOT_FOUND_MESSAGE);
  }

  if (listing.moderation?.isHiddenByAdmin === true) {
    throw createListingError(
      LISTING_ADMIN_HIDDEN,
      LISTING_ADMIN_HIDDEN_MESSAGE,
    );
  }

  listing.status = status;
  return listing.save();
};

const hideListing = (listingId) => updateListingStatus(listingId, 'hidden');

module.exports = {
  CATEGORY_INACTIVE,
  CATEGORY_INACTIVE_MESSAGE,
  CATEGORY_NOT_FOUND,
  CATEGORY_NOT_FOUND_MESSAGE,
  INVALID_LISTING_STATUS,
  INVALID_LISTING_STATUS_MESSAGE,
  LISTING_ADMIN_HIDDEN,
  LISTING_ADMIN_HIDDEN_MESSAGE,
  LISTING_NOT_FOUND,
  LISTING_NOT_FOUND_MESSAGE,
  LISTINGS_PER_PAGE,
  createListing,
  getLatestListings,
  getListingById,
  getRelatedListings,
  getListingDocumentById,
  getListingsByCategory,
  getListingsBySeller,
  getPublicListings,
  hideListing,
  updateListing,
  updateListingStatus,
};
