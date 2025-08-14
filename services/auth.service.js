const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const ApiError = require("../config/apiError");
const httpStatus = require("http-status");
const otpService = require("./otp.service");
const { sendOTP } = require("../util/sendMail");

const register = async (data) => {
  const user = await User.create(data);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  user.refreshToken = refreshToken;
  await user.save();

  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  };

  return { user, accessToken, refreshToken, options };
};

const login = async (data) => {
  const { email, password } = data;

  const user = await User.findOne({ email });
  if (!user || !(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid Username or Password");
  }

  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  user.refreshToken = refreshToken;
  await user.save();

  const loginUser = await User.findById(user._id).select("-password");
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  };

  return { user: loginUser, accessToken, refreshToken, options };
};

const logout = async (user_id) => {
  await User.findByIdAndUpdate(user_id, { $unset: { refreshToken: 1 } });

  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  };

  return { options };
};

const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "No refresh token provided");
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch (err) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
  }

  const user = await User.findById(decoded._id);
  if (!user || user.refreshToken !== refreshToken) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Unauthorized refresh attempt");
  }

  const newAccessToken = user.generateAccessToken();
  const newRefreshToken = user.generateRefreshToken();
  user.refreshToken = newRefreshToken;
  await user.save();

  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  };

  return { accessToken: newAccessToken, refreshToken: newRefreshToken, options };
};

const emailLogin = async (body) => {
  const { email, name, username, password } = body;
  console.log(body);
  const otp = await otpService.generateAndSaveOTP(email, { name, username, email, password });
  await sendOTP(email, otp);
  return { email };
};

const verifyOtpAndRegister = async (body) => {
  const { email, otp } = body;
  const userData = await otpService.verifyOTP(email, otp);
  console.log(userData);
  if (!userData) throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired OTP");

  const existingUser = await User.findOne({ email });
  if (existingUser) throw new ApiError(httpStatus.BAD_REQUEST, "User already exists");

  const user = await User.create(userData);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  user.refreshToken = refreshToken;
  await user.save();
  await otpService.clearOTP(email);

  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  };

  return { user, accessToken, refreshToken, options };
};

module.exports = {
  register,
  login,
  logout,
  emailLogin,
  verifyOtpAndRegister,
  refreshAccessToken,
};
