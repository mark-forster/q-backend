const Otp = require("../models/otp.model");

const generateAndSaveOTP = async (email, userData) => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 min

  await Otp.findOneAndUpdate(
    { email },
    { otp, expiresAt, userData },
    { upsert: true }
  );

  return otp;
};

const verifyOTP = async (email, otp) => {
  const record = await Otp.findOne({ email });
  if (!record || record.expiresAt < new Date()) return null;
  return record.otp === otp ? record.userData : null;
};

const clearOTP = async (email) => {
  await Otp.deleteOne({ email });
};

module.exports = { generateAndSaveOTP, verifyOTP, clearOTP };
