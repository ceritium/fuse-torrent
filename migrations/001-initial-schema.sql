-- Up
CREATE TABLE Torrents (id INTEGER PRIMARY KEY, name TEXT, magnet_url TEXT, torrentfile TEXT, infohash TEXT, metadata JSON);
-- Down
DROP TABLE Torrents;
