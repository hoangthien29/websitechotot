const crypto = require('node:crypto');
const fs = require('node:fs');
const multer = require('multer');

const {
  CATEGORY_IMAGE_UPLOAD_DIRECTORY,
  deleteStoredCategoryImage,
  uploadedCategoryImageToPublicPath,
} = require('../utils/categoryImageStorage');
const {
  validateUploadedImageFile,
} = require('../utils/imageSignature');

const MAX_CATEGORY_IMAGE_SIZE_BYTES = 3 * 1024 * 1024;
const CATEGORY_IMAGE_MIME_TYPE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const EXPECTED_CATEGORY_IMAGE_UPLOAD_ERROR_CODES = new Set([
  'LIMIT_FILE_SIZE',
  'LIMIT_FILE_COUNT',
  'LIMIT_UNEXPECTED_FILE',
  'INVALID_CATEGORY_IMAGE_TYPE',
]);

fs.mkdirSync(CATEGORY_IMAGE_UPLOAD_DIRECTORY, {
  recursive: true,
});

const categoryImageStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, CATEGORY_IMAGE_UPLOAD_DIRECTORY);
  },
  filename: (req, file, callback) => {
    const extension = CATEGORY_IMAGE_MIME_TYPE_EXTENSIONS[file.mimetype];
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

const categoryImageFileFilter = (req, file, callback) => {
  if (!CATEGORY_IMAGE_MIME_TYPE_EXTENSIONS[file.mimetype]) {
    const error = new Error(
      'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
    );
    error.code = 'INVALID_CATEGORY_IMAGE_TYPE';
    callback(error);
    return;
  }

  callback(null, true);
};

const categoryImageUpload = multer({
  storage: categoryImageStorage,
  fileFilter: categoryImageFileFilter,
  limits: {
    fileSize: MAX_CATEGORY_IMAGE_SIZE_BYTES,
    files: 1,
  },
}).single('image');

const getCategoryImageUploadErrorMessage = (error) => {
  const messages = {
    LIMIT_FILE_SIZE: 'Ảnh danh mục không được vượt quá 3 MB.',
    LIMIT_FILE_COUNT: 'Chỉ được tải lên một ảnh danh mục.',
    LIMIT_UNEXPECTED_FILE: 'Chỉ được tải lên một ảnh danh mục.',
    INVALID_CATEGORY_IMAGE_TYPE:
      'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
  };

  return (
    messages[error?.code] ||
    'Không thể tải ảnh danh mục lên. Vui lòng thử lại.'
  );
};

const uploadCategoryImage = (req, res, next) => {
  categoryImageUpload(req, res, (error) => {
    if (!error) {
      if (!req.file) {
        return next();
      }

      return validateUploadedImageFile(req.file)
        .then(async (isValid) => {
          if (isValid) {
            return next();
          }

          await deleteStoredCategoryImage(
            uploadedCategoryImageToPublicPath(req.file),
          );
          req.file = undefined;
          req.categoryImageUploadError = {
            code: 'INVALID_CATEGORY_IMAGE_CONTENT',
            message:
              'Nội dung file không khớp định dạng JPG, PNG hoặc WEBP.',
          };
          return next();
        })
        .catch(async (validationError) => {
          await deleteStoredCategoryImage(
            uploadedCategoryImageToPublicPath(req.file),
          );
          req.file = undefined;
          return next(validationError);
        });
    }

    const storedPath = uploadedCategoryImageToPublicPath(req.file);

    return deleteStoredCategoryImage(storedPath)
      .then(() => {
        req.file = undefined;

        if (!EXPECTED_CATEGORY_IMAGE_UPLOAD_ERROR_CODES.has(error.code)) {
          return next(error);
        }

        req.categoryImageUploadError = {
          code: error.code || 'CATEGORY_IMAGE_UPLOAD_ERROR',
          message: getCategoryImageUploadErrorMessage(error),
        };
        return next();
      })
      .catch(next);
  });
};

module.exports = {
  MAX_CATEGORY_IMAGE_SIZE_BYTES,
  uploadCategoryImage,
};
