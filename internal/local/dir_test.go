package local

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitSetsAppDataDirAndCreatesDirectory(t *testing.T) {
	configRoot := filepath.Join(t.TempDir(), "config")
	if err := os.MkdirAll(configRoot, 0o755); err != nil {
		t.Fatalf("failed creating config root %q: %v", configRoot, err)
	}

	// Cover multiple OS resolution paths for os.UserConfigDir.
	t.Setenv("APPDATA", configRoot)
	t.Setenv("XDG_CONFIG_HOME", configRoot)
	t.Setenv("HOME", configRoot)

	AppDataDir = ""
	Init()

	expected := filepath.Join(configRoot, "kubegui")
	if AppDataDir != expected {
		t.Fatalf("AppDataDir mismatch: got %q, want %q", AppDataDir, expected)
	}

	info, err := os.Stat(expected)
	if err != nil {
		t.Fatalf("expected directory %q to exist: %v", expected, err)
	}
	if !info.IsDir() {
		t.Fatalf("expected %q to be a directory", expected)
	}
}