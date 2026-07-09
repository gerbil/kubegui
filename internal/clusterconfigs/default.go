package clusterconfigs

import (
  "kubegui/internal/db"
  appLogger "kubegui/internal/logger"
  "os"
  "path/filepath"

  "k8s.io/client-go/tools/clientcmd"
)

// addDefaultKubeconfig discovers kubeconfig files in the
// local environment and adds their contexts to the database if they don't already exist.
func addDefaultKubeconfig() {
  kubeconfigs := discoverKubeconfigPaths()
  if len(kubeconfigs) == 0 {
    appLogger.Logger.Debug("no local kubeconfig discovered")
    return
  }

  configs, err := db.GetClusterconfigs()
  if err != nil {
    appLogger.Logger.Error("failed to read existing cluster configs", "error", err)
    return
  }

  existingContexts := make(map[string]struct{}, len(configs))
  for _, config := range configs {
    existingContexts[config.Context] = struct{}{}
  }

  for _, kubeconfigPath := range kubeconfigs {
    appLogger.Logger.Info("default kubeconfig discovered", "path", kubeconfigPath)

    rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
    cfg, err := rules.Load()
    if err != nil {
      appLogger.Logger.Warn("failed to load discovered kubeconfig", "path", kubeconfigPath, "error", err)
      continue
    }

    if len(cfg.Contexts) == 0 {
      appLogger.Logger.Warn("discovered kubeconfig has no contexts", "path", kubeconfigPath)
      continue
    }

    fileName := filepath.Base(kubeconfigPath)
    if fileName == "" || fileName == "." {
      fileName = "kubeconfig"
    }

    for ctx := range cfg.Contexts {
      if _, exists := existingContexts[ctx]; exists {
        appLogger.Logger.Debug("default kubeconfig context already exists", "context", ctx, "path", kubeconfigPath)
        continue
      }

        db.AddConfigWithSource(fileName, ctx, ctx, kubeconfigPath, defaultClusterIconPath, 0, db.ConfigSourceAutoDetected)
      existingContexts[ctx] = struct{}{}
      appLogger.Logger.Info("added default kubeconfig context", "context", ctx, "path", kubeconfigPath)
    }
  }
}

// discoverKubeconfigPaths looks for kubeconfig files in the local environment and returns their paths.
func discoverKubeconfigPaths() []string {
  if raw := os.Getenv("KUBECONFIG"); raw != "" {
    var paths []string
    for _, p := range filepath.SplitList(raw) {
      if p == "" {
        continue
      }
      if _, err := os.Stat(p); err == nil {
        paths = append(paths, p)
      }
    }
    if len(paths) > 0 {
      return paths
    }
  }

  homeDir, err := os.UserHomeDir()
  if err != nil || homeDir == "" {
    return nil
  }

  defaultPath := filepath.Join(homeDir, ".kube", "config")
  if _, err := os.Stat(defaultPath); err == nil {
    return []string{defaultPath}
  }

  return nil
}