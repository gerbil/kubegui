package db

import (
	"database/sql"
	"fmt"
)

// GetSetting returns a settings value by key.
func GetSetting(name string) (string, error) {
	var value string
	err := CDB.QueryRow("SELECT value FROM settings WHERE name = ? LIMIT 1", name).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("setting %q not found", name)
		}
		return "", err
	}
	return value, nil
}

// UpsertSetting inserts or updates a setting value by key.
func UpsertSetting(name, value string) error {
	_, err := CDB.Exec("INSERT INTO settings(name, value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", name, value)
	return err
}

