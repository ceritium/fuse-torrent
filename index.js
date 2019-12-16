#!/usr/bin/env node

const fuse = require('fuse-bindings')
const sqlite = require('sqlite')
const fs = require('fs')
const path = require('path')
const torrentStream = require('torrent-stream')
const drive = require('./drive.js')
const Promise = require('bluebird')
const os = require('os')

var argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('db-prepare', 'Prepare the db')
  .command('add <magnetUrl> [category]', 'Add magnet url to the DB', (yargs) => {
    yargs
      .positional('magnetUrl', {
        describe: 'Magnet url',
        type: 'string',
        default: null
      })
  })
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

if (command === 'add') {
  addMagnetUrl(argv.magnetUrl, argv.category)
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
    .then(db => db.migrate({ force: 'last', migrationsPath: migrationsPath }))
  console.log('DB ready')
}

async function addMagnetUrl (magnetUrl, category) {
  console.log('Fetching torrent')
  const ts = torrentStream(magnetUrl)
  ts.on('ready', async function () {
    const files = ts.files.map((file) => {
      return { path: file.path, length: file.length }
    })
    console.log('Files:')
    files.forEach(file => console.log(file))
    const metadata = JSON.stringify({ files: files })
    const db = await sqlite.open(dbFile)
    await db.run('INSERT INTO Torrents (magnet_url, name, infohash, metadata, category) VALUES (?, ?, ?, ?, ?)',
      [magnetUrl, ts.torrent.name, ts.infohash, metadata, category])

    process.exit()
  })
}

function mountTorrents () {
  let mount = argv.path
  let tmp = argv.tmp
  if (!mount) mount = '/tmp/data'
  if (!tmp) tmp = '/tmp'
  mount = fs.realpathSync(mount)
  tmp = fs.realpathSync(tmp)

  drive(dbFile, mount, tmp)
  var exit = async function () {
    console.log('\n')
    setTimeout(process.kill.bind(process, process.pid), 2000).unref()
    process.removeListener('SIGINT', exit)
    process.removeListener('SIGTERM', exit)

    fuse.unmount(mount, function () {
      fs.rmdir(mount, function () {
        process.exit()
      })
    })
  }

  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)
}
