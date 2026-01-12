const User = require("../models/user.model");
const authService = require("../services/auth.service");
const catchAsync = require("../config/catchAsync");
const httpStatus = require("http-status");
const jwt = require("jsonwebtoken");
const ApiError = require("../config/apiError");

const signUp = catchAsync(async (req, res) => {
  if (await User.isEmailTaken(req.body.email)) {
    return res.send({ errorMessage: "Email already taken" });
  }

  const { user, accessToken, refreshToken, options } = await authService.register(req.body);

  res
    .status(httpStatus.OK)
    .cookie("token", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json({
      message: "Registered successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        bio: user.bio,
        profilePic: user.profilePic,
      },
      token: accessToken,
    });
});

const signIn = catchAsync(async (req, res) => {
  const { user, accessToken, refreshToken, options } = await authService.login(req.body);

  if (user.isFrozen) {
    user.isFrozen = false;
    await user.save();
  }

  res
    .status(httpStatus.OK)
    .cookie("token", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json({ message: "Login successfully", user, token: accessToken });
});

const signOut = catchAsync(async (req, res) => {
  const { options } = await authService.logout(req.user._id);

  res
    .status(httpStatus.OK)
    .clearCookie("token", options)
    .clearCookie("refreshToken", options)
    .json({ message: "Logged Out Successfully" });
});

const refreshTokenController = catchAsync(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;
  const { accessToken, refreshToken, options } = await authService.refreshAccessToken(token);

  res
    .cookie("token", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json({ message: "Token refreshed", token: accessToken });
});

const getAllUser = catchAsync(async (req, res) => {
  const users = await User.find({}).exec();
  return res.status(httpStatus.OK).json({ users });
});

const Register = catchAsync(async (req, res) => {
  const { email } = await authService.emailLogin(req.body);
  return res.json({ message: "OTP sent to your email", email });
});

const verifyOtpAndRegister = catchAsync(async (req, res) => {
  const { user, accessToken, refreshToken, options } = await authService.verifyOtpAndRegister(req.body);
  
  if (!user) {
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }

  return res
    .status(201)
    .cookie("token", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json({ message: "User registered successfully", user, token: accessToken });
});

const getMe = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select("-password -refreshToken");

  if (!user) {
    return res.status(httpStatus.NOT_FOUND).json({ errorMessage: "User not found" });
  }

  res.status(httpStatus.OK).json({ message: "User data fetched successfully", user });
});

const forgotPassword = catchAsync(async (req, res) => {
  const { email } = await authService.forgotPassword(req.body);
  res.json({
    message: "If account exists, OTP sent to email",
    email,
  });
});
const verifyResetOtp = catchAsync(async (req, res) => {
  const { resetToken, options } =
    await authService.verifyResetOtp(req.body);

  res
    .cookie("resetToken", resetToken, options)
    .json({ message: "OTP verified",resetToken:resetToken,options });
});

const resetPassword = catchAsync(async (req, res) => {
  const token = req.cookies.resetToken;
  if (!token) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Unauthorized");
  }

  const decoded = jwt.verify(token, process.env.JWT_TEMP_SECRET);

  await authService.resetPassword({
    email: decoded.email,
    newPassword: req.body.newPassword,
  });

  res
    .clearCookie("resetToken")
    .json({ message: "Password reset successful" });
});
 
module.exports = {
  signUp,
  signIn,
  signOut,
  refreshTokenController,
  getAllUser,
  Register,
  verifyOtpAndRegister,
  getMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword 
};