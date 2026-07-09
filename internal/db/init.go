package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"kubegui/internal/local"
	appLogger "kubegui/internal/logger"
	"net/url"
	"os"
	"path/filepath"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/sqlite"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	msqlite "modernc.org/sqlite"
)

const initSQL = `
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA busy_timeout = 5000;
        PRAGMA trusted_schema = OFF;
`

var (
	CDB *sql.DB
	MDB *sql.DB
	EDB *sql.DB
)

//go:embed migrations/cdb/*.sql
var cdbm embed.FS

//go:embed migrations/mdb/*.sql
var mdbm embed.FS

func Init() error {
	if local.AppDataDir == "" {
		return fmt.Errorf("db.Init: userdata.AppDataDir is empty - call userdata.Init() first")
	}

	dbFullPath := filepath.Join(local.AppDataDir, "kubegui.db")
	metricsDBFullPath := filepath.Join(local.AppDataDir, "metrics.db")
	eventsDBFullPath := filepath.Join(local.AppDataDir, "events.db")

	msqlite.RegisterConnectionHook(func(conn msqlite.ExecQuerierContext, _ string) error {
		_, err := conn.ExecContext(context.Background(), initSQL, nil)
		return err
	})

	var err error
	CDB, err = sql.Open("sqlite", dbFullPath)
	if err != nil {
		return fmt.Errorf("open CDB: %w", err)
	}
	MDB, err = sql.Open("sqlite", metricsDBFullPath)
	if err != nil {
		return fmt.Errorf("open MDB: %w", err)
	}
	EDB, err = sql.Open("sqlite", eventsDBFullPath)
	if err != nil {
		return fmt.Errorf("open EDB: %w", err)
	}

	CDBdriver, err := sqlite.WithInstance(CDB, &sqlite.Config{})
	if err != nil {
		return fmt.Errorf("sqlite driver CDB: %w", err)
	}
	MDBdriver, err := sqlite.WithInstance(MDB, &sqlite.Config{})
	if err != nil {
		return fmt.Errorf("sqlite driver MDB: %w", err)
	}

	tmpDir, err := os.MkdirTemp("", "migrations")
	if err != nil {
		return fmt.Errorf("create temp migrations dir: %w", err)
	}
	appLogger.Logger.Info("Using temporary directory for migrations", "dir", tmpDir)
	defer os.RemoveAll(tmpDir)

	if err := writeEmbeddedMigrationsToDisk(cdbm, tmpDir); err != nil {
		return fmt.Errorf("write cdb migrations: %w", err)
	}
	if err := writeEmbeddedMigrationsToDisk(mdbm, tmpDir); err != nil {
		return fmt.Errorf("write mdb migrations: %w", err)
	}

	cdbmpath, err := toFileURL(filepath.Join(tmpDir, "migrations", "cdb"))
	if err != nil {
		return fmt.Errorf("cdb migration path: %w", err)
	}
	mdbmpath, err := toFileURL(filepath.Join(tmpDir, "migrations", "mdb"))
	if err != nil {
		return fmt.Errorf("mdb migration path: %w", err)
	}

	cdbMigration, err := migrate.NewWithDatabaseInstance(cdbmpath, "sqlite", CDBdriver)
	if err != nil {
		return fmt.Errorf("init cdb migration: %w", err)
	}
	mdbMigration, err := migrate.NewWithDatabaseInstance(mdbmpath, "sqlite", MDBdriver)
	if err != nil {
		return fmt.Errorf("init mdb migration: %w", err)
	}

	appLogger.Logger.Info("Migrating cdb database")
	if err = applyMigration("cdb", cdbMigration); err != nil {
		return err
	}

	appLogger.Logger.Info("Migrating mdb database")
	if err = applyMigration("mdb", mdbMigration); err != nil {
		return err
	}

	defaultSettings := map[string]string{
		"aiallow":    "false",
		"aitoken":    "",
		"aitype":     "",
		"aimodel":    "",
		"aiendpoint": "",
		"fsfont":     "Space Grotesk",
		"fssize":     "11",
	}
	for k, v := range defaultSettings {
		if _, err := CDB.Exec(`INSERT OR IGNORE INTO settings(name, value) VALUES(?, ?)`, k, v); err != nil {
			appLogger.Logger.Error("failed to insert default setting", "name", k, "error", err)
		}
	}

	return nil
}

func applyMigration(name string, migration *migrate.Migrate) error {
	if err := migration.Up(); err != nil {
		var dirtyErr migrate.ErrDirty
		if errors.As(err, &dirtyErr) {
			appLogger.Logger.Warn("database migration is dirty; forcing version", "db", name, "version", dirtyErr.Version)
			if forceErr := migration.Force(dirtyErr.Version); forceErr != nil {
				return fmt.Errorf("force %s migration: %w", name, forceErr)
			}
			retryErr := migration.Up()
			if retryErr != nil && retryErr != migrate.ErrNoChange {
				return fmt.Errorf("reapply %s migration after force: %w", name, retryErr)
			}
			if retryErr == migrate.ErrNoChange {
				appLogger.Logger.Debug("migration already up to date after force", "db", name)
			}
			return nil
		}
		if err == migrate.ErrNoChange {
			appLogger.Logger.Debug("migration already up to date", "db", name)
			return nil
		}
		return fmt.Errorf("apply %s migration: %w", name, err)
	}
	return nil
}

func writeEmbeddedMigrationsToDisk(embedded fs.FS, targetDir string) error {
	return fs.WalkDir(embedded, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(embedded, path)
		if err != nil {
			return err
		}
		destPath := filepath.Join(targetDir, path)
		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return err
		}
		return os.WriteFile(destPath, data, 0o644)
	})
}

func toFileURL(path string) (string, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	u := &url.URL{Scheme: "file", Path: filepath.ToSlash(absPath)}
	return u.String(), nil
}
