#!/usr/bin/env python3
from flask import Flask, send_from_directory
from flask_sockets import Sockets
from werkzeug.routing import Rule
import json

app = Flask(__name__)
sockets = Sockets(app)

clients = []
broadcaster = []

@sockets.route('/echo')
def echo_socket(ws):
    print("Server received new client")
    while not ws.closed:
        msgStr = ws.receive()
        if msgStr is None:
            print("User disconnected")
            break

        print("Received message: ", msgStr)
        try:
            msg = json.loads(msgStr)
            if msg["type"] == "server_hello":
                print("Registering server")
                if len(broadcaster):
                    broadcaster[0] = ws
                else:
                    broadcaster.append(ws)
            elif msg["type"] == "client_hello":
                clients.append(ws)
            elif msg["target"] == "server":
                if len(broadcaster):
                    broadcaster[0].send(msgStr)
                else:
                    print("Warning: received a client message without a server")
            else:
                for client in clients:    
                    if client is not ws:
                        try:
                            client.send(msgStr)
                        except:
                            print("Error: Failed to send message to client")
        except Exception as ex:
            print("Error parsing message: ", msgStr, ex)

    if ws in clients:
        clients.remove(ws)

# Flask-Sockets 0.2.1 drops route options, including websocket=True.
# Add its WS-aware counterpart while retaining the original HTTP fallback.
echo_rule = Rule('/echo', endpoint=echo_socket)
if hasattr(echo_rule, 'websocket'):
    echo_rule.websocket = True
    sockets.url_map.add(echo_rule)

@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('static', path)


if __name__ == "__main__":
    from gevent import pywsgi
    from geventwebsocket.handler import WebSocketHandler
    server = pywsgi.WSGIServer(('', 5000), app, handler_class=WebSocketHandler)
    server.serve_forever()
