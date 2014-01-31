# sentinel-redis
Redis Sentinel client for Node.JS

    npm install sentinel-redis

##Usage
    var rs = require("sentinel-redis")

    // Create a new sentinel manager with the array of sentinel server definitions
    var sentinel = rs([
      { host: '127.0.0.1', port: 26379 },
      { host: '127.0.0.1', port: 26380 },
      { host: '127.0.0.1', port: 26381 }
    ]);

    // Create a new Redis client for given master and with the supplied options.
    // This is a regular Redis client. You can do whatever you want with it at this point.
    // In case of a failover, it will transparently switch to new master and keep working.
    var client = sentinel.createClient("masterName", options);

##license
MIT
