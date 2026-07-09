package clusterconfigs

import (
	"kubegui/internal/logger"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// SaveConfigOnDrop registers a file-drop handler on the given window.
func SaveConfigOnDrop(window *application.WebviewWindow) {
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		files := event.Context().DroppedFiles()
		for _, file := range files {
			logger.Logger.Info("Dropped file", "path", file)
			saveClusterConfigFile(window, file, "config-drop", nil)
		}
	})
}
