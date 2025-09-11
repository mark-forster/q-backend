const mongoose = require('mongoose');
require('dotenv').config();
const path=require('path')
const { config } = require('../config');

const connectDB= async()=>{
    mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(config.mongo.uri);
    console.log(`[DB] Connected → ${config.isProd ? 'PROD' : 'DEV'}`);
  } catch (err) {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  }
}
module.exports = connectDB;