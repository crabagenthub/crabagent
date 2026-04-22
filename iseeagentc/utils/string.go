package utils

import (
	"regexp"
)

/*
   Author : lucbine
   DateTime : 2024/4/20
   Description :
*/

// ContainsEmoji 函数接收一个字符串参数，检查其中是否包含表情符号
// 如果参数为空字符串，返回 false
// 使用正则表达式匹配表情符号的 Unicode 范围（1F600-1F6FF 和 2600-26FF）
// 如果字符串中包含表情符号，返回 true，否则返回 false
func ContainsEmoji(str string) bool {
	if str == "" {
		return false
	}
	emojiRx := regexp.MustCompile(`[\x{1F600}-\x{1F6FF}|[\x{2600}-\x{26FF}]`)
	return emojiRx.MatchString(str)
}

func IsSpace(r rune) bool {
	if r <= '\u00FF' {
		// Obvious ASCII ones: \t through \r plus space. Plus two Latin-1 oddballs.
		switch r {
		case ' ', '\t', '\n', '\v', '\f', '\r':
			return true
		case '\u0085', '\u00A0':
			return true
		}
		return false
	}
	// High-valued ones.
	if '\u2000' <= r && r <= '\u200a' {
		return true
	}
	switch r {
	case '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000':
		return true
	}
	return false
}
