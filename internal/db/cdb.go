package db

import (
	appLogger "kubegui/internal/logger"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
)

type Clusterconfig struct {
	ContextName string
	FileName    string
	Context     string
	ConfigPath  string
	ImagePath   string
	Active      int
	Source      string
	User        string
}

const (
	ConfigSourceManual       = "manual"
	ConfigSourceAutoDetected = "auto-detected"
)

// GetClusterconfigs safely with mutex locking
func GetClusterconfigs() (clusterconfigs []Clusterconfig, err error) {
	rows, err := CDB.Query("SELECT filename, contextname, context, configpath, imagepath, active, source FROM clusterconfigs ORDER BY sort")
	if err != nil {
		appLogger.Logger.Error("get clusterconfigs query failed", "error", err)
		return
	}
	defer rows.Close()
	clusterconfigs = []Clusterconfig{} // Slice to store configs
	var clusterconfig Clusterconfig
	for rows.Next() {
		err = rows.Scan(&clusterconfig.FileName, &clusterconfig.ContextName, &clusterconfig.Context, &clusterconfig.ConfigPath, &clusterconfig.ImagePath, &clusterconfig.Active, &clusterconfig.Source)
		if err != nil {
			appLogger.Logger.Error("scan clusterconfig failed", "error", err)
			return
		}
		clusterconfig.User = resolveClusterUser(clusterconfig.ConfigPath, clusterconfig.Context)
		clusterconfigs = append(clusterconfigs, clusterconfig)
	}
	return
}

func resolveClusterUser(configPath, contextName string) string {
	if strings.TrimSpace(configPath) == "" || strings.TrimSpace(contextName) == "" {
		return ""
	}

	rawCfg, err := clientcmd.LoadFromFile(configPath)
	if err != nil {
		return ""
	}
	ctx := rawCfg.Contexts[contextName]
	if ctx == nil {
		if strings.Contains(contextName, "@") {
			parts := strings.SplitN(contextName, "@", 2)
			return strings.TrimSpace(parts[0])
		}
		return ""
	}
	user := strings.TrimSpace(ctx.AuthInfo)
	if user != "" {
		return user
	}
	if strings.Contains(contextName, "@") {
		parts := strings.SplitN(contextName, "@", 2)
		return strings.TrimSpace(parts[0])
	}
	return ""
}

// GetClusterconfig get a single Clusterconfig from the database
// based on contextName and context
func GetClusterconfigByContext(context, fileName string) Clusterconfig {
	clusterconfig := Clusterconfig{}
	row := CDB.QueryRow("SELECT filename, contextname, context, configpath, imagepath, active, source FROM clusterconfigs WHERE context = ? AND fileName = ? LIMIT 1", context, fileName)
	err := row.Scan(&clusterconfig.FileName, &clusterconfig.ContextName, &clusterconfig.Context, &clusterconfig.ConfigPath, &clusterconfig.ImagePath, &clusterconfig.Active, &clusterconfig.Source)
	if err != nil {
		appLogger.Logger.Error("get clusterconfig scan failed", "context", context, "filename", fileName, "error", err)
		return Clusterconfig{}
	}
	err = row.Err()
	if err != nil {
		appLogger.Logger.Error("get clusterconfig row error", "context", context, "filename", fileName, "error", err)
		return Clusterconfig{}
	}
	clusterconfig.User = resolveClusterUser(clusterconfig.ConfigPath, clusterconfig.Context)

	return clusterconfig
}

// GetActiveClusterconfig get a single Clusterconfig from the database
func GetActiveClusterconfig() (clusterconfig Clusterconfig, err error) {
	clusterconfig = Clusterconfig{}
	row := CDB.QueryRow("SELECT filename, contextname, context, configpath, imagepath, active, source FROM clusterconfigs WHERE active = 1 LIMIT 1")
	err = row.Scan(&clusterconfig.FileName, &clusterconfig.ContextName, &clusterconfig.Context, &clusterconfig.ConfigPath, &clusterconfig.ImagePath, &clusterconfig.Active, &clusterconfig.Source)
	if err == nil {
		clusterconfig.User = resolveClusterUser(clusterconfig.ConfigPath, clusterconfig.Context)
	}
	return
}

// AddConfig adds a new config to the database
func AddConfig(fileName, contextName, context, configPath, imagePath string, active int) {
	AddConfigWithSource(fileName, contextName, context, configPath, imagePath, active, ConfigSourceManual)
}

// AddConfigWithSource adds a new config to the database with an explicit source marker.
func AddConfigWithSource(fileName, contextName, context, configPath, imagePath string, active int, source string) {
	if strings.TrimSpace(source) == "" {
		source = ConfigSourceManual
	}
	_, err := CDB.Exec("INSERT OR IGNORE INTO clusterconfigs (filename, contextname, context, configpath, imagepath, active, source) VALUES (?,?,?,?,?,?,?)", fileName, contextName, context, configPath, imagePath, active, source)
	if err != nil {
		appLogger.Logger.Error("add config failed", "filename", fileName, "context", context, "source", source, "error", err)
	}
}

// UpdateConfig changes config in the database
func UpdateConfig(fileName, contextName, context, configPath, imagePath string, active int) {
	_, err := CDB.Exec("UPDATE clusterconfigs SET contextname = ?, configpath = ?, imagepath = ?, active = ? WHERE filename = ? AND context = ?", contextName, configPath, imagePath, active, fileName, context)
	if err != nil {
		appLogger.Logger.Error("update config failed", "filename", fileName, "context", context, "error", err)
	}
}

// RenameConfig changes config contextName in the database
func RenameConfig(oldName, newName, context, fileName string) {
	_, err := CDB.Exec("UPDATE clusterconfigs SET contextname = ? WHERE contextname = ? AND context = ? AND filename = ?", newName, oldName, context, fileName)
	if err != nil {
		appLogger.Logger.Error("rename config failed", "oldName", oldName, "newName", newName, "context", context, "filename", fileName, "error", err)
	}
}

// ReorderConfig changes config contextName in the database
func ReorderConfigs(configs []interface{}) {
	// get new order
	for i, v := range configs {
		i++ // Convert index to 1-based index
		// update order
		// parts[0] - filename
		// parts[1] - context
		data := strings.Replace(v.(string), "'", "", -1)
		parts := strings.Split(data, "|")
		_, err := CDB.Exec("UPDATE clusterconfigs SET sort = ? WHERE filename = ? AND context = ?", i, parts[0], parts[1])
		if err != nil {
			appLogger.Logger.Error("reorder config failed", "index", i, "value", v, "error", err)
		}
	}
}

// UpdateImagePath changes config contextName in the database
func UpdateImagePath(filename, context, newImagePath string) {
	_, err := CDB.Exec("UPDATE clusterconfigs SET imagepath = ? WHERE context = ? AND filename = ?", newImagePath, context, filename)
	if err != nil {
		appLogger.Logger.Error("update image path failed", "filename", filename, "context", context, "error", err)
	}
}

func ResetActiveConfig() {
	// Reset current active cluster
	_, err := CDB.Exec("UPDATE clusterconfigs SET active = 0")
	if err != nil {
		appLogger.Logger.Error("reset active config failed", "error", err)
	}
}

// ConnectConfig makes active provided config in the database
func ConnectConfig(context, filename string) {
	appLogger.Logger.Info("ConnectConfig DB", "context", context, "filename", filename)
	// Reset current active cluster
	ResetActiveConfig()
	// Set new active cluster by contextName
	_, err := CDB.Exec("UPDATE clusterconfigs SET active = 1 WHERE context = ? AND filename = ?", context, filename)
	if err != nil {
		appLogger.Logger.Error("connect config failed", "context", context, "filename", filename, "error", err)
	}
}

// DeleteConfig deletes a config from the database
func DeleteConfig(context, filename string) {
	_, err := CDB.Exec("DELETE FROM clusterconfigs WHERE context = ? AND filename = ?", context, filename)
	if err != nil {
		appLogger.Logger.Error("delete config failed", "context", context, "filename", filename, "error", err)
	}
}

// UpdateContext changes config context in the database to provided
func UpdateContext(filename, contextName, contextOld, contextNew string) {
	_, err := CDB.Exec("UPDATE clusterconfigs SET context = ? WHERE filename = ? AND context = ? AND contextname = ?", contextNew, filename, contextOld, contextName)
	if err != nil {
		appLogger.Logger.Error("update context failed", "filename", filename, "contextOld", contextOld, "contextNew", contextNew, "error", err)
	}
}