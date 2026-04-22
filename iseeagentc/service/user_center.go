package service

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/redis/go-redis/v9"

	"iseeagentc/entity/request"
	"iseeagentc/entity/response"
	"iseeagentc/internal/auth"
	"iseeagentc/internal/context"
	"iseeagentc/internal/errors"
	"iseeagentc/internal/logger"
	"iseeagentc/internal/resource"
	"iseeagentc/model"
	"iseeagentc/utils"
)

/*
   Author : lucbine
   DateTime : 2024/4/28
   Description :
*/

const (
	RegisterPhoneCodeKey = "rg_phone_%s_code"
	RegisterPhoneCodeTTL = time.Minute // 验证码过期时间

	LoginPhoneCodeKey = "lg_phone_%s_code"
	LoginPhoneCodeTTL = time.Minute // 验证码过期时间

	CodeTypeRegister = 1 // 注册验证码类型
	CodeTypeLogin    = 2 // 登陆验证码类型
)

type UserCenter struct {
	Ctx *gin.Context
}

func NewUserCenter(ctx *gin.Context) *UserCenter {
	return &UserCenter{Ctx: ctx}
}

// Login 登
func (u *UserCenter) Login(req *request.UserLoginRequest) (bool, error) {
	if req.Password != "" {
		return u.LoginByPassword(req.Phone, req.Password)
	}
	return u.LoginByInvalidCode(req.Phone, req.ValidCode)
}

// LoginByPassword 密码登陆
func (u *UserCenter) LoginByPassword(phone string, password string) (bool, error) {
	userModel := model.NewUser(u.Ctx)
	user, err := userModel.GetNormalUserByPhone(phone)
	if err != nil {
		return false, errors.FormatError("Common/DBError", err.Error())
	}

	if user == nil {
		return false, errors.FormatError("UserCenter/PhoneNotRegExist")
	}

	//单点登陆
	ok, err := auth.IsLogin(u.Ctx, user.ID)
	if err != nil {
		return false, err
	} else if ok {
		// 如果单用户登录，则返回错误信息
		return false, errors.AuthFail("您已在其他地方登陆")
	}

	//比较密码
	if user.Password != utils.MD5(password) {
		return false, errors.FormatError("UserCenter/PasswordNotMatch")
	}

	//生成 token
	aToken, rToken, err := auth.GenToken(user.ID, user.Email, user.Phone)
	//从头部返回给用户
	u.Ctx.Header("Authorization", fmt.Sprintf("%s,%s", aToken, rToken))
	return true, nil
}

// LoginByInvalidCode 手机号登陆
func (u *UserCenter) LoginByInvalidCode(phone string, code string) (bool, error) {
	if resource.Redis == nil {
		return false, errors.FormatError("Common/InternalError")
	}
	// 验证码是否正确
	key := fmt.Sprintf(LoginPhoneCodeKey, phone)
	codeStr, err := resource.Redis.Get(u.Ctx, key).Result()
	if err != nil && err != redis.Nil {
		return false, errors.FormatError("Common/InternalError")
	}
	if codeStr != code {
		return false, errors.FormatError("UserCenter/InvalidCodeError")
	}
	// 用户是否存在
	userModel := model.NewUser(u.Ctx)
	user, err := userModel.GetNormalUserByPhone(phone)
	if err != nil {
		return false, errors.FormatError("Common/DBError", err.Error())
	}

	if user == nil {
		return false, errors.FormatError("UserCenter/PhoneNotRegExist")
	}

	//单点登陆
	ok, err := auth.IsLogin(u.Ctx, user.ID)
	if err != nil {
		return false, err
	} else if ok {
		// 如果单用户登录，则返回错误信息
		return false, errors.AuthFail("您已在其他地方登陆")
	}

	//生成 token
	aToken, rToken, err := auth.GenToken(user.ID, user.Email, user.Phone)
	//从头部返回给用户
	u.Ctx.Header("Authorization", fmt.Sprintf("%s,%s", aToken, rToken))
	return true, nil
}

// PhoneRegister 注册
func (u *UserCenter) PhoneRegister(req *request.PhoneRegisterRequest) (bool, error) {
	if resource.Redis == nil {
		return false, errors.FormatError("Common/InternalError")
	}
	// 验证码是否正确
	key := fmt.Sprintf(RegisterPhoneCodeKey, req.Phone)
	code, err := resource.Redis.Get(u.Ctx, key).Result()
	if err != nil && err != redis.Nil {
		return false, errors.FormatError("Common/InternalError")
	}
	if code != req.ValidCode {
		return false, errors.FormatError("UserCenter/InvalidCodeError")
	}

	// 手机是否已经注册
	userModel := model.NewUser(u.Ctx)
	user, err := userModel.GetNormalUserByPhone(req.Phone)

	if err != nil {
		return false, errors.FormatError("Common/DBError", err.Error())
	}

	if user != nil {
		return false, errors.FormatError("UserCenter/PhoneRegExist")
	}

	uuid := utils.GenUUID32()
	//插入用户
	_, err = model.NewUser(u.Ctx).Create(model.User{
		UUID:       uuid,
		UserName:   utils.GenUsername(),
		Phone:      req.Phone,
		Password:   utils.MD5(req.PassWord),
		Status:     model.UserStatusNormal,
		CreateTime: time.Now(),
		UpdateTime: time.Now(),
	})

	if err != nil {
		logger.Error(u.Ctx, "create user error:", zap.Error(err))
		return false, errors.FormatError("Common/DBError", err.Error())
	}

	return true, nil
}

// SendPhoneCode 发送手机验证码
func (u *UserCenter) SendPhoneCode(req *request.UserPhoneCodeRequest) (bool, error) {
	if resource.Redis == nil {
		return false, errors.FormatError("Common/InternalError")
	}
	//todo 防刷机制
	/*
		限制发送频率：限制同一手机号码发送验证码的频率，例如，在一定时间内只允许发送一次验证码。
		验证码有效期：设置验证码的有效期，确保验证码在一定时间内有效，过期后需重新生成。
		IP限制：限制同一IP地址发送验证码的频率，防止同一IP地址连续发送大量验证码。
		限制发送次数：限制同一手机号码在一段时间内发送验证码的次数，防止恶意攻击。
	*/

	//是否已经生成了验证码

	var (
		key = ""
		ttl time.Duration
	)

	if req.Type == CodeTypeRegister {
		key = fmt.Sprintf(RegisterPhoneCodeKey, req.Phone)
		ttl = RegisterPhoneCodeTTL
	} else if req.Type == CodeTypeLogin {
		key = fmt.Sprintf(LoginPhoneCodeKey, req.Phone)
		ttl = LoginPhoneCodeTTL
	} else {
		return false, errors.FormatError("Common/InvalidCodeType")
	}

	code, err := resource.Redis.Get(u.Ctx, key).Result()

	if err != nil && err != redis.Nil {
		logger.Error(u.Ctx, "redis error:", zap.Error(err))
		return false, errors.FormatError("Common/InternalError")
	}

	if code != "" {
		return false, errors.FormatError("UserCenter/InvalidCodeExist")
	}

	newCode := utils.GenPhoneCode()
	if er := resource.Redis.Set(u.Ctx, key, newCode, ttl).Err(); er != nil {
		return false, errors.FormatError("Common/InternalError")
	}

	fmt.Println("code:", newCode)
	return true, nil
}

// UserInfo 用户信息
func (u *UserCenter) UserInfo() (*response.UserInfo, error) {
	userID, err := context.GetUserID(u.Ctx)
	if err != nil {
		return nil, err
	}
	if userID <= 0 {
		return nil, errors.FormatError("UserCenter/NotLogin")
	}
	userInfo, err := model.NewUser(u.Ctx).GetByID(userID)
	if err != nil {
		return nil, err
	}
	return u.formatUserInfo(userInfo), nil
}

func (u *UserCenter) formatUserInfo(userInfo *model.User) *response.UserInfo {
	res := &response.UserInfo{
		UUID:      userInfo.UUID,
		UserName:  userInfo.UserName,
		Phone:     userInfo.Phone,
		Email:     userInfo.Email,
		Status:    userInfo.Status,
		URCStatus: userInfo.URCStatus,
		UECStatus: userInfo.UECStatus,
	}
	return res
}
