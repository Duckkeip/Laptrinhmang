# ChatNet — Ứng dụng Chat đa phòng thời gian thực

Ứng dụng chat nhóm đa phòng (multi-room), realtime, hỗ trợ gửi file và hiển thị trạng thái
online/offline, xây dựng bằng **Node.js + Express + Socket.io**.

## 1. Tính năng

- **Đa phòng (multi-room)**: tham gia phòng có sẵn hoặc tạo phòng mới, danh sách phòng
  cập nhật realtime kèm số người online.
- **Nhắn tin nhóm**: gửi/nhận tin nhắn văn bản tức thời trong phòng qua WebSocket.
- **Gửi file**: gửi ảnh (hiển thị preview trực tiếp) hoặc tài liệu (pdf, docx, zip...)
  qua HTTP upload (Multer), sau đó phát tới cả phòng qua socket.
- **Trạng thái online/offline**: danh sách người dùng đang online theo từng phòng,
  thông báo hệ thống khi có người vào/rời phòng.
- **Typing indicator**: hiển thị "... đang nhập" khi người khác đang gõ tin nhắn.
- **Lưu lịch sử chat vào MongoDB**: tin nhắn (text & file) và danh sách phòng được lưu
  bền vững trong MongoDB (qua Mongoose), tự động load 200 tin nhắn gần nhất khi vào phòng.
  Danh sách phòng vẫn còn sau khi restart server.

## 2. Kiến trúc

```
Client (browser)  <---- WebSocket (Socket.io) ---->  Node.js Server (Express + Socket.io)
      |                                                        |
      +-------------- HTTP POST /upload (Multer) --------------+
                                                                 |
                                                          Mongoose ODM
                                                                 |
                                                        MongoDB (rooms, messages)
                                                                 |
                                                          public/uploads/* (file vat ly)
```

- **server.js**: khởi tạo Express + Socket.io, kết nối MongoDB khi start (`main()`),
  quản lý trạng thái online tức thời trong bộ nhớ (`users`, `rooms` — chỉ để biết ai
  đang kết nối, không phải nguồn dữ liệu chính), xử lý các sự kiện socket (`join`,
  `chat-message`, `file-message`, `typing`, `create-room`, `disconnect`), và endpoint
  `POST /upload` nhận file qua Multer.
- **db/connection.js**: kết nối tới MongoDB bằng Mongoose (`MONGODB_URI`).
- **db/Room.js**: schema `Room` — lưu danh sách phòng (`name`, `createdAt`), có index
  `unique` trên `name` để tránh trùng phòng.
- **db/Message.js**: schema `Message` — lưu từng tin nhắn (`room`, `type`, `username`,
  `text` hoặc `url/name/size/isImage`, `time`), index trên `{ room, time }` để truy vấn
  lịch sử theo phòng nhanh.
- **public/**: giao diện web thuần HTML/CSS/JS, kết nối tới server qua
  `socket.io-client` (script được Socket.io tự phục vụ tại `/socket.io/socket.io.js`).
- **public/uploads/**: vẫn lưu file vật lý (ảnh, tài liệu) trên đĩa; MongoDB chỉ lưu
  đường dẫn (`url`) tới file, không lưu binary trực tiếp (giữ DB gọn nhẹ).

## 3. Cài đặt & chạy

Yêu cầu: Node.js >= 18, và một MongoDB đang chạy (local hoặc cloud).

### 3.1. Chuẩn bị MongoDB

Chọn một trong hai cách:

- **Cài local**: cài MongoDB Community Server theo hướng dẫn chính thức
  (https://www.mongodb.com/docs/manual/installation/), sau đó chạy `mongod` để
  MongoDB lắng nghe ở `mongodb://127.0.0.1:27017`.
- **Dùng MongoDB Atlas (miễn phí, không cần cài gì)**: tạo cluster free tier tại
  https://www.mongodb.com/atlas, lấy connection string dạng
  `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/multiroom-chat`.

### 3.2. Cấu hình biến môi trường

```bash
cd multiroom-chat
cp .env.example .env
```

Mở `.env` và sửa `MONGODB_URI` cho đúng với MongoDB bạn đang dùng (local hoặc Atlas).

### 3.3. Cài đặt & chạy server

```bash
npm install
npm start
```

Khi kết nối MongoDB thành công, terminal sẽ hiện `Da ket noi MongoDB: ...` rồi
`Multi-room chat server dang chay tai http://localhost:3000`.

Mở nhiều tab/trình duyệt khác nhau, đặt tên người dùng khác nhau, cùng vào một phòng
(ví dụ `General`) để test chat đa người, gửi file và xem trạng thái online. Danh sách
phòng và lịch sử tin nhắn được lưu trong MongoDB nên vẫn còn sau khi restart server.

Muốn đổi cổng: sửa `PORT` trong `.env`, hoặc `PORT=4000 npm start`.

Nếu server báo `Khong the ket noi MongoDB: connect ECONNREFUSED ...`, nghĩa là chưa
có MongoDB nào đang chạy ở địa chỉ trong `MONGODB_URI` — kiểm tra lại bước 3.1.

## 4. Các sự kiện Socket.io chính

| Sự kiện          | Chiều          | Payload                                      | Mô tả |
|-------------------|----------------|-----------------------------------------------|-------|
| `join`            | client → server | `{ username, room }` + callback              | Tham gia phòng, trả về lịch sử chat |
| `chat-message`     | client → server | `{ text }`                                    | Gửi tin nhắn văn bản |
| `file-message`     | client → server | `{ url, name, size, isImage }`                | Gửi tin nhắn kèm file (sau khi upload) |
| `typing`           | client ↔ server | `boolean`                                     | Báo đang gõ / dừng gõ |
| `create-room`      | client → server | `roomName` + callback                         | Tạo phòng mới |
| `room-list`        | server → client | `[{ name, online }]`                          | Cập nhật danh sách phòng |
| `online-users`     | server → client | `[username]`                                  | Danh sách người online trong phòng |
| `chat-message`     | server → client | tin nhắn đầy đủ (text hoặc file)              | Broadcast tin nhắn tới cả phòng |
| `system-message`   | server → client | `{ type, text, time }`                        | Thông báo vào/rời phòng |

## 5. Hướng mở rộng


- Thêm xác thực (JWT) thay vì chỉ nhập tên hiển thị.
- Dùng Redis Adapter cho Socket.io khi chạy nhiều server (load balancing, scale ngang) —
  vì trạng thái online hiện đang lưu trong bộ nhớ của từng instance server.
- Dùng MongoDB Change Streams để đồng bộ trạng thái giữa nhiều instance server.
- Thêm TTL index hoặc capped collection cho `Message` để tự động dọn tin nhắn cũ.
- Thêm mã hoá tin nhắn end-to-end.
- Giới hạn kích thước/loại file chặt chẽ hơn, quét virus khi upload; hoặc chuyển file
  lên object storage (S3, GridFS) thay vì lưu trên đĩa server.
