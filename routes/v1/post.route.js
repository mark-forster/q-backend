const express= require('express');
const router=express.Router();
const postController = require('../../controllers/post.controller')
const isAuth= require('../../middlewares/isAuth');
const upload=require('../../util/multer');
// Get all posts
// router.get('/feeds', isAuth, postController.getFeed)
router.get('/feedPosts', isAuth, postController.getFeed);

router.get('/', isAuth, postController.getAllPost);
router.post('/create', upload.single('image'),isAuth, postController.createPost);
// PUT requests to update an existing post by its ID
// 'img' is the field name for the file in the multipart/form-data request
router.put('/update/:postId', isAuth, upload.single('image'), postController.updatePostController);

// DELETE requests to delete a post by its ID
router.delete('/delete/:postId', isAuth, postController.deletePostController);
router.get('/:postId', isAuth, postController.getpostById);
router.get('/user/:username', isAuth, postController.getUserPost);
router.delete('/', isAuth, postController.deleteAllPost)
// like unlike post
router.put('/like/:postId', isAuth, postController.likePostById);
router.put("/reply/:postId", isAuth, postController.replyToPost);
module.exports =router;