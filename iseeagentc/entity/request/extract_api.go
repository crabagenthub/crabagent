package request

type VideoExtractRequest struct {
	URL string `json:"url" binding:"required,url" msg:"url is empty"`
}

type VideoDownloadRequest struct {
	URL     string `json:"url" binding:"required,url" msg:"url is empty"`
	Quality string `json:"quality,omitempty" msg:"quality is invalid"`
}
