const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

// GridFSBucket duoc khoi tao SAU KHI ket noi MongoDB thanh cong. Bucket
// "uploads" tao 2 collection trong Mongo: uploads.files (metadata) va
// uploads.chunks (du lieu nhi phan chia nho).
let gridFSBucket = null;

function getGridFSBucket() {
  if (!gridFSBucket) {
    gridFSBucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  }
  return gridFSBucket;
}

// Xoa 1 file trong GridFS dua vao url dang "/files/<id>" da luu trong tin nhan.
// Dung khi xoa tin nhan loai 'file' de khong de rac trong uploads.files/uploads.chunks.
async function deleteFileFromUrl(url) {
  const match = String(url || '').match(/\/files\/([a-f0-9]{24})$/i);
  if (!match) return;
  try {
    const fileId = new mongoose.Types.ObjectId(match[1]);
    await getGridFSBucket().delete(fileId);
  } catch (err) {
    // File co the da bi xoa truoc do hoac khong ton tai - khong can chan luong xoa tin nhan
    console.warn('Khong xoa duoc file GridFS (co the da khong con ton tai):', err.message);
  }
}

module.exports = { getGridFSBucket, deleteFileFromUrl };
