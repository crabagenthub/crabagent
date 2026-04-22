package model

import (
	"time"

	"github.com/gin-gonic/gin"

	"iseeagentc/internal/errors"

	"iseeagentc/internal/resource"
)

/*
Author : lucbine
DateTime : 2024/4/20
Description : 用户model
*/

const (
	UserTableName       = "user"
	UserStatusNormal    = 0 // 正常
	userStatusBlackList = 1 // 黑名单
	userStatusDeleted   = 2 // 删除
)

type User struct {
	ID         uint64       `gorm:"primaryKey;column:id"`
	UUID       string       `gorm:"column:uuid"`
	UserName   string       `gorm:"column:user_name"`
	Password   string       `gorm:"column:password"`
	Phone      string       `gorm:"column:phone"`
	Email      string       `gorm:"column:email"`
	Status     int8         `gorm:"column:status"`
	URCStatus  int8         `gorm:"column:urc_status"`
	UECStatus  int8         `gorm:"column:uec_status"`
	CreateTime time.Time    `gorm:"column:create_time"`
	UpdateTime time.Time    `gorm:"column:update_time"`
	Ctx        *gin.Context `gorm:"-"`
}

type UserFilterOptions struct {
	ID         uint64
	UUID       string
	UserName   string
	Phone      string
	Email      string
	Status     int8
	URCStatus  int8
	UECStatus  int8
	CreateTime time.Time
	UpdateTime time.Time
}

func NewUser(ctx *gin.Context) *User {
	return &User{
		Ctx: ctx,
	}
}

func (*User) TableName() string {
	return UserTableName
}

func (u *User) GetList() ([]*User, error) {
	return nil, nil
}

func (u *User) GetByID(ID uint64) (*User, error) {
	if resource.DB == nil {
		return nil, errors.FormatError("Common/DBError", "database not initialized")
	}
	var user = &User{}
	db := resource.DB.WithContext(u.Ctx).Table(u.TableName()).Where("id = ?", ID)
	if err := db.First(&user).Error; err != nil {
		return nil, errors.FormatModelError(err)
	}
	return user, nil
}

func (u *User) GetNormalUserByPhone(phone string) (*User, error) {
	if resource.DB == nil {
		return nil, errors.FormatError("Common/DBError", "database not initialized")
	}
	var user = &User{}
	db := resource.DB.WithContext(u.Ctx).Table(u.TableName()).Where("phone = ?", phone)
	db = db.Where("status = ?", UserStatusNormal)
	if err := db.First(&user).Error; err != nil {
		return nil, errors.FormatModelError(err)
	}
	return user, nil
}

func (u *User) Create(user User) (uint64, error) {
	if resource.DB == nil {
		return 0, errors.FormatError("Common/DBError", "database not initialized")
	}
	if err := resource.DB.Create(&user).Error; err != nil {
		return 0, errors.FormatModelError(err)
	}
	return user.ID, nil
}

func (u *User) Update() {

}

func (u *User) Delete() {

}
