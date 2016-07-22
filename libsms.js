var serialport = require('serialport');
var bunyan = require('bunyan');

var modem = {
    create: function(options) {
        var instance = Object.create(this);
        instance.options = options;
        instance.options.autoOpen = false;
        instance.locked = false;
        instance.log = new bunyan({
            name: 'sms',
            level: 'error'
        });
        return instance;
    },
    connect: function(callback) {
        this.port = new serialport(this.options.device, this.options);
        this.log.info('opening serial port');
        this.port.open((err) => {
            this.log.info('port opened');
            if (!err) {
                this.port.flush((err) => {
                    if (err) {
                        this.log.error(err, 'error flushing data');
                        return callback(err);
                    }
                    this.log.info('setting up modem')
                    this.port.write('ATE0;+CMGF=1\r', (err) => {
                        this.wait(callback);
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
        this.port.write('AT+CSQ\r', (err) => {
            if (err) {
                this.log.error(err);
                return callback(err);
            }
            this.wait((err, reply) => {
                if (!err) { //parse reply from modem
                    this.log.info('received signal information')
                    var result = reply.split('\n')[1]
                                 .split(':')[1].trim().split(',');
                    var rssi = parseInt(result.shift(), 10);
                    var ber = parseInt(result.shift(), 10);
                    var status
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
        var command = `AT+CMGS=${sms.recipient}\r${sms.message}${String.fromCharCode(26)}`;
        this.log.debug({sending: command});
        this.port.write(command, (err) => {
            if (err) {
                this.log.error(err, 'error on message write')
                return callback(err);
            }
            this.wait((err, buffer) => {
                if (err) {
                    callback(err);
                } else {
                    callback();
                }
            });
        });
    },
    close: function(callback) {
        this.port.close(callback);
    },
    wait: function(callback) {
        this.log.info('waiting for modem response')
        var buffer = '';
        var self = this; // need a named function here so need a scoped this.
        this.port.on('data', function parser(chunk) {
            self.log.debug({received: chunk.toString()})
            buffer += chunk;
            // search for message delimiter
            if (buffer.search(/OK|ERROR/) !== -1) {
                var err;
                if (buffer.search('ERROR') !== -1) {
                    err = new Error('modem error')
                    self.log.error(err);
                }
                self.port.removeListener('data', parser);
                self.locked = false;
                return callback(err, buffer);
            }
        });
    }
}

module.exports = modem;
