package ingest

import "testing"

func TestIsValidResourceURI(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		uri  string
		want bool
	}{
		{name: "https", uri: "https://example.com/a.txt", want: true},
		{name: "file_scheme", uri: "file:///var/log/app.log", want: true},
		{name: "memory_scheme", uri: "memory://search?q=hello", want: true},
		{name: "unix_absolute", uri: "/var/log/app.log", want: true},
		{name: "relative_dot", uri: "./foo/bar.txt", want: true},
		{name: "windows_absolute", uri: `C:\Users\alice\file.txt`, want: true},
		{name: "tool_placeholder", uri: "tool://bash", want: false},
		{name: "unknown_literal", uri: "unknown", want: false},
		{name: "empty", uri: "   ", want: false},
		{name: "unsupported_scheme", uri: "custom://foo", want: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := IsValidResourceURI(tt.uri)
			if got != tt.want {
				t.Fatalf("IsValidResourceURI(%q) = %v, want %v", tt.uri, got, tt.want)
			}
		})
	}
}

