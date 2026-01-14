const express = require('express')
const router = express.Router()
const isAuth= require('../../middlewares/isAuth');
const zegoController=require('../../controllers/zego.controller.js')

router.post('/token',isAuth, zegoController.getZegoToken);

module.exports = router;