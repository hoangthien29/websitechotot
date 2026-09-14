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

  return res.status(statusCode).render('errors/500', {
    pageTitle: 'Đã xảy ra lỗi',
    statusCode,
  });
};

module.exports = errorMiddleware;
