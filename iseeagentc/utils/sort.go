package utils

type Number interface {
	~int | ~int8 | ~int16 | ~int32 | ~int64 |
		~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
		~float32 | ~float64
}

type SortSlice[T Number] []T

func (s SortSlice[T]) Len() int {
	return len(s)
}

func (s SortSlice[T]) Less(i, j int) bool {
	return s[i] < s[j]
}

func (s SortSlice[T]) Swap(i, j int) {
	s[i], s[j] = s[j], s[i]
}
