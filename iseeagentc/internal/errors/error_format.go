package errors

import (
	"errors"
	"fmt"
	"iseeagentc/internal/logger"
	"net/http"
	"strings"

	"gorm.io/gorm"
)

func Is(err, target error) bool {
	return errors.Is(err, target)
}

// FormatError 通过errCode抛错，errCode统一为2层，以/分隔，第一层为业务模块，第二层为具体错误信息
func FormatError(errCode string, params ...interface{}) *Error {
	errCodeList := strings.Split(errCode, "/")
	if len(errCodeList) != 2 {
		return InternalError("errCode Not Exists")
	}

	firstLevelMap, ok := ErrorCodeMessageMap[errCodeList[0]]
	if !ok {
		return InternalError(errCode)
	}

	errMsg, ok := firstLevelMap[errCodeList[1]]
	if !ok {
		return InternalError(errCode)
	}

	return &Error{
		Code:       errCode,
		Message:    fmt.Sprintf(errMsg, params...),
		HTTPStatus: http.StatusBadRequest, // 默认返回400
	}
}

func InternalError(message string) *Error {
	logger.Error(nil, "InternalError: "+message)
	return &Error{
		Code:       "InternalError",
		Message:    message,
		HTTPStatus: http.StatusInternalServerError, // 默认返回500
	}
}

func ParamFieldError(field, reason string) *Error {
	return FormatError("Common/ParamFieldError", field, reason)
}

func DataNotFound(id int64) *NotFoundError {
	return &NotFoundError{
		Code:       "DataNotFound",
		Message:    fmt.Sprintf("Data [%d] does not exist", id),
		ChMessage:  fmt.Sprintf("未查找[%d]的数据", id),
		HTTPStatus: http.StatusNotFound,
	}
}

func UrlNotFound() *NotFoundError {
	return &NotFoundError{
		Code:       "DataNotFound",
		Message:    "URL not found",
		ChMessage:  "",
		HTTPStatus: http.StatusNotFound,
	}
}

func FormatModelError(err error) error {
	switch err {
	case nil:
		return nil
	case gorm.ErrRecordNotFound:
		return nil
	default:
		return InternalError(fmt.Sprintf("Internal error: %s", err.Error()))
	}
}

func AuthFail(message string) *NotAuthError {
	return &NotAuthError{
		Code:       "AuthFail",
		Message:    "login fail",
		ChMessage:  message,
		HTTPStatus: http.StatusUnauthorized,
	}
}
