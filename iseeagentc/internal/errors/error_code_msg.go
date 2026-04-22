package errors

/*
   Author : lucbine
   DateTime : 2024/4/25
   Description :
*/

var ErrorCodeMessageMap = map[string]map[string]string{
	"Init": {
		"ConfigError":     "初始化设置错误:%s",
		"InvalidDBDriver": "数据库驱动错误:%s",
		"DBError":         "初始化数据库错误:%s",
	},

	"Context": {
		"KeyIsEmpty": "上下文中[%s]为空",
	},

	"Middleware": {
		"MethodCantEmpty":                 "接口名称为空，无法处理",
		"ApiHasNoPermissionConf":          "此接口[%s]未配置权限，无法访问",
		"UserHasNoApiPermission":          "当前用户无此接口[%s]权限，无法访问",
		"InvalidPlatform":                 "当前请求来源平台[%s]不合法",
		"PlatformNotDeployed":             "[%s]平台未部署，无法处理当前请求",
		"InnerMethodNotAvailable":         "当前未开放内部请求",
		"InnerMethodInvalid":              "当前内部请求[%s]非法",
		"InvalidCloudID":                  "用户校验失败，cloudId[%s]不合法",
		"InnerUserlessMethodNotAvailable": "当前未开放无用户请求",
		"InnerUserlessMethodInvalid":      "当前无用户请求[%s]非法",
		"OnlyAdminCanOperate":             "当前操作只有管理员才可以执行",
	},

	// 公共错误信息
	"Common": {
		"InternalError":                    "非常抱歉，系统出现错误，请稍后重试",
		"FrequencyLimit":                   "操作太频繁，稍后重试",
		"ParamFieldNotExistOrEmpty":        "参数[%s]不存在或为空",
		"ParamFieldValueInvalid":           "参数[%s]值不合法[%v]",
		"ParamFieldError":                  "参数[%s]不合法:[%s]",
		"ParamTypeError":                   "参数[%s]类型错误，应为[%s]类型",
		"ParamsCantBothEmpty":              "参数[%s]和参数[%s]不能同时为空",
		"ParamsCantBothNonEmpty":           "参数[%s]和参数[%s]不能同时非空",
		"ParamsLengthExceeded":             "参数[%s]长度不能超过[%d]",
		"ParamsLengthNotEqual":             "参数[%s]和参数[%s]长度需相同",
		"ParamsLengthNotInRange":           "参数[%s]的值[%v]不在[%v]到[%v]的范围内",
		"ParamsValueBeyondLimit":           "参数[%s]值不能超过边界%s",
		"AuthFailed":                       "无操作权限",
		"InitServiceWithWrongDataType":     "初始化服务的数据类型错误[%v]",
		"InitServiceWithWrongProjectType":  "初始化服务的标注类型错误[%v]",
		"InitServiceWithWrongTemplateType": "初始化服务的模板类型错误[%v]",
		"ModelIDNotExist":                  "table: %s id: %+v not exist",
		"CallClientError":                  "调用服务:%s 接口:%s 报错:%s",
		"InvalidTemplateType":              "标注模版错误",
		"UpdateFailed":                     "更新数据集信息失败",
		"GetContextFail":                   "无效的上下文",
		"InterfaceNotSatisfy":              "%T 未实现接口 %s",
		"CurrentUserIsNotPermitted":        "当前用户没有权限进行此操作",
		"ValidateFailed":                   "校验%s失败:%s",
		"GenerateStrIDFailed":              "生成表[%s]字段[%s]字符串ID失败,请稍后重试",
		"FunctionNotEnabled":               "当前功能未开启",
		"InvalidPageParams":                "分页参数不合法",
		"InvalidFieldRange":                "参数[%s]不合法，应在%v-%v范围内",
		"ParamsError":                      "参数错误",
		"DBError":                          "数据库执行错误:%s",
	},
	"UserCenter": {
		"InvalidCodeExist":  "手机验证码已经生成，请一分钟后重试",
		"InvalidCodeError":  "手机验证码输入错误，请检查验证码",
		"PhoneRegExist":     "该手机号已经注册，请更换手机号注册",
		"PhoneNotRegExist":  "该手机号未注册，请请先进行注册",
		"PasswordFormatErr": "密码格式不正确 必须 6-20个字符",
		"PasswordNotMatch":  "密码错误，请更换重试",
		"NotLogin":          "未登陆",
	},
}
