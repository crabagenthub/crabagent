package validator

/*
   Author : lucbine
   DateTime : 2024/4/25
   Description : 自定义验证器
*/

import (
	"regexp"
	"strconv"
	"unicode/utf8"

	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/locales/zh"
	ut "github.com/go-playground/universal-translator"
	"github.com/go-playground/validator/v10"
	zhTranslations "github.com/go-playground/validator/v10/translations/zh"
)

const (
	TagMaxRune = "maxRune"
	TagMinRune = "minRune"
	TagPhone   = "phone"
)

var phoneRegexp = regexp.MustCompile(`^1[3-9]\d{9}$`)

var DefaultTranslator ut.Translator

func RegisterValidatorAndTrans() {
	z := zh.New()
	uTrans := ut.New(z, z)

	if v, ok := binding.Validator.Engine().(*validator.Validate); ok {
		DefaultTranslator, ok = uTrans.GetTranslator("zh")
		if ok {
			_ = zhTranslations.RegisterDefaultTranslations(v, DefaultTranslator)
		}
		RegisterCustomValidator(v, DefaultTranslator)
	}
}

type Validator struct {
	Tag           string
	ValidateFunc  func(fl validator.FieldLevel) bool
	MessageFormat string
	TranslateFunc func(ut ut.Translator, fe validator.FieldError) string
}

var CustomValidators = []Validator{
	{
		Tag: TagMaxRune,
		ValidateFunc: func(fl validator.FieldLevel) bool {
			max, _ := strconv.ParseInt(fl.Param(), 10, 64)
			return utf8.RuneCountInString(fl.Field().String()) <= int(max)
		},
		MessageFormat: "{0}长度不能超过{1}字符",
		TranslateFunc: func(ut ut.Translator, fe validator.FieldError) string {
			t, _ := ut.T(TagMaxRune, fe.Field(), fe.Param())
			return t
		},
	},
	{
		Tag: TagMinRune,
		ValidateFunc: func(fl validator.FieldLevel) bool {
			max, _ := strconv.ParseInt(fl.Param(), 10, 64)
			return utf8.RuneCountInString(fl.Field().String()) >= int(max)
		},
		MessageFormat: "{0}长度必须大于等于{1}字符",
		TranslateFunc: func(ut ut.Translator, fe validator.FieldError) string {
			t, _ := ut.T(TagMinRune, fe.Field(), fe.Param())
			return t
		},
	},
	{
		Tag: TagPhone,
		ValidateFunc: func(fl validator.FieldLevel) bool {
			phone := fl.Field().String()
			return phoneRegexp.MatchString(phone)
		},
		MessageFormat: "手机号码格式不正确",
		TranslateFunc: func(ut ut.Translator, fe validator.FieldError) string {
			t, _ := ut.T(TagPhone, fe.Field(), fe.Param())
			return t
		},
	},
}

// RegisterCustomValidator 注册定制化校验器
func RegisterCustomValidator(v *validator.Validate, trans ut.Translator) {
	//register custom validator
	for _, va := range CustomValidators {
		_ = v.RegisterValidation(va.Tag, va.ValidateFunc)
		_ = v.RegisterTranslation(va.Tag, trans, func(ut ut.Translator) error {
			return ut.Add(va.Tag, va.MessageFormat, true)
		}, va.TranslateFunc)
	}
}
