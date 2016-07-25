const modem = require('./libsms')

const wavecom = modem.create({
  device: '/dev/tty.usbserial-142', baudrate: 115200,
  xon: false, xoff: false, rtscts: true
})

const message = {
  recipient: process.argv[2],
  message: process.argv[3]
}

wavecom.connect((err) => {
  if (err) {
    throw err
  }
  wavecom.send(message, (err, reply) => {
    if (err) {
      console.log('error on send: ' + err)
    }
    wavecom.close(() => {
      console.log('done')
    })
  })
})
