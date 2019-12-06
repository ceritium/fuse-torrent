# torrent-playing

It is a working progress project, use it with precaution.

**torrent-playing** (temporal name) is based on [torrent-mount](https://github.com/mafintosh/torrent-mount)
but it allows mounting several torrents at the same time.

To mount several torrents at the same time without hit the performance of the network it relies upon **SQLite** to
cache the metadata of the torrents, so then, torrent-playing only connect to the torrent swarm when the filesystem tries to read a file. After some time of inactivity torrent-playing disconnect of the swarm.

## Usage

```
$ npm install
$ mkdir ~/torrentsfs
$ node db_prepare.js
$ node mount.js -m ~/torrentsfs
$ node add_magnet_url.js "magneturl"
```

## TODO

- [ ] Unmount directories on quit.
- [ ] Better documentation.
- [ ] Pool for connected torrents.
- [ ] Clean cached data for `torrent-stream`.
- [ ] Improve cli for allow more parameters.
- [ ] Make it an npm package.
