// EdgeBaseWebSocket.jslib
// Unity WebGL bridge for EdgeBase Room WebSocket connections.
// Place this file at: Assets/Plugins/WebGL/EdgeBaseWebSocket.jslib
//
// Usage from C# (via EdgeBaseWebGLBridge.cs):
//   int id = JB_WebSocket_Create(url, onMessagePtr, onClosePtr);
//   JB_WebSocket_Send(id, messageJson);
//   JB_WebSocket_Close(id);

var EdgeBaseWebSocketLib = {
  // Socket registry: id -> WebSocket instance
  $JB_sockets: {},
  $JB_nextId: 1,

  // ── JB_WebSocket_Create ──────────────────────────────────────────────────
  // url:         NUL-terminated C string (UTF-8)
  // onMsgPtr:    MonoPInvokeCallback pointer — void(string message)
  // onClosePtr:  MonoPInvokeCallback pointer — void()
  // Returns:     integer socket ID, or -1 on failure
  JB_WebSocket_Create: function(urlPtr, onMsgPtr, onClosePtr) {
    try {
      var url = UTF8ToString(urlPtr);
      var id = JB_nextId++;
      var ws = new WebSocket(url);

      ws.onopen = function() {
        // Connection ready — no callback needed (C# side manages auth flow)
      };

      ws.onmessage = function(evt) {
        if (typeof evt.data !== 'string') return;
        var msgPtr = allocateUTF8(evt.data);
        dynCall('vi', onMsgPtr, [msgPtr]);
        _free(msgPtr);
      };

      ws.onclose = function() {
        // Notify C# of disconnection so it can trigger reconnect
        dynCall('v', onClosePtr, []);
        delete JB_sockets[id];
      };

      ws.onerror = function() {
        // Trigger close path — C# will handle reconnect
        dynCall('v', onClosePtr, []);
      };

      JB_sockets[id] = ws;
      return id;
    } catch (e) {
      console.error('[EdgeBase] WebSocket create error:', e);
      return -1;
    }
  },

  // ── JB_WebSocket_Send ────────────────────────────────────────────────────
  // id:          Socket ID returned by JB_WebSocket_Create
  // msgPtr:      NUL-terminated C string (UTF-8 JSON)
  JB_WebSocket_Send: function(id, msgPtr) {
    var ws = JB_sockets[id];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(UTF8ToString(msgPtr));
    } catch (e) {
      console.warn('[EdgeBase] WebSocket send error:', e);
    }
  },

  // ── JB_WebSocket_Close ───────────────────────────────────────────────────
  // id:          Socket ID
  JB_WebSocket_Close: function(id) {
    var ws = JB_sockets[id];
    if (!ws) return;
    try {
      ws.close(1000, 'client disconnect');
    } catch (e) {}
    delete JB_sockets[id];
  },

  // ── JB_WebSocket_IsOpen ──────────────────────────────────────────────────
  // Returns 1 if socket is in OPEN state, 0 otherwise
  JB_WebSocket_IsOpen: function(id) {
    var ws = JB_sockets[id];
    return (ws && ws.readyState === WebSocket.OPEN) ? 1 : 0;
  },
};

// Register dependencies: $JB_sockets and $JB_nextId
autoAddDeps(EdgeBaseWebSocketLib, '$JB_sockets');
autoAddDeps(EdgeBaseWebSocketLib, '$JB_nextId');
mergeInto(LibraryManager.library, EdgeBaseWebSocketLib);
