const sqlite = require('sqlite')
const Promise = require('bluebird')

Promise.resolve()
  .then(() => sqlite.open('./database.sqlite', { Promise }))
  .then(db => db.migrate({ force: 'last' }))
