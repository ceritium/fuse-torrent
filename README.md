# fuse-torrent

It is a working progress project, use it with precaution.

**fuse-torrent** is based on [torrent-mount](https://github.com/mafintosh/torrent-mount)
but it allows mounting several torrents at the same time.

To mount several torrents at the same time without hit the performance of the network it relies upon **SQLite** to
cache the metadata of the torrents, so then, torrent-playing only connect to the torrent swarm when the filesystem tries to read a file. After some time of inactivity torrent-playing disconnect of the swarm.

## Usage

```
$ npm install -g fuse-torrent
$ fuse-torrent db-prepare
$ fuse-torrent mount $HOME/torrentfs
$ fuse-torrent add "magneturl"
```

## TODO

- [ ] Better documentation.
- [ ] Pool for connected torrents.
- [ ] Clean cached data for `torrent-stream`.
- [ ] Allow group torrents.
- [ ] Avoid duplicates by infohash.
- [ ] Allow more parameters on cli.
- [ ] Configuration by file.
- [ ] Add version to cli.
