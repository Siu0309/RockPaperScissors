// main.js 전체 파일 - 최신 채팅 포함 안정화 버전
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.11/firebase-app.js";
import { getDatabase, ref, set, onValue, remove, push, child, get, onChildAdded } from "https://www.gstatic.com/firebasejs/9.6.11/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBnm6P4aLGWnlP8gAxzd4l-5Zn5KAPkxnM",
  authDomain: "rockpaperscissors-98138.firebaseapp.com",
  databaseURL: "https://rockpaperscissors-98138-default-rtdb.firebaseio.com",
  projectId: "rockpaperscissors-98138",
  storageBucket: "rockpaperscissors-98138.firebasestorage.app",
  messagingSenderId: "122640515265",
  appId: "1:122640515265:web:34fba9f10acd56d7bc9440",
  measurementId: "G-J7E6HMVGVG"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const nicknameInput = document.getElementById("nickname");
const roomIdInput = document.getElementById("roomId");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const randomBtn = document.getElementById("randomBtn");
const statusText = document.getElementById("status");
const gameContainer = document.getElementById("game-container");
const nicknameContainer = document.getElementById("nickname-container");
const resultText = document.getElementById("result");
const rematchBtn = document.getElementById("rematch");
const leaveBtn = document.getElementById("leaveBtn");
const chatInput = document.getElementById("chat-input");
const chatLog = document.getElementById("chat-log");

let isCaller = false;
let peerConnection;
let roomId;
let localNickname;
let opponentNickname = "상대";
let dataChannel;

const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

createBtn.onclick = () => enterRoom("create");
joinBtn.onclick = () => enterRoom("join");
randomBtn.onclick = () => enterRoom("random");
leaveBtn.onclick = () => location.reload();

async function enterRoom(mode) {
  localNickname = nicknameInput.value || "나";

  if (mode === "create") {
    roomId = Math.random().toString(36).substring(2, 8);
    isCaller = true;
    statusText.innerText = `방 ID: ${roomId} (상대 기다리는 중...)`;
  } else if (mode === "join") {
    roomId = roomIdInput.value;
    isCaller = false;
  } else if (mode === "random") {
    const waitingRef = ref(db, "waiting");
    const snapshot = await get(waitingRef);
    if (snapshot.exists()) {
      const entries = Object.entries(snapshot.val());
      const [key, value] = entries[0];
      roomId = value.roomId;
      await remove(ref(db, `waiting/${key}`));
      isCaller = false;
    } else {
      roomId = Math.random().toString(36).substring(2, 8);
      const newRef = push(waitingRef);
      await set(newRef, { roomId });
      isCaller = true;
      statusText.innerText = `랜덤 매칭 대기 중...`;
    }
  }

  nicknameContainer.style.display = "none";
  gameContainer.style.display = "block";
  setupConnection();
}

function setupConnection() {
  peerConnection = new RTCPeerConnection(config);

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      const candidateRef = push(ref(db, `rooms/${roomId}/${isCaller ? "callerCandidates" : "calleeCandidates"}`));
      set(candidateRef, event.candidate.toJSON());
    }
  };

  peerConnection.ondatachannel = event => {
    dataChannel = event.channel;
    setupChannel(dataChannel);
  };

  if (isCaller) {
    dataChannel = peerConnection.createDataChannel("chat");
    setupChannel(dataChannel);
    peerConnection.createOffer().then(offer => {
      peerConnection.setLocalDescription(offer);
      set(ref(db, `rooms/${roomId}/offer`), offer);
    });
  } else {
    const offerRef = ref(db, `rooms/${roomId}/offer`);
    onValue(offerRef, async snapshot => {
      const offer = snapshot.val();
      if (offer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        set(ref(db, `rooms/${roomId}/answer`), answer);
      }
    });
  }

  const answerRef = ref(db, `rooms/${roomId}/answer`);
  onValue(answerRef, async snapshot => {
    const answer = snapshot.val();
    if (answer && isCaller) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  const callerCandidatesRef = ref(db, `rooms/${roomId}/callerCandidates`);
  const calleeCandidatesRef = ref(db, `rooms/${roomId}/calleeCandidates`);
  onChildAdded(isCaller ? calleeCandidatesRef : callerCandidatesRef, async snapshot => {
    const data = snapshot.val();
    if (!data || !data.candidate) return;
    try {
      const candidate = new RTCIceCandidate(data);
      await peerConnection.addIceCandidate(candidate);
    } catch (e) {
      console.error("ICE 추가 실패:", e);
    }
  });

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "disconnected") {
      alert("상대방이 나갔습니다.");
      location.reload();
    }
  };
}

function setupChannel(channel) {
  channel.onopen = () => {
    const chatBox = document.getElementById("chat-box");
    chatBox.style.removeProperty("display");
    chatBox.style.display = "flex";

    channel.send(`NICK:${localNickname}`);
    statusText.innerText = `🟢 연결됨! 상대와 대전 시작 🟢`;

    ["rock", "paper", "scissors"].forEach(id => {
      const btn = document.getElementById(id);
      btn.disabled = false;
      btn.onclick = () => {
        disableChoiceButtons();
        if (channel.readyState === "open") {
          channel.send(`CHOICE:${id}`);
          handleChoice(id, true);
        }
      };
    });
  };

  channel.onmessage = event => {
    const msg = event.data;

    if (msg.startsWith("NICK:")) {
      opponentNickname = msg.slice(5);
    } else if (msg.startsWith("CHOICE:")) {
      const choice = msg.slice(7);
      handleChoice(choice, false);
    } else if (msg.startsWith("CHAT:")) {
      const text = msg.slice(5);
      addChat(`${opponentNickname}: ${text}`);
    }
  };

  chatInput.addEventListener("keypress", e => {
    if (e.key === "Enter" && chatInput.value.trim() !== "") {
      const msg = chatInput.value.trim();
      if (channel.readyState === "open") {
        channel.send(`CHAT:${msg}`);
        addChat(`${localNickname}: ${msg}`);
        chatInput.value = "";
      }
    }
  });
}

function addChat(message) {
  const p = document.createElement("p");
  p.textContent = message;
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
}

let myChoice = null;
let theirChoice = null;

function handleChoice(choice, isMine) {
  if (isMine) {
    myChoice = choice;
    statusText.innerText = "상대방의 선택을 기다리는 중...";
  } else {
    theirChoice = choice;
  }
  if (myChoice && theirChoice) determineResult();
}

function determineResult() {
  const m = myChoice;
  const t = theirChoice;
  if (m === t) {
    resultText.innerText = "무승부!";
  } else if ((m === "rock" && t === "scissors") || (m === "scissors" && t === "paper") || (m === "paper" && t === "rock")) {
    resultText.innerText = `${localNickname} 승리!`;
  } else {
    resultText.innerText = `${opponentNickname} 승리!`;
  }
  myChoice = null;
  theirChoice = null;
  rematchBtn.style.display = "block";
  enableChoiceButtons();
}

function disableChoiceButtons() {
  ["rock", "paper", "scissors"].forEach(id => {
    document.getElementById(id).disabled = true;
  });
}

function enableChoiceButtons() {
  ["rock", "paper", "scissors"].forEach(id => {
    document.getElementById(id).disabled = false;
  });
}

rematchBtn.onclick = () => {
  resultText.innerText = "";
  rematchBtn.style.display = "none";
  statusText.innerText = `🟢 다시 대전 중... 🟢`;
};