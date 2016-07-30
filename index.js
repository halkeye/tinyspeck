"use strict";

const url = require('url'),
      http = require('http'),
      https = require('https'),
      WebSocket = require('ws'),
      qs = require('querystring'),
      EventEmitter = require('events');
      

class TinySpeck extends EventEmitter {
  /**
   * Contructor
   *
   * @param {Object} defaults - The default config for the instance
   */
  constructor(defaults) {
    super();
    this.cache = {};
    this.defaults = defaults || {};
    
    // loggers
    this.on('error', console.error);
  }


  /**
   * Create an instance of the Slack adapter
   *
   * @param {Object} defaults - The default config for the instance
   * @return {Slack} A new instance of the Slack adapter
   */
  instance(defaults) {
    return new this.constructor(defaults);
  }


  /**
   * Write a message using the best connector
   *
   * @param {string|object} message - A text message or object to send
   * @return {Promise} A promise with the API result
   */
  write(message) {
    if (typeof message === 'string') message = { text: message };
    let payload = Object.assign({}, message, { type: 'message' });
    return this.send('chat.postMessage', payload);
  }


  /**
   * Send data to Slack's API
   *
   * @param {string} endPoint - The method name or url
   * @param {object} payload - The JSON payload to send
   * @return {Promise} A promise with the API result
   */
  send(endPoint, payload) {    
    // use defaults when available
    let args = Object.assign({}, this.defaults, payload);

    if (this.ws && args.type === 'message' && !args.attachments) {
      return new Promise((resolve, reject) => {
        this.ws.send(JSON.stringify(args), err => err ? reject(err) : resolve(this.ws));
      });
    } else {
      // encode attachments for form data
      if (args.attachments) args.attachments = JSON.stringify(args.attachments);        
      
      return this.post(endPoint, args);
    }
  }


  /**
   * Digest a Slack message and process events
   *
   * @param {object|string} message - The incoming Slack message
   * @return {Message} The parsed message
   */
  digest(message) {
    if (typeof message === 'string') {
      try {
        message = JSON.parse(message); // JSON string
      } catch(err) {
        message = qs.parse(message); // QueryString
      }
    }

    let {event_ts, event, command, type, trigger_word, payload} = message;
    this.emit('*', message);  // wildcard support

    // notify message button triggered by callback_id
    if (payload) {
      message.payload = JSON.parse(payload);
      this.emit(payload.callback_id, message);
    }

    // notify incoming message by type
    if (type) this.emit(type, message);

    // notify slash command by command
    if (command) this.emit(command, message);

    // notify event triggered by event type
    if (event) this.emit(event.type, message);

    // notify webhook triggered by trigger word
    if (trigger_word) this.emit(trigger_word, message);

    return message;
  }


  /**
   * Event handler for incoming messages
   *
   * @param {mixed} names - Any number of event names to listen to. The last will be the callback
   * @return {Slack} The Slack adapter
   */
  on(...names) {
    let callback = names.pop(); // support multiple events per callback
    names.forEach(name => super.on(name, callback));

    return this; // chaining support
  }


  /**
   * Start RTM
   *
   * @param {object} options - Optional arguments to pass to the rtm.start method
   * @return {WebSocket} A promise containing the WebSocket
   */
  rtm(options) {
    return this.send('rtm.start', options).then(data => {
      this.cache = data.self;
      let ws = new WebSocket(data.url);
      ws.on('message', this.digest.bind(this));
      ws.on('close', () => this.ws = null);
      ws.on('open', () => this.ws = ws);
      return Promise.resolve(ws);
    });
  }


 /**
   * WebServer to listen for WebHooks
   *
   * @param {int} port - The port number to listen on
   * @param {string} path - The url path to respond to
   * @return {listener} The HTTP listener
   */
  listen(port, path) {
    path = path || '/'; // default to root
    
    return http.createServer((req, res) => {
      if (req.url == path && req.method === 'POST') {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => this.digest(data));
      }

      res.end('');
    }).listen(port, 'localhost', () => {
      console.log(`listening for events on http://localhost:${port + path}`);
    });
  }


  /**
   * POST data to Slack's API
   *
   * @param {string} endPoint - The method name or url
   * @param {object} payload - The JSON payload to send
   * @return {Promise} A promise with the api result
   */
  post(endPoint, payload) {
    // convert relative to absolute
    if (!/^http/i.test(endPoint)) endPoint = `https://slack.com/api/${endPoint}`;

    let body = qs.stringify(payload),
        {host, path} = url.parse(endPoint);
    
    let options = {
      host: host,
      path: path,
      method: 'POST',
      headers: {
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };

    return new Promise((resolve, reject) => {
      let data = '';
      let req = https.request(options, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('error', reject);
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch(err) { reject(data) }
        });

      }).on('error', reject);
    
      req.write(body);
      req.end();
    });
  }
}

module.exports = new TinySpeck();