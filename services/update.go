package services

import (
	"context"
	"fmt"
	"runtime"

	"kubegui/internal/logger"

	"github.com/creativeprojects/go-selfupdate"
)

// releaseAssetFilters returns regexps matching the release asset names published
// for the current platform. macOS ships a single universal archive.
func releaseAssetFilters() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{`kubegui-macos(-(arm64|amd64|universal))?\.zip$`}
	case "windows":
		return []string{`kubegui-windows[-_](x86_64|amd64)\.zip$`}
	case "linux":
		return []string{`kubegui-linux[-_](amd64|x86_64)\.zip$`}
	default:
		return nil
	}
}

// Update checks GitHub for a newer release and updates the running binary.
// Any failure is logged and returned so that application startup can continue.
func Update(version string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("update check panicked: %v", r)
			logger.Logger.Error("update check panicked", "err", r)
		}
	}()

	updater, err := selfupdate.NewUpdater(selfupdate.Config{
		Filters:       releaseAssetFilters(),
		UniversalArch: "universal",
	})
	if err != nil {
		logger.Logger.Error("could not create updater", "err", err)
		return err
	}

	latest, found, err := updater.DetectLatest(context.Background(), selfupdate.ParseSlug("gerbil/kubegui"))
	if err != nil {
		logger.Logger.Error("error occurred while detecting version", "err", err)
		return err
	}
	if !found || latest == nil {
		logger.Logger.Warn("latest version could not be found in the github repository",
			"os", runtime.GOOS, "arch", runtime.GOARCH)
		return nil
	}

	if latest.LessOrEqual(version) {
		logger.Logger.Info("Current version is the", "latest", version)
		return nil
	}

	logger.Logger.Info("Current version is not the latest, updating to", "version", latest.Version())

	if latest.AssetURL == "" {
		logger.Logger.Warn("no downloadable asset for this platform",
			"os", runtime.GOOS, "arch", runtime.GOARCH, "version", latest.Version())
		return nil
	}

	exe, err := selfupdate.ExecutablePath()
	if err != nil {
		logger.Logger.Error("could not locate executable path", "err", err)
		return err
	}

	if err := selfupdate.UpdateTo(context.Background(), latest.AssetURL, latest.AssetName, exe); err != nil {
		logger.Logger.Error("error occurred while updating binary", "err", err)
		return err
	}

	logger.Logger.Info("Updated", "version", latest.Version())
	return nil
}
