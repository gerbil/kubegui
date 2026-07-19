package main

import (
  _ "embed"
  "kubegui"
  "kubegui/internal/clusterconfigs"
  "kubegui/internal/db"
  "kubegui/internal/local"
  "kubegui/internal/logger"
  "kubegui/services"
  "log"
  "log/slog"
  "net/http"
  "path/filepath"
  "strings"

  "github.com/go-logr/logr"
  "github.com/wailsapp/wails/v3/pkg/application"
  "k8s.io/klog/v2"
)

func init() {
  // Ensure app data directory exists.
  local.Init()

  // Global default logger (used by Wails and by package-level slog calls).
  logger.Init()

  // To disable client-go + k8s internal libraries loggers
  klog.SetLogger(logr.Discard())

  // DB init is required to ensure that the database is properly set up before the application starts.
  // This includes creating necessary tables, establishing connections, and performing any required migrations.
  // If the database initialization fails, the application will log the error and terminate to prevent further issues.
  if err := db.Init(); err != nil {
    log.Fatal(err)
  }
}

// main function serves as the application's entry point. It initializes the application, creates a window,
// and starts a services. It subsequently runs the application and logs any error that might occur.
func main() {
  // Wails application setup.
  // See https://v3.wails.io/reference/application/
  wails := application.New(application.Options{
    Name:     "KubeGUI",
    Icon:     kubegui.Icon,
    Logger:   logger.Logger,
    LogLevel: slog.LevelDebug,
    Services: []application.Service{
      application.NewService(&services.Backend{}),
      application.NewService(&services.CleanUp{}),
    },
    Assets: application.AssetOptions{
      Handler: application.BundledAssetFileServer(kubegui.Assets),
      Middleware: func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {

          if strings.HasPrefix(req.URL.Path, "/local-images/") {
            name := filepath.Base(strings.TrimPrefix(req.URL.Path, "/local-images/"))
            if name == "." || name == "" {
              http.NotFound(rw, req)
              return
            }
            imagePath := filepath.Join(local.AppDataDir, "images", name)
            http.ServeFile(rw, req, imagePath)
            return
          }

          // Wails runtime bug wo
          if req.URL.Path == "/wails/custom.js" {
            rw.Header().Set("Content-Type", "application/javascript; charset=utf-8")
            if req.Method == http.MethodHead {
              rw.WriteHeader(http.StatusNoContent)
              return
            }
            rw.WriteHeader(http.StatusOK)
            _, _ = rw.Write([]byte("/* no-op custom runtime hook */\n"))
            return
          }

          // Pod shell exec WebSocket endpoint
          // xterm-global.js connects to ws://wails.localhost:9245/resource/exec/{ns}/{name}/{cname}
          if strings.HasPrefix(req.URL.Path, "/resource/exec/") {
            services.PodExecHandler(rw, req)
            return
          }

          next.ServeHTTP(rw, req)
        })
      },
    },
    Mac: application.MacOptions{
      ApplicationShouldTerminateAfterLastWindowClosed: true,
    },
    SingleInstance: &application.SingleInstanceOptions{
      UniqueID: "net.kubegui",
    },
  })

  // Creates a new window with the necessary options.
  // 'URL' is the URL that will be loaded into the webview on startup.
  // NOTE: Hidden MUST be false on Windows because WebView2 fails to properly
  // initialize when created in a hidden state, producing the error:
  //   "Focus failed: The parameter is incorrect."
  // which results in a grey window with no visible UI.
  window := wails.Window.NewWithOptions(application.WebviewWindowOptions{
    Hidden:                     false,
    URL:                        "/",
    Title:                      "KubeGUI",
    Name:                       "KubeGUI",
    Frameless:                  true,
    MinWidth:                   1024,
    MinHeight:                  768,
    StartState:                 application.WindowStateMaximised,
    ZoomControlEnabled:         false,
    DisableResize:              false,
    DefaultContextMenuDisabled: true,
    EnableFileDrop:             true,
    BackgroundType:             application.BackgroundTypeTranslucent,
    BackgroundColour:           application.NewRGBA(0, 0, 0, 0),
    Mac: application.MacWindow{
      InvisibleTitleBarHeight: 50,
      Backdrop:                application.MacBackdropTranslucent,
      TitleBar: application.MacTitleBar{
        HideTitle:            true,
        FullSizeContent:      true,
        UseToolbar:           false,
        HideToolbarSeparator: true,
      },
      WindowLevel: application.MacWindowLevelTornOffMenu,
      Appearance:  application.NSAppearanceNameAccessibilityHighContrastDarkAqua,
    },
    OpenInspectorOnStartup: true,
    Windows: application.WindowsWindow{
      BackdropType: application.Acrylic,
    },
  })

  // Initialize config handling and wire window-based events before the run loop.
  clusterconfigs.Init(window)

  // Window is visible immediately so WebView2 initialises correctly on Windows.
  // The React app should render a splash/loading screen while booting.

  // Runs the application (blocks until exit).
  if err := wails.Run(); err != nil {
    log.Fatal(err)
  }
}
