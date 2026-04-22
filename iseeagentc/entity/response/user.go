package response

/*
   Author : lucbine
   DateTime : 2024/4/28
   Description :
*/

//type PhoneCodeResponse struct {
//	Code string `json:"code"`
//}

type UserInfo struct {
	UUID      string `json:"uuid"`
	UserName  string `json:"user_name"`
	Phone     string `json:"phone"`
	Email     string `json:"email"`
	Status    int8   `json:"status"`
	URCStatus int8   `json:"urc_status"`
	UECStatus int8   `json:"uec_status"`
}
