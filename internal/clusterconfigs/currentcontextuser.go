package clusterconfigs

import (
	"kubegui/internal/db"
	appLogger "kubegui/internal/logger"
)

func GetCurrentContextUser() (user string, err error) {
	activeClusterconfig, err := db.GetActiveClusterconfig()
	if err != nil {
		appLogger.Logger.Error("Error getting active config from DB", "err", err)
		return
	}

	user = activeClusterconfig.User
	return
}
