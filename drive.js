const fuse = require('fuse-bindings')
const mkdirp = require('mkdirp')
const torrentStream = require('torrent-stream')
const path = require('path')
const events = require('events')

var ENOENT = -2
var EPERM = -1
var ZERO = 0

const LISTEN_PORT = 65510

module.exports = function (source, mnt, tmp, db) {
  var drive = new events.EventEmitter()
  var handlers = {}
  var ctime = new Date()
  var mtime = new Date()
  let uninterestedAt
  let lastStLog
  let lastSeedHoursUpdate
  let lastStatsUpdate
  let lastUploaded
  let lastDownloaded
  let lastread
  let listening
  let mounted

  const sourceFiles = JSON.parse(source.metadata).files

  console.log(`DRIVE ${source.st} ${source.name}`)

  source.mnt = path.join(mnt, path.resolve('/', source.name))

  fuse.unmount(source.mnt, function () {
    if (source.deletereq) return
    mkdirp(source.mnt, function () {
      if (source.deletereq) return
      fuse.mount(source.mnt, handlers)
      mounted = true
      drive.emit('mount', source)
    })
  })

  let _engine
  function engine () {
    if (!_engine) {
      const deleteTorrent = () => {
        const _do = () => {
          if (interval) {
            clearInterval(interval)
            interval = null
          }
          engine().destroy()
          engine().remove(() => {
            console.log(`DONE DELETE-TORRENT ${source.name}`)
            db.run('DELETE FROM Torrents WHERE id = ?', [source.id])
            drive.emit('deleted', source)
          })
        }
        console.log(`init DELETE-TORRENT ${source.name}`)
        if (mounted) {
          fuse.unmount(source.mnt, () => {
            drive.emit('unmount', source)
            _do()
          })
        } else {
          _do()
        }
      }

      const switchToLeech = () => {
        if (source.deletereq) return
        if (lastStLog !== 'LEECH') {
          lastStLog = 'LEECH'
          console.log(`LEECH ${source.name}`)
        }
        uninterestedAt = null
        if (source.st !== 'LEECH') {
          source.st = 'LEECH'
          source.seedhours = 0
          db.run('UPDATE Torrents set st = ?, seedhours = ? where id = ?', ['LEECH', 0, source.id])
        }
        if (!listening) {
          _engine.listen(LISTEN_PORT)
          listening = true
        }
      }

      const switchToSeed = () => {
        lastStLog = 'SEED'
        console.log(`SEED ${source.name}`)
        source.st = 'SEED'
        lastSeedHoursUpdate = new Date()
        db.run('UPDATE Torrents set st = ? where id = ?', ['SEED', source.id])
      }

      const switchToIdle = () => {
        lastStLog = 'IDLE'
        console.log(`IDLE ${source.name}`)
        source.st = 'IDLE'
        db.run('UPDATE Torrents set st = ? where id = ?', ['IDLE', source.id])
        clearInterval(interval)
        engine().destroy()
        _engine = null
        drive.emit('stop', source)
      }

      const switchToFreed = () => {
        lastStLog = 'FREED'
        console.log(`FREED ${source.name}`)
        source.st = 'FREED'
        db.run('UPDATE Torrents set st = ? where id = ?', ['FREED', source.id])
        clearInterval(interval)
        engine().destroy()
        engine().remove(() => {
          console.log(`DONE FREED-TORRENT ${source.name}`)
        })
        _engine = null
        drive.emit('stop', source)
      }

      uninterestedAt = Date.now()
      lastStLog = null
      lastStatsUpdate = Date.now()
      lastUploaded = 0
      lastDownloaded = 0
      lastread = source.lastread || 0
      listening = false
      drive.emit('start', source)

      _engine = torrentStream(source.magnet_url || Buffer.from(source.torrentfile, 'base64'), { tmp: tmp, dht: false, connections: 20, uploads: 8 })
      // _engine.swarm.utp = true
      drive.engine = _engine

      if (source.deletereq) {
        _engine.once('ready', deleteTorrent)
        return
      }

      if (source.st === 'SEED') {
        lastSeedHoursUpdate = new Date()
      }
      if (source.st === 'LEECH' || source.st === 'SEED') {
        _engine.listen(LISTEN_PORT)
        listening = true
      }
      if (!source.st || source.st === 'FREED') {
        switchToLeech()
      }

      var stateUpdateTimerFn = function () {
        if (!_engine) return clearInterval(interval)

        const dateNow = new Date()

        if ((dateNow - lastStatsUpdate) / 1000 > (120 + Math.random() * 5)) { // update stats in db every 120-125s
          const uploaded = _engine.uploaded
          const downloaded = _engine.downloaded
          lastStatsUpdate = Date.now()

          if (lastUploaded !== uploaded || lastDownloaded !== downloaded || lastread !== source.lastread) {
            source.totalup = (source.totalup || 0) + (uploaded - lastUploaded)
            source.totaldown = (source.totaldown || 0) + (downloaded - lastDownloaded)
            source.lastread = lastread
            lastUploaded = uploaded
            lastDownloaded = downloaded
            db.run('UPDATE Torrents set totalup = ?, totaldown = ?, lastread = ? where id = ?', [source.totalup, source.totaldown, source.lastread, source.id])
          }
        }

        if (source.st === 'LEECH' && uninterestedAt && (dateNow - uninterestedAt) / 1000 > 5 * 60) { // switch to seed after 5m uninterested
          switchToSeed()
        }
        if (source.st === 'SEED') {
          if ((dateNow - lastSeedHoursUpdate) / 1000 > 60 * 60) { // update seedhours
            lastSeedHoursUpdate = dateNow
            source.seedhours = source.seedhours ? source.seedhours + 1 : 1
            console.log(`SEED ${source.seedhours}h ${source.name}`)
            db.run('UPDATE Torrents set seedhours = ? where id = ?', [source.seedhours, source.id])
          }
          if (source.seedhours >= 100 && (dateNow - lastread) / 1000 > 24 * 60 * 60) { // switch to freed if seeded for 100hrs and no access in past 24h
            // switchToIdle()
            switchToFreed()
          }
        }
        // if (source.st === 'IDLE' && (dateNow - lastread) / 1000 > 5 * 60) { // switch to freed adter 10 min no read
        //   switchToFreed()
        // }
      }
      var interval

      engine().once('ready', function () {
        drive.emit('ready', source)
        interval = setInterval(stateUpdateTimerFn, (30 + Math.random() * 5) * 1000) // run state update every 30-35s

        engine().on('uninterested', function () {
          uninterestedAt = new Date()
        })

        engine().on('interested', switchToLeech)
      })

      _engine.signalRead = () => {
        lastread = new Date()
      }
    }

    return _engine
  }

  if (!source.st || source.st === 'SEED' || source.st === 'LEECH') {
    engine()
  }

  const findFromTorrent = function (path) {
    return engine().files.reduce(function (result, file) {
      return result || (file.path === path && file)
    }, null)
  }

  var find = function (path) {
    return sourceFiles.reduce(function (result, file) {
      return result || (file.path === path && file)
    }, null)
  }

  handlers.displayFolder = true
  handlers.options = ['allow_other', 'auto_cache']

  handlers.getattr = function (path, cb) {
    if (source.deletereq) return cb(ENOENT);
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
      return cb(ZERO, stat)
    }

    stat.size = 4096
    stat.mode = 16877 // 040755

    if (!path) return cb(ZERO, stat)

    var dir = sourceFiles.some(function (file) {
      return file.path.indexOf(path + '/') === 0
    })

    if (!dir) return cb(ENOENT)
    cb(ZERO, stat)
  }

  var files = {}

  handlers.open = function (path, flags, cb) {
    if (source.deletereq) return cb(ENOENT);
    path = path.slice(1)

    var file = find(path)
    if (!file) return cb(ENOENT)

    var fs = files[path] = files[path] || []
    var fd = fs.indexOf(null)
    if (fd === -1) fd = fs.length

    fs[fd] = { offset: 0 }

    cb(ZERO, fd)
  }

  handlers.release = function (path, handle, cb) {
    path = path.slice(1)

    var fs = files[path] || []
    var f = fs[handle]

    if (f && f.stream) f.stream.destroy()
    fs[handle] = null

    cb(ZERO)
  }

  handlers.readdir = function (path, cb) {
    if (source.deletereq) return cb(ENOENT);
    path = path.slice(1)

    var uniq = {}
    var files = sourceFiles
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
    cb(ZERO, files)
  }

  handlers.read = function (path, handle, buf, len, offset, cb) {
    if (source.deletereq) return cb(ENOENT);
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
      if (source.deletereq) return cb(ENOENT);
      if (engine().files.length === 0) return engine().once('ready', liip)

      engine().signalRead()

      if (!f.stream) {
        const f2 = findFromTorrent(path)
        f.stream = f2.createReadStream({ start: offset })
        f.offset = offset
      }

      var loop = function () {
        if (source.deletereq) return cb(ENOENT);
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
    cb(ZERO)
  }

  handlers.statfs = function (path, cb) {
    if (source.deletereq) return cb(ENOENT);
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

  drive.destroy = function (cb) {
    if (!_engine) return cb()
    engine().destroy(cb)
  }

  return drive
}
