package ingest

import "testing"

func TestIsShellLikeToolSpan_NonStringParamsCommand(t *testing.T) {
	// SQLite json_extract treats non-string scalars/objects as non-NULL; ShellToolWhereSQL can match these
	// while the previous Go-only string check skipped them → no agent_exec_commands row.
	raw := `{"params":{"command":1}}`
	if !isShellLikeToolSpan("tool", "generic_tool", &raw) {
		t.Fatal("numeric params.command should match shell hint like SQL")
	}
}

func TestIsShellLikeToolSpan_ObjectParamsCommand(t *testing.T) {
	raw := `{"params":{"command":{"argv":["ls"]}}}`
	if !isShellLikeToolSpan("tool", "x", &raw) {
		t.Fatal("object params.command should match shell hint like SQL json_extract")
	}
}

func TestIsShellLikeToolSpan_NonStringRootCommand(t *testing.T) {
	raw := `{"command":false}`
	if !isShellLikeToolSpan("tool", "noop", &raw) {
		t.Fatal("non-string root command should match like SQL")
	}
}
