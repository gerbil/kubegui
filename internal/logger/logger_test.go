package logger

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

  "kubegui/internal/local"
)

func TestInitConfiguresLoggerAndWritesToLogFile(t *testing.T) {
	baseTemp, err := os.MkdirTemp("", "kubegui-logger-test-")
	if err != nil {
		t.Fatalf("failed creating temp dir: %v", err)
	}
	configRoot := filepath.Join(baseTemp, "config")

	// Cover multiple OS resolution paths for os.UserConfigDir.
	t.Setenv("APPDATA", configRoot)
	t.Setenv("XDG_CONFIG_HOME", configRoot)
	t.Setenv("HOME", configRoot)

	local.AppDataDir = ""
	local.Init()

	Logger = nil
	Init()

	if Logger == nil {
		t.Fatal("expected Logger to be initialized")
	}
	if slog.Default() != Logger {
		t.Fatal("expected logger.Init to set slog default logger")
	}

	const msg = "logger-init-test-message"
	Logger.Info(msg)

	logPath := filepath.Join(local.AppDataDir, "kubegui.log")
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("expected log file %q to be readable: %v", logPath, err)
	}
	if !strings.Contains(string(data), msg) {
		t.Fatalf("expected log file to contain message %q", msg)
	}
}