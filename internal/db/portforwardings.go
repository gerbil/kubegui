package db

import (
	"database/sql"
	appLogger "kubegui/internal/logger"
)

type PodPortforwardingsConfig struct {
	Name       string
	Namespace  string
	Status     string
	RemotePort string
	LocalPort  string
}

// GetPodPortforwardingsConfigs - get all port forwarding configs
func GetPodPortforwardingsConfigs() []PodPortforwardingsConfig {
	rows, err := CDB.Query("SELECT name, namespace, status, remotePort, localPort FROM portforwardings")
	if err != nil {
		appLogger.Logger.Error("query portforwardings failed", "error", err)
		return nil
	}
	defer rows.Close()

	pfs := []PodPortforwardingsConfig{}
	for rows.Next() {
		var pf PodPortforwardingsConfig
		if err := rows.Scan(&pf.Name, &pf.Namespace, &pf.Status, &pf.RemotePort, &pf.LocalPort); err != nil {
			appLogger.Logger.Error("scan portforwarding failed", "error", err)
			return nil
		}
		pfs = append(pfs, pf)
	}
	return pfs
}

// SavePodPortforwardingsConfig - saves specific forwarding config
func SavePodPortforwardingsConfig(name, namespace, status, remotePort, localPort string) (sql.Result, error) {
	result, err := CDB.Exec("INSERT OR IGNORE INTO portforwardings (name, namespace, status, remotePort, localPort) VALUES (?,?,?,?,?)", name, namespace, status, remotePort, localPort)
	if err != nil {
		appLogger.Logger.Error("save portforwarding failed", "name", name, "namespace", namespace, "error", err)
		return nil, err
	}
	return result, nil
}

// UpdatePodPortforwardingsConfig - update specific config
func UpdatePodPortforwardingsConfig(name, namespace, status, remotePort, localPort string) (sql.Result, error) {
	result, err := CDB.Exec("UPDATE portforwardings SET status = ?, remotePort = ?, localPort = ? WHERE name = ? AND namespace = ?", status, remotePort, localPort, name, namespace)
	if err != nil {
		appLogger.Logger.Error("update portforwarding failed", "name", name, "namespace", namespace, "error", err)
		return nil, err
	}
	return result, nil
}

// DeletePodPortforwardingsConfig - delete specific config
func DeletePodPortforwardingsConfig(name string) (sql.Result, error) {
	result, err := CDB.Exec("DELETE FROM portforwardings WHERE name = ?", name)
	if err != nil {
		appLogger.Logger.Error("delete portforwarding failed", "name", name, "error", err)
		return nil, err
	}
	return result, nil
}

// DeleteAllPodPortforwardingsConfigs - delete all configs
func DeleteAllPodPortforwardingsConfigs() (sql.Result, error) {
	result, err := CDB.Exec("DELETE FROM portforwardings")
	if err != nil {
		appLogger.Logger.Error("delete all portforwardings failed", "error", err)
		return nil, err
	}
	return result, nil
}