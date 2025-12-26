const ws = new WebSocket("wss://train.etfnordic.workers.dev/ws?v=1");

ws.onopen = () => console.log("Connected ✅");
ws.onmessage = (ev) => console.log("msg:", ev.data);
ws.onerror = (e) => console.error("ws error", e);
ws.onclose = (e) => console.log("closed", e.code, e.reason);
