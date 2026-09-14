const Category = require('../models/Category');
const Conversation = require('../models/Conversation');
const Favorite = require('../models/Favorite');
const Listing = require('../models/Listing');
const Message = require('../models/Message');
const User = require('../models/User');

const RECENT_ADMIN_ITEMS = 5;

const getDashboardOverview = async () => {
  const [
    totalUsers,
    activeUsers,
    pendingUsers,
    blockedUsers,
    regularUsers,
    adminUsers,
    totalCategories,
    activeCategories,
    inactiveCategories,
    totalListings,
    activeListings,
    soldListings,
    hiddenListings,
    adminHiddenListings,
    ownerHiddenListings,
    totalFavorites,
    totalConversations,
    totalMessages,
    unreadMessages,
    recentUsers,
    recentListings,
    recentAdminHiddenListings,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'pending' }),
    User.countDocuments({ status: 'blocked' }),
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'admin' }),
    Category.countDocuments(),
    Category.countDocuments({ status: 'active' }),
    Category.countDocuments({ status: 'inactive' }),
    Listing.countDocuments(),
    Listing.countDocuments({ status: 'active' }),
    Listing.countDocuments({ status: 'sold' }),
    Listing.countDocuments({ status: 'hidden' }),
    Listing.countDocuments({
      status: 'hidden',
      'moderation.isHiddenByAdmin': true,
    }),
    Listing.countDocuments({
      status: 'hidden',
      'moderation.isHiddenByAdmin': { $ne: true },
    }),
    Favorite.countDocuments(),
    Conversation.countDocuments(),
    Message.countDocuments(),
    Message.countDocuments({ readAt: null }),
    User.find()
      .select('_id name email role status createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_ADMIN_ITEMS)
      .lean(),
    Listing.find()
      .select(
        '_id title price status moderation category seller createdAt',
      )
      .populate('category', 'name slug')
      .populate('seller', 'name email')
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_ADMIN_ITEMS)
      .lean(),
    Listing.find({
      status: 'hidden',
      'moderation.isHiddenByAdmin': true,
    })
      .select(
        '_id title status moderation category seller createdAt',
      )
      .populate('category', 'name slug')
      .populate('seller', 'name email')
      .populate('moderation.moderatedBy', 'name')
      .sort({ 'moderation.moderatedAt': -1, _id: -1 })
      .limit(RECENT_ADMIN_ITEMS)
      .lean(),
  ]);

  return {
    stats: {
      users: {
        total: totalUsers,
        active: activeUsers,
        pending: pendingUsers,
        blocked: blockedUsers,
        regular: regularUsers,
        admin: adminUsers,
      },
      categories: {
        total: totalCategories,
        active: activeCategories,
        inactive: inactiveCategories,
      },
      listings: {
        total: totalListings,
        active: activeListings,
        sold: soldListings,
        hidden: hiddenListings,
        adminHidden: adminHiddenListings,
        ownerHidden: ownerHiddenListings,
      },
      favorites: {
        total: totalFavorites,
      },
      conversations: {
        total: totalConversations,
      },
      messages: {
        total: totalMessages,
        unread: unreadMessages,
      },
    },
    recentUsers,
    recentListings,
    recentAdminHiddenListings,
  };
};

module.exports = {
  RECENT_ADMIN_ITEMS,
  getDashboardOverview,
};
