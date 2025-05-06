const WebSocket = require("ws");
const http = require("http");

const TARGET_WS_URL =
  "wss://carrot.megaeth.com/mafia/ws/1f81b9d19ac74804b41085bc1018be8ea5d9c6e8";

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket Proxy Server is running");
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store active connections
const connections = new Map();

// Helper function to convert message to string
const messageToString = async (message) => {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof Buffer) {
    return message.toString("utf8");
  }
  if (message instanceof Blob) {
    return await message.text();
  }
  return String(message);
};

wss.on("connection", (ws) => {
  console.log("Client connected");

  // Create connection to target WebSocket server
  const targetWs = new WebSocket(TARGET_WS_URL);

  // Store the connection pair
  connections.set(ws, targetWs);
  connections.set(targetWs, ws);

  // Wait for target connection to be ready
  targetWs.on("open", () => {
    console.log("Target WebSocket connection established");

    // Forward messages from client to target
    ws.on("message", async (message) => {
      try {
        const messageStr = await messageToString(message);
        console.log("Received from client:", messageStr);

        if (targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(messageStr);
        } else {
          console.error(
            "Target WebSocket is not open, current state:",
            targetWs.readyState
          );
        }
      } catch (error) {
        console.error("Error handling client message:", error);
      }
    });
  });

  // Forward messages from target to client
  targetWs.on("message", async (message) => {
    try {
      const messageStr = await messageToString(message);
      console.log("Received from target:", messageStr);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      } else {
        console.error(
          "Client WebSocket is not open, current state:",
          ws.readyState
        );
      }
    } catch (error) {
      console.error("Error handling target message:", error);
    }
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error("Client WebSocket error:", error);
    const target = connections.get(ws);
    if (target) {
      target.close();
      connections.delete(ws);
      connections.delete(target);
    }
  });

  targetWs.on("error", (error) => {
    console.error("Target WebSocket error:", error);
    const client = connections.get(targetWs);
    if (client) {
      client.close();
      connections.delete(targetWs);
      connections.delete(client);
    }
  });

  // Handle connection close
  ws.on("close", () => {
    console.log("Client disconnected");
    const target = connections.get(ws);
    if (target) {
      target.close();
      connections.delete(ws);
      connections.delete(target);
    }
  });

  targetWs.on("close", () => {
    console.log("Target connection closed");
    const client = connections.get(targetWs);
    if (client) {
      client.close();
      connections.delete(targetWs);
      connections.delete(client);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket proxy server is running on port ${PORT}`);
});
