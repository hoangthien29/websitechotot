const formatPrice = require('./formatPrice');
const { isListingImagePublicPath } = require('./fileStorage');

const LISTING_PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const conditionLabels = {
  new: 'Mới',
  used: 'Đã sử dụng',
};

const statusLabels = {
  active: 'Đang bán',
  sold: 'Đã bán',
  hidden: 'Đã ẩn',
};

const presentListing = (listing, options = {}) => {
  const data = listing?.toObject ? listing.toObject() : listing;
  const images = Array.isArray(data.images)
    ? data.images.filter(isListingImagePublicPath)
    : [];

  return {
    ...data,
    images,
    hasImages: images.length > 0,
    imageCount: images.length,
    primaryImage: images[0] || LISTING_PLACEHOLDER_IMAGE,
    formattedPrice: formatPrice(data.price),
    formattedCreatedAt: new Intl.DateTimeFormat('vi-VN').format(
      data.createdAt,
    ),
    conditionLabel: conditionLabels[data.condition] || data.condition,
    statusLabel: statusLabels[data.status] || data.status,
    isHiddenByAdmin: data.moderation?.isHiddenByAdmin === true,
    isFavorited: Boolean(options.isFavorited),
  };
};

module.exports = presentListing;
