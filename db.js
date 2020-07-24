const Datastore = require('nedb')
const path = require('path')
const os = require('os')

const dbPath = path.join(os.homedir(), '.fusetorrent')
const dbFile = path.join(dbPath, 'datastore')

const db = new Datastore({ filename: dbFile, autoload: true })

const dbFind = function (query = {}, cb) {
  return db.find(query, (err, items) => {
    if (err) console.log(err)
    cb(items)
  })
}

module.exports = { db, dbFind }
