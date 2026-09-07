package services

import (
  "context"
  "kubegui/internal/app"
  idb "kubegui/internal/db"

  "github.com/wailsapp/wails/v3/pkg/application"

  "kubegui/internal/logger"
)

type Helper struct{}

func (s *Helper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
  logger.Logger.Info("Application update check")

  version, err := app.ReadConfigFile()
  if err != nil {
    logger.Logger.Error("read config file", "err", err)
    return err
  }

  logger.Logger.Info("Current", "version", version)

  // An update check failure must never prevent the application from starting.
  if err := Update("v" + version); err != nil {
    logger.Logger.Warn("application update check failed", "err", err)
  }

  return nil
}

func (s *Helper) ServiceShutdown() error {
  logger.Logger.Info("CleanUp Service")

  // Purge all port forwarding configs from DB on exit
  _, err := idb.DeleteAllPodPortforwardingsConfigs()
  //fmt.Print(result)
  if err != nil {
    logger.Logger.Error(err.Error())
    return err
  }

  // Vacuum dbs
  _, err = idb.VacuumAllDBS()
  logger.Logger.Info("DB vacuum done")
  if err != nil {
    logger.Logger.Error(err.Error())
    return err
  }

  return nil
}