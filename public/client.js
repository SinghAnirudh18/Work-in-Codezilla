const socket = io();
let localStream;
let peerConnection;
let myRole = null; // Declare role variable at the top

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const sendMsgBtn = document.getElementById("sendMsgBtn");
const chatBox = document.getElementById("chatBox");
const recordBtn = document.getElementById("recordBtn");
const transcript = document.getElementById("transcript");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// === 1. Video/Audio Initialization ===
async function init() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  // Join room first, then handle role assignment
  socket.emit("join-room", ROOM_ID);

  // Handle role assignment
  socket.on("role-assigned", (role) => {
    myRole = role;
    console.log("My role is:", myRole);
    
    // Update UI based on role if needed
    updateUIBasedOnRole(role);
  });

  socket.on("room-full", () => {
    alert("Room is full!");
  });

  socket.on("user-connected", async (otherUserId) => {
    console.log("User connected:", otherUserId);
    createPeer();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", { sdp: offer, to: otherUserId });
  });

  socket.on("offer", async ({ sdp, from }) => {
    console.log("Received offer from:", from);
    createPeer();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", { sdp: answer, to: from });
  });

  socket.on("answer", async ({ sdp }) => {
    console.log("Received answer");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on("ice-candidate", ({ candidate }) => {
    if (peerConnection) {
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  // Handle chat messages
  socket.on("chat-message", ({ sender, message, senderRole }) => {
    addChatBubble(sender, message, senderRole);
  });
}

function createPeer() {
  if (peerConnection) return;
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = ({ streams: [stream] }) => {
    remoteVideo.srcObject = stream;
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log("Connection state:", peerConnection.connectionState);
  };
}

// Update UI based on assigned role
function updateUIBasedOnRole(role) {
  // Add role indicator to the UI
  const roleIndicator = document.getElementById("roleIndicator") || createRoleIndicator();
  roleIndicator.textContent = `Your Role: ${role}`;
  roleIndicator.className = `role-indicator role-${role.toLowerCase()}`;
}

function createRoleIndicator() {
  const indicator = document.createElement("div");
  indicator.id = "roleIndicator";
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 8px 12px;
    border-radius: 4px;
    font-weight: bold;
    z-index: 1000;
  `;
  document.body.appendChild(indicator);
  return indicator;
}

init();

// === 2. Transcription using ElevenLabs STT ===
const apiKey = "sk_64ae4be783f231868d116e8a14af6dd561429320e607383c"; // Secure this in production

let recorder, chunks = [], recording = false;

recordBtn.onclick = async () => {
  if (!recording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];

      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        await transcribe(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      recording = true;
      recordBtn.textContent = "Stop Recording";
      recordBtn.classList.add("recording");
    } catch (e) {
      alert("Microphone access error: " + e.message);
    }
  } else {
    recorder.stop();
    recording = false;
    recordBtn.textContent = "Start Recording";
    recordBtn.classList.remove("recording");
  }
};

async function transcribe(audioBlob) {
  transcript.value = "Transcribing...";
  const form = new FormData();
  form.append("file", audioBlob, "speech.webm");
  form.append("model_id", "scribe_v1");

  try {
    const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err?.error || resp.statusText);
    }

    const data = await resp.json();
    const finalText = data.text || "[No transcription returned]";
    transcript.value = finalText;

    // Send to server with role information
    await fetch("/api/stt/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        text: finalText, 
        roomId: ROOM_ID,
        role: myRole 
      })
    });

  } catch (e) {
    console.error("STT Error:", e);
    alert("Transcription failed: " + e.message);
    transcript.value = "[Transcription failed]";
  }
}

// === 3. Chat Message ===
sendMsgBtn.onclick = () => {
  const text = transcript.value.trim();
  if (text && myRole) {
    // Send message with role information
    socket.emit("chat-message", { 
      roomId: ROOM_ID, 
      message: text,
      role: myRole 
    });
    
    // Clear transcript after sending
    transcript.value = "";
  } else if (!myRole) {
    alert("Please wait for role assignment before sending messages.");
  }
};

function addChatBubble(sender, msg, senderRole) {
  const p = document.createElement("p");
  const roleClass = senderRole ? senderRole.toLowerCase() : 'unknown';
  p.className = `chat-message role-${roleClass}`;
  
  // Show role in chat if different roles exist
  const roleDisplay = senderRole ? ` (${senderRole})` : '';
  p.innerHTML = `<strong>${sender}${roleDisplay}:</strong> ${msg}`;
  
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to bottom
}