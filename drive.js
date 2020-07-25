const prettysize = require('prettysize')
const Fuse = require('fuse-native')
const torrentStream = require('torrent-stream')
const path = require('path')

const dbFind = require('./db.js').dbFind

const ENOENT = Fuse.ENOENT
const ZERO = 0

module.exports = async function (mnt, tmp) {
  const ctime = new Date()
  const mtime = new Date()
  let uninterestedAt = null

  let items = []
  let sourceFiles = []
  let categories = []
  const files = {}

  async function refreshFiles () {
    dbFind({}, (newItems) => {
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
        const newSourceFiles = []
        items.forEach(function (item) {
          const itemFiles = JSON.parse(item.metadata).files
          itemFiles.forEach(function (file) {
            if (item.category) {
              file.path = path.join(item.category, file.path)
            }
            newSourceFiles.push(file)
          })
        })
        sourceFiles = newSourceFiles
      }
    })
  }

  await refreshFiles()
  setInterval(refreshFiles, 5000)

  const handlers = {
    readdir: function (filePath, cb) {
      filePath = filePath.slice(1)

      const uniq = {}
      const files = sourceFiles
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
    },
    getattr: function (filePath, cb) {
      filePath = filePath.slice(1)

      const stat = {}
      const file = find(filePath)

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

      const dir = sourceFiles.some(function (file) {
        return file.path.indexOf(filePath + '/') === 0
      })

      if (!dir) return cb(ENOENT)

      return cb(ZERO, stat)
    },

    open: function (filePath, flags, cb) {
      filePath = filePath.slice(1)

      const file = find(filePath)
      if (!file) return cb(ENOENT)

      const fs = files[filePath] = files[filePath] || []
      let fd = fs.indexOf(null)
      if (fd === -1) fd = fs.length

      fs[fd] = { offset: 0 }

      return cb(ZERO, fd)
    },

    release: function (filePath, handle, cb) {
      filePath = filePath.slice(1)

      const fs = files[filePath] || []
      const f = fs[handle]

      if (f && f.stream) f.stream.destroy()
      fs[handle] = null

      return cb(ZERO)
    },

    read: function (filePath, handle, buf, len, offset, cb) {
      filePath = filePath.slice(1)

      const file = find(filePath)
      const fs = files[filePath] || []
      const f = fs[handle]

      if (!file) return cb(ENOENT)
      if (!f) return cb(ENOENT)

      if (len + offset > file.length) len = file.length - offset

      if (f.stream && f.offset !== offset) {
        f.stream.destroy()
        f.stream = null
      }

      const loop = function () {
        if (engine(filePath).files.length === 0) return engine(filePath).once('ready', loop)

        if (!f.stream) {
          const f2 = findFromTorrent(filePath)
          f.stream = f2.createReadStream({ start: offset })
          f.offset = offset
        }

        const innerLoop = function () {
          const result = f.stream.read(len)
          if (!result) return f.stream.once('readable', innerLoop)
          result.copy(buf)
          cb(result.length)
        }

        innerLoop()
      }

      loop()
    }
  }

  const opts = { force: true, mkdir: true, displayFolder: true }
  const fuse = new Fuse(mnt, handlers, opts)
  fuse.mount()
  console.log(`fuse-torrent ready: ${mnt}`)

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

      let _engine = torrentStream({ infoHash: target.infoHash }, { tmp: tmp })
      _engines[name] = _engine

      var harakiri = function () {
        if (uninterestedAt) {
          const lapsus = (new Date() - uninterestedAt) / 1000
          if (lapsus > 60) {
            uninterestedAt = null
            clearInterval(interval)
            if (_engine) {
              _engines[name] = null
              _engine.destroy()
              _engine = null
            }
            console.log('Stop swarm ' + name)
          }
        }
      }
      var interval = setInterval(harakiri, 6000)

      _engine.on('uninterested', function () {
        uninterestedAt = new Date()
        _engine.swarm.pause()
      })

      _engine.on('interested', function () {
        uninterestedAt = null
        if(_engine.swarm) {
          _engine.swarm.resume()
        } else {
          _engine
      })

      _engine.once('ready', () => console.log('Swarm ready ' + name))

      _engine.on('download', index => {
        const down = prettysize(_engine.swarm.downloaded)
        const downSpeed = prettysize(_engine.swarm.downloadSpeed()).replace('Bytes', 'b') + '/s'

        const notChoked = function (result, wire) {
          return result + (wire.peerChoking ? 0 : 1)
        }
        const connects = _engine.swarm.wires.reduce(notChoked, 0) + '/' + _engine.swarm.wires.length + ' peers'

        console.log('Downloaded ' + connects + ' : ' + downSpeed + ' : ' + down + ' of ' + prettysize(_engine.torrent.length) + ' for ' + name + ' : ' + index)
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

  const find = function (filePath) {
    return sourceFiles.reduce(function (result, file) {
      return result || (file.path === filePath && file)
    }, null)
  }

  process.once('SIGINT', function () {
    setTimeout(process.kill.bind(process, process.pid), 2000).unref()
    fuse.unmount(err => {
      if (err) {
        console.log('filesystem at ' + fuse.mnt + ' not unmounted', err)
      } else {
        console.log('filesystem at ' + fuse.mnt + ' unmounted')
      }
    })
  })
}
