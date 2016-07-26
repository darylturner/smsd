const fs = require('fs')
const bunyan = require('bunyan')
const restify = require('restify')
const uuid = require('uuid')
const libsms = require('./libsms')

// parse in configuration parameters
const configFile = process.argv[2] || './config.json'
try {
  var config = JSON.parse(fs.readFileSync(configFile))
} catch (err) {
  console.log('configuration file not found: ', err)
  process.exit(1)
}

// create bunyan logging instance
const log = bunyan.createLogger({name: 'smsd'})

// drop privileges if running as root
if (config.drop_priv) {
  if (process.getuid() === 0) {
    log.info('dropping privileges')
    process.setuid(config.user)
  }
}

// initalise message queues and modem objects
const messageQueue = []
let messageLog = []
const modem = libsms.create(config.modem)
modem.log.level('error')

// set up restify server and route handlers
const server = restify.createServer({
  name: 'smsd'
})
server.use(restify.bodyParser())

server.get('/', (req, res, next) => {
  res.send({
    code: 'ok',
    message: 'for sending texts and stuff'
  })
  return next()
})

if (config.enable_dashboard) {
  const socketio = require('socket.io')
  var dashboard = socketio.listen(server)
  server.get(/\/dashboard\/?.*/, restify.serveStatic({
    directory: __dirname,
    default: 'index.html'
  }))
} else {
    // null listener
    var dashboard = {
        emit: function(event, message) {
            return
        }
    }
}

server.get('/api/sms/queue', (req, res, next) => {
  res.send({
    code: 'ok',
    queue: messageQueue
  })
  return next()
})

server.get('/api/sms/log', (req, res, next) => {
  res.send({
    code: 'ok',
    log: messageLog
  })
  return next()
})

server.get('/api/modem/signal', (req, res, next) => {
  modem.signal((err, reply) => {
    if (err) {
      return next(err)
    } else {
      res.send({
        code: 'ok',
        signal: reply
      })
      return next()
    }
  })
})

server.post('/api/sms', (req, res, next) => {
  let message = req.params
  log.info({ message: message }, 'received request')

  if (messageQueue.length > config.max_queue) {
    const err = new restify.TooManyRequestsError('message queue length greater than configured limit')
    log.error(err)
    return next(err)
  }
  if (message.message.length > 160) {
    const err = new restify.BadRequestError('message too long')
    log.warn(err)
    return next(err)
  }
  if (!message.recipient.match(/^\d{11}$/)) {
    const err = new restify.BadRequestError('recipient number is malformed')
    log.warn(err)
    return next(err)
  }

  message.id = uuid.v4()
  message.retries = config.message_retries
  message.status = 'pending'
  message.timestamp = new Date()
  messageQueue.push(message)
  dashboard.emit('refresh')
  res.send({
    code: 'ok',
    message: message.id
  })
  return next()
})

// enter senderLoop, if queue is not empty rerun the loop
function senderLoop () {
  log.debug('senderLoop entered')
  if (!modem.locked && messageQueue.length > 0) {
    let message = messageQueue.shift()
    log.info({ message: message }, 'attempting to send message')
    modem.send(message, (err) => {
      message.timestamp = new Date()
      if (err) {
        if (message.retries > 0) {
          log.warn('failed to send message. requeuing')
          message.retries--
          message.status = 'retrying'
          messageQueue.unshift(message)
        } else {
          log.error('failed to send message. discarding')
          message.status = 'failed'
          messageLog.push(message)
        }
      } else {
        log.info('message sent')
        message.status = 'sent'
        messageLog.push(message)
      }
      messageLog = messageLog.slice(config.log_size * -1) // truncate log
      dashboard.emit('refresh')

      if (messageQueue.length > 0) {
        return senderLoop()
      } else {
        return
      }
    })
  }
}

// once modem is succesfully connected start listening for requests
modem.connect((err) => {
  if (err) {
    log.error(err)
    process.exit(1)
  }
  log.info('modem ready')
  server.listen(config.port)
  log.info(`server listening on ${config.port}`)
  setInterval(senderLoop, config.wake_interval * 1000) // periodically wake senderLoop
})

process.on('SIGINT', () => {
  log.info('caught sigint. closing gracefully')
  modem.close((err) => {
    if (!err) {
      process.exit(0)
    } else {
      log.error(err)
      process.exit(1)
    }
  })
})
