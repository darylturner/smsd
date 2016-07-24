const serialport = require('serialport');
const bunyan = require('bunyan');
const EventEmitter = require('events');

const modem = {
    create: function(options) {
        const instance = Object.create(this);
        instance.emitter = new EventEmitter;
        instance.options = options;
        instance.options.autoOpen = false;
        instance.locked = false;
        instance.log = bunyan.createLogger({
            name: 'sms',
            level: 'error'
        });
        return instance;
    },
    connect: function(callback) {
        this.port = new serialport(this.options.device, this.options);
        this.log.info('opening serial port');
        this.port.open(err => {
            this.log.info('port opened');
            if (!err) {
                this.port.flush(err => {
                    if (err) {
                        this.log.error(err, 'error flushing data');
                        return callback(err);
                    }
                    this.startDataHandler();
                    this.log.info('setting up modem')
                    this.port.write('ATE0;+CMGF=1\r', err => {
                        this.emitter.once('termination', callback);
                    });
                });
            } else {
                this.log.error(err, 'error opening port');
                return callback(err);
            }
        });
    },
    signal: function(callback) {
        if (this.locked) {
            return callback(new Error('modem locked'));
        }
        this.locked = true;
        this.log.info('querying modem signal strength')
        const cmd = 'AT+CSQ\r';
        this.log.debug({sent: cmd});
        this.port.write(cmd, err => {
            if (err) {
                this.log.error(err);
                return callback(err);
            }
            this.emitter.once('termination', (err, reply) => {
                if (!err) {
                    this.log.info('received signal information')
                    const result = reply.split('\n')[1]
                                 .split(':')[1].trim().split(',');
                    const rssi = parseInt(result.shift(), 10);
                    const ber = parseInt(result.shift(), 10);
                    let status
                    if (rssi < 11) {
                        status = 'weak';
                    } else if (rssi > 10 & rssi < 32) {
                        status = 'good';
                    } else if (rssi == 99) {
                        status = 'disconnected';
                    } else { status = 'unknown'; }
                    return callback(null, {
                        rssi: rssi,
                        ber: ber,
                        status: status
                    });
                } else {
                    this.log.error(err, 'error on signal query');
                    return callback(err, reply);
                }
            });
        });
    },
    send: function(sms, callback) {
        if (this.locked) {
            return callback(new Error('modem locked'));
        }
        this.locked = true;
        this.log.info({sms: sms}, 'attempting to send message');
        const cmd = `AT+CMGS=${sms.recipient}\r`;
        this.log.debug({sent: cmd});
        this.port.write(cmd, err => {
            if (err) {
                this.log.error(err, 'error on message write')
                this.locked = false;
                return callback(err);
            }
            this.emitter.once('continue', () => {
                const cmd = `${sms.message}${String.fromCharCode(26)}`;
                this.log.debug({sent: cmd});
                this.port.write(cmd, () => {
                    this.emitter.once('termination', callback);
                });
            })
        });
    },
    close: function(callback) {
        this.port.close(callback);
    },
    startDataHandler: function() {
        let buffer = '';
        this.port.on('data', chunk => {
            this.log.debug({received: chunk.toString()})
            buffer += chunk;
            if (buffer.search('>') !== -1) {
                this.emitter.emit('continue', null, null);
                buffer = '';
            } else if (buffer.search('ERROR') !== -1) {
                err = new Error('modem error');
                this.log.error(err);
                this.emitter.emit('termination', err, buffer);
                buffer = '';
                this.locked = false;
            } else if (buffer.search('OK') !== -1) {
                this.emitter.emit('termination', null, buffer);
                buffer = '';
                this.locked = false;
            }
        });
    }
}

module.exports = modem;
