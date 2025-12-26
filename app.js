const ws = new WebSocket("wss://train.etfnordic.workers.dev/ws?v=1");

ws.onopen = () => console.log("OPEN ✅");
ws.onmessage = (e) => console.log("MSG", String(e.data).slice(0, 120));
ws.onerror = (e) => console.log("ERROR", e);
ws.onclose = (e) => console.log("CLOSE", e.code, e.reason);
