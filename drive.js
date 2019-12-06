const prettysize = require('prettysize')
const fuse = require('fuse-bindings')
const mkdirp = require('mkdirp')
const torrentStream = require('torrent-stream')
const path = require('path')

var ENOENT = -2
var EPERM = -1

module.exports = function (source, mnt, tmp) {
  const isLazy = true
  if (!mnt) mnt = '.'

  var handlers = {}
  var ctime = new Date()
  var mtime = new Date()
  let uninterestedAt = null
  let ready = false

  let source_files = JSON.parse(source.metadata).files
  mnt = path.join(mnt, path.resolve('/', source.name))
  fuse.unmount(mnt, function () {
    mkdirp(mnt, function () {
      fuse.mount(mnt, handlers)
        console.log("Mounted " + mnt)
    })
  })


  let _engine;
  function engine() {
    if(!_engine) {
      console.log('Start engine: ' + source.name)
      _engine = torrentStream(source.magnet_url, { tmp: tmp })

      var harakiri = function () {
        if(uninterestedAt) {
          let lapsus = (new Date() - uninterestedAt) / 1000
          if (lapsus > 10) {
            uninterestedAt = null
            clearInterval(interval)
            engine().destroy
            ready = false
            _engine = null
            console.log('Stop engine: ' + source.name)
          }
          console.log(lapsus)
        }
      }
      var interval = setInterval(harakiri, 5000)


      engine().once('ready', function () {
        console.log('Ready engine: ' + source.name)
        ready = true
        if (engine().torrent.name === (_engine.files[0] && _engine.files[0].path)) {
          var dir = engine().torrent.name.replace(/\.[^.]+$/, '')
          engine().torrent.files.forEach(function (file) {
            file.path = path.join(dir, file.path)
          })
          engine().torrent.name = dir
        }

      engine().on('download', function(index) {
        let down = prettysize(engine().swarm.downloaded)
        let downSpeed = prettysize(engine().swarm.downloadSpeed()).replace('Bytes', 'b') + '/s'

        let notChoked = function (result, wire) {
          return result + (wire.peerChoking ? 0 : 1)
        }
        let connects = engine().swarm.wires.reduce(notChoked, 0) + '/' + _engine.swarm.wires.length + ' peers'

        console.log('Downloaded ' + connects + ' : ' + downSpeed + ' : ' + down + ' of ' + prettysize(engine().torrent.length) + ' for ' + source.name + ' : ' + index)
      })

        engine().on('uninterested', function () {
          // console.log('Uninterested: ' + source.name)
          uninterestedAt = new Date()
          engine().swarm.pause()
        })

        engine().on('interested', function () {
          // console.log('Interested: ' + source.name)
          // console.log(engine().selection)
          uninterestedAt = null
          engine().swarm.resume()
        })
      })
    }

    return _engine
  }


  let findFromTorrent = function (path) {
    return engine().files.reduce(function (result, file) {
      return result || (file.path === path && file)
    }, null)
  }

  var find = function (path) {
    return source_files.reduce(function (result, file) {
      return result || (file.path === path && file)
    }, null)
  }

  handlers.displayFolder = true
  handlers.options = ['allow_other', 'auto_cache']

  handlers.getattr = function (path, cb) {
    path = path.slice(1)

    var stat = {}
    var file = find(path)

    stat.ctime = ctime
    stat.mtime = mtime
    stat.atime = new Date()
    stat.uid = process.getuid()
    stat.gid = process.getgid()

    if (file) {
      stat.size = file.length
      stat.mode = 33206 // 0100666
      return cb(0, stat)
    }

    stat.size = 4096
    stat.mode = 16877 // 040755

    if (!path) return cb(0, stat)

    var dir = source_files.some(function (file) {
      return file.path.indexOf(path + '/') === 0
    })

    if (!dir) return cb(ENOENT)
    cb(0, stat)
  }

  var files = {}

  handlers.open = function (path, flags, cb) {
    path = path.slice(1)

    var file = find(path)
    if (!file) return cb(ENOENT)

    var fs = files[path] = files[path] || []
    var fd = fs.indexOf(null)
    if (fd === -1) fd = fs.length

    fs[fd] = {offset: 0}

    cb(0, fd)
  }

  handlers.release = function (path, handle, cb) {
    path = path.slice(1)

    var fs = files[path] || []
    var f = fs[handle]

    if (f && f.stream) f.stream.destroy()
    fs[handle] = null

    cb(0)
  }

  handlers.readdir = function (path, cb) {
    path = path.slice(1)

    var uniq = {}
    var files = source_files
      .filter(function (file) {
        return file.path.indexOf(path ? path + '/' : '') === 0
      })
      .map(function (file) {
        return file.path.slice(path ? path.length + 1 : 0).split('/')[0]
      })
      .filter(function (name) {
        if (uniq[name]) return false
        uniq[name] = true
        return true
      })

    if (!files.length) return cb(ENOENT)
    cb(0, files)
  }

  handlers.read = function (path, handle, buf, len, offset, cb) {
    path = path.slice(1)

    var file = find(path)
    var fs = files[path] || []
    var f = fs[handle]

    if (!file) return cb(ENOENT)
    if (!f) return cb(ENOENT)

    if (len + offset > file.length) len = file.length - offset

    if (f.stream && f.offset !== offset) {
      f.stream.destroy()
      f.stream = null
    }

    var liip = function () {
      if (engine().files.length == 0) return engine().once('ready', liip)

      if (!f.stream) {
        let f2 = findFromTorrent(path)
        f.stream = f2.createReadStream({start: offset})
        f.offset = offset
      }

      var loop = function () {
        var result = f.stream.read(len)
        if (!result) return f.stream.once('readable', loop)
        result.copy(buf)
        cb(result.length)
      }

      loop()
    }

    liip()
  }

  handlers.write = function (path, handle, buf, len, offset, cb) {
    cb(EPERM)
  }

  handlers.unlink = function (path, cb) {
    cb(EPERM)
  }

  handlers.rename = function (src, dst, cb) {
    cb(EPERM)
  }

  handlers.mkdir = function (path, mode, cb) {
    cb(EPERM)
  }

  handlers.rmdir = function (path, cb) {
    cb(EPERM)
  }

  handlers.create = function (path, mode, cb) {
    cb(EPERM)
  }

  handlers.getxattr = function (path, name, buffer, length, offset, cb) {
    cb(EPERM)
  }

  handlers.setxattr = function (path, name, buffer, length, offset, flags, cb) {
    cb(0)
  }

  handlers.statfs = function (path, cb) {
    cb(0, {
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

  return engine

  // return engine
}
