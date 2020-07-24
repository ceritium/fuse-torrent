#!/usr/bin/env node
const fs = require('fs')
const torrentStream = require('torrent-stream')
const readTorrent = require('read-torrent')

const drive = require('./drive.js')
const dbFind = require('./db.js').dbFind
const db = require('./db.js').db

var argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
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
if (command === 'list') {
  listTorrents()
}

if (command === 'add') {
  addTorrent(argv.torrentFile, argv.category)
}

if (command === 'mount') {
  mountTorrents()
}

async function listTorrents () {
  dbFind({}, (items) => {
    items.forEach(item => {
      const line = [item.infoHash, item.name, item.category].filter(x => x).join('\t')
      console.log(line)
    })
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

      const doc = {
        torrentFile: ts.metadata.toString('base64'),
        name: ts.torrent.name,
        infoHash: torrent.infoHash,
        metadata: metadata,
        category: category
      }

      db.insert(doc, function (err, newDoc) {
        if (err) console.log(err)
        process.exit()
      })
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

  drive(mount, cache)
}
