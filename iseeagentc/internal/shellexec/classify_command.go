package shellexec

import (
	"regexp"
	"strings"
)

// P1 风险优先：数值越大整行聚合结果越优先（与计划一致；同优先级取遍历中先出现的段）。
var categoryRiskRank = map[ShellCommandCategory]int{
	CategoryNetwork: 50,
	CategoryProcess: 40,
	CategoryPackage: 30,
	CategoryFile:    20,
	CategorySystem:  10,
	CategoryOther:   0,
}

// 单次弹出的前缀（小写 token）；与 categories 中「动词」区分：此处仅作包装器剥离。
var singlePopWrapper = map[string]bool{
	"env":     true,
	"nohup":   true,
	"command": true,
	"stdbuf":  true,
	"time":    true,
}

var reEnvAssign = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*=`)

var reTimeoutDur = regexp.MustCompile(`(?i)^\d+(\.\d+)?[smhd]?$`)

func stripSudoLeadingFlags(argv []string) []string {
	for len(argv) > 0 {
		t := strings.TrimSpace(argv[0])
		if !strings.HasPrefix(t, "-") {
			break
		}
		low := strings.ToLower(t)
		if strings.HasPrefix(low, "--") && strings.Contains(low, "=") {
			argv = argv[1:]
			continue
		}
		if (low == "-u" || low == "-g" || low == "-U" || low == "-p" || low == "--user" || low == "--group") && len(argv) >= 2 {
			argv = argv[2:]
			continue
		}
		argv = argv[1:]
	}
	return argv
}

func stripNiceNumeric(argv []string) []string {
	for len(argv) >= 2 {
		t0 := strings.ToLower(strings.TrimSpace(argv[0]))
		if t0 == "-n" {
			argv = argv[2:]
			continue
		}
		break
	}
	return argv
}

func stripLeadingCommandWrappers(argv []string, cfg ResourceAuditConfig) []string {
	argv = append([]string(nil), argv...)
	const maxIters = 48
	for iter := 0; iter < maxIters && len(argv) > 0; iter++ {
		for len(argv) > 0 && strings.TrimSpace(argv[0]) == "" {
			argv = argv[1:]
		}
		if len(argv) == 0 {
			break
		}
		if reEnvAssign.MatchString(strings.TrimSpace(argv[0])) {
			argv = argv[1:]
			continue
		}
		lt := normalizeToken(argv[0], cfg)
		if lt == "" {
			argv = argv[1:]
			continue
		}
		if lt == "sudo" {
			argv = argv[1:]
			argv = stripSudoLeadingFlags(argv)
			continue
		}
		if lt == "nice" {
			argv = argv[1:]
			argv = stripNiceNumeric(argv)
			continue
		}
		if lt == "timeout" && len(argv) >= 2 {
			next := strings.TrimSpace(argv[1])
			if reTimeoutDur.MatchString(next) {
				argv = argv[2:]
				continue
			}
			argv = argv[1:]
			continue
		}
		if singlePopWrapper[lt] {
			argv = argv[1:]
			continue
		}
		break
	}
	return argv
}

func classifyVerbToken(tok string, cfg ResourceAuditConfig) ShellCommandCategory {
	tok = normalizeToken(tok, cfg)
	if tok == "" {
		return CategoryOther
	}
	cat := cfg.ShellExec.CommandSemantics.Categories
	if containsStr(cat.File, tok) {
		return CategoryFile
	}
	if containsStr(cat.Network, tok) {
		return CategoryNetwork
	}
	if containsStr(cat.System, tok) {
		return CategorySystem
	}
	if containsStr(cat.Process, tok) {
		return CategoryProcess
	}
	if containsStr(cat.Package, tok) {
		return CategoryPackage
	}
	return CategoryOther
}

func classifySimpleArgv(argv []string, cfg ResourceAuditConfig) ShellCommandCategory {
	if len(argv) == 0 {
		return CategoryOther
	}
	origFirst := strings.TrimSpace(argv[0])
	argv = stripLeadingCommandWrappers(argv, cfg)
	for len(argv) > 0 && strings.TrimSpace(argv[0]) == "" {
		argv = argv[1:]
	}
	if len(argv) == 0 {
		// 仅由包装器 / 环境赋值构成时，用首个原始 token 归类（如单独 `sudo` → system）
		return classifyVerbToken(origFirst, cfg)
	}
	return classifyVerbToken(argv[0], cfg)
}

func collectAstArgvs(ast ShellCommandAst) [][]string {
	var out [][]string
	for _, n := range ast.Nodes {
		switch n.Kind {
		case "command":
			if len(n.Argv) > 0 {
				out = append(out, append([]string(nil), n.Argv...))
			}
		case "pipe":
			for _, ch := range n.Children {
				if ch.Kind == "command" && len(ch.Argv) > 0 {
					out = append(out, append([]string(nil), ch.Argv...))
				}
			}
		}
	}
	return out
}

func aggregateCategoriesP1(cats []ShellCommandCategory) ShellCommandCategory {
	if len(cats) == 0 {
		return CategoryOther
	}
	best := CategoryOther
	bestRank := categoryRiskRank[best]
	for _, c := range cats {
		r := categoryRiskRank[c]
		if r > bestRank {
			best = c
			bestRank = r
		}
	}
	return best
}

// classifyCommandCategory 对整行 shell 做 AST 分段 + 前缀剥离 + 多段 P1 风险聚合。
func classifyCommandCategory(cmd string, cfg ResourceAuditConfig, platform string) ShellCommandCategory {
	trim := strings.TrimSpace(cmd)
	if trim == "" {
		return CategoryOther
	}
	ast := parseCommandAst(trim, platform)
	argvs := collectAstArgvs(ast)
	if len(argvs) == 0 {
		// 无法分词时退回整行首 token（与旧行为接近）
		return classifyVerbToken(firstToken(trim), cfg)
	}
	cats := make([]ShellCommandCategory, 0, len(argvs))
	for _, av := range argvs {
		cats = append(cats, classifySimpleArgv(av, cfg))
	}
	return aggregateCategoriesP1(cats)
}
