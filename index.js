var redis = require("redis");
var async = require("async");
var events = require("events");
var util = require("util");
var net = require('net');

function Sentinel(sentinels) {
  if (!(this instanceof Sentinel))
    return new Sentinel(sentinels);

  this.sentinels = sentinels.map(function (sentinel) {
    var client = redis.createClient(sentinel.port, sentinel.host, { retry_max_delay: 2500 })
    client.on('error', function () { });
    return client;
  });

  events.EventEmitter.call(this);
};

util.inherits(Sentinel, events.EventEmitter);

Sentinel.prototype.createClient = function (name, coptions) {
  var self = this;

  coptions = coptions || {};
  if (!coptions.retry_max_delay)
    coptions.retry_max_delay = 2500;

  var socket = new net.Socket();
  var client = new redis.RedisClient(socket, coptions);

  self.getMaster(name, function (err, master) {
    if (err)
      return client.emit('error', err);

    client.host = master.host;
    client.port = master.port;
    client.stream.connect(master.port, master.host);

    function resetMaster () {
      if (client.resettingMaster)
        return;

      client.resettingMaster = true;

      self.getMaster(name, function (err, master) {
        client.resettingMaster = false;

        if (err)
          return client.emit('error', err);

        client.host = master.host;
        client.port = master.port;

        client.stream.destroy();
      });
    }

    client.on('error', function (err) {
      if (client.closing)
        return;

      resetMaster();
    });

    self.on('switch-master', function (cluster) {
      if (cluster !== name)
        return;

      resetMaster();
    });

    var send_command = client.send_command;
    client.send_command = function (command, args, callback) {
      if (!callback && Array.isArray(args) && typeof args[args.length - 1] == 'function')
        callback = args.pop();

      send_command.call(client, command, args, function (err, response) {
        if (err && /READONLY/.test(err.message))
          client.emit('error', err);

        if (typeof callback == 'function')
          callback(err, response);
      });
    }
  });

  return client;
}

Sentinel.prototype.getMaster = function (name, next) {
  var index = 0
    , master = null
    , self = this

  next = next || function() {};

  async.until(function () {
    return master || index >= self.sentinels.length;
  }, function (next) {
    var client = self.sentinels[index++];

    client.send_command('SENTINEL', ['get-master-addr-by-name', name], function(err, result) {
      if (err || !result)
        return process.nextTick(next);

      if (index > 1) {
        self.sentinels.splice(index - 1, 1);
        self.sentinels.splice(0, 0, client);
      }

      if (self.activeClient !== client) {
        self.activeClient = client;

        if (self.listener)
          self.listener.end();

        self.listener = redis.createClient(client.port, client.host);

        self.listener.on('error', function (err) {});

        self.listener.on('pmessage', function(channel, msg, data) {
          if (msg == '+switch-master')
            self.emit('switch-master', data.split(/\s+/)[0]);
        });

        self.listener.psubscribe('*');
      }

      master = { host: result[0], port: result[1] };
      process.nextTick(next);
    });
  }, function (err) {
    if (err) return next(err);

    if (!master) {
      var err = new Error("Unable to determine master for " + name);
      self.emit('error', err);
      return next(err);
    }

    next(null, master);
  });
};

module.exports = Sentinel;
