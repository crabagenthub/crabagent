package conf

import _ "embed"

//go:embed command-exec-audit.toml
var defaultCommandExecAuditConfigTOML []byte

func DefaultCommandExecAuditConfigTOML() []byte {
	return defaultCommandExecAuditConfigTOML
}
