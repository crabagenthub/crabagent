package conf

import _ "embed"

//go:embed resourceaudit.toml
var defaultResourceAuditConfigTOML []byte

func DefaultResourceAuditConfigTOML() []byte {
	return defaultResourceAuditConfigTOML
}
