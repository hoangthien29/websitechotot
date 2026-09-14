const notFoundMiddleware = (req, res) => {
  res.status(404).render('errors/404', {
    pageTitle: 'Không tìm thấy trang',
    requestedUrl: req.originalUrl,
  });
};

module.exports = notFoundMiddleware;
