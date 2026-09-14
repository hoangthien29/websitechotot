const express = require('express');

const profileController = require('../controllers/profile.controller');
const { multipartCsrfProtection } = require('../config/csrf');
const { uploadAvatar } = require('../middlewares/avatar.middleware');
const { requireAuth } = require('../middlewares/auth.middleware');
const {
  updateProfileValidator,
} = require('../validators/profile.validator');

const router = express.Router();

router.get('/profile', requireAuth, profileController.showProfile);
router.get('/users/:id', profileController.showPublicSellerProfile,);
router.get('/profile/edit', requireAuth, profileController.showEditProfile);
router.put(
  '/profile',
  requireAuth,
  uploadAvatar,
  multipartCsrfProtection,
  updateProfileValidator,
  profileController.updateProfile,
);

module.exports = router;
