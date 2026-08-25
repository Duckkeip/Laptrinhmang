/**
 * build_dataset_from_mongo.js
 *
 * Mục đích: bạn đã mất dataset gốc -> dùng chính lịch sử chat thật trong
 * MongoDB của app multiroom-chat để dựng lại một bộ dataset khởi điểm.
 * Đây KHÔNG phải dataset hoàn chỉnh để finetune ngay (dữ liệu chat thường
 * rời rạc, thiếu ngữ cảnh hỏi-đáp rõ ràng) nhưng là nguồn thật, miễn phí,
 * và bạn có thể lọc/gộp lại thành cặp instruction-response.
 *
 * Cách chạy:
 *   node build_dataset_from_mongo.js
 *
 * Yêu cầu: file .env ở thư mục gốc project (multiroom-chat/.env) đã có
 * MONGODB_URI, và bạn chạy script này ngay trong thư mục multiroom-chat/
 * (để nó tự đọc db/Message.js).
 *
 * Output: dataset/raw_from_mongo.jsonl
 *   Mỗi dòng là 1 object { room, username, text, time } lấy nguyên từ
 *   collection Message. Sau đó bạn cần tự xử lý tiếp: ghép các đoạn hỏi ->
 *   đáp gần nhau thành 1 mẫu {system, user, assistant} giống sample_dataset.jsonl.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB } = require('../db/connection');
const Message = require('../db/Message');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Khong tim thay MONGODB_URI trong .env');
    process.exit(1);
  }

  await connectDB(uri);

  const docs = await Message.find({ type: 'text' })
    .sort({ time: 1 })
    .lean();

  console.log(`Tim thay ${docs.length} tin nhan text trong DB.`);

  const outPath = path.join(__dirname, 'raw_from_mongo.jsonl');
  const stream = fs.createWriteStream(outPath);

  for (const d of docs) {
    stream.write(JSON.stringify({
      room: d.room,
      username: d.username,
      text: d.text,
      time: d.time
    }) + '\n');
  }

  stream.end(() => {
    console.log(`Da ghi ${docs.length} dong vao ${outPath}`);
    console.log('Buoc tiep theo: mo file nay, tu tay (hoac dung 1 LLM ho tro)');
    console.log('ghep cac cau hoi-dap lien tiep thanh dinh dang giong sample_dataset.jsonl');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Loi:', err);
  process.exit(1);
});
