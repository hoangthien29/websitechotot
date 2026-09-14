require('dotenv').config();

const mongoose = require('mongoose');

const connectDatabase = require('../src/config/database');
const Category = require('../src/models/Category');
const createSlug = require('../src/utils/createSlug');

const seedData = [
  ['Điện thoại', 'Điện thoại di động và phụ kiện đã qua sử dụng.'],
  ['Laptop và máy tính', 'Laptop, máy tính để bàn và phụ kiện máy tính.'],
  ['Xe máy', 'Xe máy và phụ kiện xe dành cho nhu cầu đi lại.'],
  ['Đồ điện tử', 'Thiết bị điện tử và phụ kiện công nghệ.'],
  ['Đồ gia dụng', 'Thiết bị và vật dụng phục vụ gia đình.'],
  ['Thời trang', 'Quần áo, giày dép và phụ kiện thời trang.'],
  ['Nội thất', 'Bàn ghế, tủ và đồ trang trí không gian sống.'],
  ['Thể thao', 'Dụng cụ và phụ kiện dành cho hoạt động thể thao.'],
  ['Mẹ và bé', 'Sản phẩm thiết yếu dành cho mẹ và trẻ nhỏ.'],
  ['Khác', 'Các sản phẩm phù hợp chưa thuộc những danh mục trên.'],
].map(([name, description]) => ({
  name,
  slug: createSlug(name),
  description,
  image: '',
  status: 'active',
}));

const seedCategories = async () => {
  let createdCount = 0;

  try {
    await connectDatabase();
    await Category.init();

    for (const category of seedData) {
      const result = await Category.updateOne(
        { $or: [{ name: category.name }, { slug: category.slug }] },
        { $setOnInsert: category },
        { upsert: true },
      );

      if (result.upsertedCount === 1) {
        createdCount += 1;
      }
    }

    console.log(`Seed danh mục hoàn tất: tạo mới ${createdCount}, đã tồn tại ${seedData.length - createdCount}.`);
  } catch (error) {
    console.error(`Seed danh mục thất bại (${error.name || 'UnknownError'}).`);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('Đã đóng kết nối MongoDB sau khi seed danh mục.');
    }
  }
};

void seedCategories();
