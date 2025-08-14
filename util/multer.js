const multer = require('multer');
const path=require('path');
const fs=require('fs');
// Server
const storage = multer.diskStorage({
   destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads'); // uploads folder path 
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 50 // 50MB 
  }
});

module.exports = upload;