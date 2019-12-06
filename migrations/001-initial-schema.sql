-- Up
CREATE TABLE Torrents (id INTEGER PRIMARY KEY, name TEXT, magnet_url TEXT, infohash TEXT, metadata JSON);
-- INSERT INTO Torrents (id, magnet_url) VALUES (1, "magnet:?xt=urn:btih:3614a11d8dca137277560151c0027279e8d121e3&dn=Novecento+aka+1900+(1976)+720p+BRrip_sujaidr_TMRG&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com
-- ");
-- INSERT INTO Torrents (id, magnet_url) VALUES (2, "magnet:?xt=urn:btih:556be0bd40c4880e29ba567663c65bd8bae9fbeb&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337");
--
-- Down
DROP TABLE Torrents;
