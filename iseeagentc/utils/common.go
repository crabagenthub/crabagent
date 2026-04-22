package utils

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"

	uuid "github.com/nu7hatch/gouuid"
)

/*
   Author : lucbine
   DateTime : 2024/4/20
   Description :
*/

const (
	DefaultUuidString = "73a61d26-8c61-4086-899c-9a5959f145fa"
)

func GenPhoneCode() string {
	return GenerateRandomDigits(4)
}

// 生成指定长度的随机数字串
func GenerateRandomDigits(length int) string {
	var result string
	for i := 0; i < length; i++ {
		digit := rand.Intn(10) // 生成0-9之间的随机数
		result += fmt.Sprintf("%d", digit)
	}
	return result
}

// GenUUID 生成唯一ID
func GenUUID() string {
	newID, err := uuid.NewV4()
	if err != nil {
		return DefaultUuidString
	}
	return newID.String()
}

// GenUUID32 生成用户ID
func GenUUID32() string {
	// 计算字节数
	bytes := make([]byte, 16)
	_, err := rand.Read(bytes)
	if err != nil {
		return ""
	}
	// 将随机字节转换为十六进制字符串
	return hex.EncodeToString(bytes)
}

// GenUsername 生成随机用户名
func GenUsername() string {
	// 候选用户名字符集
	charset := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	// 生成随机用户名
	username := make([]byte, 8) // 生成8个字符的用户名
	for i := range username {
		username[i] = charset[rand.Intn(len(charset))]
	}
	return "用户" + string(username)
}

func PrettyJson(v interface{}) string {
	bts, _ := json.Marshal(v)
	return string(bts)
}

func If[T any](condition bool, ifTrue T, ifNot T) T {
	if condition {
		return ifTrue
	}
	return ifNot
}

func Max[T Number](a, b T) T {
	if a > b {
		return a
	}
	return b
}

func Min[T Number](a, b T) T {
	if a < b {
		return a
	}
	return b
}

func Addr[T any](p T) *T {
	return &p
}
