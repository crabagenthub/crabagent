package utils

import (
	"crypto/md5"
	"encoding/hex"
)

/*
   Author : lucbine
   DateTime : 2024/4/20
   Description :
*/

func MD5(str string) string {
	// 创建一个 MD5 hasher
	hasher := md5.New()
	// 将字符串转换为字节数组并计算哈希值
	hasher.Write([]byte(str))
	// 获取哈希值的字节数组
	hashBytes := hasher.Sum(nil)
	// 将字节数组转换为十六进制字符串
	hashString := hex.EncodeToString(hashBytes)
	return hashString
}
