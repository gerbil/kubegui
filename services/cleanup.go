package services

import (
  "fmt"
  idb "kubegui/internal/db"
)

type CleanUp struct{}

func (s *CleanUp) ServiceStartup() error {
  fmt.Println("CleanUpservice started")
  return nil
}

func (s *CleanUp) ServiceShutdown() error {
  fmt.Println("CleanUp Service")

  // Purge all port forwarding configs from DB on exit
  _, err := idb.DeleteAllPodPortforwardingsConfigs()
  //fmt.Print(result)
  if err != nil {
    fmt.Print(err)
    return err
  }

  // Vacuum dbs
  result, err := idb.VacuumAllDBS()
  fmt.Print(result)
  if err != nil {
    fmt.Println(err)
    return err
  }

  return nil
}