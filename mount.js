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

const id = 0

async function start () {
  const db = await sqlite.open('./database.sqlite')
  const torrents = await db.all('SELECT * FROM torrents where id > ?', id)

  torrents.forEach(item => {
    drive(item, mount, tmp)
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
