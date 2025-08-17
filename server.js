
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LoveGlob Random Video</title>
  <style>
    body { font-family: system-ui; display:flex; flex-direction:column; align-items:center; gap:10px; margin:20px; }
    video { width:45vw; max-width:420px; background:#000; border-radius:12px; }
    .row { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
    button { padding:10px 14px; border-radius:10px; border:1px solid #ddd; cursor:pointer; }
    #status { font-weight:600; }
  </style>
</head>
<body>
  <h1>🎥 LoveGlob Random Video</h1>
  <div class="row">
    <video id="local" autoplay playsinline muted></video>
    <video id="remote" autoplay playsinline></video>
  </div>
  <div class="row">
    <button id="startBtn">Find Partner</button>
    <button id="nextBtn" disabled>Next</button>
    <span id="status">Idle</span>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();             // same-origin
    const statusEl   = document.getElementById('status');
    const startBtn   = document.getElementById('startBtn');
    const nextBtn    = document.getElementById('nextBtn');
    const localVideo = document.getElementById('local');
    const remoteVideo= document.getElementById('remote');

    let pc, localStream, roomId, iAmInitiator = false;

    const rtcConfig = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };

    async function initMedia() {
      if (localStream) return localStream;
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      return localStream;
    }

    function makePeer() {
      if (pc) pc.close();
      pc = new RTCPeerConnection(rtcConfig);
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      pc.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };
      pc.onicecandidate = e => {
        if (e.candidate) socket.emit('signal', { candidate: e.candidate });
      };
    }

    async function startIfInitiator() {
      if (!iAmInitiator) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { offer });
    }

    // UI
    startBtn.onclick = async () => {
      startBtn.disabled = true;
      statusEl.textContent = 'Requesting camera...';
      try {
        await initMedia();
        statusEl.textContent = 'Looking for a partner...';
        socket.emit('join_queue', {});     // matches server
      } catch {
        statusEl.textContent = 'Camera/mic blocked.';
        startBtn.disabled = false;
      }
    };

    nextBtn.onclick = () => {
      socket.emit('next');
      if (pc) pc.close();
      remoteVideo.srcObject = null;
      roomId = null; iAmInitiator = false;
      statusEl.textContent = 'Finding new partner...';
      socket.emit('join_queue', {});
    };

    // Socket events from server
    socket.on('queued', () => {
      nextBtn.disabled = false;
      statusEl.textContent = 'Waiting for someone to join...';
    });

    socket.on('matched', async ({ roomId: rid, initiator }) => {
      roomId = rid; iAmInitiator = !!initiator;
      statusEl.textContent = 'Partner found! Connecting...';
      await initMedia();
      makePeer();
      startIfInitiator();
    });

    socket.on('signal', async (data) => {
      await initMedia();
      if (!pc) makePeer();
      if (data.offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { answer });
      } else if (data.answer) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
      }
    });

    socket.on('peer_left', () => {
      statusEl.textContent = 'Partner left. Finding new one...';
      if (pc) pc.close();
      remoteVideo.srcObject = null;
      roomId = null; iAmInitiator = false;
      socket.emit('join_queue', {});
    });
  </script>
</body>
</html>
