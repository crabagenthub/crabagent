package calendardays

import "time"

// DefaultMaxTrendDays caps generated day keys to avoid oversized JSON for multi-year ranges.
const DefaultMaxTrendDays = 400

// UTCYMDInclusive returns every UTC calendar date "2006-01-02" from the date of sinceMs through
// the date of untilMs inclusive. If the span exceeds maxDays, only the last maxDays ending at until's date are kept.
// Returns nil if sinceMs/untilMs are invalid or since > until.
func UTCYMDInclusive(sinceMs, untilMs int64, maxDays int) []string {
	if maxDays < 1 {
		maxDays = DefaultMaxTrendDays
	}
	if untilMs < sinceMs {
		return nil
	}
	start := time.UnixMilli(sinceMs).UTC()
	end := time.UnixMilli(untilMs).UTC()
	startDay := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	endDay := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.UTC)
	if endDay.Before(startDay) {
		return nil
	}
	n := int(endDay.Sub(startDay).Hours()/24) + 1
	if n > maxDays {
		startDay = endDay.AddDate(0, 0, -(maxDays - 1))
		n = maxDays
	}
	out := make([]string, 0, n)
	for d := startDay; !d.After(endDay); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format("2006-01-02"))
	}
	return out
}
