package parser

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

func Int64FromUnknown(v any) *int64 {
	switch x := v.(type) {
	case int:
		n := int64(x)
		return &n
	case int64:
		return &x
	case float64:
		if !math.IsNaN(x) && !math.IsInf(x, 0) {
			n := int64(x)
			return &n
		}
	case json.Number:
		n, err := x.Int64()
		if err == nil {
			return &n
		}
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return nil
		}
		n, err := strconv.ParseInt(s, 10, 64)
		if err == nil {
			return &n
		}
	}
	return nil
}
