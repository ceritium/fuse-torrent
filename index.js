#!/usr/bin/env node

const prettysize = require('prettysize')
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
  .command('add <magnetUrl>', 'Add magnet url to the DB', (yargs) => {
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
  addMagnetUrl(argv.magnetUrl)
}

if (command === 'mount') {
  mountTorrents()
}

function dbPrepare () {
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath)
  }

  console.log('Running pending migrations')
  Promise.resolve()
    .then(() => sqlite.open(dbFile, { Promise }))
    .then(db => db.migrate({ force: 'last' }))
  console.log('DB ready')
}

async function addMagnetUrl (magnetUrl) {
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
    await db.run('INSERT INTO Torrents (magnet_url, name, infohash, metadata) VALUES (?, ?, ?, ?)',
      [magnetUrl, ts.torrent.name, ts.infohash, metadata])

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

  let id = 0

  var torrents = []

  async function start () {
    const db = await sqlite.open(dbFile)
    const items = await db.all('SELECT * FROM torrents where id > ?', id)

    items.forEach(item => {
      torrents.push(item)
      id = item.id
      const events = drive(item, mount, tmp)
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
      process.exit()
    }
  }

  var exit = async function () {
    console.log('\n')
    clearInterval(checkNewTorrentsInterval)
    setTimeout(process.kill.bind(process, process.pid), 2000).unref()
    process.removeListener('SIGINT', exit)
    process.removeListener('SIGTERM', exit)

    unmount(0)
  }

  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)
}
