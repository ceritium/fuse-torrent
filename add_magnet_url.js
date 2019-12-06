const torrentStream = require('torrent-stream')
const sqlite = require('sqlite')

async function insert(magnetUrl, ts){
  const db = await sqlite.open('./database.sqlite');
  let files = ts.files.map((file) => {
    return {path: file.path, length: file.length}
  })
  console.log("Files:")
  files.forEach(file => console.log(file))
  let metadata = JSON.stringify({files: files})
  await db.run("INSERT INTO Torrents (magnet_url, name, infohash, metadata) VALUES (?, ?, ?, ?)",
    [magnetUrl, ts.torrent.name, ts.infohash, metadata]);
}
async function start(magnetUrl) {
  console.log("Fetching torrent")
  let ts = torrentStream(magnetUrl)
  ts.on('ready', function(){
    insert(magnetUrl, ts).then(()=>
      process.exit()
    )
  })
}

start(process.argv[2])
