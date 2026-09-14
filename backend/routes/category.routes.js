const express = require('express');

const categoryController = require('../controllers/category.controller');

const router = express.Router();

router.get('/', categoryController.listCategories);
router.get('/:slug', categoryController.showCategory);

module.exports = router;
