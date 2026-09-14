const mongoose = require('mongoose');

const Category = require('../models/Category');
const createSlug = require('../utils/createSlug');
const {
  isManagedCategoryImagePath,
} = require('../utils/categoryImageStorage');

const CATEGORY_NOT_FOUND = 'CATEGORY_NOT_FOUND';
const CATEGORY_NOT_FOUND_MESSAGE = 'Không tìm thấy danh mục.';
const CATEGORY_ALREADY_EXISTS = 'CATEGORY_ALREADY_EXISTS';
const CATEGORY_ALREADY_EXISTS_MESSAGE = 'Tên danh mục đã tồn tại.';
const CATEGORY_SLUG_EXISTS = 'CATEGORY_SLUG_EXISTS';
const CATEGORY_SLUG_EXISTS_MESSAGE =
  'Đường dẫn danh mục đã tồn tại. Vui lòng chọn tên khác.';
const CATEGORY_INVALID_SLUG = 'CATEGORY_INVALID_SLUG';
const CATEGORY_INVALID_SLUG_MESSAGE =
  'Tên danh mục phải tạo được đường dẫn hợp lệ.';
const CATEGORY_INVALID_STATUS = 'CATEGORY_INVALID_STATUS';
const CATEGORY_INVALID_STATUS_MESSAGE = 'Trạng thái danh mục không hợp lệ.';
const CATEGORY_INVALID_IMAGE = 'CATEGORY_INVALID_IMAGE';
const CATEGORY_INVALID_IMAGE_MESSAGE = 'Ảnh danh mục không hợp lệ.';
const ALLOWED_STATUSES = ['active', 'inactive'];

const createCategoryError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getActiveCategories = () =>
  Category.find({ status: 'active' })
    .select('name slug description image status')
    .sort({ name: 1 })
    .lean();

const getAllCategoriesForAdmin = () =>
  Category.find()
    .select('name slug description image status createdAt updatedAt')
    .sort({ createdAt: -1 })
    .lean();

const getCategoryBySlug = (slug) =>
  Category.findOne({
    slug: String(slug || '').trim().toLowerCase(),
    status: 'active',
  })
    .select('name slug description image status createdAt updatedAt')
    .lean();

const getCategoryById = (categoryId) => {
  if (!mongoose.isValidObjectId(categoryId)) {
    return null;
  }

  return Category.findById(categoryId)
    .select('name slug description image status createdAt updatedAt')
    .lean();
};

const normalizeCategoryData = (data) => {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description =
    typeof data.description === 'string' ? data.description.trim() : '';
  const image = typeof data.image === 'string' ? data.image.trim() : '';
  const status =
    typeof data.status === 'string' ? data.status.trim() : 'active';
  const slug = createSlug(name);

  if (!slug) {
    throw createCategoryError(
      CATEGORY_INVALID_SLUG,
      CATEGORY_INVALID_SLUG_MESSAGE,
    );
  }

  if (!ALLOWED_STATUSES.includes(status)) {
    throw createCategoryError(
      CATEGORY_INVALID_STATUS,
      CATEGORY_INVALID_STATUS_MESSAGE,
    );
  }

  if (image !== '' && !isManagedCategoryImagePath(image)) {
    throw createCategoryError(
      CATEGORY_INVALID_IMAGE,
      CATEGORY_INVALID_IMAGE_MESSAGE,
    );
  }

  return { name, slug, description, image, status };
};

const findDuplicateCategory = (name, slug, excludedId) => {
  const query = { $or: [{ name }, { slug }] };

  if (excludedId) {
    query._id = { $ne: excludedId };
  }

  return Category.findOne(query).select('name slug').lean();
};

const throwDuplicateCategoryError = (duplicate, normalizedData) => {
  if (!duplicate) {
    return;
  }

  if (duplicate.name === normalizedData.name) {
    throw createCategoryError(
      CATEGORY_ALREADY_EXISTS,
      CATEGORY_ALREADY_EXISTS_MESSAGE,
    );
  }

  throw createCategoryError(CATEGORY_SLUG_EXISTS, CATEGORY_SLUG_EXISTS_MESSAGE);
};

const convertDuplicateKeyError = (error) => {
  if (error.code !== 11000) {
    throw error;
  }

  const duplicateField = Object.keys(
    error.keyPattern || error.keyValue || {},
  )[0];

  if (duplicateField === 'slug') {
    return createCategoryError(
      CATEGORY_SLUG_EXISTS,
      CATEGORY_SLUG_EXISTS_MESSAGE,
    );
  }

  return createCategoryError(
    CATEGORY_ALREADY_EXISTS,
    CATEGORY_ALREADY_EXISTS_MESSAGE,
  );
};

const createCategory = async (data) => {
  const normalizedData = normalizeCategoryData(data);
  const duplicate = await findDuplicateCategory(
    normalizedData.name,
    normalizedData.slug,
  );

  throwDuplicateCategoryError(duplicate, normalizedData);

  try {
    return await Category.create(normalizedData);
  } catch (error) {
    throw convertDuplicateKeyError(error);
  }
};

const updateCategory = async (categoryId, data) => {
  if (!mongoose.isValidObjectId(categoryId)) {
    throw createCategoryError(CATEGORY_NOT_FOUND, CATEGORY_NOT_FOUND_MESSAGE);
  }

  const category = await Category.findById(categoryId);

  if (!category) {
    throw createCategoryError(CATEGORY_NOT_FOUND, CATEGORY_NOT_FOUND_MESSAGE);
  }

  const normalizedData = normalizeCategoryData(data);
  const duplicate = await findDuplicateCategory(
    normalizedData.name,
    normalizedData.slug,
    category._id,
  );

  throwDuplicateCategoryError(duplicate, normalizedData);

  category.name = normalizedData.name;
  category.slug = normalizedData.slug;
  category.description = normalizedData.description;
  category.image = normalizedData.image;
  category.status = normalizedData.status;

  try {
    return await category.save();
  } catch (error) {
    throw convertDuplicateKeyError(error);
  }
};

const updateCategoryStatus = async (categoryId, status) => {
  if (!ALLOWED_STATUSES.includes(status)) {
    throw createCategoryError(
      CATEGORY_INVALID_STATUS,
      CATEGORY_INVALID_STATUS_MESSAGE,
    );
  }

  if (!mongoose.isValidObjectId(categoryId)) {
    throw createCategoryError(CATEGORY_NOT_FOUND, CATEGORY_NOT_FOUND_MESSAGE);
  }

  const category = await Category.findByIdAndUpdate(
    categoryId,
    { $set: { status } },
    {
      returnDocument: 'after',
      runValidators: true,
    },
  );

  if (!category) {
    throw createCategoryError(CATEGORY_NOT_FOUND, CATEGORY_NOT_FOUND_MESSAGE);
  }

  return category;
};

module.exports = {
  CATEGORY_ALREADY_EXISTS,
  CATEGORY_ALREADY_EXISTS_MESSAGE,
  CATEGORY_INVALID_IMAGE,
  CATEGORY_INVALID_IMAGE_MESSAGE,
  CATEGORY_INVALID_SLUG,
  CATEGORY_INVALID_SLUG_MESSAGE,
  CATEGORY_INVALID_STATUS,
  CATEGORY_INVALID_STATUS_MESSAGE,
  CATEGORY_NOT_FOUND,
  CATEGORY_NOT_FOUND_MESSAGE,
  CATEGORY_SLUG_EXISTS,
  CATEGORY_SLUG_EXISTS_MESSAGE,
  createCategory,
  getActiveCategories,
  getAllCategoriesForAdmin,
  getCategoryById,
  getCategoryBySlug,
  updateCategory,
  updateCategoryStatus,
};
