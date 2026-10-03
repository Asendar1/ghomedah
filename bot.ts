import WebSocket from "ws";

new WebSocket('ws://localhost:8787').on('message', (m) => console.log(m.toString()));
