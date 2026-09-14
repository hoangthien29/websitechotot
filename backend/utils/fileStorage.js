const fs = require('node:fs/promises');
const path = require('node:path');

const LISTING_UPLOAD_DIRECTORY = path.resolve(
  __dirname,
  '..',
  '..',
  'uploads',
  'listings',
);
const LISTING_UPLOAD_PUBLIC_PREFIX = '/uploads/listings/';
const LISTING_IMAGE_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

const isListingImagePublicPath = (publicPath) => {
  if (
    typeof publicPath !== 'string' ||
    !publicPath.startsWith(LISTING_UPLOAD_PUBLIC_PREFIX)
  ) {
    return false;
  }

  const filename = publicPath.slice(LISTING_UPLOAD_PUBLIC_PREFIX.length);

  return (
    LISTING_IMAGE_FILENAME_PATTERN.test(filename) &&
    filename === path.basename(filename) &&
    !filename.includes('\\')
  );
};

const uploadedFilesToPublicPaths = (files) => {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .map((file) => path.basename(file?.filename || ''))
    .filter(Boolean)
    .map((filename) => `${LISTING_UPLOAD_PUBLIC_PREFIX}${filename}`);
};

const publicPathToDiskPath = (publicPath) => {
  if (!isListingImagePublicPath(publicPath)) {
    return null;
  }

  const filename = publicPath.slice(LISTING_UPLOAD_PUBLIC_PREFIX.length);
  const diskPath = path.resolve(LISTING_UPLOAD_DIRECTORY, filename);
  const allowedPrefix = `${LISTING_UPLOAD_DIRECTORY}${path.sep}`;

  return diskPath.startsWith(allowedPrefix) ? diskPath : null;
};

const deleteStoredFile = async (publicPath) => {
  const diskPath = publicPathToDiskPath(publicPath);

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
      `Không thể xóa một file ảnh đã lưu (${error.code || 'UnknownError'}).`,
    );
    return false;
  }
};

const deleteStoredFiles = async (publicPaths) => {
  if (!Array.isArray(publicPaths)) {
    return [];
  }

  return Promise.all(publicPaths.map(deleteStoredFile));
};

const normalizeRemoveImages = (value) => {
  const values = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      values.filter((item) => typeof item === 'string' && item.length > 0),
    ),
  ];
};

module.exports = {
  LISTING_UPLOAD_DIRECTORY,
  LISTING_UPLOAD_PUBLIC_PREFIX,
  LISTING_IMAGE_FILENAME_PATTERN,
  deleteStoredFile,
  deleteStoredFiles,
  isListingImagePublicPath,
  normalizeRemoveImages,
  publicPathToDiskPath,
  uploadedFilesToPublicPaths,
};
