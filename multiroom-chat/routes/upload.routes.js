const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { getGridFSBucket } = require('../services/gridfs');
const { MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES } = require('../config/env');

const ALLOWED_FILE_PATTERN = /\.(jpg|jpeg|png|gif|webp|pdf|docx?|xlsx?|pptx?|txt|zip|mp4|mov|webm)$/i;

// Doc file vao bo nho (buffer) truoc, roi ghi thang vao MongoDB qua GridFS,
// khong luu ra o dia server.
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_FILE_PATTERN.test(file.originalname)) {
      return cb(new Error('Dinh dang file khong duoc ho tro'));
    }
    cb(null, true);
  }
});

// Middleware upload rieng, bat loi multer (vd vuot gioi han dung luong) va
// tra ve JSON ro rang thay vi de Express hien trang loi HTML mac dinh.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `File vượt quá giới hạn cho phép (tối đa ${MAX_FILE_SIZE_MB}MB). Vui lòng chọn file nhỏ hơn.`
        });
      }
      return res.status(400).json({ error: err.message || 'Lỗi khi tải file lên' });
    }
    next();
  });
}

router.post('/upload', requireAuth, handleUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file nào được gửi lên' });

  const bucket = getGridFSBucket();
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(req.file.originalname);

  const uploadStream = bucket.openUploadStream(req.file.originalname, {
    contentType: req.file.mimetype,
    metadata: { uploadedBy: req.user.username }
  });

  uploadStream.end(req.file.buffer);

  uploadStream.on('error', (err) => {
    console.error('Loi khi ghi file vao GridFS:', err);
    res.status(500).json({ error: 'Loi khi luu file' });
  });

  uploadStream.on('finish', () => {
    res.json({
      url: `/files/${uploadStream.id}`,
      name: req.file.originalname,
      size: req.file.size,
      isImage
    });
  });
});

// Doc lai file tu GridFS de hien thi/tai xuong
router.get('/files/:id', async (req, res) => {
  let fileId;
  try {
    fileId = new mongoose.Types.ObjectId(req.params.id);
  } catch (err) {
    return res.status(400).json({ error: 'ID file khong hop le' });
  }

  const bucket = getGridFSBucket();
  const filesCursor = bucket.find({ _id: fileId });
  const fileDoc = await filesCursor.next();

  if (!fileDoc) return res.status(404).json({ error: 'Khong tim thay file' });

  res.set('Content-Type', fileDoc.contentType || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(fileDoc.filename)}"`);

  const downloadStream = bucket.openDownloadStream(fileId);
  downloadStream.on('error', () => res.status(404).end());
  downloadStream.pipe(res);
});

module.exports = router;
