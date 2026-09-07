package db

import (
	"os"
	"path/filepath"
	"testing"

	"kubegui/internal/local"
	"kubegui/internal/logger"
)

func init() {
	// Initialize logger for tests to avoid nil pointer panics
	logger.Init()
}

func closeDBs() {
	// Close DB connections to allow file cleanup
	if CDB != nil {
		CDB.Close()
		CDB = nil
	}
	if MDB != nil {
		MDB.Close()
		MDB = nil
	}
	if EDB != nil {
		EDB.Close()
		EDB = nil
	}
}

func TestInitErrorEmptyAppDataDir(t *testing.T) {
	// Save original
	orig := local.AppDataDir
	defer func() { local.AppDataDir = orig }()

	// Test: Init should fail if AppDataDir is empty
	local.AppDataDir = ""
	err := Init()
	if err == nil {
		t.Error("Init() should fail when AppDataDir is empty")
	}
}

func TestInitCreatesDBFiles(t *testing.T) {
	defer closeDBs()

	// Setup: create temp dir for test data
	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	// Test: Init should succeed
	err := Init()
	if err != nil {
		t.Fatalf("Init() failed: %v", err)
	}

	// Verify: database files exist (at least CDB and MDB)
	cdbPath := filepath.Join(tmpDir, "kubegui.db")
	metricsPath := filepath.Join(tmpDir, "metrics.db")

	if _, err := os.Stat(cdbPath); os.IsNotExist(err) {
		t.Errorf("kubegui.db not created at %s", cdbPath)
	}
	if _, err := os.Stat(metricsPath); os.IsNotExist(err) {
		t.Errorf("metrics.db not created at %s", metricsPath)
	}

	// Verify: DB handles are created
	if CDB == nil {
		t.Error("CDB is nil after Init")
	}
	if MDB == nil {
		t.Error("MDB is nil after Init")
	}
	if EDB == nil {
		t.Error("EDB is nil after Init")
	}
}

func TestVacuumAllDBSSuccess(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// Test: VacuumAllDBS should not error
	_, err := VacuumAllDBS()
	if err != nil {
		t.Fatalf("VacuumAllDBS() failed: %v", err)
	}
}

func TestClusterconfigAddAndGet(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// Test: AddConfig should succeed
	AddConfig("test.kubeconfig", "test-context", "test-cluster", "/path/to/config", "/path/to/image", 0)

	// Test: GetClusterconfigs should return the added config
	configs, err := GetClusterconfigs()
	if err != nil {
		t.Fatalf("GetClusterconfigs() failed: %v", err)
	}
	if len(configs) == 0 {
		t.Error("Expected at least one config after AddConfig")
	}

	found := false
	for _, cfg := range configs {
		if cfg.FileName == "test.kubeconfig" {
			found = true
			if cfg.ContextName != "test-context" {
				t.Errorf("Expected context 'test-context', got '%s'", cfg.ContextName)
			}
			break
		}
	}
	if !found {
		t.Error("Added config not found in GetClusterconfigs")
	}
}

func TestClusterconfigSameFilenameMultipleContexts(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	AddConfig("multi.kubeconfig", "context-a", "cluster-a", "/path/to/config", "/path/to/image-a", 0)
	AddConfig("multi.kubeconfig", "context-b", "cluster-b", "/path/to/config", "/path/to/image-b", 0)

	configs, err := GetClusterconfigs()
	if err != nil {
		t.Fatalf("GetClusterconfigs() failed: %v", err)
	}

	count := 0
	for _, cfg := range configs {
		if cfg.FileName == "multi.kubeconfig" {
			count++
		}
	}

	if count != 2 {
		t.Fatalf("Expected 2 configs for the same filename, got %d", count)
	}

	seenA, seenB := false, false
	for _, cfg := range configs {
		if cfg.FileName != "multi.kubeconfig" {
			continue
		}
		if cfg.Context == "cluster-a" && cfg.ContextName == "context-a" {
			seenA = true
		}
		if cfg.Context == "cluster-b" && cfg.ContextName == "context-b" {
			seenB = true
		}
	}

	if !seenA || !seenB {
		t.Fatalf("Expected both context-a and context-b rows for the same filename, got seenA=%v seenB=%v", seenA, seenB)
	}
}

func TestConnectConfigActive(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// Test: AddConfig and ConnectConfig
	AddConfig("cluster1.kubeconfig", "context1", "cluster1", "/path1", "/image1", 0)
	ConnectConfig("cluster1", "cluster1.kubeconfig")

	// Test: GetActiveClusterconfig should return the connected config
	active, err := GetActiveClusterconfig()
	if err != nil {
		t.Fatalf("GetActiveClusterconfig() failed: %v", err)
	}
	if active.FileName == "" {
		t.Error("Expected active config but got empty")
	}
	if active.Active != 1 {
		t.Errorf("Expected active=1, got %d", active.Active)
	}
}

func TestDeleteConfig(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// Test: AddConfig
	AddConfig("todelete.kubeconfig", "del-context", "del-cluster", "/path", "/image", 0)

	// Verify it exists
	configs, err := GetClusterconfigs()
	if err != nil {
		t.Fatalf("GetClusterconfigs() failed: %v", err)
	}
	if len(configs) == 0 {
		t.Fatal("Config was not added")
	}

	// Test: DeleteConfig
	DeleteConfig("del-cluster", "todelete.kubeconfig")

	// Verify it's deleted
	configs, err = GetClusterconfigs()
	if err != nil {
		t.Fatalf("GetClusterconfigs() failed after delete: %v", err)
	}
	for _, cfg := range configs {
		if cfg.FileName == "todelete.kubeconfig" {
			t.Error("Config should have been deleted but still exists")
		}
	}
}

func TestPortforwardingSave(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// Test: SavePodPortforwardingsConfig should execute without panic
	// (schema may not have table, but function should handle it gracefully)
	_, _ = SavePodPortforwardingsConfig("test-pod", "default", "active", "8080", "9090")

	// Test: GetPodPortforwardingsConfigs should not crash
	configs := GetPodPortforwardingsConfigs()
	if configs == nil {
		t.Error("GetPodPortforwardingsConfigs() returned nil")
	}
}

func TestInitRecoversDirtyMDBMigration(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	if MDB == nil {
		t.Fatal("MDB is nil after initial Init")
	}

	if _, err := MDB.Exec(`UPDATE schema_migrations SET dirty = true`); err != nil {
		t.Fatalf("marking MDB migration dirty failed: %v", err)
	}
	closeDBs()

	if err := Init(); err != nil {
		t.Fatalf("Init should recover dirty MDB migration: %v", err)
	}

	if MDB == nil {
		t.Fatal("MDB is nil after recovery Init")
	}

	var dirty bool
	if err := MDB.QueryRow(`SELECT dirty FROM schema_migrations LIMIT 1`).Scan(&dirty); err != nil {
		t.Fatalf("querying schema_migrations dirty flag failed: %v", err)
	}
	if dirty {
		t.Fatal("expected dirty migration flag to be cleared")
	}
}

func TestGetClusterconfigByContext(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	AddConfig("sample.kubeconfig", "sample-context", "sample-cluster", "/tmp/config", "/tmp/image", 1)

	cfg := GetClusterconfigByContext("sample-cluster", "sample.kubeconfig")
	if cfg.FileName != "sample.kubeconfig" {
		t.Fatalf("unexpected filename: got %q", cfg.FileName)
	}
	if cfg.ContextName != "sample-context" {
		t.Fatalf("unexpected contextName: got %q", cfg.ContextName)
	}
	if cfg.Context != "sample-cluster" {
		t.Fatalf("unexpected context: got %q", cfg.Context)
	}
	if cfg.ConfigPath != "/tmp/config" {
		t.Fatalf("unexpected configPath: got %q", cfg.ConfigPath)
	}
	if cfg.ImagePath != "/tmp/image" {
		t.Fatalf("unexpected imagePath: got %q", cfg.ImagePath)
	}
	if cfg.Active != 1 {
		t.Fatalf("unexpected active flag: got %d", cfg.Active)
	}
}

func TestUpdateConfig(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	AddConfig("update.kubeconfig", "old-name", "cluster-a", "/old/config", "/old/image", 0)
	UpdateConfig("update.kubeconfig", "new-name", "cluster-a", "/new/config", "/new/image", 1)

	cfg := GetClusterconfigByContext("cluster-a", "update.kubeconfig")
	if cfg.ContextName != "new-name" {
		t.Fatalf("contextName not updated: got %q", cfg.ContextName)
	}
	if cfg.ConfigPath != "/new/config" {
		t.Fatalf("configPath not updated: got %q", cfg.ConfigPath)
	}
	if cfg.ImagePath != "/new/image" {
		t.Fatalf("imagePath not updated: got %q", cfg.ImagePath)
	}
	if cfg.Active != 1 {
		t.Fatalf("active not updated: got %d", cfg.Active)
	}
}

func TestReorderConfigs(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	AddConfig("a.kubeconfig", "ctx-a", "cluster-a", "/a", "/img-a", 0)
	AddConfig("b.kubeconfig", "ctx-b", "cluster-b", "/b", "/img-b", 0)

	ReorderConfigs([]interface{}{"'b.kubeconfig|cluster-b'", "'a.kubeconfig|cluster-a'"})

	configs, err := GetClusterconfigs()
	if err != nil {
		t.Fatalf("GetClusterconfigs failed: %v", err)
	}
	if len(configs) < 2 {
		t.Fatalf("expected at least 2 configs, got %d", len(configs))
	}
	if configs[0].FileName != "b.kubeconfig" || configs[1].FileName != "a.kubeconfig" {
		t.Fatalf("unexpected order: got [%s, %s]", configs[0].FileName, configs[1].FileName)
	}
}

func TestUpdatePodPortforwardingsConfig(t *testing.T) {
	defer closeDBs()

	tmpDir := t.TempDir()
	local.AppDataDir = tmpDir

	if err := Init(); err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	if _, err := SavePodPortforwardingsConfig("pod-a", "default", "active", "8080", "9090"); err != nil {
		t.Fatalf("SavePodPortforwardingsConfig failed: %v", err)
	}
	if _, err := UpdatePodPortforwardingsConfig("pod-a", "default", "inactive", "8443", "9443"); err != nil {
		t.Fatalf("UpdatePodPortforwardingsConfig failed: %v", err)
	}

	configs := GetPodPortforwardingsConfigs()
	if len(configs) != 1 {
		t.Fatalf("expected 1 portforwarding config, got %d", len(configs))
	}

	if configs[0].Status != "inactive" {
		t.Fatalf("status not updated: got %q", configs[0].Status)
	}
	if configs[0].RemotePort != "8443" {
		t.Fatalf("remotePort not updated: got %q", configs[0].RemotePort)
	}
	if configs[0].LocalPort != "9443" {
		t.Fatalf("localPort not updated: got %q", configs[0].LocalPort)
	}
}
