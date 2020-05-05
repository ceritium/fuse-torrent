-- Up
ALTER TABLE Torrents ADD st TEXT;
ALTER TABLE Torrents ADD seedhours integer;
ALTER TABLE Torrents ADD totalup integer;
ALTER TABLE Torrents ADD totaldown integer;
ALTER TABLE Torrents ADD lastread integer;
ALTER TABLE Torrents ADD deletereq boolean;
-- Down
ALTER TABLE Torrents DROP COLUMN st TEXT;
ALTER TABLE Torrents DROP COLUMN seedhours integer;
ALTER TABLE Torrents DROP COLUMN totalup integer;
ALTER TABLE Torrents DROP COLUMN totaldown integer;
ALTER TABLE Torrents DROP COLUMN lastread integer;
ALTER TABLE Torrents DROP COLUMN deletereq boolean;
