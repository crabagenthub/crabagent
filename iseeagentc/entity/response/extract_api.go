package response

// VideoExtractResponse 视频抽取响应
type VideoExtractResponse struct {
	Title       string            `json:"title"`       // 视频标题
	Description string            `json:"description"` // 视频描述
	Duration    int64             `json:"duration"`    // 视频时长(秒)
	Thumbnail   string            `json:"thumbnail"`   // 缩略图URL
	VideoURL    string            `json:"video_url"`   // 视频直链
	Author      string            `json:"author"`      // 作者
	Platform    string            `json:"platform"`    // 平台名称
	ViewCount   int64             `json:"view_count"`  // 播放量
	LikeCount   int64             `json:"like_count"`  // 点赞数
	Extra       map[string]string `json:"extra"`       // 额外信息
}

// SupportedPlatformsResponse 支持的平台列表响应
type SupportedPlatformsResponse struct {
	Platforms []string `json:"platforms"` // 支持的平台列表
}
