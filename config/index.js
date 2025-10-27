// Load .env files by NODE_ENV (development / production)
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
require("dotenv").config();
const ENV = process.env.NODE_ENV || 'development';

// Optional personal overrides
const localPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(localPath)) dotenv.config({ path: localPath });

// Env-specific
const envPath = path.join(process.cwd(), `.env.${ENV}`);
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

// Fallback .env
const defaultPath = path.join(process.cwd(), '.env');
if (fs.existsSync(defaultPath)) dotenv.config({ path: defaultPath });

function required(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

function csv(val) {
  return (val || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

const config = {
  env: ENV,
  isDev: ENV === 'development',
  isProd: ENV === 'production',

  port: Number(process.env.PORT || 8080),

  mongo: {
    // prefer single MONGODB_URI; else fall back to per-env
    uri:
      process.env.MONGODB_URI ||
      (ENV === 'production'
        ? required('MONGODB_URI_PROD', process.env.MONGODB_URI_PROD)
        : required('MONGODB_URI_DEV', process.env.MONGODB_URI_DEV)),
  },

  cors: {
    // CSV lists for origins
    devOrigins: csv(process.env.CORS_DEV_ORIGINS),
    prodOrigins: csv(process.env.CORS_PROD_ORIGINS),
    // allow requests without Origin (mobile/Postman/server-to-server)
    allowNoOrigin: process.env.CORS_ALLOW_NO_ORIGIN === 'true',
    // legacy single keys you used before (optional merge)
    legacy: [process.env.RENDER_HOST, process.env.DOMAINHOST, process.env.LOCALHOST].filter(Boolean),
  },

  cloudinary: {
    cloudName: required('CLOUDINARY_CLOUD_NAME', process.env.CLOUDINARY_CLOUD_NAME),
    apiKey:     required('CLOUDINARY_API_KEY', process.env.CLOUDINARY_API_KEY),
    apiSecret:  required('CLOUDINARY_API_SECRET', process.env.CLOUDINARY_API_SECRET),
  },
  uploads: {
    provider: process.env.UPLOAD_PROVIDER || (ENV === 'production' ? 'cloudinary' : 'local'),
    localDir: process.env.UPLOAD_LOCAL_DIR || 'uploads',
    maxSizeMB: Number(process.env.UPLOAD_MAX_MB || 20),
    allowedMimes: csv(process.env.UPLOAD_ALLOWED_MIMES).length
      ? csv(process.env.UPLOAD_ALLOWED_MIMES)
      : ['image/jpeg','image/png','image/webp','image/gif',
         'video/mp4','video/webm',
         'audio/mpeg','audio/webm',
         'application/pdf','application/zip'],
  },
  zego: {
    // 💡 required() function ကို အသုံးပြုပြီး .env မှာ မပါရင် error ပြမည်။
    appId: Number(required('ZEGO_APP_ID', process.env.ZEGO_APP_ID)),
    serverSecret: required('ZEGO_SERVER_SECRET', process.env.ZEGO_SERVER_SECRET),
  }
};

module.exports = { config };
