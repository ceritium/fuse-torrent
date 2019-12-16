const prettysize = require('prettysize')
const fuse = require('fuse-bindings')
const mkdirp = require('mkdirp')
const torrentStream = require('torrent-stream')
const sqlite = require('sqlite')
const path = require('path')

var ENOENT = -2
var EPERM = -1
var ZERO = 0

module.exports = async function (dbFile, mnt, tmp) {
  const db = await sqlite.open(dbFile)

  var handlers = {}
  var ctime = new Date()
  var mtime = new Date()
  let uninterestedAt = null

  var items = []
  var sourceFiles = []
  var categories = []

  async function refreshFiles () {
    const newItems = await db.all('SELECT * FROM torrents')
    newItems.forEach(function (item) {
      if (item.category) {
        item.path = path.join(item.category, item.name)
      }
    })
    if (items !== newItems) {
      items = newItems
      categories = Array.from(new Set(
        items.filter(function (item) { return item.category }).map(function (item) { return item.category })
      ))
      // categories = Array.from(new Set(items.filter(function (item) { return item.category }))).map(function(item){ return item.category})
      sourceFiles = []
      items.forEach(function (item) {
        const itemFiles = JSON.parse(item.metadata).files
        itemFiles.forEach(function (file) {
          if (item.category) {
            file.path = path.join(item.category, file.path)
          }
          sourceFiles.push(file)
        })
      })
    }
  }

  await refreshFiles()
  setInterval(refreshFiles, 5000)

  fuse.unmount(mnt, function () {
    mkdirp(mnt, function () {
      fuse.mount(mnt, handlers)
      console.log('fuse-torrent ready')
    })
  })

  var _engines = {}
  function engine (filePath) {
    const split = filePath.split('/')
    let name
    if (categories.find(function (cat) { return cat === split[0] })) {
      name = split[1]
    } else {
      name = split[0]
    }

    if (!_engines[name]) {
      console.log('Swarm starting ' + name)
      const target = items.find(function (item) {
        const term = item.name
        return term === name
      })

      let _engine = torrentStream(target.magnet_url, { tmp: tmp })
      _engines[name] = _engine

      var harakiri = function () {
        if (uninterestedAt) {
          const lapsus = (new Date() - uninterestedAt) / 1000
          if (lapsus > 10) {
            uninterestedAt = null
            clearInterval(interval)
            if (_engine) {
              _engine.destroy()
              _engine = null
              _engines[name] = null
            }
            console.log('Stop swarm ' + name)
          }
        }
      }
      var interval = setInterval(harakiri, 5000)

      engine(filePath).on('uninterested', function () {
        uninterestedAt = new Date()
        engine(filePath).swarm.pause()
      })

      engine(filePath).on('interested', function () {
        uninterestedAt = null
        engine(filePath).swarm.resume()
      })

      engine(filePath).once('ready', () => console.log('Swarm ready ' + name))

      engine(filePath).on('download', index => {
        const down = prettysize(engine(filePath).swarm.downloaded)
        const downSpeed = prettysize(engine(filePath).swarm.downloadSpeed()).replace('Bytes', 'b') + '/s'

        const notChoked = function (result, wire) {
          return result + (wire.peerChoking ? 0 : 1)
        }
        const connects = engine(filePath).swarm.wires.reduce(notChoked, 0) + '/' + engine(filePath).swarm.wires.length + ' peers'

        console.log('Downloaded ' + connects + ' : ' + downSpeed + ' : ' + down + ' of ' + prettysize(engine(filePath).torrent.length) + ' for ' + name + ' : ' + index)
      })
    }

    return _engines[name]
  }

  const findFromTorrent = function (filePath) {
    const split = filePath.split('/')
    if (categories.find(function (cat) { return cat === split[0] })) {
      filePath = split.slice(1, split.length).join('/')
    }

    return engine(filePath).files.reduce(function (result, file) {
      return result || (file.path === filePath && file)
    }, null)
  }

  var find = function (filePath) {
    return sourceFiles.reduce(function (result, file) {
      return result || (file.path === filePath && file)
    }, null)
  }

  handlers.displayFolder = true
  handlers.options = ['allow_other', 'auto_cache']

  handlers.getattr = function (filePath, cb) {
    filePath = filePath.slice(1)

    var stat = {}
    var file = find(filePath)

    stat.ctime = ctime
    stat.mtime = mtime
    stat.atime = new Date()
    stat.uid = process.getuid()
    stat.gid = process.getgid()

    if (file) {
      stat.size = file.length
      stat.mode = 33206 // 0100666
      return cb(ZERO, stat)
    }

    stat.size = 4096
    stat.mode = 16877 // 040755

    if (!filePath) return cb(ZERO, stat)

    var dir = sourceFiles.some(function (file) {
      return file.path.indexOf(filePath + '/') === 0
    })

    if (!dir) return cb(ENOENT)
    cb(ZERO, stat)
  }

  var files = {}

  handlers.open = function (filePath, flags, cb) {
    filePath = filePath.slice(1)

    var file = find(filePath)
    if (!file) return cb(ENOENT)

    var fs = files[filePath] = files[filePath] || []
    var fd = fs.indexOf(null)
    if (fd === -1) fd = fs.length

    fs[fd] = { offset: 0 }

    cb(ZERO, fd)
  }

  handlers.release = function (filePath, handle, cb) {
    filePath = filePath.slice(1)

    var fs = files[filePath] || []
    var f = fs[handle]

    if (f && f.stream) f.stream.destroy()
    fs[handle] = null

    cb(ZERO)
  }

  handlers.readdir = function (filePath, cb) {
    filePath = filePath.slice(1)

    var uniq = {}
    var files = sourceFiles
      .filter(function (file) {
        return file.path.indexOf(filePath ? filePath + '/' : '') === 0
      })
      .map(function (file) {
        return file.path.slice(filePath ? filePath.length + 1 : 0).split('/')[0]
      })
      .filter(function (name) {
        if (uniq[name]) return false
        uniq[name] = true
        return true
      })

    if (!files.length) return cb(ENOENT)
    cb(ZERO, files)
  }

  handlers.read = function (filePath, handle, buf, len, offset, cb) {
    filePath = filePath.slice(1)

    var file = find(filePath)
    var fs = files[filePath] || []
    var f = fs[handle]

    if (!file) return cb(ENOENT)
    if (!f) return cb(ENOENT)

    if (len + offset > file.length) len = file.length - offset

    if (f.stream && f.offset !== offset) {
      f.stream.destroy()
      f.stream = null
    }

    var loop = function () {
      if (engine(filePath).files.length === 0) return engine(filePath).once('ready', loop)

      if (!f.stream) {
        const f2 = findFromTorrent(filePath)
        f.stream = f2.createReadStream({ start: offset })
        f.offset = offset
      }

      var innerLoop = function () {
        var result = f.stream.read(len)
        if (!result) return f.stream.once('readable', innerLoop)
        result.copy(buf)
        cb(result.length)
      }

      innerLoop()
    }

    loop()
  }

  handlers.write = function (filePath, handle, buf, len, offset, cb) {
    cb(EPERM)
  }

  handlers.unlink = function (filePath, cb) {
    cb(EPERM)
  }

  handlers.rename = function (src, dst, cb) {
    cb(EPERM)
  }

  handlers.mkdir = function (filePath, mode, cb) {
    cb(EPERM)
  }

  handlers.rmdir = function (filePath, cb) {
    cb(EPERM)
  }

  handlers.create = function (filePath, mode, cb) {
    cb(EPERM)
  }

  handlers.getxattr = function (filePath, name, buffer, length, offset, cb) {
    cb(EPERM)
  }

  handlers.setxattr = function (filePath, name, buffer, length, offset, flags, cb) {
    cb(ZERO)
  }

  handlers.statfs = function (filePath, cb) {
    cb(ZERO, {
      bsize: 1000000,
      frsize: 1000000,
      blocks: 1000000,
      bfree: 1000000,
      bavail: 1000000,
      files: 1000000,
      ffree: 1000000,
      favail: 1000000,
      fsid: 1000000,
      flag: 1000000,
      namemax: 1000000
    })
  }

  handlers.destroy = function (cb) {
    cb()
  }
}
