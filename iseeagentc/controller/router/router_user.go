package router

import (
	"github.com/gin-gonic/gin"

	"iseeagentc/controller"
	"iseeagentc/controller/middleware"
)

/*
   Author : lucbine
   DateTime : 2024/3/4
   Description :
*/

func RegisterUser(r *gin.Engine) {

	//账号中心
	accountGroup := r.Group("/userCenter/")
	{
		// 发送验证码
		accountGroup.POST("/sendPhoneCode", GetTypedHandler(controller.SendPhoneCode))
		// 用户注册
		accountGroup.POST("/phoneRegister", GetTypedHandler(controller.PhoneRegister))
		// 用户登录
		accountGroup.POST("/login", GetTypedHandler(controller.UserLogin))

	}

	//用户相关接口
	userGroup := r.Group("/userCenter/", middleware.CheckAuth())
	{
		// 用户信息
		userGroup.GET("/userInfo", controller.UserInfo)
		// 用户修改密码
		userGroup.POST("/updatePassword", controller.UserUpdatePassword)
		// 用户修改头像
		userGroup.POST("/updateAvatar", controller.UserUpdateAvatar)
		// 用户修改信息
		userGroup.POST("/updateInfo", controller.UserUpdateInfo)
		// 用户修改邮箱
		userGroup.POST("/updateEmail", controller.UserUpdateEmail)
		// 用户修改手机
		userGroup.POST("/updatePhone", controller.UserUpdatePhone)
		// 用户修改昵称
		userGroup.POST("/updateNickname", controller.UserUpdateNickname)
	}

}
