package auth

import (
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"iseeagentc/internal/config"
	"iseeagentc/internal/errors"
)

/*
   Author : lucbine
   DateTime : 2024/4/26
   Description : jwt 认证
*/

type MyCustomClaims struct {
	UserID uint64 `json:"userID"`
	Email  string `json:"email"`
	Phone  string `json:"phone"`
	jwt.RegisteredClaims
}

// GenToken 生成token
func GenToken(ID uint64, email, phone string) (string, string, error) {
	aToken, err := GenAccessToken(ID, email, phone)
	if err != nil {
		return aToken, "", err
	}
	rToken, err := GenRefreshToken()
	if err != nil {
		return aToken, rToken, err
	}

	return aToken, rToken, nil
}

// GenAccessToken 生成 access token
func GenAccessToken(ID uint64, email, phone string) (string, error) {
	expireTime := time.Duration(config.JwtATokenExpire()) * time.Minute
	claims := MyCustomClaims{
		ID,
		email,
		phone,
		jwt.RegisteredClaims{
			// A usual scenario is to set the expiration time relative to the current time
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expireTime)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    config.AppName(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(config.SigningKey())
}

func GenRefreshToken() (string, error) {
	claims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().AddDate(0, 0, config.JwtRTokenExpire())),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		NotBefore: jwt.NewNumericDate(time.Now()),
		Issuer:    config.AppName(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(config.SigningKey())
}

// ValidAccessToken 验证access token
func ValidAccessToken(tokenStr string) (*MyCustomClaims, error) {
	var myc = new(MyCustomClaims)
	tokenStr = strings.Replace(tokenStr, "Bearer ", "", 1)
	// token 校验
	token, err := jwt.ParseWithClaims(tokenStr, myc, func(token *jwt.Token) (interface{}, error) {
		return config.SigningKey(), nil
	})

	if err != nil {
		return myc, err
	}

	if !token.Valid {
		return nil, errors.AuthFail("invalid or expired token")
	}

	return myc, nil
}

// ValidRefreshToken 验证refresh token

func ValidRefreshToken(tokenStr string) error {
	tokenStr = strings.Replace(tokenStr, "Bearer ", "", 1)
	// token 校验
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		return config.SigningKey(), nil
	})
	// refresh token  校验
	if err != nil {
		return errors.AuthFail(err.Error())
	}
	if !token.Valid {
		return errors.AuthFail("invalid or expired token")
	}
	return nil
}

// RefreshToken 刷新 token
func RefreshToken(aToken, rToken string) (newAToken, newRToken string, err error) {
	// refresh token 无效直接返回
	if err = ValidRefreshToken(rToken); err != nil {
		return
	}

	//从 旧 access token 中解析出自定义数据
	claim, err := ValidAccessToken(aToken)

	if errors.Is(err, jwt.ErrTokenExpired) {

	}

	if err == nil || errors.Is(err, jwt.ErrTokenExpired) {
		return GenToken(claim.UserID, claim.Email, claim.Phone)
	}
	return
}
