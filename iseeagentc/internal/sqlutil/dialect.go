package sqlutil

import (
	"database/sql"
	"fmt"
	"strings"

	sqlite3 "github.com/mattn/go-sqlite3"
)

// IsSQLite 判断 database/sql 是否由 go-sqlite3 驱动打开。
func IsSQLite(db *sql.DB) bool {
	if db == nil {
		return false
	}
	_, ok := db.Driver().(*sqlite3.SQLiteDriver)
	return ok
}

// RebindQuestionMarksToDollar 将 SQL 中占位符 ? 依次替换为 $1、$2…（忽略单引号字符串内的 ?）。
func RebindQuestionMarksToDollar(q string) string {
	var b strings.Builder
	b.Grow(len(q) + 8)
	inSingle := false
	n := 1
	for i := 0; i < len(q); i++ {
		c := q[i]
		if c == '\'' {
			if inSingle && i+1 < len(q) && q[i+1] == '\'' {
				b.WriteByte('\'')
				b.WriteByte('\'')
				i++
				continue
			}
			inSingle = !inSingle
			b.WriteByte(c)
			continue
		}
		if c == '?' && !inSingle {
			fmt.Fprintf(&b, "$%d", n)
			n++
			continue
		}
		b.WriteByte(c)
	}
	return b.String()
}

// RebindIfPostgres 在非 SQLite 驱动下将 ? 转为 PostgreSQL 风格占位符；SQLite 下原样返回。
func RebindIfPostgres(db *sql.DB, q string) string {
	if IsSQLite(db) {
		return q
	}
	return RebindQuestionMarksToDollar(q)
}
