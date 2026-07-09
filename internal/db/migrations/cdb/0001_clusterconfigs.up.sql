CREATE TABLE IF NOT EXISTS clusterconfigs (configPath TEXT PRIMARY KEY, contextName TEXT, imagePath TEXT, active INTEGER);
CREATE TABLE IF NOT EXISTS portforwardings (name TEXT PRIMARY KEY, namespace TEXT, status TEXT, localPort INTEGER, remotePort INTEGER);
CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, resource TEXT);
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT);