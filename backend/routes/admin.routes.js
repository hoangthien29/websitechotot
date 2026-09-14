const express = require('express');

const adminDashboardController = require('../controllers/adminDashboard.controller');
const adminListingController = require('../controllers/adminListing.controller');
const adminUserController = require('../controllers/adminUser.controller');
const { adminMutationLimiter } = require('../config/rateLimit');
const { requireAdmin } = require('../middlewares/admin.middleware');
const { requireAuth } = require('../middlewares/auth.middleware');
const {
  adminListingIdValidator,
  adminListingsQueryValidator,
  hideListingValidator,
} = require('../validators/adminListing.validator');
const {
  adminUserIdValidator,
  adminUsersQueryValidator,
  blockUserValidator,
} = require('../validators/adminUser.validator');

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/', adminDashboardController.showDashboard);

router.get(
  '/users',
  adminUsersQueryValidator,
  adminUserController.listUsers,
);
router.get(
  '/users/:id',
  adminUserIdValidator,
  adminUserController.showUser,
);
router.patch(
  '/users/:id/approve',
  adminMutationLimiter,
  adminUserIdValidator,
  adminUserController.approveUser,
);
router.patch(
  '/users/:id/block',
  adminMutationLimiter,
  blockUserValidator,
  adminUserController.blockUser,
);
router.patch(
  '/users/:id/unblock',
  adminMutationLimiter,
  adminUserIdValidator,
  adminUserController.unblockUser,
);

router.get(
  '/listings',
  adminListingsQueryValidator,
  adminListingController.listListings,
);
router.get(
  '/listings/:id',
  adminListingIdValidator,
  adminListingController.showListing,
);
router.patch(
  '/listings/:id/hide',
  adminMutationLimiter,
  hideListingValidator,
  adminListingController.hideListing,
);
router.patch(
  '/listings/:id/restore',
  adminMutationLimiter,
  adminListingIdValidator,
  adminListingController.restoreListing,
);

module.exports = router;
