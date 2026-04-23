package httpserver

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tylerb/graceful"

	"iseeagentc/controller/router"
	"iseeagentc/internal/config"
	"iseeagentc/internal/logger"
)

// Start 在 bootstrap.ServiceInit 与 validator 注册之后调用，启动 Gin HTTP API。
func Start() {
	apiHandler := gin.Default()
	router.Init(apiHandler)

	log.Printf("Starting HTTP server on %s", config.GetString("app.HTTPServer.Listen"))

	server := &graceful.Server{
		Timeout: 10 * time.Second,
		Server: &http.Server{
			Addr:    config.GetString("app.HTTPServer.Listen"),
			Handler: apiHandler,
		},
	}

	if err := server.ListenAndServe(); err != nil {
		log.Printf("HTTP server failed: %v", err)
	}

	log.Println("Shutting down server...")
	if logger.Logger != nil {
		if err := logger.Logger.Sync(); err != nil {
			log.Printf("logger sync failed: %v", err)
		}
	}
	log.Println("Server shutdown complete")
}
