package utils

import (
	"time"
)

/*
   Author : lucbine
   DateTime : 2024/4/20
   Description : 时间工具类
*/

// TimeToStr 将给定的 time.Time 对象 t 转换为字符串格式，并返回该字符串。
// 转换的字符串格式为 time.DateTime，即 "2006-01-02 15:04:05" 这样的格式。
//
// 参数：
// t：需要转换为字符串的 time.Time 对象。
//
// 返回值：
// 转换后的字符串，格式为 "2006-01-02 15:04:05"。

func TimeToStr(t time.Time) string {
	return t.Format(time.DateTime)
}

// Int64ToStr 将 int64 类型的数字 i 转换为 time.Time 对象，
// 并使用 time.DateTime 格式将其转换为字符串返回。
//
// 参数：
// i：需要转换的 int64 类型数字。
//
// 返回值：
// 转换后的字符串，格式为 "2006-01-02 15:04:05"。
func Int64ToStr(i int64) string {
	return time.Unix(i, 0).Format(time.DateTime)
}

// TimeToSlimStr 将给定的 time.Time 对象 t 转换为字符串格式，并返回该字符串。
// 转换的字符串格式为 "20060102150405"，即年月日时分秒的连续数字串。
//
// 参数：
// t：需要转换为字符串的 time.Time 对象。
//
// 返回值：
// 转换后的字符串，格式为 "20060102150405"。
func TimeToSlimStr(t time.Time) string {
	return t.Format("20060102150405")
}

// StringToUnix 将字符串格式的日期时间转换为 Unix 时间戳
//
// 参数：
// timeStr: 字符串格式的日期时间，格式为 "2006-01-02 15:04:05"
//
// 返回值：
// int64: 转换后的 Unix 时间戳
func StringToUnix(timeStr string) int64 {
	stamp, _ := time.ParseInLocation(time.DateTime, timeStr, time.Local)
	return stamp.Unix()
}
