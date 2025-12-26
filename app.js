const ws = new WebSocket("wss://train.etfnordic.workers.dev/ws?v=1");
ws.onopen = () => console.log("proxy open ✅");
ws.onmessage = (e) => console.log("msg:", String(e.data).slice(0, 120));
ws.onclose = (e) => console.log("close:", e.code, e.reason);
ws.onerror = (e) => console.log("error", e);
