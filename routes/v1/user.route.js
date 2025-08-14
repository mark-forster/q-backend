const express = require('express')
const router = express.Router()
const userController = require('../../controllers/user.controller')
const isAuth= require('../../middlewares/isAuth');
const upload=require('../../util/multer')
// search User List
router.get('/search/:query',isAuth, userController.searchUserList)
router.post('/follow/:id',isAuth, userController.followUnfollow);
router.put('/update',isAuth, upload.single('image'), userController.updateUser);
router.get('/profile/:query',isAuth, userController.getUserProfile)
router.get('/suggested', isAuth, userController.getSuggestedUsers)
router.put('/freeze', isAuth, userController.freezeAccount)
module.exports = router;