const {
  CSRF_ERROR_CODE,
  generateCsrfToken,
} = require('../config/csrf');
const {
  deleteStoredAvatar,
  uploadedAvatarToPublicPath,
} = require('../utils/avatarStorage');
const {
  deleteStoredCategoryImage,
  uploadedCategoryImageToPublicPath,
} = require('../utils/categoryImageStorage');
const {
  deleteStoredFiles,
  uploadedFilesToPublicPaths,
} = require('../utils/fileStorage');

const attachCsrfToken = (req, res, next) => {
  Object.defineProperty(res.locals, 'csrfToken', {
    configurable: true,
    enumerable: true,
    get: () => generateCsrfToken(req),
  });

  return next();
};

const cleanupRequestUploads = async (req) => {
  const tasks = [];

  if (Array.isArray(req.files) && req.files.length > 0) {
    tasks.push(deleteStoredFiles(uploadedFilesToPublicPaths(req.files)));
  }

  if (req.file?.fieldname === 'avatar') {
    tasks.push(
      deleteStoredAvatar(uploadedAvatarToPublicPath(req.file)),
    );
  }

  if (req.file?.fieldname === 'image') {
    tasks.push(
      deleteStoredCategoryImage(
        uploadedCategoryImageToPublicPath(req.file),
      ),
    );
  }

  await Promise.all(tasks);
  req.files = [];
  req.file = undefined;
};

const handleCsrfError = async (error, req, res, next) => {
  if (error?.code !== CSRF_ERROR_CODE) {
    return next(error);
  }

  try {
    await cleanupRequestUploads(req);
  } catch (cleanupError) {
    return next(cleanupError);
  }

  return res.status(403).render('errors/403', {
    pageTitle: 'Yêu cầu không hợp lệ',
    errorMessage:
      'Phiên biểu mẫu đã hết hạn hoặc mã bảo mật không hợp lệ. Vui lòng tải lại trang và thử lại.',
  });
};

module.exports = {
  attachCsrfToken,
  cleanupRequestUploads,
  handleCsrfError,
};
