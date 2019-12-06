const torrentStream = require('torrent-stream')
let ts = torrentStream("magnet:?xt=urn:btih:3614a11d8dca137277560151c0027279e8d121e3&dn=Novecento+aka+1900+(1976)+720p+BRrip_sujaidr_TMRG&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com")

ts.on('ready', function(){
  console.log(ts.torrent.name)
  ts.files.forEach(file => {
    debugger
    console.log(file.path)
  })
  process.exit()
})
