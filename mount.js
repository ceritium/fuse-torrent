const prettysize = require('prettysize')
const fuse = require('fuse-bindings')
const sqlite = require('sqlite')
const fs = require('fs')
const drive = require('./drive.js')
const path = require('path')

const minimist = require('minimist')

const argv = minimist(process.argv.slice(2), {
  alias: { tmp: 't', mount: 'm', help: 'h' }
})

if (argv.h) {
  console.error('Usage: bla bla bla')
  console.error()
  console.error('  --help,    -h  Display help')
  console.error('  --tmp,     -t  Tmp directory')
  console.error('  --source,  -s  Magnets file')
  console.error('  --mount,   -m  Mount directory')
  console.error()
  process.exit(1)
}

let mount = argv.mount
let tmp = argv.tmp
if (!mount) mount = '/tmp/data'
if (!tmp) tmp = '/tmp'
mount = fs.realpathSync(mount)
tmp = fs.realpathSync(tmp)

let id = 0

async function start () {
  const db = await sqlite.open('./database.sqlite')
  const torrents = await db.all('SELECT * FROM torrents where id > ?', id)

  torrents.forEach(item => {
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

function unmount (torrents, index) {
  const item = torrents[index]

  if (item) {
    const mnt = path.join(mount, path.resolve('/', item.name))
    console.log('Unmounting ' + mnt)

    fuse.unmount(mnt, function () {
      fs.rmdir(mnt, function () {
        unmount(torrents, index + 1)
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

  const db = await sqlite.open('./database.sqlite')
  const torrents = await db.all('SELECT * FROM torrents')
  unmount(torrents, 0)
}

process.on('SIGINT', exit)
process.on('SIGTERM', exit)
