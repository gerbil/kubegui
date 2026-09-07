package clusterconfigs

import "github.com/wailsapp/wails/v3/pkg/application"

const defaultClusterIconPath = "ui//cluster.svg"

// Init start required configuration processes
// such as discovering local kubeconfig files and adding them to the database etc
func Init(window *application.WebviewWindow) {
  addDefaultKubeconfig()
  SaveConfigOnDrop(window)
  SaveConfigOnInput(window)
}