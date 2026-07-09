package db

import (
	"database/sql"
	appLogger "kubegui/internal/logger"
)

// Vacuum all dbs
func VacuumAllDBS() (sql.Result, error) {
	result, err := MDB.Exec("VACUUM;")
	if err != nil {
		appLogger.Logger.Error("vacuum MDB failed", "error", err)
		return nil, err
	}

	result, err = EDB.Exec("VACUUM;")
	if err != nil {
		appLogger.Logger.Error("vacuum EDB failed", "error", err)
		return nil, err
	}

	return result, nil
}
