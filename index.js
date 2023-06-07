'use strict';

require('dotenv').config();

let RFB = require('rfb2');
let io = require('socket.io');
let express = require('express');
let http = require('http');
let imageEncode = require('image-encode')

let clients = [];
const port = process.env.PORT || 8090;

console.log("rfb.encodings.raw", RFB.encodings.raw);
console.log("rfb.encodings.copyRect", RFB.encodings.copyRect);
console.log("rfb.encodings.hextile", RFB.encodings.hextile);

let r;
let fps = 0, max_fps = 0;
let update_requested = 0

function brgaToRgba(src) {
    let rgba = new Buffer.alloc(src.length);
    for (let i = 0; i < src.length; i += 4) {
        rgba[i] = src[i + 2];
        rgba[i + 1] = src[i + 1];
        rgba[i + 2] = src[i];
        //rgba[i + 3] = src[i + 3];
        rgba[i + 3] = 0xff;
    }
    return rgba;
}

function addEventHandlers(r, socket) {
    let initialized = false;
    let screenWidth;
    let screenHeight;

    function handleConnection(width, height) {
        screenWidth = width;
        screenHeight = height;
        console.info('RFB connection established');
        socket.emit('init', {
            width: width,
            height: height
        });
        clients.push({
            socket: socket,
            rfb: r,
            interval: setInterval(function () {
                r.requestUpdate(false, 0, 0, r.width, r.height);
                update_requested = update_requested + 1
            }, 10)
        });
        initialized = true;
    }

    r.on('error', function (e) {
        console.error('Error while talking with the remote RFB server', e);
    });

    r.on('rect', function (rect) {
        fps = fps + 1
        if (!initialized) {
            handleConnection(rect.width, rect.height);
        }
        r.requestUpdate(false, 0, 0, r.width, r.height);

        let new_buff = brgaToRgba(rect.buffer)
        let encoded = Buffer.from(imageEncode(new_buff, [rect.width, rect.height], 'png'))

        socket.emit('frame', {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            image: encoded.toString("base64")
        });
    });

    r.on('*', function () {
        console.log(arguments);
    });
}

function createRfbConnection(config, socket) {
    try {
        r = RFB.createConnection({
            host: config.host,
            port: config.port,
            password: config.password,
            encodings: 0
        });
    } catch (e) {
        console.error(e);
    }
    addEventHandlers(r, socket);
    return r;
}

function disconnectClient(socket) {
    clients.forEach(function (client) {
        if (client.socket === socket) {
            client.rfb.end();
            clearInterval(client.interval);
        }
    });
    clients = clients.filter(function (client) {
        return client.socket === socket;
    });
}

function show_fps() {
    setTimeout(function () {
        console.log("FPS", fps);
        console.log("Max-FPS", max_fps);
        console.log("Update Requested", update_requested)
        if (fps > max_fps) {
            max_fps = fps
        }
        fps = 0;
        update_requested = 0
        show_fps()
    }, 1000);
}

(function () {
    let app = express();
    let server = http.createServer(app);

    server.listen(port);

    console.log('Listening on port', port);

    io = io(server, { log: false });
    io.sockets.on('connection', function (socket) {
        console.info('Client connected');
        show_fps();
        socket.on('init', function (config) {
            r = createRfbConnection(config, socket);
            socket.on('mouse', function (evnt) {
                r.pointerEvent(evnt.x, evnt.y, evnt.button);
            });
            socket.on('keyboard', function (evnt) {
                r.keyEvent(evnt.keyCode, evnt.isDown);
                console.info('Keyboard input');
            });
            socket.on('disconnect', function () {
                disconnectClient(socket);
                console.info('Client disconnected');
            });
        });
    });
}());

