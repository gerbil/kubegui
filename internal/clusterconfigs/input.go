package clusterconfigs

import (
	"fmt"
	"kubegui/internal/db"
	"kubegui/internal/logger"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"k8s.io/client-go/tools/clientcmd"
)

func saveClusterConfigFile(window *application.WebviewWindow, path, source string, eventData any) {
	fileName := filepath.Base(path)

	_, err := clientcmd.BuildConfigFromFlags("", path)
	if err != nil {
		message := "Not valid kubeconfig (" + fileName + ")!"
		status := "error"
		notificationJS := fmt.Sprintf("notification('%s', '%s')", status, message)
		window.ExecJS(notificationJS)
		return
	}

	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: path}
	cfg, err := rules.Load()
	if err != nil {
		message := "Unable to load kubeconfig (" + fileName + ")!"
		status := "error"
		notificationJS := fmt.Sprintf("notification('%s', '%s')", status, message)
		window.ExecJS(notificationJS)
		return
	}

	if len(cfg.Contexts) == 0 {
		message := "Kubeconfig contains no contexts (" + fileName + ")!"
		status := "error"
		notificationJS := fmt.Sprintf("notification('%s', '%s')", status, message)
		window.ExecJS(notificationJS)
		return
	}

	for ctx := range cfg.Contexts {
		logger.Logger.Info("discovered kubeconfig context", "context", ctx)
		logger.Logger.Info("Add cluster", "cluster name", fileName, "context", ctx)
		db.AddConfig(fileName, ctx, ctx, path, "ui//cluster.svg", 0)
	}

	message := "Cluster config added!"
	status := "success"
	notificationJS := fmt.Sprintf("notification('%s', '%s')", status, message)
	window.ExecJS(notificationJS)

	application.Get().Event.Emit("clusterConfigsChanged", map[string]any{
		"source": source,
		"data":   eventData,
	})
}

func SaveConfigOnInput(window *application.WebviewWindow) {
	application.Get().Event.On("addClusterConfig", func(e *application.CustomEvent) {
		result, _ := application.Get().Dialog.OpenFile().CanChooseFiles(true).PromptForSingleSelection()

		if result != "" {
			saveClusterConfigFile(window, result, "config-input", e.Data)

			if e.Data == "init" {
				window.SetURL("/init")
			}
		}
	})
}
