const { validationResult } = require('express-validator');

const categoryService = require('../services/category.service');
const conversationService = require('../services/conversation.service');
const favoriteService = require('../services/favorite.service');
const listingService = require('../services/listing.service');
const { MAX_LISTING_IMAGES } = require('../middlewares/upload.middleware');
const {
  deleteStoredFiles,
  normalizeRemoveImages,
  uploadedFilesToPublicPaths,
} = require('../utils/fileStorage');
const {
  buildListingUrl,
  createPagination,
} = require('../utils/createPagination');
const normalizeListingQuery = require('../utils/normalizeListingQuery');
const presentListing = require('../utils/presentListing');
const { isManagedAvatarPath } = require('../utils/avatarStorage');

const CREATED_MESSAGE = 'Tạo bài đăng thành công.';
const UPDATED_MESSAGE = 'Cập nhật bài đăng thành công.';
const STATUS_CHANGED_MESSAGE = 'Thay đổi trạng thái bài đăng thành công.';
const HIDDEN_MESSAGE = 'Bài đăng đã được ẩn.';
const DEFAULT_AVATAR = '/images/default-avatar.svg';

const getFieldErrors = (req) => {
  const mappedErrors = validationResult(req).mapped();

  return Object.fromEntries(
    Object.entries(mappedErrors).map(([field, error]) => [field, error.msg]),
  );
};

const getOldInput = (data = {}) => ({
  title: typeof data.title === 'string' ? data.title : '',
  description:
    typeof data.description === 'string' ? data.description : '',
  price:
    typeof data.price === 'string' || typeof data.price === 'number'
      ? String(data.price)
      : '',
  category:
    typeof data.category === 'string'
      ? data.category
      : data.category?._id?.toString() || data.category?.toString() || '',
  location: typeof data.location === 'string' ? data.location : '',
  condition: typeof data.condition === 'string' ? data.condition : 'used',
});

const renderNotFound = (req, res) =>
  res.status(404).render('errors/404', {
    pageTitle: 'Không tìm thấy trang',
    requestedUrl: req.originalUrl,
  });

const getSellerId = (listing) => listing.seller?._id || listing.seller;

const getSafeAvatar = (avatar) =>
  isManagedAvatarPath(avatar) ? avatar : '';

const isListingOwner = (listing, user) =>
  Boolean(user && getSellerId(listing)?.toString() === user._id.toString());

const canManageListing = (listing, user) =>
  isListingOwner(listing, user) || user?.role === 'admin';

const getDetailSuccessMessage = (query = {}) => {
  if (query.created === '1') {
    return CREATED_MESSAGE;
  }

  if (query.updated === '1') {
    return UPDATED_MESSAGE;
  }

  return '';
};

const getMyListingsSuccessMessage = (query = {}) => {
  if (query.created === '1') {
    return CREATED_MESSAGE;
  }

  if (query.updated === '1') {
    return UPDATED_MESSAGE;
  }

  if (query.statusChanged === '1') {
    return STATUS_CHANGED_MESSAGE;
  }

  if (query.hidden === '1') {
    return HIDDEN_MESSAGE;
  }

  return '';
};

const getCategoriesForForm = async (currentCategory) => {
  const categories = await categoryService.getActiveCategories();
  const currentCategoryId = currentCategory?._id?.toString();

  if (
    currentCategory &&
    !categories.some(
      (category) => category._id.toString() === currentCategoryId,
    )
  ) {
    return [...categories, currentCategory];
  }

  return categories;
};

const getImageFormData = ({
  existingImages = [],
  selectedRemoveImages = [],
  retryImages = false,
} = {}) => ({
  existingImages,
  maxImages: MAX_LISTING_IMAGES,
  remainingImageSlots: Math.max(
    0,
    MAX_LISTING_IMAGES - existingImages.length,
  ),
  retryImages,
  selectedRemoveImages,
});

const renderListingDetail = (req, res, listing, options = {}) => {
  const isOwner = isListingOwner(listing, req.user);
  const presentedListing = presentListing(listing, {
    isFavorited: options.isFavorited,
  });
  const canManage =
    canManageListing(listing, req.user) &&
    !presentedListing.isHiddenByAdmin;
  presentedListing.sellerAvatar =
    getSafeAvatar(listing.seller?.avatar) || DEFAULT_AVATAR;

return res.status(options.statusCode || 200).render('listings/show', {
  pageTitle: listing.title,

  listing: presentedListing,

  isOwner,
  canManage,

  errors: options.errors || {},

  successMessage:
    options.successMessage || '',

  currentUrl:
    req.originalUrl,

  messageConversationId:
    options.messageConversationId || '',

  relatedListings:
    options.relatedListings || [],
});
};

const renderMyListings = async (req, res, options = {}) => {
  const listings = await listingService.getListingsBySeller(req.user._id);

  return res.status(options.statusCode || 200).render('listings/my-listings', {
    pageTitle: 'Bài đăng của tôi',
    listings: listings.map(presentListing),
    successMessage: options.successMessage || '',
    errors: options.errors || {},
  });
};

const isCategoryError = (error) =>
  error.code === listingService.CATEGORY_NOT_FOUND ||
  error.code === listingService.CATEGORY_INACTIVE;

const normalizeFilterErrors = (errors) => {
  if (!errors._unknown_fields) {
    return errors;
  }

  const { _unknown_fields: unknownFieldsError, ...fieldErrors } = errors;
  return {
    ...fieldErrors,
    general: unknownFieldsError,
  };
};

const getEmptyPagination = () => ({
  page: 1,
  limit: listingService.LISTINGS_PER_PAGE,
  totalItems: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false,
  previousPage: null,
  nextPage: null,
});

const renderPublicListings = (res, options) => {
  const pagination = createPagination(options.pagination, options.filters);

  return res.status(options.statusCode || 200).render('listings/index', {
    pageTitle: 'Tìm kiếm sản phẩm',
    listings: options.listings || [],
    categories: options.categories,
    filters: options.filters,
    filterErrors: options.filterErrors || {},
    pagination,
    totalItems: pagination.totalItems,
    currentUrl: options.currentUrl || '/listings',
  });
};

const listListings = async (req, res, next) => {
  try {
    const filters = normalizeListingQuery(req.query);
    const categories = await categoryService.getActiveCategories();
    const filterErrors = normalizeFilterErrors(getFieldErrors(req));

    if (Object.keys(filterErrors).length > 0) {
      return renderPublicListings(res, {
        statusCode: 422,
        listings: [],
        categories,
        filters,
        filterErrors,
        pagination: getEmptyPagination(),
      });
    }

    const selectedCategory = filters.category
      ? categories.find((category) => category.slug === filters.category)
      : null;

    if (filters.category && !selectedCategory) {
      return renderPublicListings(res, {
        statusCode: 422,
        listings: [],
        categories,
        filters,
        filterErrors: { category: 'Danh mục không hợp lệ.' },
        pagination: getEmptyPagination(),
      });
    }

    const result = await listingService.getPublicListings(
      filters,
      selectedCategory?._id,
    );

    if (
      result.pagination.totalItems > 0 &&
      filters.page > result.pagination.totalPages
    ) {
      return res.redirect(
        302,
        buildListingUrl(filters, result.pagination.totalPages),
      );
    }

    const favoriteListingIds = await favoriteService.getFavoriteListingIds(
      req.user?._id,
      result.items.map((listing) => listing._id),
    );

    return renderPublicListings(res, {
      listings: result.items.map((listing) =>
        presentListing(listing, {
          isFavorited: favoriteListingIds.has(listing._id.toString()),
        }),
      ),
      categories,
      filters,
      pagination: result.pagination,
      currentUrl: req.originalUrl,
    });
  } catch (error) {
    return next(error);
  }
};

const showListing = async (req, res, next) => {
  try {
    const listing = await listingService.getListingById(req.params.id);

    if (!listing) {
      return renderNotFound(req, res);
    }

    if (listing.status === 'hidden' && !canManageListing(listing, req.user)) {
      return renderNotFound(req, res);
    }

    const isOwner = isListingOwner(listing, req.user);
    let isFavorited = false;
    let existingConversation = null;
    
    const relatedListings =
    await listingService.getRelatedListings(
      listing._id,
      listing.category?._id || listing.category,
      5,
    );

    if (req.user && !isOwner && listing.status !== 'hidden') {
      [isFavorited, existingConversation] = await Promise.all([
        favoriteService.isListingFavorited(req.user._id, listing._id),
        conversationService.findExistingConversationForListing(
          listing._id,
          req.user._id,
          getSellerId(listing),
        ),
      ]);
    }

    const relatedFavoriteIds =
  await favoriteService.getFavoriteListingIds(
    req.user?._id,

    relatedListings.map(
      (relatedListing) =>
        relatedListing._id,
    ),
  );

  const presentedRelatedListings =
    relatedListings.map(
      (relatedListing) =>
        presentListing(
          relatedListing,
          {
            isFavorited:
              relatedFavoriteIds.has(
                relatedListing._id.toString(),
              ),
          },
        ),
    );

  return renderListingDetail(req, res, listing, {
    successMessage:
      getDetailSuccessMessage(req.query),

    isFavorited,

    messageConversationId:
      existingConversation?._id?.toString() || '',

    relatedListings:
      presentedRelatedListings,
  });
  } catch (error) {
    return next(error);
  }
};

const showCreateForm = async (req, res, next) => {
  try {
    const categories = await getCategoriesForForm();

    return res.render('listings/create', {
      pageTitle: 'Đăng sản phẩm',
      categories,
      canSubmit: categories.length > 0,
      errors: {},
      oldInput: getOldInput(),
      ...getImageFormData(),
    });
  } catch (error) {
    return next(error);
  }
};

const createListing = async (req, res, next) => {
  const newImagePaths = uploadedFilesToPublicPaths(req.files);
  const errors = getFieldErrors(req);
  const oldInput = getOldInput(req.body);
  const retryImages =
    newImagePaths.length > 0 || Boolean(req.uploadError);

  if (req.uploadError) {
    errors.images = req.uploadError.message;
  }

  try {
    const categories = await getCategoriesForForm();

    if (Object.keys(errors).length > 0) {
      await deleteStoredFiles(newImagePaths);

      return res.status(422).render('listings/create', {
        pageTitle: 'Đăng sản phẩm',
        categories,
        canSubmit: categories.length > 0,
        errors,
        oldInput,
        ...getImageFormData({ retryImages }),
      });
    }

    try {
      const listing = await listingService.createListing({
        title: req.body.title,
        description: req.body.description,
        price: req.body.price,
        category: req.body.category,
        location: req.body.location,
        condition: req.body.condition,
        seller: req.user._id,
        images: newImagePaths,
      });

      return res.redirect(303, `/listings/${listing._id}?created=1`);
    } catch (error) {
      if (isCategoryError(error)) {
        await deleteStoredFiles(newImagePaths);

        return res.status(422).render('listings/create', {
          pageTitle: 'Đăng sản phẩm',
          categories,
          canSubmit: categories.length > 0,
          errors: { category: error.message },
          oldInput,
          ...getImageFormData({ retryImages }),
        });
      }

      throw error;
    }
  } catch (error) {
    await deleteStoredFiles(newImagePaths);
    return next(error);
  }
};

const showEditForm = async (req, res, next) => {
  try {
    const listing = await listingService.getListingById(req.listing._id);

    if (!listing) {
      return renderNotFound(req, res);
    }

    const categories = await getCategoriesForForm(listing.category);

    const presentedListing = presentListing(listing);

    return res.render('listings/edit', {
      pageTitle: 'Chỉnh sửa bài đăng',
      listing: presentedListing,
      categories,
      errors: {},
      oldInput: getOldInput(listing),
      ...getImageFormData({
        existingImages: presentedListing.images,
      }),
    });
  } catch (error) {
    return next(error);
  }
};

const updateListing = async (req, res, next) => {
  const newImagePaths = uploadedFilesToPublicPaths(req.files);
  const existingImages = Array.isArray(req.listing.images)
    ? req.listing.images.map(String)
    : [];
  const requestedRemoveImages = normalizeRemoveImages(
    req.body.removeImages,
  );
  const invalidRemoveImages = requestedRemoveImages.filter(
    (imagePath) => !existingImages.includes(imagePath),
  );
  const selectedRemoveImages = requestedRemoveImages.filter((imagePath) =>
    existingImages.includes(imagePath),
  );
  const keptImages = existingImages.filter(
    (imagePath) => !selectedRemoveImages.includes(imagePath),
  );
  const finalImages = [...keptImages, ...newImagePaths];
  const retryImages =
    newImagePaths.length > 0 || Boolean(req.uploadError);

  try {
    const listing = await listingService.getListingById(req.listing._id);

    if (!listing) {
      await deleteStoredFiles(newImagePaths);
      return renderNotFound(req, res);
    }

    const categories = await getCategoriesForForm(listing.category);
    const errors = getFieldErrors(req);
    const oldInput = getOldInput(req.body);
    const presentedListing = presentListing(listing);

    if (req.uploadError) {
      errors.images = req.uploadError.message;
    }

    if (invalidRemoveImages.length > 0) {
      errors.images = 'Ảnh được chọn xóa không thuộc bài đăng này.';
    }

    if (finalImages.length > MAX_LISTING_IMAGES) {
      errors.images = 'Một bài đăng chỉ được có tối đa 5 ảnh.';
    }

    if (Object.keys(errors).length > 0) {
      await deleteStoredFiles(newImagePaths);

      return res.status(422).render('listings/edit', {
        pageTitle: 'Chỉnh sửa bài đăng',
        listing: presentedListing,
        categories,
        errors,
        oldInput,
        ...getImageFormData({
          existingImages: presentedListing.images,
          selectedRemoveImages,
          retryImages,
        }),
      });
    }

    try {
      await listingService.updateListing(req.listing._id, {
        title: req.body.title,
        description: req.body.description,
        price: req.body.price,
        category: req.body.category,
        location: req.body.location,
        condition: req.body.condition,
        images: finalImages,
      });

      await deleteStoredFiles(selectedRemoveImages);
      return res.redirect(303, `/listings/${req.listing._id}?updated=1`);
    } catch (error) {
      if (isCategoryError(error)) {
        await deleteStoredFiles(newImagePaths);

        return res.status(422).render('listings/edit', {
          pageTitle: 'Chỉnh sửa bài đăng',
          listing: presentedListing,
          categories,
          errors: { category: error.message },
          oldInput,
          ...getImageFormData({
            existingImages: presentedListing.images,
            selectedRemoveImages,
            retryImages,
          }),
        });
      }

      if (error.code === listingService.LISTING_NOT_FOUND) {
        await deleteStoredFiles(newImagePaths);
        return renderNotFound(req, res);
      }

      throw error;
    }
  } catch (error) {
    await deleteStoredFiles(newImagePaths);
    return next(error);
  }
};

const updateListingStatus = async (req, res, next) => {
  const errors = getFieldErrors(req);

  try {
    if (Object.keys(errors).length > 0) {
      const listing = await listingService.getListingById(req.listing._id);

      if (!listing) {
        return renderNotFound(req, res);
      }

      return renderListingDetail(req, res, listing, {
        statusCode: 422,
        errors: { general: errors.status },
      });
    }

    await listingService.updateListingStatus(req.listing._id, req.body.status);
    return res.redirect(303, '/my-listings?statusChanged=1');
  } catch (error) {
    if (error.code === listingService.LISTING_NOT_FOUND) {
      return renderNotFound(req, res);
    }

    if (error.code === listingService.INVALID_LISTING_STATUS) {
      try {
        return await renderMyListings(req, res, {
          statusCode: 422,
          errors: { general: error.message },
        });
      } catch (renderError) {
        return next(renderError);
      }
    }

    return next(error);
  }
};

const deleteListing = async (req, res, next) => {
  try {
    await listingService.hideListing(req.listing._id);
    return res.redirect(303, '/my-listings?hidden=1');
  } catch (error) {
    if (error.code === listingService.LISTING_NOT_FOUND) {
      return renderNotFound(req, res);
    }

    return next(error);
  }
};

const listMyListings = async (req, res, next) => {
  try {
    return await renderMyListings(req, res, {
      successMessage: getMyListingsSuccessMessage(req.query),
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createListing,
  deleteListing,
  listListings,
  listMyListings,
  showCreateForm,
  showEditForm,
  showListing,
  updateListing,
  updateListingStatus,
};
