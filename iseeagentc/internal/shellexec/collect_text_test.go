package shellexec

import (
	"strings"
	"testing"
)

func TestParseShellSpanRow_tokenRisk_resultContentArray(t *testing.T) {
	cfg := DefaultResourceAuditConfig()
	thr := 100
	large := strings.Repeat("x", 150)
	out := `{"result":{"content":[{"type":"text","text":"` + large + `"}]}}`
	in := `{"params":{"command":"echo test"}}`
	p := ParseShellSpanRow(&in, &out, nil, nil, nil, cfg, &thr)
	if !p.TokenRisk {
		t.Fatalf("expected TokenRisk=true for content[] body len=%d thr=%d", p.StdoutLen, thr)
	}
	if p.StdoutLen < thr {
		t.Fatalf("stdout_len=%d want >= %d", p.StdoutLen, thr)
	}
}
