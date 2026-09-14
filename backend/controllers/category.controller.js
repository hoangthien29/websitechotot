const { validationResult } = require('express-validator');

const categoryService = require('../services/category.service');
const favoriteService = require('../services/favorite.service');
const listingService = require('../services/listing.service');
const {
  deleteStoredCategoryImage,
  getCategoryImageUrl,
  isManagedCategoryImagePath,
  uploadedCategoryImageToPublicPath,
} = require('../utils/categoryImageStorage');
const presentListing = require('../utils/presentListing');

const CREATED_MESSAGE = 'Tạo danh mục thành công.';
const UPDATED_MESSAGE = 'Cập nhật danh mục thành công.';
const STATUS_CHANGED_MESSAGE = 'Thay đổi trạng thái danh mục thành công.';

const getFieldErrors = (req) => {
  const mappedErrors = validationResult(req).mapped();

  return Object.fromEntries(
    Object.entries(mappedErrors).map(([field, error]) => [field, error.msg]),
  );
};

const getOldInput = (data = {}) => ({
  name: typeof data.name === 'string' ? data.name : '',
  description:
    typeof data.description === 'string' ? data.description : '',
  status: typeof data.status === 'string' ? data.status : 'active',
});

const presentCategory = (category) => {
  const imageUrl = getCategoryImageUrl(category);

  return {
    ...category,
    hasManagedImage: Boolean(imageUrl),
    imageUrl,
  };
};

const renderNotFound = (req, res) =>
  res.status(404).render('errors/404', {
    pageTitle: 'Không tìm thấy trang',
    requestedUrl: req.originalUrl,
  });

const getSuccessMessage = (query = {}) => {
  if (query.created === '1') {
    return CREATED_MESSAGE;
  }

  if (query.updated === '1') {
    return UPDATED_MESSAGE;
  }

  if (query.statusChanged === '1') {
    return STATUS_CHANGED_MESSAGE;
  }

  return '';
};

const formatAdminCategories = (categories) =>
  categories.map((category) => ({
    ...presentCategory(category),
    descriptionPreview:
      category.description?.length > 80
        ? `${category.description.slice(0, 80)}…`
        : category.description || '',
    formattedCreatedAt: new Intl.DateTimeFormat('vi-VN').format(
      category.createdAt,
    ),
  }));

const renderAdminCategoryList = async (res, options = {}) => {
  const categories = await categoryService.getAllCategoriesForAdmin();

  return res.status(options.statusCode || 200).render('admin/categories/index', {
    pageTitle: 'Quản lý danh mục',
    categories: formatAdminCategories(categories),
    successMessage: options.successMessage || '',
    errors: options.errors || {},
  });
};

const isDuplicateError = (error) =>
  error.code === categoryService.CATEGORY_ALREADY_EXISTS ||
  error.code === categoryService.CATEGORY_SLUG_EXISTS;

const isInvalidCategoryError = (error) =>
  error.code === categoryService.CATEGORY_INVALID_SLUG ||
  error.code === categoryService.CATEGORY_INVALID_STATUS ||
  error.code === categoryService.CATEGORY_INVALID_IMAGE;

const listCategories = async (req, res, next) => {
  try {
    const categories = await categoryService.getActiveCategories();

    return res.render('categories/index', {
      pageTitle: 'Danh mục sản phẩm',
      categories: categories.map(presentCategory),
    });
  } catch (error) {
    return next(error);
  }
};

const showCategory = async (req, res, next) => {
  try {
    const category = await categoryService.getCategoryBySlug(req.params.slug);

    if (!category) {
      return renderNotFound(req, res);
    }

    const listings = await listingService.getListingsByCategory(category);
    const favoriteListingIds = await favoriteService.getFavoriteListingIds(
      req.user?._id,
      listings.map((listing) => listing._id),
    );

    return res.render('categories/show', {
      pageTitle: category.name,
      category: presentCategory(category),
      listings: listings.map((listing) =>
        presentListing(listing, {
          isFavorited: favoriteListingIds.has(listing._id.toString()),
        }),
      ),
      currentUrl: req.originalUrl,
    });
  } catch (error) {
    return next(error);
  }
};

const listAdminCategories = async (req, res, next) => {
  try {
    return await renderAdminCategoryList(res, {
      successMessage: getSuccessMessage(req.query),
    });
  } catch (error) {
    return next(error);
  }
};

const showCreateCategoryForm = (req, res) =>
  res.render('admin/categories/create', {
    pageTitle: 'Thêm danh mục',
    category: presentCategory({ image: '' }),
    errors: {},
    oldInput: getOldInput(),
  });

const createCategory = async (req, res, next) => {
  const newImagePath = uploadedCategoryImageToPublicPath(req.file);
  const errors = getFieldErrors(req);
  const oldInput = getOldInput(req.body);

  if (req.categoryImageUploadError) {
    errors.image = req.categoryImageUploadError.message;
  }

  if (Object.keys(errors).length > 0) {
    await deleteStoredCategoryImage(newImagePath);

    return res.status(422).render('admin/categories/create', {
      pageTitle: 'Thêm danh mục',
      category: presentCategory({ image: '' }),
      errors,
      oldInput,
    });
  }

  try {
    await categoryService.createCategory({
      name: req.body.name,
      description: req.body.description,
      image: newImagePath,
      status: req.body.status,
    });

    return res.redirect(303, '/admin/categories?created=1');
  } catch (error) {
    await deleteStoredCategoryImage(newImagePath);

    if (isDuplicateError(error)) {
      return res.status(409).render('admin/categories/create', {
        pageTitle: 'Thêm danh mục',
        category: presentCategory({ image: '' }),
        errors: { name: error.message },
        oldInput,
      });
    }

    if (isInvalidCategoryError(error)) {
      return res.status(422).render('admin/categories/create', {
        pageTitle: 'Thêm danh mục',
        category: presentCategory({ image: '' }),
        errors: {
          [error.code === categoryService.CATEGORY_INVALID_IMAGE
            ? 'image'
            : 'name']: error.message,
        },
        oldInput,
      });
    }

    return next(error);
  }
};

const showEditCategoryForm = async (req, res, next) => {
  try {
    const category = await categoryService.getCategoryById(req.params.id);

    if (!category) {
      return renderNotFound(req, res);
    }

    return res.render('admin/categories/edit', {
      pageTitle: 'Chỉnh sửa danh mục',
      category: presentCategory(category),
      errors: {},
      oldInput: getOldInput(category),
    });
  } catch (error) {
    return next(error);
  }
};

const updateCategory = async (req, res, next) => {
  const newImagePath = uploadedCategoryImageToPublicPath(req.file);
  let categoryUpdated = false;

  try {
    const category = await categoryService.getCategoryById(req.params.id);

    if (!category) {
      await deleteStoredCategoryImage(newImagePath);
      return renderNotFound(req, res);
    }

    const errors = getFieldErrors(req);
    const oldInput = getOldInput(req.body);

    if (req.categoryImageUploadError) {
      errors.image = req.categoryImageUploadError.message;
    }

    if (Object.keys(errors).length > 0) {
      await deleteStoredCategoryImage(newImagePath);

      return res.status(422).render('admin/categories/edit', {
        pageTitle: 'Chỉnh sửa danh mục',
        category: presentCategory(category),
        errors,
        oldInput,
      });
    }

    const oldImage = isManagedCategoryImagePath(category.image)
      ? category.image
      : '';
    const removeImage = ['1', 'on'].includes(req.body.removeImage);
    const finalImage = newImagePath || (removeImage ? '' : oldImage);

    try {
      await categoryService.updateCategory(req.params.id, {
        name: req.body.name,
        description: req.body.description,
        image: finalImage,
        status: req.body.status,
      });
      categoryUpdated = true;

      if (oldImage !== finalImage) {
        await deleteStoredCategoryImage(oldImage);
      }

      return res.redirect(303, '/admin/categories?updated=1');
    } catch (error) {
      await deleteStoredCategoryImage(newImagePath);

      if (isDuplicateError(error)) {
        return res.status(409).render('admin/categories/edit', {
          pageTitle: 'Chỉnh sửa danh mục',
          category: presentCategory(category),
          errors: { name: error.message },
          oldInput,
        });
      }

      if (isInvalidCategoryError(error)) {
        return res.status(422).render('admin/categories/edit', {
          pageTitle: 'Chỉnh sửa danh mục',
          category: presentCategory(category),
          errors: {
            [error.code === categoryService.CATEGORY_INVALID_IMAGE
              ? 'image'
              : 'name']: error.message,
          },
          oldInput,
        });
      }

      if (error.code === categoryService.CATEGORY_NOT_FOUND) {
        return renderNotFound(req, res);
      }

      throw error;
    }
  } catch (error) {
    if (!categoryUpdated) {
      await deleteStoredCategoryImage(newImagePath);
    }

    return next(error);
  }
};

const updateCategoryStatus = async (req, res, next) => {
  const errors = getFieldErrors(req);

  try {
    if (Object.keys(errors).length > 0) {
      return await renderAdminCategoryList(res, {
        statusCode: 422,
        errors: { general: errors.status },
      });
    }

    await categoryService.updateCategoryStatus(req.params.id, req.body.status);
    return res.redirect(303, '/admin/categories?statusChanged=1');
  } catch (error) {
    if (error.code === categoryService.CATEGORY_NOT_FOUND) {
      return renderNotFound(req, res);
    }

    if (error.code === categoryService.CATEGORY_INVALID_STATUS) {
      try {
        return await renderAdminCategoryList(res, {
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

module.exports = {
  createCategory,
  listAdminCategories,
  listCategories,
  showCategory,
  showCreateCategoryForm,
  showEditCategoryForm,
  updateCategory,
  updateCategoryStatus,
};
