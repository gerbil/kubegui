package local

import (
  "fmt"
  "log"
  "os"
  "path/filepath"
  "runtime"
  "strings"
)

// AppDataDir is the resolved kubegui app data path, set by Init().
var AppDataDir string

func CreateAppDir() {
  dir, err := resolveConfigDir()
  if err != nil {
    log.Fatalf("userdata: cannot resolve config directory: %v", err)
  }
  AppDataDir = filepath.Join(dir, "kubegui")
  log.Printf("userdata: app data directory: %s", AppDataDir)
  if err := os.MkdirAll(AppDataDir, os.FileMode(0o775)); err != nil {
    log.Printf("userdata: cannot create app data directory %q: %v", AppDataDir, err)
    fallback := filepath.Join(os.TempDir(), "kubegui")
    if err2 := os.MkdirAll(fallback, os.FileMode(0o775)); err2 != nil {
      log.Fatalf("userdata: fallback directory creation failed %q: %v", fallback, err2)
    }
    AppDataDir = fallback
    log.Printf("userdata: using fallback app data directory: %s", AppDataDir)
  }
}

func resolveConfigDir() (string, error) {
  if runtime.GOOS == "windows" {
    candidates := []string{
      normalizePath(os.Getenv("APPDATA")),
    }
    if profile := normalizePath(os.Getenv("USERPROFILE")); profile != "" {
      candidates = append(candidates, filepath.Join(profile, "AppData", "Roaming"))
    }
    for _, c := range candidates {
      if c == "" {
        continue
      }
      if isExistingDir(c) {
        return c, nil
      }
    }
  }

  if d, err := os.UserConfigDir(); err == nil {
    d = normalizePath(d)
    if d != "" && (runtime.GOOS != "windows" || isExistingDir(d)) {
      return d, nil
    }
  }

  if runtime.GOOS != "windows" {
    if v := normalizePath(os.Getenv("XDG_CONFIG_HOME")); v != "" {
      return v, nil
    }
  }

  home, err := os.UserHomeDir()
  if err != nil {
    return "", fmt.Errorf("cannot determine home directory: %w", err)
  }
  home = normalizePath(home)
  if runtime.GOOS == "windows" {
    fallback := filepath.Join(home, "AppData", "Roaming")
    if isExistingDir(fallback) {
      return fallback, nil
    }
    return "", fmt.Errorf("no valid Windows config directory found (APPDATA/USERPROFILE invalid)")
  }
  return filepath.Join(home, ".config"), nil
}

func normalizePath(p string) string {
  p = strings.TrimSpace(p)
  if p == "" {
    return ""
  }
  return filepath.Clean(p)
}

func isExistingDir(p string) bool {
  st, err := os.Stat(p)
  return err == nil && st.IsDir()
}