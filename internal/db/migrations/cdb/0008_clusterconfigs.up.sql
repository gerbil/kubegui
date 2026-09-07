DROP TABLE IF EXISTS clusterconfigs_new;
CREATE TABLE clusterconfigs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT,
  contextname TEXT,
  context TEXT,
  configpath TEXT,
  imagepath TEXT,
  active INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  sort INTEGER,
  UNIQUE(filename, context)
);

INSERT INTO clusterconfigs_new (filename, contextname, context, configpath, imagepath, active, source, sort)
SELECT filename, contextname, context, configPath, imagePath, active, source, sort FROM clusterconfigs;

DROP TABLE IF EXISTS clusterconfigs;
ALTER TABLE clusterconfigs_new RENAME TO clusterconfigs;
