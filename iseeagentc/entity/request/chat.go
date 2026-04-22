package request

/*
   Author : lucbine
   DateTime : 2024/4/25
   Description : 用户请求实体
*/

type ChatParams struct {
	Query           string            `json:"query" binding:"required" msg:"query is empty"`
	Stream          bool              `json:"stream"`
	ConversationID  string            `json:"conversation_id,omitempty"`
	AutoSaveHistory bool              `json:"auto_save_history,omitempty"`
	CustomVariables map[string]string `json:"custom_variables,omitempty"`
	MetaData        map[string]string `json:"meta_data,omitempty"`
	ExtraParams     string            `json:"extra_params,omitempty"`
}

type AsrParams struct {
	Type int `json:"type" binding:"oneof=1 2"`
}
