const ws = new WebSocket("wss://train.etfnordic.workers.dev/echo");
ws.onopen = () => { console.log("echo open"); ws.send("hello"); };
ws.onmessage = (e) => console.log("echo msg:", e.data);
ws.onclose = (e) => console.log("echo close:", e.code, e.reason);
ws.onerror = (e) => console.log("echo error", e);
