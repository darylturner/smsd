var modem = require('./libsms')

var wavecom = modem.create({
    device: '/dev/cuau0', baudrate: 115200,
    xon: true, xoff: true
})

wavecom.connect((err) => {
    wavecom.signal((err, reply) => {
        if (err) { console.log('error on signal: ' + err) }
        else {
            console.log(JSON.stringify(reply))
        }
        wavecom.close()
    })
})
