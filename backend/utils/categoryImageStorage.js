const fs = require('node:fs/promises');
const path = require('node:path');

const CATEGORY_IMAGE_UPLOAD_DIRECTORY = path.resolve(
  __dirname,
  '..',
  '..',
  'uploads',
  'categories',
);
const CATEGORY_IMAGE_PUBLIC_PREFIX = '/uploads/categories/';
const CATEGORY_IMAGE_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

const isManagedCategoryImagePath = (publicPath) => {
  if (
    typeof publicPath !== 'string' ||
    !publicPath.startsWith(CATEGORY_IMAGE_PUBLIC_PREFIX)
  ) {
    return false;
  }

  const filename = publicPath.slice(CATEGORY_IMAGE_PUBLIC_PREFIX.length);

  return (
    CATEGORY_IMAGE_FILENAME_PATTERN.test(filename) &&
    filename === path.basename(filename) &&
    !filename.includes('\\')
  );
};

const uploadedCategoryImageToPublicPath = (file) => {
  const filename = path.basename(file?.filename || '');
  const publicPath = filename
    ? `${CATEGORY_IMAGE_PUBLIC_PREFIX}${filename}`
    : '';

  return isManagedCategoryImagePath(publicPath) ? publicPath : '';
};

const getCategoryImageUrl = (category) =>
  isManagedCategoryImagePath(category?.image) ? category.image : '';

const categoryImagePublicPathToDiskPath = (publicPath) => {
  if (!isManagedCategoryImagePath(publicPath)) {
    return null;
  }

  const filename = publicPath.slice(CATEGORY_IMAGE_PUBLIC_PREFIX.length);
  const diskPath = path.resolve(CATEGORY_IMAGE_UPLOAD_DIRECTORY, filename);
  const allowedPrefix = `${CATEGORY_IMAGE_UPLOAD_DIRECTORY}${path.sep}`;

  return diskPath.startsWith(allowedPrefix) ? diskPath : null;
};

const deleteStoredCategoryImage = async (publicPath) => {
  const diskPath = categoryImagePublicPathToDiskPath(publicPath);

  if (!diskPath) {
    return false;
  }

  try {
    await fs.unlink(diskPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    console.warn(
      `Không thể xóa file ảnh danh mục đã lưu (${error.code || 'UnknownError'}).`,
    );
    return false;
  }
};

module.exports = {
  CATEGORY_IMAGE_FILENAME_PATTERN,
  CATEGORY_IMAGE_PUBLIC_PREFIX,
  CATEGORY_IMAGE_UPLOAD_DIRECTORY,
  categoryImagePublicPathToDiskPath,
  deleteStoredCategoryImage,
  getCategoryImageUrl,
  isManagedCategoryImagePath,
  uploadedCategoryImageToPublicPath,
};
