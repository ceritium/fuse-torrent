const fuse = require('fuse-bindings')
const { readdirSync } = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const fs = require('fs')

const getDirectories = source =>
  readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)

async function umount() {
  getDirectories('data').forEach(dir => {
    let mnt = path.join('data', path.resolve('/', dir))
    fuse.unmount(mnt, function () {
      fs.rmdirSync(mnt)
      console.log(mnt)
    })
  })
}

umount()
