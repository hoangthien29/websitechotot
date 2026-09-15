const errorMiddleware = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (process.env.NODE_ENV === 'development') {
    console.error(error);
  }

  const requestedStatus = Number(error.status || error.statusCode);
  const statusCode =
    requestedStatus >= 400 && requestedStatus < 600 ? requestedStatus : 500;

  if (req.xhr || req.get('Accept')?.includes('application/json')) {
    const isUploadError = error.code === 'LIMIT_FILE_SIZE' ||
      error.code === 'LIMIT_FILE_COUNT' ||
      error.message === 'Chỉ hỗ trợ ảnh hoặc video.';

    return res.status(isUploadError ? 422 : statusCode).json({
      code: isUploadError ? 'MEDIA_VALIDATION_FAILED' : 'INTERNAL_ERROR',
      message: isUploadError
        ? 'File tải lên không hợp lệ hoặc vượt quá giới hạn.'
        : 'Đã xảy ra lỗi. Vui lòng thử lại.',
    });
  }

  return res.status(statusCode).render('errors/500', {
    pageTitle: 'Đã xảy ra lỗi',
    statusCode,
  });
};

module.exports = errorMiddleware;
