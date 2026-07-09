CREATE TABLE IF NOT EXISTS nodes (
    uid             TEXT,
    name            TEXT,
    cpu             TEXT,
    memory          TEXT,
    storage         TEXT,
    cpupercent      TEXT,
    memorypercent   TEXT,
    storagepercent  TEXT,
    time            DATETIME
);

CREATE TABLE IF NOT EXISTS pods (
    uid             TEXT,
    name            TEXT,
    namespace       TEXT,
    container       TEXT,
    cpu             TEXT,
    memory          TEXT,
    storage         TEXT,
    cpupercent      TEXT,
    memorypercent   TEXT,
    storagepercent  TEXT,
    time            DATETIME
);