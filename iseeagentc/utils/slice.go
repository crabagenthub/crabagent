package utils

import (
	"reflect"
	"strconv"
)

/*
   Author : lucbine
   DateTime : 2024/4/20
   Description :
*/

// DeleteElement 函数接受一个可比较的切片elements和一个元素toDeleteElement，返回一个新的切片，该切片包含elements中不等于toDeleteElement的所有元素。
// V是elements和toDeleteElement的类型，需要满足comparable接口。
func DeleteElement[V comparable](elements []V, toDeleteElement V) []V {
	result := make([]V, 0, len(elements)) // 创建一个新的切片来存储结果
	for _, v := range elements {
		if v != toDeleteElement {
			result = append(result, v) // 只追加不等于要删除元素的值
		}
	}
	return result
}

// SliceUnique 函数接受一个可比较的切片 elements，并返回一个新的切片，该切片只包含 elements 中的唯一元素。
// V 是 elements 元素的类型，必须满足 comparable 接口。
// 如果 elements 为空，则直接返回空切片。
func SliceUnique[V comparable](elements []V) []V {
	if len(elements) == 0 {
		return elements
	}

	var existElementsMap = map[V]bool{}
	i := 0
	for _, v := range elements {
		isExist := existElementsMap[v]
		if !isExist {
			elements[i] = v
			existElementsMap[v] = true
			i++
		}
	}
	return elements[0:i]
}

// DiffStringSlice 函数接受两个字符串切片a和b作为参数，并返回一个字符串切片c。
// 切片c包含切片a中不包含在切片b中的所有元素。
func DiffStringSlice(a []string, b []string) []string {
	var c []string
	temp := map[string]struct{}{} // map[string]struct{}{}创建了一个key类型为String值类型为空struct的map，Equal -> make(map[string]struct{})

	for _, val := range b {
		if _, ok := temp[val]; !ok {
			temp[val] = struct{}{} // 空struct 不占内存空间
		}
	}

	for _, val := range a {
		if _, ok := temp[val]; !ok {
			c = append(c, val)
		}
	}

	return c
}

// InArray 判断一个元素是否存在于一个切片中
// 参数 needle 是要查找的元素
// 参数 haystack 是要查找的切片
// 返回值是一个布尔值，表示元素是否存在于切片中
func InArray[T comparable](needle T, haystack []T) bool {
	for _, item := range haystack {
		if item == needle {
			return true
		}
	}
	return false
}

// Unshift 函数接受一个类型为T的新头部元素和一个类型为T的切片作为参数，
// 并返回一个新的类型为T的切片，该切片包含原始切片中的元素，以及新头部元素作为第一个元素。
// 如果原始切片为空，则新切片只包含新头部元素。
//
// 参数：
// newHead：类型为T的新头部元素
// originSlice：类型为T的原始切片
//
// 返回值：
// 返回一个新的类型为T的切片，包含原始切片和新头部元素
func Unshift[T any](newHead T, originSlice []T) []T {
	return append([]T{newHead}, originSlice...)
}

// Shift 函数用于将给定切片的第一个元素移除，并返回修改后的切片。
// 如果切片长度为1或0，则返回一个空切片。
//
// 参数：
// originSlice: 待移除第一个元素的切片，使用指针接收以支持在函数内部修改原切片
//
// 返回值：
// 无返回值，函数会直接修改传入的原切片
func Shift[T any](originSlice *[]T) {
	if len(*originSlice) <= 1 {
		*originSlice = []T{}
	} else {
		*originSlice = (*originSlice)[1:]
	}
}

type Integer interface {
	uint | uint8 | uint16 | uint32 | uint64 | int | int8 | int16 | int32 | int64 | float32 | float64
}

type IntegerString interface {
	uint | uint8 | uint16 | uint32 | uint64 | int | int8 | int16 | int32 | int64 | float32 | float64 | string
}

// ArrayColumn 从一个接口类型的切片中按照指定列名提取出列值，并返回一个新的列值切片
//
// 参数：
// s: 接口类型的切片，包含多个结构体
// col: 字符串类型，指定要提取的列名
//
// 返回值：
// retCol: []T，列值切片，类型为T的切片，T为整数或字符串类型
//
// 注意：
// 如果列名不存在或列值类型不符合要求，将会抛出panic异常
func ArrayColumn[T IntegerString](s interface{}, col string) (retCol []T) {
	rv := reflect.ValueOf(s)
	ln := rv.Len()
	for i := 0; i < ln; i++ {
		tmpRv := rv.Index(i)
		value := tmpRv.FieldByName(col)
		if !value.IsValid() {
			panic("unknown field: " + col)
		}
		switch value.Kind() {
		case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Float32, reflect.Float64, reflect.String:
			value := value.Interface().(T)
			retCol = append(retCol, value)
		default:
			panic("unknown field: " + col)
		}
	}
	return
}

// SliceToFieldMap 将源切片中的每个元素作为键值对添加到目标映射中
//
// 参数：
// source：源切片，用于获取键值对
// target：目标映射，用于存储键值对
// keyField：源切片中元素的字段名，用于作为映射的键
// valueField：源切片中元素的字段名，用于作为映射的值
//
// 返回值：无
func SliceToFieldMap(source interface{}, target interface{}, keyField string, valueField string) {
	if source == nil {
		return
	}

	sourceValue := reflect.ValueOf(source)
	targetValue := reflect.ValueOf(target)
	if sourceValue.Kind() != reflect.Slice || targetValue.Kind() != reflect.Map {
		return
	}

	for i := 0; i < sourceValue.Len(); i++ {
		item := sourceValue.Index(i)
		if item.Kind() == reflect.Ptr {
			item = item.Elem()
		}
		var value = item
		if valueField != "" {
			value = item.FieldByName(valueField)
		}
		targetValue.SetMapIndex(item.FieldByName(keyField), value)
	}
}

// SliceIntersect 函数接受两个类型为T的切片a和b作为参数，并返回它们的交集切片
//
// 参数：
// a: 类型为T的切片a
// b: 类型为T的切片b
//
// 返回值：
// 返回一个类型为T的切片，表示a和b的交集
func SliceIntersect[T comparable](a, b []T) []T {
	m := make(map[T]struct{})
	for _, x := range a {
		m[x] = struct{}{}
	}
	res := make([]T, 0, len(a))
	for _, y := range b {
		if _, ok := m[y]; ok {
			res = append(res, y)
		}
	}
	return res
}

// StrSliceToInt64Slice 将一个字符串切片转换为一个 int64 切片
//
// 参数：
// s: 待转换的字符串切片
//
// 返回值：
// 转换后的 int64 切片
func StrSliceToInt64Slice(s []string) []int64 {
	intSlice := make([]int64, 0)
	for _, str := range s {
		// Parse the string to int64
		num, err := strconv.ParseInt(str, 10, 64)
		if err != nil {
			continue
		}
		intSlice = append(intSlice, num)
	}
	return intSlice
}
