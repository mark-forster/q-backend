const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const ApiError = require("../config/apiError");
const httpStatus = require("http-status");
const otpService = require("./otp.service");
const { sendOTP } = require("../util/sendMail");
const getCookieOptions = () => {
  const isProd = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
};

const register = async (data) => {
  const user = await User.create(data);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  user.refreshToken = refreshToken;
  await user.save();

  const cookieOptions = getCookieOptions();


  return { user, accessToken, refreshToken, options: cookieOptions };
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
const cookieOptions = getCookieOptions();


  return { user: loginUser, accessToken, refreshToken, options: cookieOptions };
};

const logout = async (user_id) => {
  await User.findByIdAndUpdate(user_id, { $unset: { refreshToken: 1 } });

 const cookieOptions = getCookieOptions();


  return { options: cookieOptions };
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

 const cookieOptions = getCookieOptions();


  return { accessToken: newAccessToken, refreshToken: newRefreshToken, options: cookieOptions };
};

const emailLogin = async (body) => {
  const { email, name, username, password } = body;

  try {
    if (!email) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Email is required");
    }

    console.log("EMAIL LOGIN BODY =>", { email, name, username });

const otp = await otpService.generateAndSaveOTP(email, {
  purpose: "REGISTER",
  payload: {
    name,
    username,
    email,
    password
  },
});
    console.log("OTP GENERATED =>", otp);

    await sendOTP(email, otp);

    return { email };
  } catch (err) {
    console.error("EMAIL LOGIN ERROR =>", err);
    throw err; // catchAsync က handle လုပ်စေ
  }
};


const verifyOtpAndRegister = async (body) => {
  const { email, otp } = body;

  const userData = await otpService.verifyOTP(email, otp, "REGISTER");

  if (!userData || !userData.password) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Invalid or expired OTP. Please register again."
    );
  }
console.log("OTP payload =>", userData);

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User already exists");
  }

  const user = await User.create({
    name: userData.name,
    username: userData.username,
    email: userData.email,
    password: userData.password, // ✅ guaranteed exists
  });

  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  user.refreshToken = refreshToken;
  await user.save();

  await otpService.clearOTP(email, "REGISTER");

  return { user, accessToken, refreshToken, options: getCookieOptions() };
};


const forgotPassword = async ({ email }) => {
  const user = await User.findOne({ email });

  if (!user) return { email };

  const otp = await otpService.generateAndSaveOTP(email, {
    purpose: "RESET_PASSWORD",
  });
    console.log("OTP GENERATED =>", otp);

  await sendOTP(email, otp);
  return { email };
};

const verifyResetOtp = async ({ email, otp }) => {
 const isValid = await otpService.verifyOTP(email, otp, "RESET_PASSWORD");

if (!isValid) {
  throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired OTP");
}
 

  const resetToken = jwt.sign(
    { email, purpose: "RESET_PASSWORD" },
    process.env.JWT_TEMP_SECRET,
    { expiresIn: "10m" }
  );

  return { resetToken, options: getCookieOptions() };
};
const resetPassword = async ({ email, newPassword }) => {
  const user = await User.findOne({ email });
  if (!user) throw new ApiError(404, "User not found");

  user.password = newPassword; // bcrypt auto
  user.refreshToken = "";      // logout all sessions
  await user.save();

await otpService.clearOTP(email, "RESET_PASSWORD");
};


module.exports = {
  register,
  login,
  logout,
  emailLogin,
  verifyOtpAndRegister,
  refreshAccessToken,
  forgotPassword,
  verifyResetOtp ,
  resetPassword 
};
