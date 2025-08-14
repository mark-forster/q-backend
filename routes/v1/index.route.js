const express= require('express');
const router=express.Router();
const authRoute= require('./auth.route');
const postRoute= require('./post.route');
const userRoute= require('./user.route');
const messageRoute= require('./message.route')
const defaultRoutes=[
    {
        path:'/auth',
        route:authRoute
    },
    {
        path:'/posts',
        route:postRoute
    },
    {
        path:'/users',
        route:userRoute
    },
    {
        path:'/messages',
        route:messageRoute
    }
]

defaultRoutes.forEach((route)=>{
    router.use(route.path, route.route);
});

module.exports =router;