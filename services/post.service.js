const Post= require('../models/post.model')
const User= require('../models/user.model')
const ApiError = require('../config/apiError')
const httpStatus = require('http-status')
const cloudinary = require('cloudinary').v2;
const fs=require("fs");
const newPost = async (user_id, data, img) => {
    let uploadedFile = null;

    try {
        const { text } = data;
        
        // filtering text input
        if (!text) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Text is required', true);
        }
        const maxLength = 500;
        if (text.length > maxLength) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Text should not exceed 500 characters', true);
        }

        const postedBy = user_id;
        let imageInfo = null; // null if image empty

        // Update image to Cloudinary
        if (img) {
            uploadedFile = img.path;

            const uploadedResponse = await cloudinary.uploader.upload(img.path, {
                resource_type: "auto", // image or video
            });

            // clear image form server disk after uploaded cloudinary
            fs.unlinkSync(img.path);
            
            // image data 
            imageInfo = {
                public_id: uploadedResponse.public_id,
                url: uploadedResponse.secure_url,
            };
        }

        //Creating post
        const post = await new Post({ 
            postedBy, 
            text, 
            img: imageInfo // 
        });

        await post.save();
        return post;

    } catch (error) {
        // delete file from server if error
        if (uploadedFile && fs.existsSync(uploadedFile)) {
            fs.unlinkSync(uploadedFile);
        }
        console.error('Error creating post:', error);
        throw error;
    }
};

// Getting post By Id
const getPostById= async(postId)=>{
    const post = await Post.findById(postId);
    return post;
}
// Toggle Like Unlike 
const toggleLikeUnlike= async(userId,postId)=>{
    const post = await Post.findById(postId);
    if(!post){
        throw new ApiError(httpStatus.NOT_FOUND, 'Post not found', true);
    }
    const userLikePost = await post.likes.includes(userId);
    if(userLikePost){
        await Post.findByIdAndUpdate(postId,{$pull: {likes : userId}}) //  Unlike
        return ({post:post,message:"User unlike this post"})
    }
    else{
        await Post.findByIdAndUpdate(postId,{$push: {likes : userId}}) // Like
        return ({post:post,message:"User like this post"})
    }
}

// replying to post
const replyToPost= async(postId,userId,text)=>{
        const user= await User.findById(userId);
        const username= user.username;
        const profilePic= user.profilePic;
        const post = await Post.findById(postId);
        if(!post){
            throw new ApiError(httpStatus.NOT_FOUND, 'Post not found', true);
        }
        const reply = {userId,text,profilePic,username}
         post.replies.push(reply)
        await post.save();
        return ({reply:reply,message:"Reply posted successfully"})
}
// getting feed
const getFeed = async(userId)=>{
    const user = await User.findById(userId);//admin
    const following =await user.following;//admin's following people
    const feedPosts = await Post.find({ postedBy: { $in: following } }).sort({ createdAt: -1 }); //admin follwing people's post
  
    return feedPosts;

}

const updatePostById = async (postId, user_id, data, img) => {
    let uploadedFile = null;

    try {
        const { text } = data;
        
        // 1. Find the post by its ID
        const post = await Post.findById(postId);
        if (!post) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Post not found');
        }

        // 2. Authorization check: Ensure the user is the author
        if (post.postedBy.toString() !== user_id.toString()) {
            throw new ApiError(httpStatus.FORBIDDEN, 'You are not authorized to update this post');
        }

        // 3. Update the image if a new one is provided
        if (img) {
            uploadedFile = img.path;

            // Delete the old image from Cloudinary if it exists
            if (post.img && post.img.public_id) {
                await cloudinary.uploader.destroy(post.img.public_id);
            }

            // Upload the new image to Cloudinary
            const uploadedResponse = await cloudinary.uploader.upload(img.path, {
                resource_type: "auto",
            });
            fs.unlinkSync(img.path);
            
            // Update the post's image info
            post.img = {
                public_id: uploadedResponse.public_id,
                url: uploadedResponse.secure_url,
            };
        } else if (post.img) {
            // Handle case where user wants to remove the image but not upload a new one
            // This is a common feature. You can add a flag in the request body to trigger this.
            // Example: if (data.removeImage === true) { ... }
        }

        // 4. Update post text if it's provided
        if (text) {
            post.text = text;
        }

        // 5. Save the updated post to the database
        await post.save();
        return post;

    } catch (error) {
        // If an error occurred, ensure the temporary local file is deleted
        if (uploadedFile && fs.existsSync(uploadedFile)) {
            fs.unlinkSync(uploadedFile);
        }
        console.error('Error updating post:', error);
        throw error;
    }
};
const deletePostById = async (postId, user_id) => {
    try {
        // 1. Find the post by its ID
        const post = await Post.findById(postId);
        if (!post) {
            throw new ApiError(httpStatus.NOT_FOUND, 'Post not found');
        }

        // 2. Authorization check: Ensure the user is the author
        if (post.postedBy.toString() !== user_id.toString()) {
            throw new ApiError(httpStatus.FORBIDDEN, 'You are not authorized to delete this post');
        }

        // 3. Delete the image from Cloudinary if it exists
        if (post.img && post.img.public_id) {
            // The `post.img` is automatically parsed into an object by your model's getter
            await cloudinary.uploader.destroy(post.img.public_id);
        }

        // 4. Delete the post from the database
        await post.deleteOne();
        
        return { message: 'Post deleted successfully' };

    } catch (error) {
        console.error('Error deleting post:', error);
        throw error;
    }
};


module.exports = {
    newPost,
    getPostById,
    toggleLikeUnlike,
    replyToPost,
    getFeed,
    updatePostById,
    deletePostById
}