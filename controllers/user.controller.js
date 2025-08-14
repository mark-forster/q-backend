const catchAsync = require('../config/catchAsync')
const userService = require('../services/user.service')
const User= require('../models/user.model')
const cloudinary = require('cloudinary').v2;
const mongoose= require('mongoose');
const Post = require('../models/post.model')
const followUnfollow = catchAsync(async (req,res,next)=>{
        const follower_id= req.params.id;
        const currentUser_id= req.user._id;
        const {message}= await userService.followUnfollow(currentUser_id,follower_id);
    res.status(200).json({message:message});
        
});

const updateUser= catchAsync(async (req,res,next)=>{
    const userId= req.user._id;
    // metching current Id and update user Id
    
    const data= req.body;
     const file = req.file;
     console.log(data,file);
    const user = await userService.updateUser(userId,data,file);
    user.password= null;
     // Find all posts that this user replied and update username and profilePic fields
		await Post.updateMany(
			{ "replies.userId": userId},
			{
				$set: {
					"replies.$[reply].username": user.username,
					"replies.$[reply].profilePic": user.profilePic,
				},
			},
			{ arrayFilters: [{ "reply.userId": userId }] }
		);
    res.status(200).json({user:user, message:"User updated successfully"});
});

// getting user profile by current user id
const getUserProfile=catchAsync(async (req,res,next)=>{
 
        // We will fetch user profile either with username or userId
	// query is either username or userId
    // query is either username or userId
	const  {query}  = req.params;
    // const user = await userService.getUserById(query);
    let user;
    // query is userId
if (mongoose.Types.ObjectId.isValid(query)) {
     user = await User.findOne({ _id: query }).select("-password").select("-updatedAt");
   
} else {
    // query is username
     user = await User.findOne({ username: query }).select("-password").select("-updatedAt");
   
}
   if(!user){
    return res.json( {errorMessage:"User not found"});
   }
    return res.status(200).json({user:user});
   
});


// Search user affctive
// getting user profile by current user id
const searchUserList=catchAsync(async (req,res,next)=>{
 // We will fetch user profile either with username or userId
 const {query} = req.params; let users;
// query is userId
    // Note: To return multiple users, we need to use 'find' instead of 'findOne'
    // You can search by username only for partial matches.
    // Searching by ObjectId with a regex is not recommended.

    // If query is not a valid ObjectId, search for username with regex
 if (!mongoose.Types.ObjectId.isValid(query)) { users = await User.find({
        username: {
          $regex: query,
          $options: 'i' // This makes the search case-insensitive
        }
      }).select("-password").select("-updatedAt");
 } else {
      // If query is a valid ObjectId, find the user by ID
      const user = await User.findOne({ _id: query }).select("-password").select("-updatedAt");
      users = user ? [user] : [];
    }

    // You can also add logic to search the 'name' field if it exists
    // users = await User.find({
    //   $or: [
    //     { username: { $regex: query, $options: 'i' } },
    //     { name: { $regex: query, $options: 'i' } }
    //   ]
    // }).select("-password").select("-updatedAt");

 if(users.length === 0){
 return res.json( {errorMessage:"User not found"});
 }
 return res.status(200).json({users: users});
});






const getSuggestedUsers= catchAsync(async(req,res,next)=>{
    const userId= req.user._id;
    const users= await userService.getSuggestedUsers(userId);
    res.status(200).json({users:users});
})

const freezeAccount= catchAsync(async(req,res,next)=>{

    const user= await User.findById(req.user._id);
    if(!user){
        return res.status(400).json({errorMessage:"User not found"});
    }
    user.isFrozen= true;
    await user.save();
    return res.status(201).json({message:"User account freeze successfully"})
});

module.exports = {followUnfollow,updateUser,getUserProfile,getSuggestedUsers,freezeAccount,searchUserList}