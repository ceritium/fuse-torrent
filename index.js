#!/usr/bin/env node

const fuse = require('fuse-bindings')
const sqlite = require('sqlite')
const fs = require('fs')
const path = require('path')
const torrentStream = require('torrent-stream')
const readTorrent = require('read-torrent')
const Promise = require('bluebird')
const os = require('os')

const drive = require('./drive.js')

var argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('db-prepare', 'Prepare the db')
  .command('add-magnet <magnetUrl> [category]', 'Add magnet url to the DB', (yargs) => {
    yargs
      .positional('magnetUrl', {
        describe: 'Magnet url',
        type: 'string',
        default: null
      })
  })
  .command('add <torrentFile> [category]', 'Add torrent file to the DB', (yargs) => {
    yargs
      .positional('torrentFile', {
        describe: 'torrent file',
        type: 'string',
        default: null
      })
  })
  .command('list', 'List torrents in the DB')
  .command('mount <path>', 'Mount torrents under specific path', (yargs) => {
    yargs
      .positional('path', {
        describe: 'Path to mount the torrents',
        type: 'string',
        default: null
      })
      .demand('path')
  })
  .option('c', {
    alias: 'cache-path',
    description: 'Path for caching',
    default: '/tmp'
  })
  .demandCommand()
  .help('help')
  .alias('h', 'help')
  .argv

const command = argv._[0]
const dbPath = path.join(os.homedir(), '.fusetorrent')
const dbFile = path.join(dbPath, 'database.sqlite')

if (command === 'db-prepare') {
  dbPrepare()
}

if (command === 'list') {
  listTorrents()
}

if (command === 'add') {
  addTorrent(argv.torrentFile, argv.category)
}

if (command === 'mount') {
  mountTorrents()
}

function dbPrepare () {
  const migrationsPath = path.join(__dirname, 'migrations')
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath)
  }

  console.log('Running pending migrations')
  Promise.resolve()
    .then(() => sqlite.open(dbFile, { Promise }))
    .then(db => db.migrate({ migrationsPath: migrationsPath }))
  console.log('DB ready')
}

async function listTorrents () {
  const db = await sqlite.open(dbFile)
  const items = await db.all('SELECT * FROM Torrents')

  items.forEach(item => {
    const line = [item.id, item.infohash, item.name, item.category].filter(x=>x).join('\t')
    console.log(line)
  })
}

async function addTorrent (torrentFile, category) {
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
      console.log('Files:')
      files.forEach(file => console.log(file))
      const metadata = JSON.stringify({ files: files })
      const db = await sqlite.open(dbFile)
      await db.run('INSERT INTO Torrents (torrentfile, name, infohash, metadata, category) VALUES (?, ?, ?, ?, ?)',
        [ts.metadata.toString('base64'), ts.torrent.name, torrent.infoHash, metadata, category])

      process.exit()
    })
  })
}

function mountTorrents () {
  let mount = argv.path
  let cache = argv.cachePath
  if (!mount) mount = '/tmp/data'
  if (!cache) cache = '/tmp'
  mount = fs.realpathSync(mount)
  cache = fs.realpathSync(cache)

  drive(dbFile, mount, cache)
  var exit = async function () {
    console.log('\n')
    setTimeout(process.kill.bind(process, process.pid), 2000).unref()
    process.removeListener('SIGINT', exit)
    process.removeListener('SIGTERM', exit)

    fuse.unmount(mount, function () {
      // fs.rmdir(mount, function () {
        process.exit()
      // })
    })
  }

  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)
}
