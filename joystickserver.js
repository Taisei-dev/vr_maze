const fs = require('fs');
const events = require('events');
const { createServer } = require('https');
const webSocketServer = require('websocket').server;

//library
class Joystick extends events {
    constructor (id, deadzone, sensitivity) {
        super();

        const buffer = new Buffer(8);
        let fd;

        // Last reading from this axis, used for debouncing events using sensitivty setting
        let lastAxisValue = [];
        let lastAxisEmittedValue = [];

        const parse = (buffer) => {
        const event =  {
            time : buffer.readUInt32LE(0),
            value: buffer.readInt16LE(4),
            number: buffer[7]
        };

        const type = buffer[6];

        if (type & 0x80) {
            event.init = true;
        }

        if (type & 0x01) {
            event.type = 'button';
        }

        if (type & 0x02) {
            event.type = 'axis';
        }

        event.id = id;

        return event;
        };

        const startRead = () => {
        fs.read(fd, buffer, 0, 8, null, onRead);
        };

        const onOpen = (err, fdOpened) => {
        if (err) return this.emit('error', err);
        else {
            this.emit('ready');

            fd = fdOpened;
            startRead();
        }
        };

        const onRead = (err, bytesRead) => {
        if (err) return this.emit('error', err);
        const event = parse(buffer);

        let squelch = false;

        if (event.type === 'axis') {
            if (sensitivity) {
            if (lastAxisValue[event.number] && Math.abs(lastAxisValue[event.number] - event.value) < sensitivity) {
                // data squelched due to sensitivity, no self.emit
                squelch = true;
            } else {
                lastAxisValue[event.number] = event.value;
            }
            }

            if (deadzone && Math.abs(event.value) < deadzone) event.value = 0;

            if (lastAxisEmittedValue[event.number] === event.value) {
            squelch = true;
            } else {
            lastAxisEmittedValue[event.number] = event.value;
            }
        }

        if (!squelch) this.emit(event.type, event);
        if (fd) startRead();
        };

        this.close = function (callback) {
        fs.close(fd, callback);
        fd = undefined;
        };

        fs.open('/dev/input/js' + id, 'r', onOpen);
    }
};


const webSocketsServerPort = 5000;

const clients = [];
const ssloptions={
  cert: fs.readFileSync('./ssl/server.crt'),
  ca: fs.readFileSync('./ssl/server.csr'),
  key: fs.readFileSync('./ssl/server.key')
};
const server = createServer(ssloptions,(req, res) => {
    var path = req.url;
    if (path === '/') {
        path = '/index.html';
    }

    fs.readFile(`${__dirname}/static${path}`, function (err, data) {
        if (err) {
            res.writeHead(404);
            res.end(JSON.stringify(err));
            return;
        }
        res.writeHead(200);
        res.end(data);
    });
});
server.listen(webSocketsServerPort, () => {
    console.log((new Date()) + " Server is listening on port " + webSocketsServerPort);
});

const wsServer = new webSocketServer({ httpServer: server });
wsServer.on('request', (request) => {
    console.log((new Date()) + ' Connection from origin ' + request.origin + '.');
    const connection = request.accept(null, request.origin);
    console.log((new Date()) + ' Connection accepted.');

    const index = clients.push(connection) - 1;

    connection.on('message', (message) => {
        if (message.type === 'utf8') {
            console.log('Received Message: ' + message.utf8Data);
        } else if (message.type === 'binary') {
            console.log('Received Binary Message of ' + message.binaryData.length + ' bytes');
        }
    });

    connection.on('close', (connection) => {
        console.log((new Date()) + " Peer " + connection.remoteAddress + " disconnected.");
        // Remove an user from the list of connected clients
        clients.splice(index, 1);
    });
});

var coordinate=[0,0];
var rotation=0;
var pushed=0;

function setAxis(data){
    if(data['number']==0){
        coordinate[0]=data['value'];
    }
    else if(data['number']==1){
        coordinate[1]=data['value'];
    }
    else if(data['number']==2){
        rotation=data['value'];
    }
}
function sendButton(data){
    if(data['number']==9){
        pushed=data['value'];
        clients.forEach(client => {
            client.sendUTF(`${coordinate[0]} ${coordinate[1]} ${rotation} ${pushed}`);
        });
    }
}

var joystick = new Joystick(0, 100); //joystic on /dev/input/js0, active when 100 away from center
joystick.on('button', sendButton);
joystick.on('axis', setAxis);

//send info
setInterval(()=>{
    if(coordinate[0]==0&&coordinate[1]==0&&rotation==0&&pushed==0) return;
    clients.forEach(client => {
        client.sendUTF(`${coordinate[0]} ${coordinate[1]} ${rotation} ${pushed}`);
    });
},80)
