package request

/*
   Author : lucbine
   DateTime : 2024/4/25
   Description : 用户请求实体
*/

type UserPhoneCodeRequest struct {
	Phone string `json:"phone" binding:"required,phone" msg:"手机号码格式不正确"`
	Type  uint8  `json:"type" binding:"required,oneof=1 2"` // 1 注册 2 登录
}

type PhoneRegisterRequest struct {
	//手机号
	Phone string `json:"phone" binding:"required,phone" msg:"手机号码格式不正确"`
	// 验证码
	ValidCode string `json:"validCode" binding:"required,len=4"  msg:"验证码格式不正确"`
	// 密码
	PassWord string `form:"password" json:"password" binding:"required,min=6,max=20" msg:"密码格式不正确 必须 6-20个字符"`
}

type UserLoginRequest struct {
	Phone     string `json:"phone" binding:"required,phone" msg:"手机号码格式不正确"`
	Password  string `json:"password" binding:"required_without=ValidCode" msg:"密码格式不正确 必须 6-20个字符"`
	ValidCode string `json:"validCode" binding:"required_without=Password" msg:"验证码格式不正确"`
}
