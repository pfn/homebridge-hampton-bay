// {
//  "accessory": "HBay",
//  "name": "Ceiling One",
//  "fanName": "Fan One",
//  "irblaster": "ESP_8695EC",
//  "remote_code": "1000",
//  "out": 3
// }

// Hampton Bay - No direction function
// Dimming is not predictable, so not enabled

"use strict";

var debug = require('debug')('HBay');
const packageConfig = require('./package.json');
var Service, Characteristic, cmdQueue;
var os = require("os");
const { exec } = require('child_process');
var hostname = os.hostname();

var fanCommands = {
  // bedroom = 0x200, kitchen = 0x100
  fanOff: 0x10,
  fanLow: 0x4,
  fanMed: 0x2,
  fanHigh: 0x1,
  lightND: 0x8,
  lightD: 0x0,
  busy: 400 // delay
};

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerPlatform("homebridge-hampton-bay", "HBay", hamptonBayPlatform);
};

function hamptonBayPlatform(log, config, api) {
  this.devices = config.devices;
  this.log = log;
  this.api = api;
}

hamptonBayPlatform.prototype = {
  accessories: function(callback) {
    var accessories = [];
    this.devices.forEach((config, i) => {
      this.log("Adding", (config.name ? config.name : config.lightName));
      var accessory = new HBay(this.log, config);
      accessories.push(accessory);
    });
    callback(accessories);
  }
};

function HBay(log, config, api) {
  this.log = log;
  this.name = (config.name ? config.name : config.lightName);

  this.fanName = config.fanName || this.name + " fan";
  this.lightName = config.lightName || this.name + " light";

  this.remote_code = config.remote_code;

  this.dimmable = config.dimmable || false; // Default to not dimmable
  this.light = (config.light !== false); // Default to has light
  this.direction = config.winter || true; // Hampton does not support direction

  debug("Light", this.light);
  debug("Dimmable", this.dimmable);

  if (this.dimmable) {
    fanCommands.light = fanCommands.lightD;
    fanCommands.dimmable = "0";
  } else {
    fanCommands.light = fanCommands.lightND;
    fanCommands.dimmable = "1";
  }

  // Below are the legacy settings

  this.stateful = config.stateful || false;
  this.on_busy = config.on_busy || 1;
  this.off_busy = config.off_busy || 1;
  this.down_busy = config.down_busy || 1;
  this.up_busy = config.up_busy || 1;

  this.on_data = config.on_data;
  this.off_data = config.off_data;
  this.up_data = config.up_data;
  this.down_data = config.down_data;
  this.start = config.start || undefined;
  this.steps = config.steps || 4;
  this.count = config.count || 0;

  this.working = Date.now();

  this.log.info(
    '%s v%s, node %s',
    packageConfig.name, packageConfig.version, process.version
  );

  debug("Adding Fan", this.fanName);
  this._fan = new Service.Fan(this.fanName);
  this._fan.getCharacteristic(Characteristic.On)
    .on('set', this._fanOn.bind(this));

  this._fan
    .addCharacteristic(new Characteristic.RotationSpeed())
    .on('set', this._fanSpeed.bind(this))
    .setProps({
      minStep: 5
    });

  //  this._fan
  //    .addCharacteristic(new Characteristic.RotationDirection())
  //    .on('set', this._fanDirection.bind(this));

  this._fan.getCharacteristic(Characteristic.RotationSpeed).updateValue(fanCommands.start);

  //  this._fan.getCharacteristic(Characteristic.RotationDirection).updateValue(this.direction);

  if (this.light) {
    debug("Adding Light", this.lightName);
    this._light = new Service.Lightbulb(this.lightName);
    this._light.getCharacteristic(Characteristic.On)
      .on('set', this._lightOn.bind(this));

    if (this.dimmable) {
      this._light
        .addCharacteristic(new Characteristic.Brightness())
        .on('set', this._lightBrightness.bind(this));
    }
  }

  if (this.start === undefined && this.on_data && this.up_data) {
    this.resetDevice();
  }
}

HBay.prototype.getServices = function() {
  var informationService = new Service.AccessoryInformation();

  informationService
    .setCharacteristic(Characteristic.Manufacturer, "hampton-bay")
    .setCharacteristic(Characteristic.Model, "hampton-bay")
    .setCharacteristic(Characteristic.SerialNumber, hostname + "-" + this.name)
    .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);

  if (this.light) {
    return [this._fan, this._light, informationService];
  } else {
    return [this._fan, informationService];
  }
};

HBay.prototype._fanOn = function(on, callback) {
  this.log("Setting " + this.fanName + " _fanOn to " + on);

  if (on) {
    // Is the fan already on?  Don't repeat command
    if (!this._fan.getCharacteristic(Characteristic.On).value) {
      execQueue.call(this, "toggle", fanSpeed(this._fan.getCharacteristic(Characteristic.RotationSpeed).value), 1, fanCommands.busy, function(error, response, responseBody) {
        if (error) {
          this.log('HBay failed: %s', error.message);
          callback(error);
        } else {
          //  debug('HBay succeeded!', this.url);
          callback();
        }
      }.bind(this));
    } else {
      debug('Fan already on', this.url);
      callback();
    }
  } else {
    execQueue.call(this, "toggle", fanCommands.fanOff, 1, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  }
};

HBay.prototype._fanSpeed = function(value, callback) {
  if (value > 0) {
    this.log("Setting " + this.fanName + " _fanSpeed to " + value);
    execQueue.call(this, "toggle", fanSpeed(value), 1, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else {
    this.log("Not setting " + this.fanName + " _fanSpeed to " + value);
    setTimeout(function() {
      this._fan.getCharacteristic(Characteristic.RotationSpeed).updateValue(fanCommands.start);
    }.bind(this), 100);
    callback();
  }
};

HBay.prototype._lightOn = function(on, callback) {
  this.log("Setting " + this.lightName + " _lightOn to " + on);

  if (on && !this._light.getCharacteristic(Characteristic.On).value) {
    execQueue.call(this, "toggle", fanCommands.light, 1, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else if (!on && this._light.getCharacteristic(Characteristic.On).value) {
    execQueue.call(this, "toggle", fanCommands.light, 1, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else {
    debug("Do nothing");
    callback();
  }
};

HBay.prototype._fanDirection = function(on, callback) {
  this.log("Setting " + this.fanName + " _summerSetting to " + on);

  if (on) {
    this.direction = true;
    execQueue.call(this, "direction", fanCommands.reverse, 1, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else {
    this.direction = false;
    execQueue.call(this, "direction", fanCommands.forward, 1, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  }
};

HBay.prototype._lightBrightness = function(value, callback) {
  // debug("Device", this._fan);
  this.log("Setting " + this.lightName + " _lightBrightness to " + value);

  var current = this._fan.getCharacteristic(Characteristic.RotationSpeed)
    .value;

  if (current === undefined) {
    current = this.start;
  }

  if (value === 100 && current === 0) {
    callback(null, current);
    return;
  }

  var _value = Math.floor(value / (100 / this.steps));
  var _current = Math.floor(current / (100 / this.steps));
  var delta = Math.round(_value - _current);

  debug("Values", this.lightName, value, current, delta);

  if (delta < 0) {
    // Turn down device
    this.log("Turning down " + this.lightName + " by " + Math.abs(delta));
    execQueue.call(this, "down", this.down_data, Math.abs(delta) + this.count, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else if (delta > 0) {
    // Turn up device

    this.log("Turning up " + this.lightName + " by " + Math.abs(delta));
    execQueue.call(this, "up", this.up_data, Math.abs(delta) + this.count, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else {
    this.log("Not controlling " + this.name, value, current, delta);
    callback();
  }
};

HBay.prototype._setState = function(on, callback) {
  this.log("Turning " + this.lightName + " to " + on);

  debug("_setState", this.lightName, on, this._fan.getCharacteristic(Characteristic.On).value);

  if (on && !this._fan.getCharacteristic(Characteristic.On).value) {
    execQueue.call(this, "on", this.on_data, 1, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        var current = this._fan.getCharacteristic(Characteristic.RotationSpeed)
          .value;
        if (current !== this.start && this.start !== undefined) {
          debug("Setting level after turning on ", this.start);
          this._fan.getCharacteristic(Characteristic.RotationSpeed).updateValue(this.start);
        }
        callback();
      }
    }.bind(this));
  } else if (!on && this._fan.getCharacteristic(Characteristic.On).value) {
    execQueue.call(this, "off", this.off_data, 1, fanCommands.busy, function(error, response, responseBody) {
      if (error) {
        this.log('HBay failed: %s', error.message);
        callback(error);
      } else {
        //  debug('HBay succeeded!', this.url);
        callback();
      }
    }.bind(this));
  } else {
    debug("Do nothing");
    callback();
  }
};

HBay.prototype.resetDevice = function() {
  debug("Reseting volume on device", this.name);
  execQueue.call(this, "on", this.on_data, 1, fanCommands.busy);
  execQueue.call(this, "down", this.down_data, this.steps, fanCommands.busy);
  execQueue.call(this, "up", this.up_data, 2, fanCommands.busy);
  execQueue.call(this, "off", this.off_data, 1, fanCommands.busy, function(error, response, responseBody) {
    this._fan.getCharacteristic(Characteristic.RotationSpeed).updateValue(2);
  }.bind(this));
};

cmdQueue = {
  items: [],
  isRunning: false
};

function execQueue() {
  // push these args to the end of the queue

  cmdQueue.items.push([this, arguments]);

  // run the queue
  runQueue();
}

function runQueue() {
  if (!cmdQueue.isRunning && cmdQueue.items.length > 0) {
    cmdQueue.isRunning = true;
    var cmds = cmdQueue.items.shift();
    var that = cmds[0];
    var args = cmds[1];

    if (typeof(args[args.length -1]) === 'function') {
      // wrap callback with another function to toggle isRunning

      var callback = args[args.length - 1];
      args[args.length - 1] = function() {
        callback.apply(null, arguments);
        cmdQueue.isRunning = false;
        runQueue();
      };
    } else {
      // add callback to toggle isRunning

      args[args.length] = function() {
        cmdQueue.isRunning = false;
        runQueue();
      };
      args.length = args.length + 1;
    }
    fanctl.apply(that, args);
  }
}

function fanctl(command, code, count, sleep, callback) {
  var cmdTime = Date.now() + sleep * count;

  this.log(`${command}: remote: ${this.remote_code}, command: ${code}`);

  if (code == null) {
    this.log(`${command}, code not set`);
    callback(null, "", "");
  } else {
    exec(`/home/homebridge/fanctl/bin/fanctl ${this.remote_code | code}`, (err, stdo, stde) => {
      setTimeout(function() {
        if (typeof(callback) === 'function') callback(err, stdo, stde);
        else this.log("callback is not a function: " + typeof(callback));
      }, cmdTime - Date.now());
    });
  }
}

function _fanSpeed(speed) {
  debug("Fan Speed", speed);
  var command;
  switch (true) {
    case (speed < 16):
      command = fanCommands.fanOff;
      break;
    case (speed < 33 + 16):
      command = fanCommands.fanLow;
      break;
    case (speed < 66 + 16):
      command = fanCommands.fanMed;
      break;
    case (speed < 101):
      command = fanCommands.fanHigh;
      break;
  }
  return command;
}
