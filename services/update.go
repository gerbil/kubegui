package services

import (
	"context"
	"runtime"

	"kubegui/internal/logger"

	"github.com/creativeprojects/go-selfupdate"
)

func Update(version string) {
	latest, found, err := selfupdate.DetectLatest(context.Background(), selfupdate.ParseSlug("gerbil/kubegui"))
	if err != nil {
		logger.Logger.Error("error occurred while detecting version: %w", err)
	}
	if !found {
		logger.Logger.Error("latest version for %s/%s could not be found from github repository", runtime.GOOS, runtime.GOARCH)
	}

	if latest.LessOrEqual(version) {
		logger.Logger.Info("Current version is the", "latest", version)
	} else {
		logger.Logger.Info("Current version is not the latest, updating to", "version", latest.Version())
	}

	exe, err := selfupdate.ExecutablePath()
	if err != nil {
		logger.Logger.Error("could not locate executable path")
	}
	if err := selfupdate.UpdateTo(context.Background(), latest.AssetURL, latest.AssetName, exe); err != nil {
		logger.Logger.Error("error occurred while updating binary: %w", err)
	}

	return
}
