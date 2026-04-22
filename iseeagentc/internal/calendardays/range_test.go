package calendardays

import (
	"testing"
	"time"
)

func TestUTCYMDInclusive_singleDay(t *testing.T) {
	lo := time.Date(2026, 3, 10, 15, 0, 0, 0, time.UTC).UnixMilli()
	hi := time.Date(2026, 3, 10, 23, 59, 0, 0, time.UTC).UnixMilli()
	got := UTCYMDInclusive(lo, hi, 400)
	if len(got) != 1 || got[0] != "2026-03-10" {
		t.Fatalf("got %v", got)
	}
}

func TestUTCYMDInclusive_gapFilled(t *testing.T) {
	lo := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC).UnixMilli()
	hi := time.Date(2026, 3, 12, 0, 0, 0, 0, time.UTC).UnixMilli()
	got := UTCYMDInclusive(lo, hi, 400)
	want := []string{"2026-03-10", "2026-03-11", "2026-03-12"}
	if len(got) != len(want) {
		t.Fatalf("len got %d want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("idx %d got %q want %q", i, got[i], want[i])
		}
	}
}
