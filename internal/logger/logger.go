package logger

import (
  "context"
  "fmt"
  "io"
  "log/slog"
  "os"
  "path/filepath"
  "strings"

  "kubegui/internal/local"

  "github.com/lmittmann/tint"
  "gopkg.in/natefinch/lumberjack.v2"
  slogmulti "github.com/samber/slog-multi"
)

var Logger *slog.Logger

type MinimalHandler struct {
  W     io.Writer
  Level slog.Level
}

// Init configures the package-level logger used by the app and by Wails options.
func Init() {
  if local.AppDataDir == "" {
    // fallback to stdout-only logging if userdata.Init was not called
    Logger = slog.New(&MinimalHandler{W: os.Stdout, Level: slog.LevelInfo})
    slog.SetDefault(Logger)
    return
  }

  logFile := filepath.Join(local.AppDataDir, "kubegui.log")
  logWriter := &lumberjack.Logger{Filename: logFile, MaxSize: 10, MaxBackups: 5, MaxAge: 30, Compress: false}

  level := os.Getenv("LOG_LEVEL")
  if level == "" {
    level = "info"
  }

  terminalHandler := tint.NewHandler(os.Stdout, &tint.Options{
    Level:      parseLogLevel(level),
    TimeFormat: "2006-01-02 15:04:05",
  })

  fileHandler := slog.NewTextHandler(logWriter, &slog.HandlerOptions{
    Level: parseLogLevel(level),
  })

  Logger = slog.New(slogmulti.Fanout(terminalHandler, fileHandler))

  slog.SetDefault(Logger)
}

func parseLogLevel(value string) slog.Level {
  switch strings.ToLower(value) {
  case "debug":
    return slog.LevelDebug
  case "warn":
    return slog.LevelWarn
  case "error":
    return slog.LevelError
  default:
    return slog.LevelInfo
  }
}

func (h *MinimalHandler) Enabled(_ context.Context, lvl slog.Level) bool {
  return lvl >= h.Level
}

func (h *MinimalHandler) Handle(_ context.Context, r slog.Record) error {
  var b strings.Builder

  timestamp := r.Time.Format("2006-01-02 15:04:05")
  level := r.Level.String()

  _, _ = fmt.Fprintf(&b, "[%s] %s - %s", timestamp, level, r.Message)

  r.Attrs(func(a slog.Attr) bool {
    _, _ = fmt.Fprintf(&b, " %s=%v", a.Key, a.Value.Any())
    return true
  })

  b.WriteByte('\n')

  _, err := io.WriteString(h.W, b.String())
  return err
}

func (h *MinimalHandler) WithAttrs(_ []slog.Attr) slog.Handler {
  // just write attrs as prefix attributes
  return &MinimalHandler{
    W:     h.W,
    Level: h.Level,
  }
}

func (h *MinimalHandler) WithGroup(_ string) slog.Handler {
  // ignore groups for simplicity
  return h
}