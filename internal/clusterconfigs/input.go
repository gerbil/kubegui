package clusterconfigs

import (
	"encoding/json"
	"fmt"
	"kubegui/internal/db"
	"kubegui/internal/logger"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"k8s.io/client-go/tools/clientcmd"
)

func jsString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func notify(window *application.WebviewWindow, status, message string) {
	window.ExecJS(fmt.Sprintf("notification(%s, %s)", jsString(status), jsString(message)))
}

func saveClusterConfigFile(window *application.WebviewWindow, path, source string, eventData any) {
	fileName := filepath.Base(path)

	_, err := clientcmd.BuildConfigFromFlags("", path)
	if err != nil {
		notify(window, "error", "Not valid kubeconfig ("+fileName+")!")
		return
	}

	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: path}
	cfg, err := rules.Load()
	if err != nil {
		notify(window, "error", "Unable to load kubeconfig ("+fileName+")!")
		return
	}

	if len(cfg.Contexts) == 0 {
		notify(window, "error", "Kubeconfig contains no contexts ("+fileName+")!")
		return
	}

	for ctx := range cfg.Contexts {
		logger.Logger.Info("discovered kubeconfig context", "context", ctx)
		logger.Logger.Info("Add cluster", "cluster name", fileName, "context", ctx)
		db.AddConfig(fileName, ctx, ctx, path, "ui//cluster.svg", 0)
	}

	notify(window, "success", "Cluster config added!")

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
