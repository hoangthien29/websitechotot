const express = require('express');

const favoriteController = require('../controllers/favorite.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const {
  favoriteListingIdValidator,
  favoritesPageValidator,
} = require('../validators/favorite.validator');

const router = express.Router();

router.get(
  '/favorites',
  requireAuth,
  favoritesPageValidator,
  favoriteController.listFavorites,
);
router.post(
  '/listings/:id/favorite',
  requireAuth,
  favoriteListingIdValidator,
  favoriteController.addFavorite,
);
router.delete(
  '/listings/:id/favorite',
  requireAuth,
  favoriteListingIdValidator,
  favoriteController.removeFavorite,
);

module.exports = router;
