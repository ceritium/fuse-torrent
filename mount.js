const prettysize = require('prettysize')
const readTorrent = require('read-torrent')
const sqlite = require('sqlite');
const fs = require('fs')
const drive = require('./drive.js')

const minimist = require('minimist')

let argv = minimist(process.argv.slice(2), {
  alias: {tmp: 't', mount: 'm', help: 'h'}
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


let id = 0
let mount = argv.mount
let tmp = argv.tmp
if (!mount) mount = '/tmp/data'
if (!tmp) tmp = '/tmp'

mount = fs.realpathSync(mount)
tmp = fs.realpathSync(tmp)


async function mountTorrent(item) {
  let engine = drive(item, mount, tmp)
}

async function start() {
  const db = await sqlite.open('./database.sqlite');
  const torrents = await db.all("SELECT * FROM torrents where id > ?", id);

  torrents.forEach(item => {
    mountTorrent(item)
    id = item.id
  })
}

start();
setInterval(start, 10000);
