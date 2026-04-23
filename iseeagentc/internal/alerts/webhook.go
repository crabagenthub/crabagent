package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// PostJSON posts JSON to webhook URL with timeout.
func PostJSON(ctx context.Context, url string, payload map[string]interface{}) error {
	if url == "" || (!strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://")) {
		return fmt.Errorf("invalid or empty webhook URL")
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	cli := &http.Client{Timeout: 12 * time.Second}
	resp, err := cli.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 65536))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook HTTP %d: %s", resp.StatusCode, truncateErrBody(body))
	}
	// 飞书 / 钉钉 等常对错误请求仍返回 HTTP 2xx，在 JSON 中携带 code / errcode。
	if perr := parseWebhookAPIError(body); perr != nil {
		return perr
	}
	return nil
}

func truncateErrBody(b []byte) string {
	s := string(b)
	if len(s) > 500 {
		return s[:500] + "…"
	}
	return s
}

// parseWebhookAPIError 若响应体为 JSON 且显式表示失败，则返回错误；否则 nil。
func parseWebhookAPIError(body []byte) error {
	if len(bytes.TrimSpace(body)) == 0 {
		return nil
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(body, &top); err != nil {
		return nil
	}
	// 飞书 open-apis/bot: "code" 0 表成功
	if raw, ok := top["code"]; ok {
		var code float64
		if err := json.Unmarshal(raw, &code); err == nil && code != 0 {
			msg := stringFromJSONRaw(top["msg"])
			if msg == "" {
				msg = stringFromJSONRaw(top["message"])
			}
			if msg == "" {
				msg = string(body)
			}
			return fmt.Errorf("webhook API code %.0f: %s", code, msg)
		}
	}
	// 钉钉机器人: "errcode" 0 表成功
	if raw, ok := top["errcode"]; ok {
		var code float64
		if err := json.Unmarshal(raw, &code); err == nil && code != 0 {
			msg := stringFromJSONRaw(top["errmsg"])
			if msg == "" {
				msg = string(body)
			}
			return fmt.Errorf("webhook errcode %.0f: %s", code, msg)
		}
	}
	return nil
}

func stringFromJSONRaw(r json.RawMessage) string {
	if len(r) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(r, &s); err == nil {
		return s
	}
	return ""
}
