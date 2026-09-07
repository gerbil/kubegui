(() => {
  if (window.__kgXtermGlobalLoaded) return;
  window.__kgXtermGlobalLoaded = true;

  const terminals = new Map();

function getTerminal(ns,cleanname,cname,nodeflag) {
  const id = `terminal-${ns}-${cleanname}-${cname}`;

  // Terminal setup
  let term = new Terminal({
    cols: 120,
    rows: 60,
    cursorStyle: 'bar',
    cursorWidth: 1,
    fontSize: 12,
    ignoreBracketedPasteMode: true, // important: disables - [20 sequences
    fontFamily: "Monaco,Mono,Consolas,Liberation Mono,Menlo,monospace",
    theme: {
      foreground: "#ffffff",
      background: "#002451",
      cursorColor: "#ffcc00",
      selectionBackground: "#003f8e",
      black: "#00346e",
      red: "#ff9da4",
      green: "#d1f1a9",
      yellow: "#ffeead",
      blue: "#bbdaff",
      purple: "#ebbbff",
      cyan: "#99ffff",
      white: "#ffffff",
      brightBlack: "#7285b7",
      brightRed: "#ff9da4",
      brightGreen: "#d1f1a9",
      brightYellow: "#ffeead",
      brightBlue: "#bbdaff",
      brightPurple: "#ebbbff",
      brightCyan: "#99ffff",
      brightWhite: "#ffffff",
      cursor: "#ffcc00"
    }
  });

  // Addons
  const fitAddon = new FitAddon.FitAddon();
  const clipboardAddon = new ClipboardAddon.ClipboardAddon();

  term.loadAddon(fitAddon);
  term.loadAddon(clipboardAddon);

  //console.log("terminal-"+ns+"-"+cleanname+"-"+cname)
  const container = document.getElementById(id);
  term.open(container);
  fitAddon.fit();

  // WebSocket
  const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // In Wails desktop, frontend host may differ from backend host.
  // Exec websocket endpoints are served by the backend bridge on :9245.
  const wsHost = window.location.hostname === 'wails.localhost'
    ? 'wails.localhost:9245'
    : window.location.host;
  var wsUrl
  if (nodeflag) {
    wsUrl = `${wsProto}://${wsHost}/resource/nodes/exec/${cleanname}`;
  } else {
    wsUrl = `${wsProto}://${wsHost}/resource/exec/${ns}/${cleanname}/${cname}`;
  }
  const ws = new WebSocket(wsUrl);

  function sendResize() {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        msg_type: "resize",
        rows: term.rows,
        cols: term.cols
      }));
    }
  }

  ws.onopen = () => {
    fitAddon.fit();
    sendResize();
  };

  ws.onmessage = (evt) => term.write(evt.data);
  ws.onerror = (evt) => term.write(`\r\n[error] ${evt.data}`);
  ws.onclose = () => term.writeln('SESSION CLOSED (connection timeout)');

  // Terminal input
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        msg_type: "input",
        data: btoa(data),
      }));
    }
  });

  // Handle window/container resize
  window.addEventListener("resize", () => {
    fitAddon.fit();
    sendResize();
  });
  new ResizeObserver(() => {
    fitAddon.fit();
    sendResize();
  }).observe(container);

  // Copy selected text automatically
  term.onSelectionChange(() => {
    if (term.getSelection() !== "") {
      window.wails.Clipboard.SetText(term.getSelection());
    }
  });

  term.textarea.onkeydown = function(e) {
    // So we don't spam single control characters
    if (e.key.length > 1 && (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) && e.key !== "Backspace") {}
  }

  // Init
  terminals.set(id, { term });
  $(`#close-terminal-${ns}-${cleanname}-${cname}`).on('click', function () {
    disposeTerminal(id);
  });
}

function disposeTerminal(id) {
  const t = terminals.get(id);
  if (!t) return;
  t.term.dispose(); // destroys event listeners, renderer, etc.
  terminals.delete(id);
  //console.log(`Disposed terminal ${id}`);
}

window.getTerminal = getTerminal;
window.disposeTerminal = disposeTerminal;
})();
