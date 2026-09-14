const categoryService = require('../services/category.service');
const favoriteService = require('../services/favorite.service');
const listingService = require('../services/listing.service');
const presentListing = require('../utils/presentListing');

const getHome = async (req, res, next) => {
  try {
    const [categories, latestListings] = await Promise.all([
      categoryService.getActiveCategories(),
      listingService.getLatestListings(15),
    ]);
    const favoriteListingIds = await favoriteService.getFavoriteListingIds(
      req.user?._id,
      latestListings.map((listing) => listing._id),
    );

    return res.render('home', {
      pageTitle: 'Mua bán đồ cũ an toàn, tiện lợi',
      categories,
      listings: latestListings.map((listing) =>
        presentListing(listing, {
          isFavorited: favoriteListingIds.has(listing._id.toString()),
        }),
      ),
      currentUrl: req.originalUrl,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getHome,
};
