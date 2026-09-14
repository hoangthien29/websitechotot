const { isManagedAvatarPath } = require('./avatarStorage');
const { isListingImagePublicPath } = require('./fileStorage');
const formatDateTime = require('./formatDateTime');
const formatPrice = require('./formatPrice');

const DEFAULT_AVATAR = '/images/default-avatar.svg';
const LISTING_PLACEHOLDER = '/images/listing-placeholder.svg';

const listingStatusLabels = {
  active: 'Đang bán',
  sold: 'Đã bán',
  hidden: 'Đã ẩn',
};

const getReferenceId = (value) => value?._id || value;

const presentConversation = (conversation, currentUserId) => {
  const data = conversation?.toObject
    ? conversation.toObject()
    : conversation;
  const buyerId = getReferenceId(data.buyer)?.toString();
  const currentId = currentUserId?.toString();
  const otherParticipant =
    buyerId === currentId ? data.seller : data.buyer;
  const otherParticipantId = getReferenceId(otherParticipant)?.toString();
  const listing = data.listing || null;
  const listingImages = Array.isArray(listing?.images)
    ? listing.images.filter(isListingImagePublicPath)
    : [];
  const listingStatus = listing?.status || 'hidden';
  const unreadCount = Number.isSafeInteger(data.unreadCount)
    ? data.unreadCount
    : 0;

  return {
    id: data._id.toString(),
    detailUrl: `/messages/${data._id}`,
    otherParticipant: {
      id: otherParticipantId || '',
      name: otherParticipant?.name || 'Người dùng không còn tồn tại',
      avatarUrl: isManagedAvatarPath(otherParticipant?.avatar)
        ? otherParticipant.avatar
        : DEFAULT_AVATAR,
    },
    listing: {
      id: getReferenceId(listing)?.toString() || '',
      title: listing?.title || 'Bài đăng không còn tồn tại',
      status: listingStatus,
      statusLabel:
        listingStatusLabels[listingStatus] || 'Không còn tồn tại',
      primaryImage: listingImages[0] || LISTING_PLACEHOLDER,
      formattedPrice:
        typeof listing?.price === 'number' ? formatPrice(listing.price) : '',
      detailUrl:
        listing && listingStatus !== 'hidden'
          ? `/listings/${getReferenceId(listing)}`
          : '',
    },
    lastMessagePreview:
      data.lastMessagePreview || 'Chưa có tin nhắn.',
    formattedLastMessageAt: formatDateTime(
      data.lastMessageAt || data.createdAt,
    ),
    unreadCount,
    hasUnread: unreadCount > 0,
  };
};

module.exports = presentConversation;
