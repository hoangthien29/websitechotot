const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.redirect(303, '/login');
  }

  if (
    req.user.role !== 'admin' ||
    (req.user.status && req.user.status !== 'active')
  ) {
    return res.status(403).render('errors/403', {
      pageTitle: 'Không có quyền truy cập',
    });
  }

  return next();
};

module.exports = {
  requireAdmin,
};
