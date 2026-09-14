const listingService = require('../services/listing.service');

const renderNotFound = (req, res) =>
  res.status(404).render('errors/404', {
    pageTitle: 'Không tìm thấy trang',
    requestedUrl: req.originalUrl,
  });

const loadListing = async (req, res, next) => {
  try {
    const listing = await listingService.getListingDocumentById(req.params.id);

    if (!listing) {
      return renderNotFound(req, res);
    }

    req.listing = listing;
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireListingOwnerOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.redirect(303, '/login');
  }

  const isOwner = req.listing.seller.equals(req.user._id);
  const isAdmin = req.user.role === 'admin';

  if (req.listing.moderation?.isHiddenByAdmin === true) {
    return res.status(403).render('errors/403', {
      pageTitle: 'Bài đăng đang bị kiểm duyệt',
    });
  }

  if (!isOwner && !isAdmin) {
    return res.status(403).render('errors/403', {
      pageTitle: 'Không có quyền truy cập',
    });
  }

  return next();
};

module.exports = {
  loadListing,
  requireListingOwnerOrAdmin,
};
