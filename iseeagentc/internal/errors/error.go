package errors

import (
	"fmt"
	"io"
)

type Error struct {
	Code       string
	Message    string
	ChMessage  string
	HTTPStatus int
}

type NotFoundError struct {
	Code       string
	Message    string
	ChMessage  string
	HTTPStatus int
}

func IsNotFound(err error) bool {
	switch err.(type) {
	case *NotFoundError:
		return true
	default:
		return false
	}
}

func (e *Error) Error() string {
	return fmt.Sprintf("code: %s, message: %s", e.Code, e.Message)
}

func (e *Error) Format(s fmt.State, verb rune) {
	switch verb {
	case 'v':
		if s.Flag('+') {
			io.WriteString(s, e.Error())
			return
		}
		fallthrough
	case 's':
		io.WriteString(s, e.Error())
	case 'q':
		fmt.Fprintf(s, "%q", e.Error())
	}
}

func (e *NotFoundError) Error() string {
	if e.ChMessage != "" {
		return e.ChMessage
	}
	return e.Message
}

type NotAuthError struct {
	Code       string
	Message    string
	ChMessage  string
	HTTPStatus int
}

func (e *NotAuthError) Error() string {
	if e.ChMessage != "" {
		return e.ChMessage
	}
	return e.Message
}
