var modem = require('./libsms')

var wavecom = modem.create({
    device: '/dev/tty.usbserial-142', baudrate: 115200,
    xon: false, xoff: false, rtscts: true
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
