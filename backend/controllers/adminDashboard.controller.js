const adminDashboardService = require('../services/adminDashboard.service');
const presentAdminListing = require('../utils/presentAdminListing');
const presentAdminUser = require('../utils/presentAdminUser');

const showDashboard = async (req, res, next) => {
  try {
    const overview =
      await adminDashboardService.getDashboardOverview();

    return res.render('admin/dashboard', {
      pageTitle: 'Quản trị hệ thống',
      stats: overview.stats,
      recentUsers: overview.recentUsers.map(presentAdminUser),
      recentListings: overview.recentListings.map(presentAdminListing),
      recentAdminHiddenListings:
        overview.recentAdminHiddenListings.map(presentAdminListing),
      pageStyles: ['/css/admin.css'],
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  showDashboard,
};
