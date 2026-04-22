package utils

/*
   Author : lucbine
   DateTime : 2024/4/20
   Description :
*/

// Keys 函数接受一个 map[K]V 类型的参数 m，其中 K 必须是可比较的，V 可以是任意类型。
// 函数返回 m 中所有键的切片。

func MapKeys[K comparable, V any](m map[K]V) []K {
	var list = []K{}
	for k := range m {
		list = append(list, k)
	}
	return list
}

// Values 函数接受一个map[K]V类型的参数param，并返回一个[]V类型的切片
// 参数K是map的键类型，要求必须可比较
// 参数V是map的值类型，没有特殊要求
// 函数遍历map的所有值，并将其加入到result切片中
// 函数最后返回result切片

func MapValues[K comparable, V any](param map[K]V) []V {
	var result []V
	for _, value := range param {
		result = append(result, value)
	}

	return result
}

// MapUniqueValue 返回一个只包含唯一值的 map
//
// 参数：
// param: 需要过滤的 map
//
// 返回值：
// 返回一个只包含唯一值的 map
//
// 示例：
// m := map[string]int{"a": 1, "b": 2, "c": 1, "d": 3}
// uniqueMap := MapUniqueValue(m)
// 输出结果：map[a:1 b:2 d:3]
func MapUniqueValue[K comparable, V comparable](param map[K]V) map[K]V {
	var result map[K]V
	var valueExistMap = map[V]bool{}
	for key, value := range param {
		_, has := valueExistMap[value]
		if has {
			continue
		}
		result[key] = value
		valueExistMap[value] = true
	}

	return result
}

// MapMerge 函数接收两个类型为map[K]V的参数firstParam和secondParam，并返回一个类型为map[K]V的结果。
// 其中K和V都是可比较的类型。
// 函数的作用是将secondParam中的键值对覆盖firstParam中对应的键值对，并返回合并后的结果。
// 如果secondParam中存在firstParam中不存在的键，则将该键值对添加到firstParam中。
// 如果firstParam中存在secondParam中不存在的键，则该键的值不会改变。
func MapMerge[K comparable, V comparable](firstParam map[K]V, secondParam map[K]V) map[K]V {
	// 用第二个的覆盖第一个
	for key, value := range secondParam {
		firstParam[key] = value
	}

	return firstParam
}

// MapReverse 函数接受一个类型为 map[K]V 的参数 param，其中 K 和 V 均为可比较类型
// 函数返回一个新的 map[V]K 类型的映射，其中原映射中的键值对在结果映射中被反转
// 如果原映射中存在相同的值，则结果映射中只保留最后一个出现的键值对
func MapReverse[K comparable, V comparable](param map[K]V) map[V]K {
	var result = map[V]K{}
	for key, value := range param {
		result[value] = key
	}
	return result
}
