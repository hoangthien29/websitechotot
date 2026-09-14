const crypto = require('node:crypto');
const fs = require('node:fs');
const multer = require('multer');

const {
  AVATAR_UPLOAD_DIRECTORY,
  deleteStoredAvatar,
  uploadedAvatarToPublicPath,
} = require('../utils/avatarStorage');
const {
  validateUploadedImageFile,
} = require('../utils/imageSignature');

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_TYPE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const EXPECTED_AVATAR_UPLOAD_ERROR_CODES = new Set([
  'LIMIT_FILE_SIZE',
  'LIMIT_FILE_COUNT',
  'LIMIT_UNEXPECTED_FILE',
  'INVALID_AVATAR_TYPE',
]);

fs.mkdirSync(AVATAR_UPLOAD_DIRECTORY, {
  recursive: true,
});

const avatarStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, AVATAR_UPLOAD_DIRECTORY);
  },
  filename: (req, file, callback) => {
    const extension = AVATAR_MIME_TYPE_EXTENSIONS[file.mimetype];
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

const avatarFileFilter = (req, file, callback) => {
  if (!AVATAR_MIME_TYPE_EXTENSIONS[file.mimetype]) {
    const error = new Error(
      'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
    );
    error.code = 'INVALID_AVATAR_TYPE';
    callback(error);
    return;
  }

  callback(null, true);
};

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: {
    fileSize: MAX_AVATAR_SIZE_BYTES,
    files: 1,
  },
}).single('avatar');

const getAvatarUploadErrorMessage = (error) => {
  const messages = {
    LIMIT_FILE_SIZE: 'Ảnh đại diện không được vượt quá 2 MB.',
    LIMIT_FILE_COUNT: 'Chỉ được tải lên một ảnh đại diện.',
    LIMIT_UNEXPECTED_FILE: 'Chỉ được tải lên một ảnh đại diện.',
    INVALID_AVATAR_TYPE: 'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
  };

  return (
    messages[error?.code] ||
    'Không thể tải ảnh đại diện lên. Vui lòng thử lại.'
  );
};

const uploadAvatar = (req, res, next) => {
  avatarUpload(req, res, (error) => {
    if (!error) {
      if (!req.file) {
        return next();
      }

      return validateUploadedImageFile(req.file)
        .then(async (isValid) => {
          if (isValid) {
            return next();
          }

          await deleteStoredAvatar(uploadedAvatarToPublicPath(req.file));
          req.file = undefined;
          req.avatarUploadError = {
            code: 'INVALID_AVATAR_CONTENT',
            message:
              'Nội dung file không khớp định dạng JPG, PNG hoặc WEBP.',
          };
          return next();
        })
        .catch(async (validationError) => {
          await deleteStoredAvatar(uploadedAvatarToPublicPath(req.file));
          req.file = undefined;
          return next(validationError);
        });
    }

    const storedPath = uploadedAvatarToPublicPath(req.file);

    return deleteStoredAvatar(storedPath)
      .then(() => {
        req.file = undefined;

        if (!EXPECTED_AVATAR_UPLOAD_ERROR_CODES.has(error.code)) {
          return next(error);
        }

        req.avatarUploadError = {
          code: error.code || 'AVATAR_UPLOAD_ERROR',
          message: getAvatarUploadErrorMessage(error),
        };
        return next();
      })
      .catch(next);
  });
};

module.exports = {
  MAX_AVATAR_SIZE_BYTES,
  uploadAvatar,
};
