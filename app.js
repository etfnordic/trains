const ws = new WebSocket("wss://train.etfnordic.workers.dev/ws?v=1");

ws.onopen = () => console.log("Connected to proxy");
ws.onmessage = (ev) => {
  // Oxyfi skickar normalt text/JSON
  console.log("msg:", ev.data);
};
ws.onerror = (e) => console.error("ws error", e);
ws.onclose = (e) => console.log("ws closed", e.code, e.reason);
