const express = require("express");
const router = express.Router();
const authController = require("../../controllers/auth.controller");
const isAuth = require("../../middlewares/isAuth");

router.post("/signUp", authController.signUp);
router.post("/signIn", authController.signIn);
router.post("/register", authController.Register);
router.post("/verify-otp", authController.verifyOtpAndRegister);
router.post("/signOut", isAuth, authController.signOut);
router.get("/users",isAuth, authController.getAllUser);
router.post("/refresh-token", authController.refreshTokenController);
router.get("/me", isAuth, authController.getMe);
router.post("/logout",isAuth, authController.signOut);

module.exports = router;