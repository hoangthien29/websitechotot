const express = require('express');

const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authLimiter } = require('../config/rateLimit');
const {
  requireAuth,
  requireGuest,
} = require('../middlewares/auth.middleware');
const {
  loginValidator,
  registerValidator,
} = require('../validators/auth.validator');


router.get('/register', requireGuest, authController.showRegisterForm);
router.post(
  '/register',
  requireGuest,
  authLimiter,
  registerValidator,
  authController.register,
);
router.get('/login', requireGuest, authController.showLoginForm);
router.post(
  '/login',
  requireGuest,
  authLimiter,
  loginValidator,
  authController.login,
);
router.post('/logout', requireAuth, authController.logout);

router.get('/auth/google/callback', authController.googleCallback);
router.get('/auth/google', authController.googleLogin);
router.get('/google/callback', authController.googleCallback);
router.get('/google', authController.googleLogin);
module.exports = router;
