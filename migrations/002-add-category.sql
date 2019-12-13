-- Up
ALTER TABLE Torrents ADD category TEXT;
-- Down
ALTER TABLE Torrents DROP COLUMN category TEXT;
