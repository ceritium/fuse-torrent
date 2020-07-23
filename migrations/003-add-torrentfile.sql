-- Up
ALTER TABLE Torrents ADD torrentfile TEXT;
UPDATE Torrents SET torrentfile = magnet_url
-- Down
ALTER TABLE Torrents DROP COLUMN torrentfile TEXT;
