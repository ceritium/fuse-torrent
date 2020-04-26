-- Up
ALTER TABLE Torrents ADD torrentfile TEXT;
-- Down
ALTER TABLE Torrents DROP COLUMN torrentfile TEXT;
