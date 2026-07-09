package app

import (
	"encoding/json"
	"io/fs"
	"kubegui/build"
	"kubegui/internal/logger"
)

// ReadConfigFile reads enbedded `build/info.json` file and returns product version
func ReadConfigFile() (version string, err error) {
	// Let's first read the `info.json` file
	build := &build.Info
	info, err := fs.ReadFile(build, "info.json")
	if err != nil {
		logger.Logger.Error("Error when opening file", "err", err)
		return
	}

	var m map[string]interface{}
	json.Unmarshal(info, &m)

	if info, ok := m["info"].(map[string]any); ok {
		if entry, ok := info["0000"].(map[string]any); ok {
			if v, ok := entry["ProductVersion"].(string); ok {
				version = v
			}
		}
	}

	return
}
