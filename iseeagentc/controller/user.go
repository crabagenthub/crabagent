package controller

/*
   Author : lucbine
   DateTime : 2024/3/4
   Description :
*/
import (
	"net/http"

	"github.com/gin-gonic/gin"

	"iseeagentc/entity/request"
	"iseeagentc/internal/errors"

	"iseeagentc/service"
)

func UserLogin(c *gin.Context, req *request.UserLoginRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	if req.Password == "" && req.ValidCode == "" {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}

	if req.Password != "" {
		if len(req.Password) < 6 || len(req.Password) > 12 {
			AbortWithWriteErrorResponse(c, errors.FormatError("UserCenter/PasswordFormatErr"))
			return
		}
	}

	if req.ValidCode != "" {
		if len(req.ValidCode) != 4 {
			AbortWithWriteErrorResponse(c, errors.FormatError("UserCenter/InvalidCodeError"))
			return
		}
	}

	resp, err := service.NewUserCenter(c).Login(req)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, resp)
}

func SendPhoneCode(c *gin.Context, req *request.UserPhoneCodeRequest) {
	resp, err := service.NewUserCenter(c).SendPhoneCode(req)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, resp)
}

func PhoneRegister(c *gin.Context, req *request.PhoneRegisterRequest) {
	resp, err := service.NewUserCenter(c).PhoneRegister(req)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, resp)
}

func UserInfo(c *gin.Context) {
	resp, err := service.NewUserCenter(c).UserInfo()
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, resp)
}

func UserUpdatePassword(c *gin.Context) {
	c.JSON(200, "ok")
}

func UserUpdateAvatar(c *gin.Context) {
	c.JSON(200, "ok")
}

func UserUpdateInfo(c *gin.Context) {
	c.JSON(200, "ok")
}

func UserUpdateEmail(c *gin.Context) {
	c.JSON(200, "ok")
}

func UserUpdatePhone(c *gin.Context) {
	c.JSON(200, "ok")
}

func UserUpdateNickname(c *gin.Context) {
	c.JSON(200, "ok")
}
