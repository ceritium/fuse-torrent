#!/usr/bin/env node

const prettysize = require('prettysize')
const fuse = require('fuse-bindings')
const sqlite = require('sqlite')
const fs = require('fs')
const path = require('path')
const readTorrent = require('read-torrent')
const torrentStream = require('torrent-stream')
const drive = require('./drive.js')
const Promise = require('bluebird')

var argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('db-prepare', 'Prepare the db')
  .command('add <magnetUrl>', 'Add magnet url to the DB', (yargs) => {
    yargs
      .positional('magnetUrl', {
        describe: 'Magnet url',
        type: 'string',
        default: null
      })
      .demand('magnetUrl')
  })
  .command('addtorrent <torrentFile>', 'Add torrent file to the DB', (yargs) => {
    yargs
      .positional('torrentFile', {
        describe: 'torrent file',
        type: 'string',
        default: null
      })
      .demand('torrentFile')
  })
  .command('list', 'List torrents in the DB')
  .command('remove <id>', 'Remove torrent from the DB', (yargs) => {
    yargs
      .positional('id', {
        describe: 'id to remove',
        type: 'string',
        default: null
      })
      .demand('infohash')
  })
  .command('mount', 'Mount torrents under ./mount', (yargs) => {
    yargs
      .positional('path', {
        describe: 'Path to mount the torrents',
        type: 'string',
        default: null
      })
      .demand('path')
  })
  .demandCommand()
  .help('help')
  .alias('h', 'help')
  .argv

const command = argv._[0]
const dbFile = path.join('./', 'database.sqlite')

if (command === 'db-prepare') {
  dbPrepare()
}

if (command === 'add') {
  addMagnetUrl(argv.magnetUrl)
}

if (command === 'addtorrent') {
  addTorrentFile(argv.torrentFile)
}

if (command === 'mount') {
  mountTorrents()
}

if (command === 'list') {
  listTorrents()
}

if (command === 'remove') {
  removeTorrent(argv.infohash)
}

function dbPrepare () {
  const migrationsPath = path.join(__dirname, 'migrations')
  console.log('Running pending migrations')
  Promise.resolve()
    .then(() => sqlite.open(dbFile, { Promise }))
    .then(db => db.migrate({ force: 'last', migrationsPath: migrationsPath }))
  console.log('DB ready')
}

async function listTorrents () {
  const db = await sqlite.open(dbFile)
  const items = await db.all('SELECT * FROM torrents')
  items.forEach(item => {
    console.log(`${item.id}\t${item.infohash || '--'}\t${item.name}`)
  })
}

async function addMagnetUrl (magnetUrl) {
  console.log('Fetching torrent')
  const ts = torrentStream(magnetUrl)
  ts.on('ready', async function () {
    const files = ts.files.map((file) => {
      return { path: file.path, length: file.length }
    })
    console.log(ts.torrent.name)
    const metadata = JSON.stringify({ files: files })
    const db = await sqlite.open(dbFile)

    const items = await db.all(
      'SELECT * FROM torrents where (name IS NOT NULL AND name = ?) OR (infohash IS NOT NULL AND infohash = ?)',
      [ts.torrent.name, ts.infohash]
    )
    if (items.length > 0) {
      console.error('torrent with same name or inforhash already in the DB')
      process.exit(2)
    }

    await db.run('INSERT INTO Torrents (magnet_url, name, infohash, metadata) VALUES (?, ?, ?, ?)',
      [magnetUrl, ts.torrent.name, ts.infohash, metadata])

    console.log('\tADDED')
    process.exit()
  })
}

async function addTorrentFile (torrentFile) {
  console.log('Fetching torrent')
  readTorrent(torrentFile, function (err, torrent, raw) {
    if (err) {
      console.error(err.message)
      process.exit(2)
    }
    const ts = torrentStream(raw)
    ts.on('ready', async function () {
      const files = ts.files.map((file) => {
        return { path: file.path, length: file.length }
      })
      console.log(ts.torrent.name)
      const metadata = JSON.stringify({ files: files })
      const db = await sqlite.open(dbFile)

      const items = await db.all(
        'SELECT * FROM torrents where (name IS NOT NULL AND name = ?) OR (infohash IS NOT NULL AND infohash = ?)',
        [ts.torrent.name, ts.infohash]
      )
      if (items.length > 0) {
        console.error('torrent with same name or inforhash already in the DB')
        process.exit(2)
      }

      await db.run('INSERT INTO Torrents (torrentfile, name, infohash, metadata) VALUES (?, ?, ?, ?)',
        [raw.toString('base64'), ts.torrent.name, ts.infohash, metadata])

      console.log('\tADDED')
      process.exit()
    })
  })
}

function mountTorrents () {
  let mount = './mount'
  let cache = './cache'
  mount = fs.realpathSync(mount)
  cache = fs.realpathSync(cache)

  let id = 0

  var torrents = []

  async function start () {
    const db = await sqlite.open(dbFile)
    const items = await db.all('SELECT * FROM torrents where id > ?', id)

    items.forEach(item => {
      torrents.push(item)
      id = item.id
      const events = drive(item, mount, cache)
      events.on('mount', source => console.log('Mounted ' + source.mnt))
      events.on('start', source => console.log('Swarm starting ' + source.mnt))
      events.on('ready', source => console.log('Swarm ready ' + source.mnt))
      events.on('stop', source => console.log('Stop swarm' + source.mnt))

      events.on('download', index => {
        const down = prettysize(events.engine.swarm.downloaded)
        const downSpeed = prettysize(events.engine.swarm.downloadSpeed()).replace('Bytes', 'b') + '/s'

        const notChoked = function (result, wire) {
          return result + (wire.peerChoking ? 0 : 1)
        }
        const connects = events.engine.swarm.wires.reduce(notChoked, 0) + '/' + events.engine.swarm.wires.length + ' peers'

        console.log('Downloaded ' + connects + ' : ' + downSpeed + ' : ' + down + ' of ' + prettysize(events.engine.torrent.length) + ' for ' + item.name + ' : ' + index)
      })

      events.on('upload', index => {
        const up = prettysize(events.engine.swarm.uploadded)
        const upSpeed = prettysize(events.engine.swarm.uploadSpeed()).replace('Bytes', 'b') + '/s'

        const notChoked = function (result, wire) {
          return result + (wire.peerChoking ? 0 : 1)
        }
        const connects = events.engine.swarm.wires.reduce(notChoked, 0) + '/' + events.engine.swarm.wires.length + ' peers'

        console.log('Uploaded ' + connects + ' : ' + upSpeed + ' : ' + up + ' of ' + prettysize(events.engine.torrent.length) + ' for ' + item.name + ' : ' + index)
      })
    })
  }

  start()
  var checkNewTorrentsInterval = setInterval(start, 10000)

  function unmount (index) {
    const item = torrents[index]

    if (item) {
      const mnt = path.join(mount, path.resolve('/', item.name))
      console.log('Unmounting ' + mnt)

      fuse.unmount(mnt, function () {
        fs.rmdir(mnt, function () {
          unmount(index + 1)
        })
      })
    } else {
      console.log('DONE\n')
      process.exit()
    }
  }

  var exit = async function () {
    console.log('EXITING\n')
    clearInterval(checkNewTorrentsInterval)
    setTimeout(process.kill.bind(process, process.pid), 10000).unref()
    process.removeListener('SIGINT', exit)
    process.removeListener('SIGTERM', exit)

    unmount(0)
  }

  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)
}
