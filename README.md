# NTT Marketplace

NTT Marketplace là đồ án website mua bán và đăng tin sản phẩm cũ, được xây dựng theo kiến trúc MVC bằng Node.js, Express, EJS và MongoDB. Phiên bản hiện tại đã có đăng ký, đăng nhập, session lưu trong MongoDB, hồ sơ cá nhân, quản lý danh mục và CRUD bài đăng; trang chủ và trang danh mục đều lấy sản phẩm thật từ MongoDB.

## Công nghệ đang sử dụng

- Node.js và Express.js
- MongoDB và Mongoose
- EJS
- Bootstrap 5
- Helmet
- Morgan
- Method Override
- dotenv
- bcrypt
- express-validator
- express-session
- connect-mongo
- multer
- slugify
- Nodemon (development)
- CommonJS

## Yêu cầu

- Node.js 20.8 trở lên
- npm đi kèm Node.js
- MongoDB local đang chạy hoặc một MongoDB Atlas cluster có thể truy cập

Kiểm tra phiên bản đã cài:

```bash
node --version
npm --version
```

## Cài đặt

1. Cài dependencies:

   ```bash
   npm install
   ```

2. Tạo file `.env` từ file mẫu:

   PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   macOS/Linux:

   ```bash
   cp .env.example .env
   ```

3. Cấu hình cổng, kết nối MongoDB và session trong `.env`:

   ```env
   NODE_ENV=development
   PORT=3000
   MONGODB_URI=mongodb://127.0.0.1:27017/ntt_marketplace
   SESSION_SECRET=replace_with_a_long_random_secret
   SESSION_COOKIE_NAME=ntt_marketplace_sid
   SESSION_MAX_AGE_MS=604800000
   ```

   Tạo `SESSION_SECRET` mạnh bằng lệnh sau rồi chỉ lưu kết quả vào `.env` local:

   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

   Không commit file `.env` vì file này có thể chứa thông tin kết nối và session secret. `.env.example` chỉ chứa các giá trị mẫu an toàn.

## Kết nối MongoDB

### MongoDB local

Khởi động MongoDB local trước khi chạy website. Nếu MongoDB được cài dưới dạng Windows service, có thể khởi động service từ ứng dụng Services hoặc terminal có quyền phù hợp:

```powershell
net start MongoDB
```

Nếu chạy `mongod` thủ công, chỉ định thư mục lưu dữ liệu đã tồn tại:

```powershell
mongod --dbpath C:\data\db
```

Sau đó dùng URI sau trong `.env`:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/ntt_marketplace
```

### MongoDB Atlas

Thay `MONGODB_URI` trong file `.env` local bằng connection string do Atlas cung cấp:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER/ntt_marketplace
```

Thay các giá trị mẫu bằng thông tin thật, cấu hình Database User và cho phép địa chỉ IP của máy truy cập cluster. Không đưa connection string thật vào `.env.example` hoặc Git.

Nếu Node.js báo lỗi `querySrv ECONNREFUSED` trong khi URI Atlas hợp lệ, có thể cấu hình DNS resolver dành cho truy vấn MongoDB trong `.env`:

```env
MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1
```

## Chạy dự án

Chế độ development (tự khởi động lại khi mã nguồn thay đổi):

```bash
npm run dev
```

Chế độ production:

```bash
npm start
```

Sau khi khởi động, truy cập `http://localhost:3000`.

MongoDB Atlas hoặc MongoDB local phải kết nối thành công trước khi server bắt đầu lắng nghe HTTP.

## Đăng ký tài khoản

Bước 3 đã bổ sung chức năng đăng ký phía server với các route:

- `GET /register`: hiển thị form đăng ký.
- `POST /register`: validate dữ liệu, kiểm tra email trùng, hash mật khẩu và lưu user.

Mật khẩu được hash bằng `bcrypt` với 12 vòng salt trước khi lưu. Dữ liệu form được kiểm tra phía server bằng `express-validator`; `confirmPassword` không được lưu và `role`/`status` không được nhận từ request.

Để kiểm tra thủ công:

1. Chạy `npm run dev` và chờ thông báo MongoDB kết nối thành công.
2. Mở `http://localhost:3000/register`.
3. Gửi form hợp lệ và xác nhận trang chuyển về `/login?registered=1`.
4. Thử email sai định dạng, mật khẩu ngắn, xác nhận không khớp và email đã tồn tại để kiểm tra thông báo lỗi.

## Đăng nhập, session và đăng xuất

Bước 4 đã bổ sung đăng nhập và đăng xuất bằng session phía server:

- `GET /login`: hiển thị form đăng nhập.
- `POST /login`: validate dữ liệu, tìm user và dùng `bcrypt.compare` để kiểm tra mật khẩu.
- `POST /logout`: hủy session, xóa cookie và chuyển về trang đăng nhập.
- `GET /logout` không tồn tại; thao tác thay đổi trạng thái chỉ dùng phương thức POST.

Ứng dụng dùng `express-session` và `connect-mongo`. Session được lưu trong collection `sessions` của chính MongoDB được cấu hình qua `MONGODB_URI`; cookie chỉ chứa session ID, có `httpOnly`, `sameSite=lax`, thời hạn mặc định 7 ngày và chỉ bật `secure` trong production. Session chỉ lưu `userId`, không lưu mật khẩu, password hash hoặc toàn bộ user document.

Sau khi xác thực thành công, session được regenerate trước khi ghi `userId` để hạn chế session fixation. Middleware tải user active theo `userId`, đặt user vào `req.user` và `res.locals.currentUser`, nhờ đó EJS có thể hiển thị tên người dùng và form đăng xuất trên navbar. Tài khoản `blocked` hoặc `pending` không thể đăng nhập.

Để kiểm tra thủ công:

1. Đăng ký một tài khoản test tại `/register` và xác nhận được chuyển tới `/login?registered=1`.
2. Đăng nhập bằng tài khoản test, xác nhận response chuyển về `/` và navbar hiển thị tên người dùng.
3. Refresh trang chủ, sau đó mở `/login` và `/register`; trạng thái đăng nhập phải được giữ và hai trang guest phải chuyển về `/`.
4. Gửi form `POST /logout`, xác nhận chuyển tới `/login?loggedOut=1` và navbar trở lại trạng thái guest.
5. Kiểm tra MongoDB có collection `sessions` và document session không chứa password/password hash.

Các biến session bắt buộc hoặc được hỗ trợ:

- `SESSION_SECRET`: secret mạnh dùng để ký session cookie; ứng dụng báo lỗi rõ ràng nếu thiếu.
- `SESSION_COOKIE_NAME`: tên cookie, mặc định đề xuất là `ntt_marketplace_sid`.
- `SESSION_MAX_AGE_MS`: thời gian sống cookie theo mili giây, giá trị mẫu `604800000` tương đương 7 ngày.

CSRF protection chưa được triển khai trong Bước 4 và sẽ được bổ sung ở giai đoạn bảo mật sau. Bước 4 chưa triển khai trang cá nhân, admin dashboard hoặc JWT; trang hồ sơ cá nhân được bổ sung riêng ở Bước 9.

## Danh mục sản phẩm

Bước 5 đã bổ sung model `Category`, tự động tạo slug tiếng Việt bằng `slugify`, danh sách/chi tiết danh mục công khai và khu vực quản lý dành riêng cho admin. Danh mục có các trường `name`, `slug`, `description`, `image`, `status`, `createdAt` và `updatedAt`. Trạng thái chỉ nhận `active` hoặc `inactive`; danh mục inactive không xuất hiện trên trang chủ hoặc các route công khai.

Route công khai:

- `GET /categories`: danh sách danh mục active.
- `GET /categories/:slug`: chi tiết một danh mục active; slug không tồn tại hoặc inactive trả 404.

Route quản trị, tất cả đều yêu cầu `req.user.role === "admin"`:

- `GET /admin/categories`
- `GET /admin/categories/create`
- `POST /admin/categories`
- `GET /admin/categories/:id/edit`
- `PUT /admin/categories/:id`
- `PATCH /admin/categories/:id/status`

Ứng dụng không nhận slug từ form. Service tự tạo slug từ tên, kiểm tra trùng name/slug trước khi ghi và vẫn xử lý duplicate key từ MongoDB để tránh lỗi kỹ thuật `E11000` xuất hiện trên giao diện. Category chỉ được ẩn bằng status, không có route DELETE.

Tạo dữ liệu danh mục ban đầu bằng lệnh:

```bash
npm run seed:categories
```

Seed chỉ thêm những danh mục còn thiếu bằng `$setOnInsert`; không xóa hoặc ghi đè danh mục đã được admin chỉnh sửa. Có thể chạy lại lệnh mà không tạo dữ liệu trùng.

Để tạo tài khoản admin test an toàn:

1. Đăng ký một tài khoản test riêng trên website.
2. Trong MongoDB Atlas, mở database `ntt_marketplace` và collection `users`.
3. Tìm đúng email test rồi chỉ đổi trường `role` của document đó từ `user` thành `admin`.
4. Đăng xuất và đăng nhập lại trước khi mở `/admin/categories`.

Không lưu email/mật khẩu admin trong source code và không cập nhật hàng loạt user. Trường `image` của Category chỉ nhận URL hoặc đường dẫn static đã tồn tại. CSRF protection vẫn chưa được triển khai.

## Bài đăng sản phẩm

Bước 6 đã hoàn thành Listing CRUD theo quyền sở hữu. Model `Listing` lưu `title`, `description`, `price` dạng Number, `category` tham chiếu `Category`, `seller` tham chiếu `User`, `location`, `condition`, `images`, `status` và timestamps. `condition` chỉ nhận `new` hoặc `used`; `status` chỉ nhận `active`, `sold` hoặc `hidden`.

Route công khai:

- `GET /listings`
- `GET /listings/:id`

Route yêu cầu đăng nhập:

- `GET /listings/create`
- `POST /listings`
- `GET /my-listings`

Route chỉ owner hoặc admin được sử dụng:

- `GET /listings/:id/edit`
- `PUT /listings/:id`
- `PATCH /listings/:id/status`
- `DELETE /listings/:id`

Seller luôn được lấy từ user trong session, không nhận từ form. Route `DELETE` là soft delete: document không bị xóa mà chỉ chuyển sang `hidden`. Listing `active` hiển thị công khai và ở khu vực sản phẩm mới; listing `sold` vẫn công khai với nhãn “Đã bán” nhưng không xuất hiện ở sản phẩm mới; listing `hidden` chỉ owner hoặc admin xem được. Trang chủ lấy tối đa 8 listing active mới nhất từ MongoDB, còn trang chi tiết category hiển thị listing active và sold thuộc đúng category.

Bước 6 chưa hỗ trợ tìm kiếm, lọc, phân trang, yêu thích hoặc chat. Không commit file `.env` hay đưa thông tin kết nối, session secret vào source code.

## Upload ảnh sản phẩm

Bước 7 đã bổ sung upload nhiều ảnh bằng Multer cho form tạo và sửa Listing. Hai form sử dụng `multipart/form-data`, field upload có tên `images` và ảnh là tùy chọn. Mỗi Listing được có từ 0 đến 5 ảnh; mỗi ảnh tối đa 5 MB. Định dạng được hỗ trợ là JPG, JPEG, PNG và WEBP. Ứng dụng không chấp nhận SVG, GIF, video, tài liệu hoặc file thực thi do người dùng upload.

File được lưu local trong `uploads/listings/` với filename UUID do server tạo và phần mở rộng ánh xạ từ MIME type cho phép. Tên file gốc không được dùng làm tên lưu. MongoDB chỉ lưu public path dạng `/uploads/listings/<filename>`, không lưu Buffer, Base64 hoặc đường dẫn tuyệt đối. Thư mục `uploads/` nằm trong `.gitignore` nên ảnh người dùng không được commit lên Git.

Khi sửa Listing, owner hoặc admin có thể giữ ảnh cũ, tải thêm ảnh và chọn xóa riêng từng ảnh hiện tại. Ảnh cũ được đối chiếu với chính Listing trước khi xóa; file mới được dọn nếu upload, validation, category hoặc cập nhật database thất bại. File cũ chỉ bị xóa sau khi MongoDB cập nhật thành công. Ảnh đầu tiên trong mảng là ảnh chính.

Card sản phẩm và trang “Bài đăng của tôi” hiển thị ảnh chính. Trang chi tiết hiển thị gallery responsive. Listing cũ hoặc Listing mới không có ảnh sử dụng static placeholder `/images/listing-placeholder.svg`. Soft delete chỉ chuyển Listing sang `hidden` và không xóa ảnh, vì Listing vẫn có thể được owner xem hoặc kích hoạt lại.

Lưu ảnh local phù hợp cho môi trường development. Khi triển khai production trên nhiều máy hoặc filesystem không bền vững, có thể chuyển lớp lưu trữ sang Cloudinary hoặc S3 ở bước sau. Phiên bản hiện tại chưa triển khai Cloudinary.

## Tìm kiếm, lọc, sắp xếp và phân trang

Bước 8 bổ sung tìm kiếm công khai tại `GET /listings` bằng query string. Route hỗ trợ đúng các tham số `keyword`, `category`, `condition`, `minPrice`, `maxPrice`, `location`, `status`, `sort` và `page`. Giá trị mặc định lần lượt là chuỗi rỗng cho các bộ lọc tùy chọn, `status=all`, `sort=newest` và `page=1`. Mỗi trang luôn lấy tối đa 12 Listing; client không được tự thay đổi `limit`.

`keyword` tìm không phân biệt hoa thường trong `title` và `description`; `location` tìm chuỗi con không phân biệt hoa thường. Cả hai giá trị đều được giới hạn độ dài và escape ký tự regex trước khi tạo bộ lọc. Cách tìm bằng escaped regex phù hợp với phạm vi đồ án và lượng dữ liệu vừa phải; dự án chưa dùng MongoDB text index, Atlas Search, Elasticsearch hoặc dịch vụ tìm kiếm ngoài.

Danh mục được nhận dưới dạng slug và chỉ được resolve sang ObjectId khi Category còn active. `condition`, `status` và `sort` dùng whitelist cố định; `hidden` không bao giờ là trạng thái public. Giá chỉ nhận số nguyên từ 0 đến 100.000.000.000 và giá tối thiểu không được lớn hơn giá tối đa. `page` chỉ nhận số nguyên từ 1 đến 10.000. Các field lạ, object, array và cú pháp MongoDB operator từ query đều bị từ chối; `req.query` không được truyền hoặc spread trực tiếp vào truy vấn MongoDB.

Service dùng `countDocuments` song song với truy vấn `find`, đồng thời áp dụng `sort`, `skip` và `limit` ngay trong MongoDB. Phân trang giữ nguyên toàn bộ bộ lọc bằng `URLSearchParams`, hiển thị trang đầu/trước/các trang gần hiện tại/sau/cuối và chuyển về trang hợp lệ cuối cùng nếu người dùng yêu cầu trang vượt tổng kết quả. Trang chủ có form tìm nhanh gửi `GET /listings?keyword=...`; home controller vẫn chỉ tải danh mục active và 8 Listing active mới nhất như trước.

## Hồ sơ cá nhân

Bước 9 bổ sung trang hồ sơ riêng cho người dùng đã đăng nhập với các route:

- `GET /profile`: hiển thị thông tin tài khoản, ngày tham gia, thống kê Listing và tối đa 4 Listing gần đây.
- `GET /profile/edit`: hiển thị form chỉnh sửa hồ sơ.
- `PUT /profile`: cập nhật hồ sơ và ảnh đại diện.

Cả ba route đều dùng `requireAuth` và luôn lấy tài khoản từ `req.user._id`; route không nhận user ID từ URL hoặc form. Người dùng chỉ có thể cập nhật `name`, `phone`, `address` và `avatar`. Email, password, role và status không thể sửa trong bước này. Session tiếp tục chỉ lưu `userId`; tên và avatar mới được `loadCurrentUser` tải lại từ MongoDB ở request sau.

Avatar được upload bằng Multer qua field `avatar`, chỉ nhận một file JPG/JPEG, PNG hoặc WEBP tối đa 2 MB. File được đặt tên bằng UUID do server tạo, lưu trong `uploads/avatars/`, còn MongoDB chỉ lưu public path `/uploads/avatars/<uuid>.<extension>`. Ứng dụng không nhận filename gốc, Base64, absolute path, SVG, GIF, PDF hoặc video. Khi chưa có avatar, giao diện dùng placeholder tĩnh `/images/default-avatar.svg`.

Khi validation hoặc cập nhật database thất bại, avatar mới được dọn và avatar cũ được giữ nguyên. Avatar cũ chỉ bị xóa sau khi MongoDB cập nhật thành công, đồng thời utility chỉ cho phép xóa file thuộc đúng `uploads/avatars/`; ảnh Listing, placeholder và file ngoài thư mục này không bị tác động.

Thống kê hồ sơ dùng `countDocuments` riêng cho `active`, `sold` và `hidden`, sau đó tính tổng từ ba giá trị. Listing gần đây được truy vấn theo đúng seller hiện tại, sắp xếp mới nhất và giới hạn 4. Bước này chưa có đổi email, đổi mật khẩu, hồ sơ người bán công khai, Favorite hoặc Chat.

### Kiểm thử hồ sơ

Dự án dùng test runner có sẵn của Node.js nên không cần cài thêm package kiểm thử:

```bash
npm test
```

Bộ test kiểm tra validation name/phone/address, whitelist field cập nhật, bảo vệ route, thống kê Listing theo seller, Listing gần đây, Multer cho JPG/PNG/WEBP, giới hạn 2 MB, một file duy nhất, cleanup khi validation hoặc database lỗi, thay/xóa avatar, UUID public path, path traversal, placeholder và hồi quy auth/Category/Listing/search. Fixture avatar dùng UUID riêng và được xóa sau từng test; test không xóa ảnh Listing hoặc toàn bộ thư mục `uploads/`.

URL avatar đưa ra giao diện chỉ được chấp nhận khi khớp public path managed `/uploads/avatars/<uuid>.<extension>`; dữ liệu path khác sẽ hiển thị placeholder. Lỗi upload dự kiến trả form 422, còn lỗi filesystem hoặc Multer không dự kiến được chuyển cho error middleware thay vì bị che thành lỗi validation.

Khi `.env` đang trỏ tới database development dành cho kiểm thử, có thể chạy E2E profile:

```bash
npm run test:e2e:profile
```

Verifier tạo một tài khoản `example.test` ngẫu nhiên, kiểm tra session/profile/avatar trên HTTP và MongoDB thật, sau đó xóa đúng User, session và avatar của lần chạy đó. Script không in email, mật khẩu, cookie, MongoDB URI hoặc session secret; không dùng `deleteMany({})`, không xóa Listing và không giữ dữ liệu test.

## Sản phẩm yêu thích

Bước 10 bổ sung danh sách tin đã lưu dành riêng cho người dùng đã đăng nhập. Model `Favorite` chỉ lưu reference `user`, `listing` và timestamps; unique compound index `{ user: 1, listing: 1 }` bảo đảm mỗi người chỉ lưu một Listing một lần, kể cả khi có hai request gần đồng thời. Index `{ user: 1, createdAt: -1 }` hỗ trợ sắp xếp theo thời điểm lưu mới nhất.

Các route đều dùng `requireAuth`:

- `GET /favorites`: hiển thị danh sách tin đã lưu.
- `POST /listings/:id/favorite`: lưu một Listing.
- `DELETE /listings/:id/favorite`: bỏ lưu bằng method override.

User ID luôn lấy từ `req.user._id`; request không được chọn Favorite owner. Người dùng có thể lưu Listing `active` hoặc `sold`, nhưng không thể lưu Listing `hidden`, Listing không tồn tại hoặc Listing của chính mình. Thêm và bỏ lưu đều idempotent; duplicate key được xử lý như trạng thái đã lưu thay vì đưa lỗi `E11000` ra giao diện. `returnTo` chỉ chấp nhận đường dẫn nội bộ để tránh open redirect.

Trang Favorites phân trang trong MongoDB, tối đa 12 Listing mỗi trang và sắp xếp theo `Favorite.createdAt` giảm dần. Aggregation lọc Listing `active`/`sold` trước khi đếm, `skip` và `limit`, vì vậy Listing `hidden` hoặc reference không còn tồn tại không làm sai tổng trang và không tạo card rỗng. Soft delete Listing không xóa Favorite document; nếu Listing được kích hoạt lại thì tin đã lưu tự xuất hiện trở lại. Listing `sold` vẫn hiển thị với nhãn “Đã bán”.

Trạng thái tim được tích hợp vào trang chủ, kết quả tìm kiếm, chi tiết Category và Listing detail. Mỗi danh sách chỉ dùng một truy vấn Favorite với `$in`, không query theo từng card; guest không phát sinh truy vấn Favorite và được dẫn tới đăng nhập. Nút tim dùng SVG tĩnh do dự án kiểm soát, có `aria-label`, focus-visible, hover nhẹ, reduced-motion và Hallmark tokens hiện tại.

Bước 10 chưa triển khai Chat, Socket.IO, notification, Favorite Category, public Favorites hoặc Favorite count trên Header.

Khi `.env` trỏ tới database development dành cho kiểm thử, có thể chạy verifier Favorite đầy đủ:

```bash
npm run test:e2e:favorite
```

Verifier tạo User, Category, Listing và Favorite có nhãn Step 10 riêng, kiểm tra route HTTP/session cùng MongoDB thật, sau đó xóa đúng ID của lần chạy. Script không in email, mật khẩu, cookie, MongoDB URI hoặc session secret; không xóa dữ liệu ngoài phạm vi fixture.

## Nhắn tin giữa người mua và người bán

Bước 11 bổ sung nhắn tin văn bản riêng tư theo từng Listing. Mỗi `Conversation` gắn đúng một `listing`, `buyer` và `seller`; unique index trên ba trường này ngăn tạo cuộc trò chuyện trùng. `Message` lưu `conversation`, `sender`, `recipient`, nội dung plain text, `readAt` và timestamps. Metadata `lastMessagePreview`, `lastMessageAt` và `lastSender` giúp sắp xếp danh sách hội thoại mà không phải tải lại toàn bộ Message.

Các route đều yêu cầu đăng nhập:

- `GET /messages`: danh sách Conversation của User hiện tại, tối đa 20 mục mỗi trang.
- `GET /messages/:conversationId`: lịch sử Message, tối đa 50 tin mỗi trang.
- `POST /listings/:id/conversations`: tạo hoặc mở lại Conversation theo Listing.
- `POST /messages/:conversationId`: gửi tin nhắn văn bản tối đa 2.000 ký tự.

Buyer luôn lấy từ `req.user`, seller luôn lấy từ Listing, còn sender và recipient được server suy ra từ hai participant. Client không được chọn các danh tính này. User thứ ba và admin không phải participant đều nhận 404. Listing `active` cho phép tạo và gửi; Listing `sold` chỉ cho phép tiếp tục Conversation đã có; Listing `hidden` vẫn giữ lịch sử cho participant nhưng chuyển sang chỉ đọc. Nội dung được trim, lưu dưới dạng plain text và render bằng EJS escaped output để ngăn stored XSS.

Việc tạo Message và cập nhật metadata Conversation chạy trong một MongoDB transaction. Nếu metadata không cập nhật được thì Message cũng rollback. Unread count chỉ đếm Message có `recipient` là User hiện tại và `readAt: null`; khi participant mở Conversation, ứng dụng chỉ đánh dấu Message gửi đến họ trong đúng Conversation đó. Header hiển thị tổng unread và rút gọn số lớn hơn 99 thành `99+`.

Giao diện dùng Workbench NTT Cobalt và các token sẵn có trong `tokens.css`. Trang danh sách hiển thị người còn lại, Listing, thumbnail/placeholder, trạng thái, preview và unread badge. Trang chi tiết hiển thị Message từ cũ đến mới trong từng trang, giữ line break bằng `white-space: pre-wrap`, có focus-visible, reduced-motion và bố cục mobile-first.

Chạy unit test và E2E Message:

```bash
npm test
npm run test:e2e:messages
```

Verifier E2E dùng MongoDB Atlas thật để kiểm tra 48 nhóm trường hợp, gồm privacy participant, active/sold/hidden, duplicate/concurrent Conversation, transaction rollback, XSS, pagination, unread/mark-read và các hồi quy Bước 1–10. Fixture có nhãn ngẫu nhiên được xóa theo đúng ID sau khi chạy; script không in email, mật khẩu, cookie, MongoDB URI hoặc session secret.

## Quản trị User và kiểm duyệt Listing

Bước 12 bổ sung dashboard quản trị tại `GET /admin`, quản lý tài khoản và kiểm duyệt bài đăng. Toàn bộ route trong khu vực này đều đi qua `requireAuth` và `requireAdmin`; tài khoản admin cũng phải ở trạng thái `active`.

Route quản trị User:

- `GET /admin/users`: tìm theo tên/email, lọc trạng thái và phân trang 20 User mỗi trang.
- `GET /admin/users/:id`: xem metadata tài khoản, thống kê và tối đa 5 Listing gần nhất; không truy vấn hoặc render password.
- `PATCH /admin/users/:id/approve`: chỉ chuyển `pending` sang `active`.
- `PATCH /admin/users/:id/block`: chỉ chuyển User thường đang `active` sang `blocked`, bắt buộc lý do 10–500 ký tự.
- `PATCH /admin/users/:id/unblock`: chỉ chuyển `blocked` về `active`.

`User.accountModeration` lưu metadata phê duyệt/chặn gồm thời điểm và admin thực hiện. Khi bỏ chặn, hệ thống xóa metadata của lần chặn hiện tại (`blockedReason`, `blockedAt`, `blockedBy`) nhưng giữ metadata phê duyệt. Admin không thể tự chặn, chặn admin khác hoặc thay đổi role qua các action này. Session của User không còn `active` bị hủy an toàn ở request tiếp theo và User trở về trạng thái guest.

Route quản trị Listing:

- `GET /admin/listings`: tìm theo tiêu đề/người bán, lọc category, trạng thái Listing và trạng thái kiểm duyệt; phân trang 20 mục mỗi trang.
- `GET /admin/listings/:id`: xem thông tin Listing, ảnh theo `object-fit: contain`, số Favorite và metadata Conversation/Message mà không đọc nội dung Message.
- `PATCH /admin/listings/:id/hide`: ẩn bài bằng moderation metadata, lưu `previousStatus` và không xóa document hoặc file ảnh.
- `PATCH /admin/listings/:id/restore`: khôi phục trạng thái `active` hoặc `sold` trước đó; dữ liệu cũ không hợp lệ dùng fallback `active`.

`Listing.moderation.isHiddenByAdmin` phân biệt bài bị admin ẩn với soft hide do owner. Khi bị admin ẩn, owner vẫn nhận được thông báo nhưng không thể sửa, đổi trạng thái hoặc xóa mềm bài; kiểm tra được thực hiện cả ở middleware và service để tránh race condition. Việc ẩn/khôi phục dùng cập nhật có điều kiện, không có route hard delete.

Dashboard chỉ hiển thị số liệu tổng hợp và bản ghi gần đây. Thống kê Message dùng `countDocuments`; ứng dụng không tải hay hiển thị nội dung Message trong khu vực Admin. Giao diện dùng macrostructure Stat-Led của Hallmark, token trong `tokens.css`, focus-visible, reduced-motion và layout mobile-first.

Chạy unit test và E2E Admin:

```bash
npm test
npm run test:e2e:admin
```

Verifier E2E kiểm tra 74 nhóm trường hợp trên MongoDB Atlas thật, gồm phân quyền, chuyển trạng thái, privacy, race condition, responsive ở 320/375/414/768/1024 px và hồi quy Bước 1–11. Fixture được gắn nhãn ngẫu nhiên, xóa theo đúng ID sau mỗi lần chạy và audit orphan document/file; script không in email, mật khẩu, cookie, MongoDB URI, session secret hoặc nội dung Message.

## Upload và quản lý ảnh danh mục

Bước 12.1 mở rộng khu vực Admin Category để admin có thể tạo danh mục không ảnh, upload ảnh mới, thay ảnh hoặc xóa ảnh hiện tại. Form dùng `multipart/form-data` với một field file duy nhất tên `image`; chỉ nhận JPG/JPEG, PNG hoặc WEBP tối đa 3 MB và không nhận SVG. Tên file do server tạo bằng UUID và extension được ánh xạ từ MIME type, không sử dụng filename gốc từ client.

Ảnh được lưu local tại `uploads/categories/`. MongoDB chỉ lưu public path được ứng dụng quản lý theo dạng `/uploads/categories/<uuid>.<extension>`; không lưu Buffer, Base64, absolute path, URL ngoài hoặc metadata Multer. Category có thể không có ảnh và khi đó trang danh sách, trang chi tiết cùng khu vực Admin sử dụng icon theo slug làm fallback. Trang chủ tiếp tục giữ card Category icon compact hiện tại.

Khi tạo hoặc cập nhật thất bại vì validation, trùng dữ liệu hay lỗi database, ảnh mới vừa upload được cleanup. Khi thay hoặc xóa ảnh, database luôn được cập nhật trước rồi file cũ mới được xóa; nếu vừa upload ảnh mới vừa chọn xóa ảnh hiện tại thì ảnh mới được ưu tiên. Thay đổi `active`/`inactive` chỉ sửa trạng thái và không tác động đến ảnh. Utility chỉ cho phép xóa file UUID thuộc đúng `uploads/categories/`, không thể xóa ảnh Listing, avatar, icon hoặc file ngoài thư mục này.

Trang `/categories` dùng card link duy nhất với ảnh 16:9 hoặc icon fallback; trang `/categories/:slug` có media gọn và giữ nguyên Listing, Favorite, filter cùng empty state. Admin list hiển thị thumbnail 80 × 50 px, còn form edit hiển thị preview và chỉ có checkbox xóa khi Category đang sở hữu managed image.

Lưu trữ local phù hợp cho môi trường development hiện tại; Bước 12.1 không dùng Cloudinary hoặc S3 và không cài thêm package. Chạy unit test và verifier E2E:

```bash
npm test
npm run test:e2e:category-image
```

Verifier tạo riêng admin, user, Category có/không có ảnh cùng các fixture regression cần thiết, kiểm tra phân quyền, MIME/dung lượng, cleanup, public/static UI, responsive và hồi quy Listing/avatar/Favorite/Message/Admin. Sau khi chạy, script xóa đúng ID và file fixture của chính lần chạy, không dùng `deleteMany({})`, không xóa dữ liệu thật và không in email, mật khẩu, cookie, MongoDB URI hoặc session secret.

## Cấu trúc cơ bản

```text
.
├── src/
│   ├── config/
│   │   ├── database.js
│   │   └── session.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── category.controller.js
│   │   ├── favorite.controller.js
│   │   ├── home.controller.js
│   │   ├── listing.controller.js
│   │   └── profile.controller.js
│   ├── middlewares/
│   │   ├── admin.middleware.js
│   │   ├── avatar.middleware.js
│   │   ├── auth.middleware.js
│   │   ├── categoryImage.middleware.js
│   │   ├── error.middleware.js
│   │   ├── listing.middleware.js
│   │   ├── upload.middleware.js
│   │   └── notFound.middleware.js
│   ├── models/
│   │   ├── Category.js
│   │   ├── Favorite.js
│   │   ├── Listing.js
│   │   └── User.js
│   ├── routes/
│   │   ├── adminCategory.routes.js
│   │   ├── auth.routes.js
│   │   ├── category.routes.js
│   │   ├── favorite.routes.js
│   │   ├── home.routes.js
│   │   ├── listing.routes.js
│   │   └── profile.routes.js
│   ├── services/
│   │   ├── auth.service.js
│   │   ├── category.service.js
│   │   ├── favorite.service.js
│   │   ├── listing.service.js
│   │   └── profile.service.js
│   ├── utils/
│   │   ├── avatarStorage.js
│   │   ├── buildListingQuery.js
│   │   ├── createPagination.js
│   │   ├── createSlug.js
│   │   ├── categoryImageStorage.js
│   │   ├── escapeRegex.js
│   │   ├── fileStorage.js
│   │   ├── formatPrice.js
│   │   ├── normalizeListingQuery.js
│   │   ├── presentListing.js
│   │   └── safeReturnTo.js
│   ├── validators/
│   │   ├── auth.validator.js
│   │   ├── category.validator.js
│   │   ├── favorite.validator.js
│   │   ├── listing.validator.js
│   │   └── profile.validator.js
│   ├── views/
│   │   ├── admin/categories/
│   │   ├── auth/
│   │   │   ├── login.ejs
│   │   │   └── register.ejs
│   │   ├── categories/
│   │   ├── errors/
│   │   ├── favorites/
│   │   ├── layouts/
│   │   ├── listings/
│   │   │   └── _pagination.ejs
│   │   ├── profile/
│   │   │   ├── edit.ejs
│   │   │   └── index.ejs
│   │   ├── partials/
│   │   └── home.ejs
│   ├── public/
│   │   ├── css/
│   │   ├── images/
│   │   └── js/
│   └── app.js
├── uploads/
│   ├── avatars/
│   ├── categories/
│   └── listings/
├── scripts/
│   ├── seedCategories.js
│   ├── verifyCategoryImageE2e.js
│   └── verifyStep10E2e.js
├── .env.example
├── package.json
├── server.js
└── README.md
```

## Trạng thái dự án

Bước 12.1 đã bổ sung upload, thay và xóa ảnh Category có cleanup an toàn, public Catalogue dùng ảnh 16:9 hoặc icon fallback, còn Home giữ icon compact. Dashboard Admin, quản lý vòng đời tài khoản `pending`/`active`/`blocked`, kiểm duyệt Listing, Message riêng tư, Favorite, auth, session, Listing CRUD, upload ảnh, soft delete, tìm kiếm/phân trang và Profile tiếp tục được giữ nguyên. Dự án chưa có đổi email, đổi mật khẩu, hồ sơ người bán công khai, Cloudinary, S3, Atlas Search, Elasticsearch, JWT, Socket.IO/WebSocket, notification, gửi ảnh/file trong chat hoặc thanh toán.

## Bước 13 — Security hardening và production readiness

Bước 13 giữ nguyên nghiệp vụ và giao diện, đồng thời bổ sung:

- CSRF token theo session cho toàn bộ form thay đổi dữ liệu, kể cả multipart upload.
- Rate limiter riêng cho auth, tạo Conversation, gửi Message và thao tác Admin nhạy cảm.
- Session fixation protection, cookie theo môi trường, `TRUST_PROXY` tường minh và validation env production.
- Helmet/CSP, request body limit, health check và graceful shutdown.
- Kiểm tra magic-byte JPEG/PNG/WEBP, UUID filename và cleanup file khi upload/CSRF lỗi.
- Audit orphan document/file chỉ đọc và cleanup script mặc định dry-run.
- Full regression qua unit test, các E2E cũ và verifier Step 13.

### Lệnh phát triển, test và production

```bash
# Development
npm install
npm run dev

# Test toàn hệ thống
npm test
npm run test:all

# Production
npm ci
npm run test:all
npm start
```

Audit dữ liệu không thay đổi database:

```bash
npm run audit:data
npm run cleanup:orphans
```

`npm run cleanup:orphans` chỉ in kế hoạch dry-run. Không chạy `--apply` nếu chưa backup và review từng ID/path.

### Cấu hình production

Production bắt buộc có `MONGODB_URI` và `SESSION_SECRET` tối thiểu 32 ký tự. Cookie chỉ bật `Secure` khi `NODE_ENV=production`; HTTPS và `TRUST_PROXY` phải được cấu hình đúng tại reverse proxy. `TRUST_PROXY=0` phù hợp khi Node nhận kết nối trực tiếp; nếu qua proxy, đặt số hop tin cậy thay vì bật vô điều kiện.

Health endpoint: `GET /healthz` chỉ trả `{"status":"ok"}`.

Upload hiện lưu trên local filesystem. Cách này phù hợp development, demo local hoặc server có persistent disk. Trên hosting filesystem tạm thời/ephemeral, phải gắn persistent disk hoặc dùng object storage như Cloudinary/S3-compatible trước khi nhận dữ liệu thật.

Checklist triển khai chi tiết: [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md).
