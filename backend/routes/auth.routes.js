const express = require('express');

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

const router = express.Router();

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

module.exports = router;
