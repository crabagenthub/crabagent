package shellexec

import "testing"

func TestClassifyCommandCategory_compoundP1(t *testing.T) {
	cfg := DefaultResourceAuditConfig()
	const pl = "unix"

	tests := []struct {
		name string
		cmd  string
		want ShellCommandCategory
	}{
		{
			name: "which_or_echo",
			cmd:  `which mailsync mbsync offlineimap || echo "No mail sync tool"`,
			want: CategorySystem,
		},
		{
			name: "sudo_curl_network_wins",
			cmd:  `sudo curl -s https://example.com`,
			want: CategoryNetwork,
		},
		{
			name: "pipe_cat_ssh_network",
			cmd:  `cat /etc/hosts | ssh host 'wc -l'`,
			want: CategoryNetwork,
		},
		{
			name: "make_and_git_package_over_file",
			cmd:  `make build && git status`,
			want: CategoryPackage,
		},
		{
			name: "unknown_only",
			cmd:  `foobar -x`,
			want: CategoryOther,
		},
		{
			name: "env_assign_then_curl",
			cmd:  `env HTTPS_PROXY= curl https://x`,
			want: CategoryNetwork,
		},
		{
			name: "nice_n_ls_file",
			cmd:  `nice -n 10 ls`,
			want: CategoryFile,
		},
		{
			name: "timeout_duration_curl",
			cmd:  `timeout 30s curl http://x`,
			want: CategoryNetwork,
		},
		{
			name: "sudo_only",
			cmd:  `sudo`,
			want: CategorySystem,
		},
		{
			name: "semicolon_sequence",
			cmd:  `ls; curl http://y`,
			want: CategoryNetwork,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyCommandCategory(tt.cmd, cfg, pl)
			if got != tt.want {
				t.Fatalf("classifyCommandCategory(%q) = %q, want %q", tt.cmd, got, tt.want)
			}
		})
	}
}

func TestAggregateCategoriesP1_firstMaxWins(t *testing.T) {
	// 同优先级时先出现的段胜出：仅当 rank 严格更大才替换
	got := aggregateCategoriesP1([]ShellCommandCategory{CategoryFile, CategoryFile})
	if got != CategoryFile {
		t.Fatalf("got %q", got)
	}
	got = aggregateCategoriesP1([]ShellCommandCategory{CategoryFile, CategoryNetwork, CategoryFile})
	if got != CategoryNetwork {
		t.Fatalf("got %q", got)
	}
}
