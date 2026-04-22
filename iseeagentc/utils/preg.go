package utils

import (
	"regexp"
)

/*
   Author : lucbine
   DateTime : 2024/4/20
   Description :
*/

// IsValidPhone 判断输入的字符串是否为合法的电话号码
// 参数：
//
//	phone：待判断的电话号码，类型为字符串
//
// 返回值：
//
//	如果输入的电话号码符合规则，返回true；否则返回false，类型为布尔值
func IsValidPhone(phone string) bool {
	landline := regexp.MustCompile("^([0-9]{3,4}-)?[0-9]{5,8}$")
	if landline.MatchString(phone) {
		return true
	}

	cellphone := regexp.MustCompile("^(\\+?86-?)?1[3456789][0-9]{9}$")
	if cellphone.MatchString(phone) {
		return true
	}

	phone400 := regexp.MustCompile("^400(-\\d{3,4}){2}$")
	if phone400.MatchString(phone) {
		return true
	}
	return false
}
