"use strict";

// DU Meet frontend.
//
// How a call works:
//  1. Every tab keeps asking the server "any messages for me?" (GET /api/poll;
//     the server holds each request until a message arrives). The tab sends
//     its own messages with POST /api/send.
//  2. When you join, the server sends "welcome" with everyone already in the
//     meeting. You create one RTCPeerConnection per person and send each an
//     "offer". They reply with an "answer", and both sides trade "ice"
//     candidates (possible network addresses) until a direct link works.
//  3. Audio and video then flow browser-to-browser. Chat, reactions, raised
//     hands, captions, polls and the whiteboard still go through the server
//     as small messages.
//
// Every connection has three media slots ("transceivers"), always in this order:
//   0 = microphone, 1 = camera, 2 = screen share.
// Turning the camera off or starting a presentation only swaps the track in a
// slot (replaceTrack), so the call never has to be renegotiated, and your
// camera and your presentation show up as two separate tiles, like in Meet.

// STUN finds your public address. When two networks block a direct link, the
// server's /api/ice adds TURN relay servers (see README section 1c).
let iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 } };
const REACTIONS = ["👍", "❤️", "🎉", "👏", "😂", "😮", "😢", "🙏"];
// Avatar tones live in style.css (--avatar-1 … --avatar-6) so they follow the theme.
const AVATAR_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--avatar-${n})`);
const SLOT = { audio: 0, camera: 1, screen: 2 };
const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

const $ = (selector) => document.querySelector(selector);
const narrow = () => matchMedia("(max-width: 45rem)").matches;

const me = {
  id: crypto.randomUUID(),
  name: "",
  stream: null,       // camera + microphone
  screenTrack: null,  // set while presenting
  mic: true,
  cam: true,
  hand: false,
  handAt: 0,
  cc: false,          // showing live captions
  rec: false,         // recording the meeting
  facing: "user",     // "user" (front) or "environment" (back camera)
};

let room = null;            // meeting code, e.g. "abc-defg-hij"
let polling = null;         // AbortController of the poll loop while in a meeting
let joinedAt = 0;
const peers = new Map();    // id -> { id, name, mic, cam, hand, screen, rec, cc, pc, pendingIce, audio, camTrack, screenTrack }
let openPanel = null;       // "info" | "people" | "chat" | "polls" | null
let unread = 0;
let unreadPolls = 0;
const notes = [];           // { time, kind, name, text } for "Download meeting notes"

// ---------- Saved preferences ----------

const prefs = {
  name: "", micId: "", camId: "", speakerId: "", noise: true,
  lang: navigator.language?.startsWith("hi") ? "hi-IN" : "en-IN",
  layout: "auto", hideSelf: false,
};
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem("du-meet-prefs") ?? "{}"));
  prefs.name ||= localStorage.getItem("du-meet-name") ?? "";
} catch {
  // private mode: defaults
}
function savePrefs() {
  try {
    localStorage.setItem("du-meet-prefs", JSON.stringify(prefs));
  } catch {
    // private mode: settings just won't be remembered
  }
}

// ---------- Pages ----------

function showView(id) {
  for (const view of document.querySelectorAll(".view")) {
    const show = view.id === id;
    if (show && view.hidden) {
      view.classList.remove("view-in");
      void view.offsetWidth;
      view.classList.add("view-in");
    }
    view.hidden = !show;
  }
  document.body.dataset.view = id;
  window.scrollTo(0, 0);
}

function route() {
  const code = new URLSearchParams(location.search).get("room");
  if (code && isValidCode(code)) openLobby(code);
  else {
    showView("home");
    window.DU?.onHome?.();
  }
}

function goToMeeting(code) {
  history.pushState(null, "", `/?room=${code}`);
  openLobby(code);
}

function goHome() {
  history.pushState(null, "", "/");
  showView("home");
  window.DU?.onHome?.();
}

function newMeetingCode() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const part = (n) => Array.from({ length: n }, () => letters[Math.floor(Math.random() * 26)]).join("");
  return `${part(3)}-${part(4)}-${part(3)}`;
}

const isValidCode = (code) => /^[a-z0-9-]{3,40}$/.test(code);

function parseMeetingInput(text) {
  text = text.trim();
  try {
    text = new URL(text).searchParams.get("room") ?? "";
  } catch {
    // not a link: treat it as a code
  }
  text = text.toLowerCase();
  return isValidCode(text) ? text : null;
}

const meetingLink = () => `${location.origin}/?room=${room}`;

// ---------- Lobby ----------

async function openLobby(code) {
  room = code;
  showView("lobby");
  $("#lobby-code").textContent = code;
  $("#name-input").value = prefs.name;
  if (!me.stream) await startMedia();
  refreshLocal();
  refreshLobbyCount();
}

async function refreshLobbyCount() {
  try {
    const response = await fetch(`/api/room?room=${encodeURIComponent(room)}`);
    const { names } = await response.json();
    $("#lobby-count").textContent = describeOthers(names);
  } catch {
    $("#lobby-count").textContent = "";
  }
}

function describeOthers(names) {
  if (names.length === 0) return "No one else is here";
  if (names.length === 1) return `${names[0]} is in this call`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are in this call`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are in this call`;
}

// ---------- Camera, microphone, screen ----------

const micTrack = () => me.stream?.getAudioTracks()[0] ?? null;
const cameraTrack = () => me.stream?.getVideoTracks()[0] ?? null;

function audioConstraints() {
  return {
    ...(prefs.micId && { deviceId: { ideal: prefs.micId } }),
    echoCancellation: true, noiseSuppression: prefs.noise, autoGainControl: true,
  };
}

function videoConstraints() {
  // A chosen camera wins; otherwise ask for the front or back camera (phones).
  return prefs.camId ? { ...VIDEO, deviceId: { ideal: prefs.camId } } : { ...VIDEO, facingMode: { ideal: me.facing } };
}

const getMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints);

async function startMedia() {
  me.stream = new MediaStream();
  if (!navigator.mediaDevices?.getUserMedia) {
    me.mic = me.cam = false;
    return toast("Camera and microphone need https:// (or localhost)");
  }
  try {
    const stream = await getMedia({ audio: audioConstraints(), video: videoConstraints() });
    for (const track of stream.getTracks()) me.stream.addTrack(track);
  } catch {
    // Maybe only one device is missing or blocked: try them one at a time.
    for (const kind of ["audio", "video"]) {
      try {
        const stream = await getMedia({ [kind]: kind === "video" ? videoConstraints() : audioConstraints() });
        me.stream.addTrack(stream.getTracks()[0]);
      } catch {
        // that device stays off
      }
    }
  }
  me.mic = Boolean(micTrack());
  me.cam = Boolean(cameraTrack());
  rememberFacing(cameraTrack());
  if (!me.mic && !me.cam) toast("Camera and microphone are blocked. Allow them in the address bar.");
  else if (!me.cam) toast("Camera not available");
  else if (!me.mic) toast("Microphone not available");
  refreshDevices();
}

function rememberFacing(track) {
  if (!track) return;
  const { facingMode } = track.getSettings();
  if (facingMode === "user" || facingMode === "environment") me.facing = facingMode;
  else if (/back|rear|environment/i.test(track.label)) me.facing = "environment";
  else if (/front|user|face/i.test(track.label)) me.facing = "user";
}

function stopCamera() {
  for (const track of me.stream.getVideoTracks()) {
    track.stop();
    me.stream.removeTrack(track);
  }
}

function setMic(on) {
  const track = micTrack();
  if (!track) return toast("No microphone found");
  track.enabled = on; // a disabled track sends silence; no need to renegotiate
  me.mic = on;
  renderAll();
  sendState({ mic: on });
  updateRecognition();
}

async function setCamera(on) {
  if (on) {
    try {
      const track = (await getMedia({ video: videoConstraints() })).getVideoTracks()[0];
      stopCamera();
      me.stream.addTrack(track);
      rememberFacing(track);
    } catch {
      return toast("Camera not available");
    }
  } else {
    stopCamera(); // stop (not just disable) so the camera light turns off
  }
  me.cam = on;
  setOutgoing(SLOT.camera, cameraTrack());
  renderAll();
  refreshDevices();
  sendState({ cam: on });
}

/** Front ↔ back camera on phones; on laptops it moves to the next camera. */
async function flipCamera() {
  if (!me.cam) return toast("Turn on your camera first");
  const before = cameraTrack()?.getSettings().deviceId;
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  const next = me.facing === "environment" ? "user" : "environment";
  // Most phones can't open two cameras at once, so release the current one first.
  stopCamera();
  let track = null;
  try {
    track = (await getMedia({ video: { ...VIDEO, facingMode: { exact: next } } })).getVideoTracks()[0];
  } catch {
    const index = cameras.findIndex((camera) => camera.deviceId === before);
    const other = cameras[(index + 1) % cameras.length];
    try {
      track = (await getMedia({ video: { ...VIDEO, deviceId: { exact: other.deviceId } } })).getVideoTracks()[0];
    } catch {
      // fall back to whatever camera works below
    }
  }
  try {
    track ??= (await getMedia({ video: videoConstraints() })).getVideoTracks()[0];
  } catch {
    me.cam = false;
    sendState({ cam: false });
  }
  if (track) {
    me.stream.addTrack(track);
    const { deviceId } = track.getSettings();
    const facing = track.getSettings().facingMode;
    me.facing = facing === "user" || facing === "environment" ? facing : deviceId === before ? me.facing : next;
    prefs.camId = deviceId ?? "";
    savePrefs();
  }
  setOutgoing(SLOT.camera, cameraTrack());
  renderAll();
  refreshDevices();
}

async function changeMic(deviceId) {
  prefs.micId = deviceId;
  savePrefs();
  let track;
  try {
    track = (await getMedia({ audio: { ...audioConstraints(), deviceId: { exact: deviceId } } })).getAudioTracks()[0];
  } catch {
    try {
      track = (await getMedia({ audio: audioConstraints() })).getAudioTracks()[0];
    } catch {
      return toast("Microphone not available");
    }
  }
  const hadMic = Boolean(micTrack());
  for (const old of me.stream.getAudioTracks()) {
    old.stop();
    me.stream.removeTrack(old);
  }
  me.stream.addTrack(track);
  if (!hadMic) me.mic = true;
  track.enabled = me.mic;
  setOutgoing(SLOT.audio, track);
  if (polling) {
    watchAudio(me.id, track);
    recordingAddAudio(me.id, track);
  }
  renderAll();
  sendState({ mic: me.mic });
}

async function changeCamera(deviceId) {
  prefs.camId = deviceId;
  savePrefs();
  if (me.cam) await setCamera(true);
  else refreshDevices();
}

async function setSpeaker(deviceId) {
  prefs.speakerId = deviceId;
  savePrefs();
  for (const peer of peers.values()) await peer.audio.setSinkId?.(deviceId).catch(() => {});
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === "videoinput");
  for (const button of document.querySelectorAll(".flip-btn")) button.hidden = cameras.length < 2;
  document.body.classList.toggle("can-flip", cameras.length > 1);
  fillSelect($("#mic-select"), devices.filter((d) => d.kind === "audioinput"), micTrack()?.getSettings().deviceId ?? prefs.micId, "Microphone");
  fillSelect($("#cam-select"), cameras, cameraTrack()?.getSettings().deviceId ?? prefs.camId, "Camera");
  const canPickSpeaker = "setSinkId" in HTMLMediaElement.prototype;
  for (const row of document.querySelectorAll(".speaker-row")) row.hidden = !canPickSpeaker;
  if (canPickSpeaker) fillSelect($("#speaker-select"), devices.filter((d) => d.kind === "audiooutput"), prefs.speakerId, "Speaker");
}
navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);

function fillSelect(select, devices, current, fallback) {
  select.replaceChildren(...devices.map((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallback} ${index + 1}`;
    option.selected = device.deviceId === current;
    return option;
  }));
  select.disabled = devices.length === 0;
  if (devices.length === 0) select.append(new Option(`No ${fallback.toLowerCase()} found`));
}

async function toggleScreenShare() {
  if (me.screenTrack) return stopScreenShare();
  if (!navigator.mediaDevices.getDisplayMedia) return toast("Screen sharing is not supported in this browser");
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 } });
    me.screenTrack = stream.getVideoTracks()[0];
  } catch {
    return; // user cancelled the picker
  }
  me.screenTrack.contentHint = "detail"; // keep text sharp rather than smooth
  me.screenTrack.onended = stopScreenShare; // browser's own "Stop sharing" button
  setOutgoing(SLOT.screen, me.screenTrack);
  stageAppeared(screenId(me.id));
  renderAll();
  sendState({ screen: true });
  toast("You are presenting to everyone");
}

function stopScreenShare() {
  if (!me.screenTrack) return;
  me.screenTrack.stop();
  me.screenTrack = null;
  setOutgoing(SLOT.screen, null);
  renderAll();
  sendState({ screen: false });
}

/** Swap the track in one media slot for everyone, without renegotiating. */
function setOutgoing(slot, track) {
  for (const peer of peers.values()) {
    peer.pc.getTransceivers()[slot]?.sender.replaceTrack(track).catch(() => {});
  }
}

function localTrack(slot) {
  return [micTrack(), cameraTrack(), me.screenTrack][slot] ?? null;
}

// ---------- Joining and leaving ----------

async function joinMeeting() {
  me.name = $("#name-input").value.trim() || "Guest";
  prefs.name = me.name;
  savePrefs();
  showView("room");
  $("#room-code").textContent = room;
  $("#meeting-link").textContent = meetingLink().replace(/^https?:\/\//, "");
  joinedAt = Date.now();
  // The clock and call time show for a moment, then fold into the (i) button.
  const chip = $(".meet-chip");
  chip.classList.add("expanded");
  clearTimeout(chip.foldTimer);
  chip.foldTimer = setTimeout(() => chip.classList.remove("expanded"), 3800);
  notes.length = 0;
  note("event", me.name, "joined");
  renderAll();
  if (micTrack()) watchAudio(me.id, micTrack());
  audioContext?.resume();

  try {
    iceServers = (await (await fetch("/api/ice")).json()).iceServers;
  } catch {
    // keep the built-in STUN servers
  }
  pollLoop();
  window.DU?.onJoin?.();
}

async function pollLoop() {
  const controller = new AbortController();
  polling = controller;
  let offline = false;
  while (polling === controller) {
    // Name and mic/cam state are only used by the first poll, which joins the room.
    const params = new URLSearchParams({
      room, id: me.id, name: me.name, mic: me.mic ? "1" : "0", cam: me.cam ? "1" : "0",
    });
    try {
      const response = await fetch(`/api/poll?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`poll failed: ${response.status}`);
      const { messages } = await response.json();
      if (offline) toast("Reconnected");
      offline = false;
      for (const message of messages) {
        try {
          handleMessage(message);
        } catch (error) {
          console.error("DU Meet: could not handle", message.type, error);
        }
      }
    } catch {
      if (polling !== controller) break; // left the meeting
      if (!offline) toast("Connection lost. Reconnecting…");
      offline = true;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

function leaveMeeting() {
  navigator.sendBeacon("/api/send", JSON.stringify({ room, from: me.id, type: "bye" }));
  polling.abort();
  polling = null;
  if (recorder) recorder.stop();
  closePip();
  stopRecognition();
  recognitionWanted = false;
  for (const id of [...peers.keys()]) removePeer(id);
  stopScreenShare();
  for (const track of me.stream.getTracks()) track.stop();
  me.stream = null;
  me.hand = false;
  me.cc = false;
  pinnedId = null;
  activeSpeaker = null;
  stageOrder.length = 0;
  meters.clear();
  closeWhiteboardLocally();
  wb.strokes.clear();
  polls.clear();
  renderPolls();
  clearCaptions();
  $("#grid").replaceChildren();
  $("#chat-messages").replaceChildren();
  toggleReactionPicker(false);
  toggleMenu(false);
  if (openPanel) togglePanel(openPanel);
  toggleInfo(false);
  unread = unreadPolls = 0;
  refreshUnread();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  window.DU?.onLeave?.();
  showView("left");
}

window.addEventListener("pagehide", () => {
  if (polling) navigator.sendBeacon("/api/send", JSON.stringify({ room, from: me.id, type: "bye" }));
});

// ---------- Signaling ----------

let sendQueue = Promise.resolve();

/** Send a message to one person (to = their id) or everyone (to = undefined). */
function send(type, data, to) {
  if (!polling) return;
  const body = JSON.stringify({ room, from: me.id, to, type, data });
  // Chained so messages arrive in the order they were sent (offer before ice).
  sendQueue = sendQueue.then(() => fetch("/api/send", { method: "POST", body }).catch(() => {}));
}

function sendState(data) {
  send("state", data);
}

function handleMessage(message) {
  const peer = peers.get(message.from);
  const data = message.data;
  switch (message.type) {
    case "welcome":
      // Also arrives again after a reconnect, so start from a clean slate.
      for (const id of [...peers.keys()]) removePeer(id);
      for (const info of message.peers) callPeer(addPeer(info));
      sendState({ mic: me.mic, cam: me.cam, hand: me.hand, screen: Boolean(me.screenTrack), rec: me.rec, cc: me.cc });
      break;
    case "join":
      removePeer(message.peer.id); // same person reconnecting
      window.DU?.onPeerJoined?.(addPeer(message.peer));
      toast(`${message.peer.name} joined`);
      note("event", message.peer.name, "joined");
      if (isSyncHost(message.peer.id)) send("sync", syncState(), message.peer.id);
      break;
    case "leave":
      if (peers.has(message.id)) {
        toast(`${peers.get(message.id).name} left`);
        note("event", peers.get(message.id).name, "left");
        removePeer(message.id);
      }
      break;
    case "state": {
      const changed = peers.get(message.peer.id);
      if (!changed) break;
      const next = message.peer;
      if (next.hand && !changed.hand) {
        changed.handAt = Date.now();
        toast(`${changed.name} raised a hand`);
      }
      if (next.screen && !changed.screen) {
        toast(`${changed.name} is presenting`);
        stageAppeared(screenId(changed.id));
      }
      if (next.rec && !changed.rec) toast(`${changed.name} started recording this meeting`);
      if (!next.rec && changed.rec) toast(`${changed.name} stopped recording`);
      Object.assign(changed, next);
      renderAll();
      updateRecognition();
      break;
    }
    case "offer":
      if (peer) answerPeer(peer, data);
      break;
    case "answer":
      if (peer) acceptAnswer(peer, data);
      break;
    case "ice":
      if (peer) addIce(peer, data);
      break;
    case "chat":
      if (peer && (typeof data?.text === "string" || Array.isArray(data?.media))) {
        addChatMessage(peer.name, String(data.text ?? "").slice(0, 500), false, Array.isArray(data.media) ? data.media.slice(0, 10) : []);
      }
      break;
    case "reaction":
      if (peer && REACTIONS.includes(data?.emoji)) showReaction(data.emoji, peer.name);
      break;
    case "mute-request":
      if (peer && me.mic) {
        setMic(false);
        toast(`${peer.name} muted you`);
      }
      break;
    case "caption":
      if (peer && typeof data?.text === "string") showCaption(peer.id, peer.name, data.text.slice(-300), Boolean(data.final));
      break;
    case "wb":
      if (peer) receiveStroke(data);
      break;
    case "wb-clear":
      if (peer) clearWhiteboard(false);
      break;
    case "wb-open":
      if (peer) {
        setWhiteboardOpen(Boolean(data?.open), false);
        toast(data?.open ? `${peer.name} opened the whiteboard` : `${peer.name} closed the whiteboard`);
      }
      break;
    case "poll":
      if (peer) receivePoll(peer, data);
      break;
    case "vote":
      if (peer) receiveVote(peer.id, data);
      break;
    case "poll-end":
      if (peer && polls.get(data?.id)?.byId === peer.id) {
        polls.get(data.id).open = false;
        renderPolls();
      }
      break;
    case "sync":
      if (peer) applySync(data);
      break;
    case "end-call":
      if (message.from === "admin") { leaveMeeting(); toast("The call was ended"); }
      break;
    default:
      // couple features (together.js): watch/listen together, sleep, moments…
      window.DU?.onMessage?.(message, peer);
  }
}

// ---------- WebRTC connections ----------

function addPeer(info) {
  const peer = {
    hand: false, screen: false, rec: false, cc: false, handAt: 0,
    ...info, pc: new RTCPeerConnection({ iceServers }), pendingIce: [],
    audio: document.createElement("audio"), camTrack: null, screenTrack: null,
  };
  if (peer.hand) peer.handAt = Date.now();
  if (peer.screen) stageAppeared(screenId(peer.id));
  // Remote voices play through their own <audio>, so tiles can be hidden,
  // moved or put in picture-in-picture without cutting anyone's sound.
  peer.audio.autoplay = true;
  if (prefs.speakerId) peer.audio.setSinkId?.(prefs.speakerId).catch(() => {});
  $("#audio-sinks").append(peer.audio);

  peer.pc.onicecandidate = ({ candidate }) => {
    if (candidate) send("ice", candidate, peer.id);
  };
  peer.pc.oniceconnectionstatechange = () => {
    const state = peer.pc.iceConnectionState;
    clearTimeout(peer.restartTimer);
    if (state === "connected" || state === "completed") {
      if (peer.reconnecting) toast(`Back with ${peer.name}`);
      peer.reconnecting = false;
      peer.restarts = 0;
      return;
    }
    // Network blip (Wi-Fi ↔ mobile data, a tunnel…): try a fresh route instead of ending the call.
    if (state === "disconnected" || state === "failed") {
      if (!peer.reconnecting) toast(`Reconnecting with ${peer.name}…`);
      peer.reconnecting = true;
      peer.restartTimer = setTimeout(() => restartPeer(peer), state === "failed" ? 0 : 2500);
    }
    if (state !== "failed" || (peer.restarts ?? 0) < 4) return;
    const relay = iceServers.some((server) => [server.urls].flat().some((url) => url.startsWith("turn")));
    toast(relay
      ? `Couldn't connect audio and video with ${peer.name}. Try rejoining.`
      : `Couldn't connect audio and video with ${peer.name}: your networks need a TURN relay (README section 1c).`);
  };
  peer.pc.ontrack = ({ track, transceiver }) => {
    const slot = peer.pc.getTransceivers().indexOf(transceiver);
    if (slot === SLOT.audio) {
      peer.audio.srcObject = new MediaStream([track]);
      peer.audio.play().catch(() => toast("Click anywhere to turn on sound"));
      watchAudio(peer.id, track);
      recordingAddAudio(peer.id, track);
    } else if (slot === SLOT.camera) {
      peer.camTrack = track;
    } else if (slot === SLOT.screen) {
      peer.screenTrack = track;
    }
    renderAll();
  };
  peers.set(peer.id, peer);
  renderAll();
  return peer;
}

function removePeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peer.pc.close();
  peer.audio.srcObject = null;
  peer.audio.remove();
  peers.delete(id);
  meters.delete(id);
  recordingRemoveAudio(id);
  removeCaption(id);
  if (activeSpeaker === id) activeSpeaker = null;
  renderAll();
  updateRecognition();
}

/** The newcomer calls everyone already in the meeting. */
async function callPeer(peer) {
  peer.initiator = true; // the one who called restarts the connection when the network drops
  // Three slots: mic, camera, screen. They exist even while empty, so the
  // camera and presenting can start later with replaceTrack.
  peer.pc.addTransceiver(localTrack(SLOT.audio) ?? "audio", { direction: "sendrecv" });
  peer.pc.addTransceiver(localTrack(SLOT.camera) ?? "video", { direction: "sendrecv" });
  peer.pc.addTransceiver(localTrack(SLOT.screen) ?? "video", { direction: "sendrecv" });
  await peer.pc.setLocalDescription(await peer.pc.createOffer());
  send("offer", peer.pc.localDescription, peer.id);
}

/** ICE restart: same call, new network path. Only the caller starts it, so the two never collide. */
async function restartPeer(peer) {
  if (!peers.has(peer.id) || !peer.initiator || peer.pc.signalingState !== "stable") return;
  if (["connected", "completed"].includes(peer.pc.iceConnectionState)) return;
  peer.restarts = (peer.restarts ?? 0) + 1;
  try {
    peer.pc.restartIce();
    await peer.pc.setLocalDescription(await peer.pc.createOffer({ iceRestart: true }));
    send("offer", peer.pc.localDescription, peer.id);
  } catch (error) {
    console.warn("DU Meet: ICE restart failed", error);
  }
  if (peer.restarts < 6) peer.restartTimer = setTimeout(() => restartPeer(peer), 8000);
}

async function answerPeer(peer, offer) {
  await peer.pc.setRemoteDescription(offer);
  const transceivers = peer.pc.getTransceivers();
  for (const [slot, transceiver] of transceivers.entries()) {
    transceiver.direction = "sendrecv";
    await transceiver.sender.replaceTrack(localTrack(slot));
  }
  await flushIce(peer);
  await peer.pc.setLocalDescription(await peer.pc.createAnswer());
  send("answer", peer.pc.localDescription, peer.id);
}

async function acceptAnswer(peer, answer) {
  await peer.pc.setRemoteDescription(answer);
  await flushIce(peer);
}

async function addIce(peer, candidate) {
  // Candidates can arrive before the offer/answer is applied; keep them until then.
  if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate).catch(() => {});
  else peer.pendingIce.push(candidate);
}

async function flushIce(peer) {
  for (const candidate of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(candidate).catch(() => {});
}

// ---------- Video tiles ----------
//
// Tile ids: a person's id (camera), "<id>#screen" (their presentation) and
// "whiteboard". renderAll() works out which tiles should exist, creates or
// removes them, paints them and then lays the grid out.

const screenId = (id) => `${id}#screen`;
const tileOf = (id) => document.querySelector(`#grid .tile[data-id="${CSS.escape(id)}"]`);

let pinnedId = null;      // tile pinned by you (only for you, like Meet's "Pin for myself")
let activeSpeaker = null; // remote person speaking most recently
const stageOrder = [];    // presentations / whiteboard in the order they appeared; newest is shown large

function stageAppeared(id) {
  const index = stageOrder.indexOf(id);
  if (index >= 0) stageOrder.splice(index, 1);
  stageOrder.push(id);
}

function wantedTiles() {
  const list = [{ id: me.id, kind: "camera", owner: me.id }];
  if (me.screenTrack) list.push({ id: screenId(me.id), kind: "screen", owner: me.id });
  for (const peer of peers.values()) {
    list.push({ id: peer.id, kind: "camera", owner: peer.id });
    if (peer.screen) list.push({ id: screenId(peer.id), kind: "screen", owner: peer.id });
  }
  if (wb.open) list.push({ id: "whiteboard", kind: "whiteboard" });
  return list;
}

function renderAll() {
  if (!polling && $("#room").hidden) {
    refreshLocal();
    return;
  }
  const grid = $("#grid");
  const wanted = wantedTiles();
  const ids = new Set(wanted.map((t) => t.id));
  for (const tile of [...grid.children]) if (!ids.has(tile.dataset.id)) tile.remove();
  for (let i = stageOrder.length - 1; i >= 0; i--) if (!ids.has(stageOrder[i])) stageOrder.splice(i, 1);
  if (pinnedId && !ids.has(pinnedId)) pinnedId = null;

  wanted.forEach((spec, index) => {
    let tile = tileOf(spec.id);
    if (!tile) {
      tile = spec.kind === "whiteboard" ? whiteboardTile() : $("#tile-template").content.firstElementChild.cloneNode(true);
      tile.dataset.id = spec.id;
      tile.classList.toggle("self", spec.id === me.id);
      grid.append(tile);
    }
    tile.style.order = index;
    if (spec.kind !== "whiteboard") paintTile(tile, spec);
    paintPin(tile, spec.id);
  });
  refreshLocal();
  refreshPeople();
  layoutGrid();
  refreshRecording();
  updatePip();
}

function paintTile(tile, spec) {
  const isMe = spec.owner === me.id;
  const info = isMe ? myInfo() : peers.get(spec.owner);
  if (!info) return;
  const label = isMe ? "You" : info.name;
  const video = tile.querySelector("video");
  if (spec.kind === "camera") {
    tile.classList.toggle("video-off", !info.cam);
    tile.classList.toggle("mic-muted", !info.mic);
    tile.classList.toggle("hand", info.hand);
    tile.classList.toggle("mirror", isMe && me.facing !== "environment");
    tile.querySelector(".name").textContent = label;
    showTrack(video, isMe ? cameraTrack() : info.camTrack);
    // The browser's own PiP button should never pick your own camera.
    video.disablePictureInPicture = isMe;
  } else {
    tile.classList.add("screen");
    tile.classList.toggle("own-screen", isMe);
    tile.querySelector(".name").textContent = isMe ? "You are presenting" : `${info.name} (presentation)`;
    showTrack(video, isMe ? null : info.screenTrack);
  }
  const avatar = tile.querySelector(".avatar span");
  avatar.textContent = initial(info.name);
  avatar.style.setProperty("--avatar", colorFor(info.name));
  // Diya's and Uday's profile photos (set in Admin) replace the letter
  const face = window.DU?.faceFor?.(info.name) || "";
  avatar.classList.toggle("photo", Boolean(face));
  avatar.style.backgroundImage = face ? `url("${face}")` : "";
}

function paintPin(tile, id) {
  const pinned = pinnedId === id;
  tile.classList.toggle("pinned", pinned);
  const button = tile.querySelector("[data-tile-action=pin]");
  if (!button) return;
  const text = pinned ? "Unpin" : "Pin";
  button.title = button.ariaLabel = text;
  button.querySelector(".icon").textContent = pinned ? "keep_off" : "keep";
}

function togglePin(id) {
  pinnedId = pinnedId === id ? null : id;
  if (pinnedId) {
    const name = tileOf(id)?.querySelector(".name")?.textContent ?? "Whiteboard";
    toast(`Pinned ${name === "You" ? "yourself" : name}`);
  }
  renderAll();
}

function speakerId() {
  if (activeSpeaker && peers.has(activeSpeaker)) return activeSpeaker;
  return peers.keys().next().value ?? me.id;
}

/** The tile shown large: pinned, else the newest presentation/whiteboard, else the speaker. */
function featuredId() {
  if (pinnedId && tileOf(pinnedId)) return pinnedId;
  return stageOrder.at(-1) ?? speakerId();
}

function layoutGrid() {
  const grid = $("#grid");
  const tiles = [...grid.children].sort((a, b) => a.style.order - b.style.order);
  if (!tiles.length) return;
  const featured = featuredId();
  const hideSelf = prefs.hideSelf && pinnedId !== me.id && tiles.length > 1 && featured !== me.id;

  let mode = prefs.layout;
  if (mode === "auto") mode = pinnedId || stageOrder.length ? "sidebar" : "tiled";
  if (mode === "tiled" && pinnedId) mode = "sidebar";

  const shown = tiles.filter((t) => !(hideSelf && t.dataset.id === me.id));
  let strip = [];
  if (mode === "sidebar") {
    strip = shown.filter((t) => t.dataset.id !== featured).slice(0, narrow() ? 3 : 4);
    if (!strip.length) mode = "spotlight";
  }
  grid.className = `grid ${mode}`;
  for (const tile of tiles) {
    const isFeatured = mode !== "tiled" && tile.dataset.id === featured;
    let onStage = shown.includes(tile);
    if (mode === "spotlight") onStage = isFeatured;
    if (mode === "sidebar") onStage = isFeatured || strip.includes(tile);
    tile.classList.toggle("featured", isFeatured);
    tile.classList.toggle("offstage", !onStage);
  }
  const hidden = mode === "sidebar" ? shown.length - strip.length - 1 : 0;
  grid.dataset.more = hidden > 0 ? `+${hidden} more` : "";

  const count = shown.length;
  let cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  if (innerWidth < 720) cols = Math.min(cols, count <= 2 ? 1 : 2);
  grid.style.setProperty("--cols", cols);
  grid.style.setProperty("--rows", Math.ceil(count / cols));
  grid.style.setProperty("--strip", Math.max(strip.length, 1));
}
window.addEventListener("resize", layoutGrid);

function showTrack(video, track) {
  const current = video.srcObject?.getVideoTracks()[0] ?? null;
  if (current !== track) video.srcObject = track ? new MediaStream([track]) : null;
}

const initial = (name) => (name.trim()[0] ?? "?").toUpperCase();

function colorFor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

const myInfo = () => ({
  id: me.id, name: me.name, mic: me.mic, cam: me.cam, hand: me.hand, handAt: me.handAt,
  screen: Boolean(me.screenTrack), rec: me.rec, cc: me.cc,
});

/** Redraw every button that shows your own state. */
function refreshLocal() {
  for (const button of document.querySelectorAll("[data-action=mic]")) {
    button.classList.toggle("off", !me.mic);
    button.querySelector(".icon").textContent = me.mic ? "mic" : "mic_off";
    button.title = `Turn ${me.mic ? "off" : "on"} microphone (⌘ + D)`;
    button.setAttribute("aria-label", `Turn ${me.mic ? "off" : "on"} microphone`);
  }
  for (const button of document.querySelectorAll("[data-action=cam]")) {
    button.classList.toggle("off", !me.cam);
    button.querySelector(".icon").textContent = me.cam ? "videocam" : "videocam_off";
    button.title = `Turn ${me.cam ? "off" : "on"} camera (⌘ + E)`;
    button.setAttribute("aria-label", `Turn ${me.cam ? "off" : "on"} camera`);
  }
  setToggle("share", Boolean(me.screenTrack), "Stop presenting", "Present now");
  setToggle("hand", me.hand, "Lower hand", "Raise hand");
  setToggle("captions", me.cc, "Turn off captions", "Turn on captions");
  setMenuLabel("pip", isPipOpen() ? "Close picture-in-picture" : "Open picture-in-picture");
  setMenuLabel("whiteboard", wb.open ? "Close whiteboard" : "Open whiteboard");
  setMenuLabel("record", me.rec ? "Stop recording" : "Record meeting");
  setMenuLabel("hide-self", prefs.hideSelf ? "Show self view" : "Hide self view");
  setMenuLabel("fullscreen", document.fullscreenElement ? "Exit full screen" : "Full screen");
  $("#more-menu [data-action=record]").classList.toggle("danger", me.rec);

  const display = Boolean(navigator.mediaDevices?.getDisplayMedia);
  for (const button of document.querySelectorAll(".share-btn")) button.hidden = !display;
  $("#more-menu [data-action=record]").hidden = !display || !window.MediaRecorder;
  $("#more-menu [data-action=fullscreen]").hidden = !document.fullscreenEnabled;
  $("#more-menu [data-action=pip]").hidden = !("documentPictureInPicture" in window) && !document.pictureInPictureEnabled;

  showTrack($("#preview"), cameraTrack());
  $("#preview-box").classList.toggle("video-off", !me.cam);
  $("#preview-box").classList.toggle("no-mirror", me.facing === "environment");
}

function setToggle(action, on, onText, offText) {
  for (const button of document.querySelectorAll(`[data-action=${action}]`)) {
    if (button.closest(".tile")) continue;
    if (button.matches(".ctrl")) {
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", on);
      button.title = on ? onText : offText;
      button.setAttribute("aria-label", on ? onText : offText);
    } else {
      const label = button.querySelector(".label");
      if (label) label.textContent = on ? onText : offText;
      button.classList.toggle("checked", on);
    }
  }
}

function setMenuLabel(action, text) {
  const label = $(`#more-menu [data-action=${action}] .label`);
  if (label) label.textContent = text;
}

// ---------- Who is speaking ----------

let audioContext = null;
const meters = new Map(); // id -> { analyser, samples }
let speakerChangedAt = 0;

function watchAudio(id, track) {
  try {
    audioContext ??= new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    audioContext.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    meters.set(id, { analyser, samples: new Uint8Array(analyser.fftSize) });
  } catch {
    // no Web Audio: just no speaking ring
  }
}

setInterval(() => {
  let loudest = null;
  let loudestLevel = 0.04;
  for (const [id, { analyser, samples }] of meters) {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
    const loudness = Math.sqrt(sum / samples.length);
    const micOn = id === me.id ? me.mic : peers.get(id)?.mic;
    const speaking = micOn && loudness > 0.03;
    tileOf(id)?.classList.toggle("speaking", speaking);
    if (speaking && id !== me.id && loudness > loudestLevel) {
      loudest = id;
      loudestLevel = loudness;
    }
  }
  // Switch the large tile at most every 1.5 s, so it doesn't flicker between people.
  if (loudest && loudest !== activeSpeaker && Date.now() - speakerChangedAt > 1500) {
    activeSpeaker = loudest;
    speakerChangedAt = Date.now();
    layoutGrid();
    updatePip();
  }
}, 150);

// ---------- Picture-in-picture ----------
//
// Chrome (desktop): a small always-on-top window (Document Picture-in-Picture)
// with the speaker's video and mic/camera/hand/leave buttons, like Meet's.
// Other browsers: classic video picture-in-picture of the speaker.
// Either way it shows the pinned tile, else the presentation, else whoever is
// speaking, and never your own camera unless you are alone.

let pip = null; // { win, video, avatar, name }

const isPipOpen = () => Boolean(pip) || document.pictureInPictureElement === $("#pip-video");

function pipTarget() {
  const id = (pinnedId && tileOf(pinnedId) ? pinnedId : null) ?? stageOrder.at(-1) ?? speakerId();
  if (id === "whiteboard") {
    wb.stream ??= wb.canvas.captureStream(10);
    return { track: wb.stream.getVideoTracks()[0], name: "Whiteboard", contain: true };
  }
  if (id.endsWith("#screen")) {
    const owner = id.slice(0, -7);
    if (owner === me.id) return { track: me.screenTrack, name: "Your presentation", contain: true };
    const peer = peers.get(owner);
    return { track: peer?.screenTrack ?? null, name: `${peer?.name ?? ""} (presentation)`, contain: true };
  }
  if (id === me.id) return { track: me.cam ? cameraTrack() : null, name: "You", person: myInfo(), mirror: me.facing !== "environment" };
  const peer = peers.get(id);
  return { track: peer?.cam ? peer.camTrack : null, name: peer?.name ?? "", person: peer };
}

async function togglePip() {
  if (isPipOpen()) return closePip();
  if ("documentPictureInPicture" in window) {
    try {
      await openDocumentPip();
    } catch {
      toast("Couldn't open picture-in-picture");
    }
  } else if (document.pictureInPictureEnabled) {
    const video = $("#pip-video");
    const target = pipTarget();
    if (!target.track) return toast("The speaker's camera is off, so there is nothing to show yet");
    showTrack(video, target.track);
    try {
      await video.play();
      await video.requestPictureInPicture();
    } catch {
      toast("Couldn't open picture-in-picture");
    }
  } else {
    toast("Picture-in-picture is not supported in this browser");
  }
  refreshLocal();
}

async function openDocumentPip() {
  const win = await window.documentPictureInPicture.requestWindow({ width: 400, height: 300 });
  for (const link of document.querySelectorAll("link[rel=stylesheet]")) {
    const copy = win.document.createElement("link");
    copy.rel = "stylesheet";
    copy.href = link.href;
    win.document.head.append(copy);
  }
  const doc = win.document;
  doc.body.className = "pip-body";
  doc.body.innerHTML = `
    <div class="pip-stage">
      <video autoplay playsinline muted></video>
      <div class="avatar"><span></span></div>
      <div class="tile-name"><span class="name"></span></div>
    </div>
    <div class="pip-controls">
      <button class="ctrl" data-action="mic"><span class="icon">mic</span></button>
      <button class="ctrl" data-action="cam"><span class="icon">videocam</span></button>
      <button class="ctrl" data-action="hand" title="Raise hand"><span class="icon">back_hand</span></button>
      <button class="ctrl" data-action="pip-back" title="Back to the meeting"><span class="icon">open_in_new</span></button>
      <button class="ctrl leave" data-action="leave" title="Leave call"><span class="icon">call_end</span></button>
    </div>`;
  doc.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "pip-back") {
      closePip();
      window.focus();
    } else {
      actions[button.dataset.action]();
    }
  });
  win.addEventListener("pagehide", () => {
    pip = null;
    refreshLocal();
  });
  pip = { win, video: doc.querySelector("video"), stage: doc.querySelector(".pip-stage"), avatar: doc.querySelector(".avatar span"), name: doc.querySelector(".name") };
  updatePip();
}

function updatePip() {
  if (pip) {
    const target = pipTarget();
    showTrack(pip.video, target.track);
    pip.video.play().catch(() => {});
    pip.stage.classList.toggle("video-off", !target.track);
    pip.stage.classList.toggle("mirror", Boolean(target.mirror));
    pip.stage.classList.toggle("contain", Boolean(target.contain));
    pip.name.textContent = target.name;
    pip.avatar.textContent = initial(target.person?.name ?? target.name);
    pip.avatar.style.setProperty("--avatar", colorFor(target.person?.name ?? target.name));
    for (const button of pip.win.document.querySelectorAll("[data-action]")) {
      const action = button.dataset.action;
      if (action === "mic") {
        button.classList.toggle("off", !me.mic);
        button.querySelector(".icon").textContent = me.mic ? "mic" : "mic_off";
      } else if (action === "cam") {
        button.classList.toggle("off", !me.cam);
        button.querySelector(".icon").textContent = me.cam ? "videocam" : "videocam_off";
      } else if (action === "hand") {
        button.classList.toggle("active", me.hand);
      }
    }
  } else if (document.pictureInPictureElement === $("#pip-video")) {
    const { track } = pipTarget();
    if (track) showTrack($("#pip-video"), track);
  }
}

function closePip() {
  if (pip) {
    pip.win.close();
    pip = null;
  }
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
}

$("#pip-video").addEventListener("leavepictureinpicture", refreshLocal);

// Chrome can open the PiP window by itself when you switch tabs during a call.
try {
  navigator.mediaSession?.setActionHandler("enterpictureinpicture", () => {
    if (polling && !isPipOpen() && "documentPictureInPicture" in window) openDocumentPip().catch(() => {});
  });
} catch {
  // not supported in this browser
}

// ---------- Live captions ----------
//
// Each browser turns its *own* microphone into text (Web Speech API, Chrome
// and Edge) and sends the words to the meeting. It only listens while someone
// in the meeting has captions on, and only shows them to people who turned
// captions on.

let recognition = null;
let recognitionWanted = false;
let lastInterimSent = 0;
const captionLines = new Map(); // id -> { element, text, timer }

function toggleCaptions() {
  me.cc = !me.cc;
  if (me.cc && !SpeechRecognition) toast("This browser can't turn your voice into text (use Chrome), but you'll see everyone else's captions");
  else if (me.cc) toast(`Captions on (${$("#caption-lang").selectedOptions[0]?.textContent ?? prefs.lang}). Change the language in Settings.`);
  if (!me.cc) clearCaptions();
  sendState({ cc: me.cc });
  refreshLocal();
  updateRecognition();
}

function updateRecognition() {
  const want = Boolean(SpeechRecognition && polling && me.mic && micTrack())
    && (me.cc || [...peers.values()].some((peer) => peer.cc));
  if (want === recognitionWanted && (!want || recognition)) return;
  recognitionWanted = want;
  if (want) startRecognition();
  else stopRecognition();
}

function startRecognition() {
  const listener = new SpeechRecognition();
  listener.lang = prefs.lang;
  listener.continuous = true;
  listener.interimResults = true;
  listener.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (!text) continue;
      const now = Date.now();
      showCaption(me.id, "You", text, result.isFinal);
      if (!result.isFinal && now - lastInterimSent < 350) continue;
      lastInterimSent = now;
      send("caption", { text: text.slice(-300), final: result.isFinal });
    }
  };
  listener.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      recognition = null;
      recognitionWanted = false;
      if (me.cc) toast("Speech recognition is blocked, so your own words can't be captioned");
    }
  };
  listener.onend = () => {
    // Chrome stops listening after a pause; start again while still needed.
    if (recognition !== listener) return;
    recognition = null;
    setTimeout(() => {
      if (recognitionWanted && !recognition) startRecognition();
    }, 250);
  };
  recognition = listener;
  try {
    listener.start();
  } catch {
    recognition = null;
  }
}

function stopRecognition() {
  const listener = recognition;
  recognition = null;
  listener?.abort();
}

function showCaption(id, name, text, final) {
  if (final) note("caption", id === me.id ? me.name : name, text);
  if (!me.cc) return;
  let line = captionLines.get(id);
  if (!line) {
    const element = document.createElement("p");
    element.className = "caption-line";
    const who = document.createElement("strong");
    who.textContent = name;
    const words = document.createElement("span");
    element.append(who, words);
    line = { element, words };
    captionLines.set(id, line);
  }
  line.words.textContent = text;
  $("#captions").append(line.element); // newest speaker at the bottom
  clearTimeout(line.timer);
  line.timer = setTimeout(() => removeCaption(id), 6000);
  while ($("#captions").children.length > 3) {
    const oldest = [...captionLines].find(([, l]) => l.element === $("#captions").firstElementChild);
    if (oldest) removeCaption(oldest[0]);
    else $("#captions").firstElementChild.remove();
  }
  $("#captions").hidden = false;
}

function removeCaption(id) {
  const line = captionLines.get(id);
  if (!line) return;
  clearTimeout(line.timer);
  line.element.remove();
  captionLines.delete(id);
  $("#captions").hidden = captionLines.size === 0;
}

function clearCaptions() {
  for (const id of [...captionLines.keys()]) removeCaption(id);
}

// ---------- Recording ----------
//
// Records this tab (the meeting as you see it) plus everyone's voices, and
// saves a .webm file on your computer when you stop. Everyone sees a
// "Recording" badge while it runs.

let recorder = null;
let recordingMix = null; // { destination, sources: Map(id -> node) }

async function toggleRecording() {
  if (recorder) return recorder.stop();
  let display;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: 30 },
      audio: false, preferCurrentTab: true, selfBrowserSurface: "include",
    });
  } catch {
    return; // cancelled
  }
  audioContext ??= new AudioContext();
  recordingMix = { destination: audioContext.createMediaStreamDestination(), sources: new Map() };
  if (micTrack()) recordingAddAudio(me.id, micTrack());
  for (const peer of peers.values()) {
    const track = peer.audio.srcObject?.getAudioTracks()[0];
    if (track) recordingAddAudio(peer.id, track);
  }
  const stream = new MediaStream([display.getVideoTracks()[0], ...recordingMix.destination.stream.getAudioTracks()]);
  const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    .find((t) => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  const started = new Date();
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    for (const track of display.getTracks()) track.stop();
    for (const node of recordingMix.sources.values()) node.disconnect();
    recordingMix = null;
    recorder = null;
    me.rec = false;
    sendState({ rec: false });
    renderAll();
    const extension = (type ?? "").includes("mp4") ? "mp4" : "webm";
    download(new Blob(chunks, { type: type ?? "video/webm" }), `DU Meet ${room} ${stamp(started)}.${extension}`);
    toast("Recording saved to your Downloads");
  };
  display.getVideoTracks()[0].onended = () => recorder?.stop(); // browser's "Stop sharing"
  recorder.start(1000);
  me.rec = true;
  sendState({ rec: true });
  renderAll();
  toast("Recording started. Everyone in the meeting can see this.");
}

function recordingAddAudio(id, track) {
  if (!recordingMix) return;
  recordingMix.sources.get(id)?.disconnect();
  const node = audioContext.createMediaStreamSource(new MediaStream([track]));
  node.connect(recordingMix.destination);
  recordingMix.sources.set(id, node);
}

function recordingRemoveAudio(id) {
  recordingMix?.sources.get(id)?.disconnect();
  recordingMix?.sources.delete(id);
}

function refreshRecording() {
  const anyone = me.rec || [...peers.values()].some((peer) => peer.rec);
  $("#rec-badge").hidden = !anyone;
}

// ---------- Whiteboard (new) ----------
//
// A shared drawing board everyone can draw on at the same time. Strokes are
// sent in small pieces while you draw, so others see them appear live.

const WB_W = 1600;
const WB_H = 900;
const WB_COLORS = ["#1d1d1f", "#d93a3a", "#2f5bd3", "#22915a", "#e08a00"];
const wb = {
  open: false, strokes: new Map(), canvas: null, ctx: null, tile: null, stream: null,
  color: WB_COLORS[0], eraser: false, current: null, pending: [], timer: null, seq: 0,
};

function whiteboardTile() {
  if (wb.tile) return wb.tile;
  const tile = document.createElement("div");
  tile.className = "tile whiteboard-tile";
  tile.innerHTML = `
    <canvas width="${WB_W}" height="${WB_H}" aria-label="Shared whiteboard"></canvas>
    <div class="wb-tools" role="toolbar" aria-label="Whiteboard tools">
      ${WB_COLORS.map((c) => `<button class="wb-color" data-wb-color="${c}" style="--swatch:${c}" aria-label="Pen colour ${c}"></button>`).join("")}
      <button class="wb-tool" data-wb="eraser" title="Eraser" aria-label="Eraser"><span class="icon" aria-hidden="true">ink_eraser</span></button>
      <button class="wb-tool" data-wb="clear" title="Clear for everyone" aria-label="Clear for everyone"><span class="icon" aria-hidden="true">delete_sweep</span></button>
      <button class="wb-tool" data-wb="save" title="Save as image" aria-label="Save as image"><span class="icon" aria-hidden="true">download</span></button>
      <button class="wb-tool" data-wb="close" title="Close whiteboard" aria-label="Close whiteboard"><span class="icon" aria-hidden="true">close</span></button>
    </div>
    <div class="tile-actions">
      <button class="tile-btn" data-tile-action="pin" title="Pin" aria-label="Pin"><span class="icon" aria-hidden="true">keep</span></button>
    </div>
    <div class="tile-name"><span class="icon pin-mark" aria-hidden="true">keep</span><span class="name">Whiteboard</span></div>`;
  wb.tile = tile;
  wb.canvas = tile.querySelector("canvas");
  wb.ctx = wb.canvas.getContext("2d");
  wb.ctx.fillStyle = "#ffffff";
  wb.ctx.fillRect(0, 0, WB_W, WB_H);
  paintWhiteboardTools();

  const point = (event) => {
    const rect = wb.canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / WB_W, rect.height / WB_H);
    const x = (event.clientX - rect.left - (rect.width - WB_W * scale) / 2) / scale;
    const y = (event.clientY - rect.top - (rect.height - WB_H * scale) / 2) / scale;
    return [Math.round(Math.max(0, Math.min(WB_W, x))), Math.round(Math.max(0, Math.min(WB_H, y)))];
  };
  wb.canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    wb.canvas.setPointerCapture(event.pointerId);
    const id = `${me.id}:${wb.seq++}`;
    wb.current = { id, c: wb.color, w: 4, e: wb.eraser, p: [] };
    wb.strokes.set(id, wb.current);
    addPoints(wb.current, [point(event)]);
    wb.pending.push(wb.current.p.at(-1));
    scheduleStrokeSend();
  });
  wb.canvas.addEventListener("pointermove", (event) => {
    if (!wb.current) return;
    const p = point(event);
    const last = wb.current.p.at(-1);
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 2) return;
    addPoints(wb.current, [p]);
    wb.pending.push(p);
    scheduleStrokeSend();
  });
  const end = () => {
    if (!wb.current) return;
    flushStroke();
    wb.current = null;
  };
  wb.canvas.addEventListener("pointerup", end);
  wb.canvas.addEventListener("pointercancel", end);

  tile.addEventListener("click", (event) => {
    const color = event.target.closest("[data-wb-color]");
    const tool = event.target.closest("[data-wb]")?.dataset.wb;
    if (color) {
      wb.color = color.dataset.wbColor;
      wb.eraser = false;
    } else if (tool === "eraser") {
      wb.eraser = !wb.eraser;
    } else if (tool === "clear") {
      clearWhiteboard(true);
    } else if (tool === "save") {
      saveWhiteboard();
    } else if (tool === "close") {
      setWhiteboardOpen(false, true);
    }
    paintWhiteboardTools();
  });
  return tile;
}

function paintWhiteboardTools() {
  for (const button of wb.tile.querySelectorAll("[data-wb-color]")) {
    button.classList.toggle("active", !wb.eraser && button.dataset.wbColor === wb.color);
  }
  wb.tile.querySelector("[data-wb=eraser]").classList.toggle("active", wb.eraser);
  wb.canvas.classList.toggle("erasing", wb.eraser);
}

function scheduleStrokeSend() {
  wb.timer ??= setTimeout(flushStroke, 90);
}

function flushStroke() {
  clearTimeout(wb.timer);
  wb.timer = null;
  if (!wb.current || !wb.pending.length) return;
  const { id, c, w, e } = wb.current;
  send("wb", { id, c, w, e, p: wb.pending.splice(0) });
}

function drawSegment(stroke, from, to) {
  const ctx = wb.ctx;
  ctx.strokeStyle = stroke.e ? "#ffffff" : stroke.c;
  ctx.lineWidth = stroke.e ? 40 : stroke.w;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0] + (from === to ? 0.1 : 0), to[1]);
  ctx.stroke();
}

function addPoints(stroke, points) {
  if (!wb.ctx) whiteboardTile();
  for (const p of points) {
    drawSegment(stroke, stroke.p.at(-1) ?? p, p);
    stroke.p.push(p);
  }
}

function receiveStroke(data) {
  if (typeof data?.id !== "string" || !Array.isArray(data.p)) return;
  const points = data.p.filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)).slice(0, 2000);
  let stroke = wb.strokes.get(data.id);
  if (!stroke) {
    const color = WB_COLORS.includes(data.c) ? data.c : WB_COLORS[0];
    stroke = { id: data.id, c: color, w: Math.min(Math.max(Number(data.w) || 4, 1), 20), e: Boolean(data.e), p: [] };
    wb.strokes.set(data.id, stroke);
  }
  addPoints(stroke, points);
  if (!wb.open) setWhiteboardOpen(true, false);
}

function redrawWhiteboard() {
  if (!wb.ctx) whiteboardTile();
  wb.ctx.fillStyle = "#ffffff";
  wb.ctx.fillRect(0, 0, WB_W, WB_H);
  for (const stroke of wb.strokes.values()) {
    const points = stroke.p;
    stroke.p = [];
    addPoints(stroke, points);
  }
}

function clearWhiteboard(mine) {
  wb.strokes.clear();
  redrawWhiteboard();
  if (mine) send("wb-clear");
}

function setWhiteboardOpen(open, mine) {
  if (wb.open === open) return;
  wb.open = open;
  if (open) {
    whiteboardTile();
    stageAppeared("whiteboard");
  }
  if (mine) send("wb-open", { open });
  renderAll();
}

function closeWhiteboardLocally() {
  wb.open = false;
  wb.current = null;
  wb.pending.length = 0;
}

function saveWhiteboard() {
  const copy = document.createElement("canvas");
  copy.width = WB_W;
  copy.height = WB_H;
  copy.getContext("2d").drawImage(wb.canvas, 0, 0);
  copy.toBlob((blob) => download(blob, `DU Meet whiteboard ${stamp(new Date())}.png`));
}

// ---------- Polls (new) ----------

const polls = new Map(); // id -> { id, question, options, by, byId, votes: Map(voterId -> option), open }

function launchPoll(question, options) {
  const poll = { id: crypto.randomUUID(), question, options, by: me.name, byId: me.id, votes: new Map(), open: true };
  polls.set(poll.id, poll);
  send("poll", { id: poll.id, question, options });
  renderPolls();
}

function receivePoll(peer, data) {
  if (typeof data?.id !== "string" || typeof data.question !== "string" || !Array.isArray(data.options)) return;
  const options = data.options.filter((o) => typeof o === "string").slice(0, 6).map((o) => o.slice(0, 80));
  if (options.length < 2 || polls.has(data.id)) return;
  polls.set(data.id, { id: data.id, question: data.question.slice(0, 200), options, by: peer.name, byId: peer.id, votes: new Map(), open: true });
  if (openPanel !== "polls") {
    unreadPolls++;
    refreshUnread();
    toast(`${peer.name} started a poll: ${data.question.slice(0, 80)}`);
  }
  renderPolls();
}

function receiveVote(voterId, data) {
  const poll = polls.get(data?.id);
  if (!poll || !poll.open || !Number.isInteger(data.option) || data.option < 0 || data.option >= poll.options.length) return;
  poll.votes.set(voterId, data.option);
  renderPolls();
}

function vote(pollId, option) {
  const poll = polls.get(pollId);
  if (!poll?.open) return;
  poll.votes.set(me.id, option);
  send("vote", { id: pollId, option });
  renderPolls();
}

function endPoll(pollId) {
  const poll = polls.get(pollId);
  if (!poll || poll.byId !== me.id) return;
  poll.open = false;
  send("poll-end", { id: pollId });
  renderPolls();
}

function renderPolls() {
  const list = $("#poll-list");
  if (!polls.size) {
    const empty = document.createElement("li");
    empty.className = "poll-empty";
    empty.textContent = "No polls yet. Ask the meeting a quick question above.";
    return list.replaceChildren(empty);
  }
  list.replaceChildren(...[...polls.values()].reverse().map((poll) => {
    const item = document.createElement("li");
    item.className = "poll";
    const head = document.createElement("p");
    head.className = "poll-meta";
    head.textContent = `${poll.byId === me.id ? "You" : poll.by} asked${poll.open ? "" : " · ended"}`;
    const question = document.createElement("p");
    question.className = "poll-question";
    question.textContent = poll.question;
    item.append(head, question);
    const total = poll.votes.size;
    const mine = poll.votes.get(me.id);
    poll.options.forEach((text, index) => {
      const count = [...poll.votes.values()].filter((v) => v === index).length;
      const percent = total ? Math.round((count / total) * 100) : 0;
      const button = document.createElement("button");
      button.className = "poll-choice";
      button.disabled = !poll.open;
      button.dataset.poll = poll.id;
      button.dataset.option = index;
      button.classList.toggle("chosen", mine === index);
      button.style.setProperty("--share", `${percent}%`);
      button.setAttribute("aria-pressed", mine === index);
      const label = document.createElement("span");
      label.textContent = text;
      const result = document.createElement("span");
      result.className = "poll-count";
      result.textContent = `${count} · ${percent}%`;
      button.append(label, result);
      item.append(button);
    });
    const foot = document.createElement("div");
    foot.className = "poll-foot";
    const votes = document.createElement("span");
    votes.textContent = `${total} ${total === 1 ? "vote" : "votes"}`;
    foot.append(votes);
    if (poll.open && poll.byId === me.id) {
      const end = document.createElement("button");
      end.className = "btn text";
      end.dataset.endPoll = poll.id;
      end.textContent = "End poll";
      foot.append(end);
    }
    item.append(foot);
    return item;
  }));
}

$("#poll-list").addEventListener("click", (event) => {
  const choice = event.target.closest("[data-poll]");
  if (choice) vote(choice.dataset.poll, Number(choice.dataset.option));
  const end = event.target.closest("[data-end-poll]");
  if (end) endPoll(end.dataset.endPoll);
});

$("#poll-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = $("#poll-question").value.trim();
  const options = [...document.querySelectorAll(".poll-option")].map((input) => input.value.trim()).filter(Boolean);
  if (!question || options.length < 2) return toast("A poll needs a question and at least two options");
  launchPoll(question, options);
  $("#poll-form").reset();
  for (const extra of [...document.querySelectorAll(".poll-option")].slice(2)) extra.remove();
  toast("Poll launched");
});

function addPollOption() {
  const count = document.querySelectorAll(".poll-option").length;
  if (count >= 6) return toast("Up to 6 options");
  const input = document.createElement("input");
  input.className = "field poll-option";
  input.placeholder = `Option ${count + 1}`;
  input.maxLength = 80;
  $("#poll-options").append(input);
  input.focus();
}

// ---------- Catching up people who join late ----------

/** The person with the smallest id (newcomer excluded) sends them the whiteboard and polls. */
function isSyncHost(newcomer) {
  const ids = [me.id, ...[...peers.keys()].filter((id) => id !== newcomer)].sort();
  return ids[0] === me.id && (wb.strokes.size > 0 || wb.open || polls.size > 0);
}

function syncState() {
  return {
    wb: { open: wb.open, strokes: [...wb.strokes.values()].map(({ id, c, w, e, p }) => ({ id, c, w, e, p })) },
    polls: [...polls.values()].map((poll) => ({ ...poll, votes: [...poll.votes] })),
  };
}

function applySync(data) {
  if (Array.isArray(data?.wb?.strokes)) {
    for (const stroke of data.wb.strokes) receiveStroke(stroke);
    setWhiteboardOpen(Boolean(data.wb.open), false);
  }
  if (Array.isArray(data?.polls)) {
    for (const poll of data.polls) {
      if (typeof poll?.id !== "string" || polls.has(poll.id) || !Array.isArray(poll.options) || !Array.isArray(poll.votes)) continue;
      polls.set(poll.id, {
        id: poll.id, question: String(poll.question).slice(0, 200), options: poll.options.map(String).slice(0, 6),
        by: String(poll.by), byId: String(poll.byId), open: Boolean(poll.open),
        votes: new Map(poll.votes.filter((v) => Array.isArray(v) && Number.isInteger(v[1]))),
      });
    }
    renderPolls();
  }
}

// ---------- Side panel: info, people, chat, polls ----------

function togglePanel(name) {
  const closing = openPanel;
  openPanel = openPanel === name ? null : name;
  $("#panel").hidden = !openPanel;
  for (const section of document.querySelectorAll("[data-panel]")) section.hidden = section.dataset.panel !== openPanel;
  $("#panel-title").textContent = { info: "Meeting details", people: "People", chat: "In-call messages", polls: "Polls" }[openPanel] ?? "";
  for (const button of document.querySelectorAll(".ctrl[data-action=chat]")) {
    button.classList.toggle("active", button.dataset.action === openPanel);
    button.setAttribute("aria-expanded", button.dataset.action === openPanel);
  }
  if (openPanel === "info") $("#meeting-link").textContent = meetingLink();
  if (openPanel === "chat") {
    unread = 0;
    refreshUnread();
    $("#chat-input").focus();
    scrollChat();
  } else if (openPanel === "polls") {
    unreadPolls = 0;
    refreshUnread();
    renderPolls();
  } else if (openPanel) {
    $("[data-action=close-panel]").focus();
  } else if (closing && $("#panel").contains(document.activeElement)) {
    // Keyboard users land back on the button that opened the panel.
    document.querySelector(`.ctrl[data-action=${closing}]`)?.focus();
  }
  layoutGrid();
}

function toggleReactionPicker(open = $("#reaction-picker").hidden) {
  $("#reaction-picker").hidden = !open;
  $("[data-action=reactions]").setAttribute("aria-expanded", open);
}

function toggleMenu(open = $("#more-menu").hidden) {
  $("#more-menu").hidden = !open;
  $(".ctrl[data-action=more]").setAttribute("aria-expanded", open);
  $(".ctrl[data-action=more]").classList.toggle("active", open);
  if (open) {
    refreshLocal();
    [...$("#more-menu").querySelectorAll("button")].find((b) => b.offsetParent)?.focus();
  }
}

function refreshPeople() {
  // Raised hands first, in the order they were raised (like Meet).
  const everyone = [myInfo(), ...peers.values()].sort((a, b) => {
    if (a.hand !== b.hand) return b.hand - a.hand;
    return a.hand ? a.handAt - b.handAt : 0;
  });
  $("#people-list").replaceChildren(...everyone.map((person) => {
    const isMe = person.id === me.id;
    const item = document.createElement("li");
    const avatar = document.createElement("span");
    avatar.className = "mini-avatar";
    avatar.textContent = initial(person.name);
    avatar.style.background = colorFor(person.name);
    const name = document.createElement("span");
    name.className = "person-name";
    name.textContent = isMe ? `${person.name} (You)` : person.name;
    if (person.screen) name.append(Object.assign(document.createElement("small"), { textContent: " · presenting" }));
    item.append(avatar, name);
    if (person.hand) item.append(icon("back_hand", "hand-icon"));
    const pin = personButton(pinnedId === person.id ? "keep_off" : "keep", pinnedId === person.id ? `Unpin ${person.name}` : `Pin ${person.name}`, "pin", person.id);
    item.append(pin);
    if (!isMe && person.mic) item.append(personButton("mic", `Mute ${person.name} for everyone`, "mute", person.id));
    else item.append(icon(person.mic ? "mic" : "mic_off"));
    return item;
  }));
  $("#people-count").textContent = everyone.length;
}

function personButton(iconName, label, action, id) {
  const button = document.createElement("button");
  button.className = "icon-btn person-btn";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.dataset.personAction = action;
  button.dataset.id = id;
  button.append(icon(iconName));
  return button;
}

$("#people-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-person-action]");
  if (!button) return;
  const { personAction, id } = button.dataset;
  if (personAction === "pin") togglePin(id);
  if (personAction === "mute") {
    send("mute-request", {}, id);
    toast(`Asked ${peers.get(id)?.name ?? "them"} to mute`);
  }
});

function icon(name, extra = "") {
  const span = document.createElement("span");
  span.className = `icon ${extra}`.trim();
  span.setAttribute("aria-hidden", "true");
  span.textContent = name;
  return span;
}

/** Photos, videos, audio and files shared in the chat. */
function chatMedia(list) {
  const box = document.createElement("div");
  box.className = "chat-media";
  for (const item of list) {
    if (typeof item?.url !== "string" || !item.url.startsWith("/api/media/")) continue;
    const src = window.authUrl ? window.authUrl(item.url) : item.url;
    const type = String(item.type || "");
    let element;
    if (type.startsWith("image/")) {
      element = document.createElement("img");
      element.src = src; element.alt = item.name || "Photo"; element.loading = "lazy";
      element.addEventListener("click", () => window.DU?.lightbox?.(src));
    } else if (type.startsWith("video/")) {
      element = document.createElement("video");
      element.src = src; element.controls = true; element.playsInline = true; element.preload = "metadata";
    } else if (type.startsWith("audio/")) {
      element = document.createElement("audio");
      element.src = src; element.controls = true; element.preload = "none";
    } else {
      element = document.createElement("a");
      element.className = "file-card";
      element.href = src; element.target = "_blank"; element.rel = "noopener"; element.download = item.name || "file";
      const icon = document.createElement("span"); icon.className = "icon"; icon.textContent = "description";
      const label = document.createElement("span"); label.textContent = item.name || "File";
      element.append(icon, label);
    }
    box.append(element);
  }
  return box;
}

function addChatMessage(name, text, mine, media = []) {
  const item = document.createElement("li");
  const head = document.createElement("div");
  head.className = "msg-head";
  const who = document.createElement("strong");
  who.textContent = mine ? "You" : name;
  const time = document.createElement("span");
  time.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  head.append(who, time);
  item.append(head);
  if (text) {
    const body = document.createElement("p");
    linkify(body, text);
    item.append(body);
  }
  if (media.length) item.append(chatMedia(media));
  $("#chat-messages").append(item);
  scrollChat();
  note("chat", name, text || `[${media.map((m) => m.name || m.type).join(", ")}]`);

  if (openPanel !== "chat" && !mine) {
    unread++;
    refreshUnread();
    toast(`${name}: ${text || "sent a file"}`);
  }
}

/** Links in chat become clickable, everything else stays plain text. */
function linkify(parent, text) {
  for (const part of text.split(/(https?:\/\/[^\s<>"]+)/g)) {
    if (/^https?:\/\//.test(part)) {
      const link = document.createElement("a");
      link.href = part;
      link.textContent = part;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      parent.append(link);
    } else if (part) {
      parent.append(part);
    }
  }
}

const scrollChat = () => { $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight; };
const refreshUnread = () => {
  $("#chat-dot").hidden = unread === 0;
  $("#polls-dot").hidden = unreadPolls === 0;
};

// ---------- Hand and reactions ----------

function toggleHand() {
  me.hand = !me.hand;
  me.handAt = me.hand ? Date.now() : 0;
  renderAll();
  sendState({ hand: me.hand });
}

function showReaction(emoji, name) {
  const reaction = document.createElement("div");
  reaction.className = "reaction";
  reaction.style.left = `${10 + Math.random() * 60}%`;
  const face = document.createElement("span");
  face.className = "emoji";
  face.textContent = emoji;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = name;
  reaction.append(face, who);
  reaction.addEventListener("animationend", () => reaction.remove());
  $("#reactions").append(reaction);
}

$("#reaction-picker").append(...REACTIONS.map((emoji) => {
  const button = document.createElement("button");
  button.textContent = emoji;
  button.setAttribute("aria-label", `Send ${emoji}`);
  button.onclick = () => {
    send("reaction", { emoji });
    showReaction(emoji, "You");
  };
  return button;
}));

// ---------- Meeting notes (new) ----------

function note(kind, name, text) {
  notes.push({ time: new Date(), kind, name, text });
}

function downloadNotes() {
  const time = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const lines = [
    `DU Meet · ${room}`,
    `${new Date(joinedAt).toLocaleString()} · ${formatDuration(Date.now() - joinedAt)}`,
    "",
    `People: ${[me.name, ...[...peers.values()].map((p) => p.name)].join(", ")}`,
    "",
    "--- Conversation (chat and captions) ---",
  ];
  for (const entry of notes) {
    if (entry.kind === "chat") lines.push(`[${time(entry.time)}] ${entry.name} (chat): ${entry.text}`);
    else if (entry.kind === "caption") lines.push(`[${time(entry.time)}] ${entry.name}: ${entry.text}`);
    else lines.push(`[${time(entry.time)}] ${entry.name} ${entry.text}`);
  }
  if (polls.size) {
    lines.push("", "--- Polls ---");
    for (const poll of polls.values()) {
      lines.push(`${poll.question} (asked by ${poll.by})`);
      poll.options.forEach((option, index) => {
        const count = [...poll.votes.values()].filter((v) => v === index).length;
        lines.push(`  ${option}: ${count}`);
      });
    }
  }
  if (!notes.some((e) => e.kind === "caption")) lines.push("", "Tip: turn on captions (CC) to include what people said.");
  download(new Blob([lines.join("\n")], { type: "text/plain" }), `DU Meet notes ${room} ${stamp(new Date(joinedAt))}.txt`);
}

// ---------- Small helpers ----------

let toastTimer;
function toast(text) {
  const element = $("#toast");
  element.textContent = text;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 3500);
}

function download(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name.replace(/[\\/:*?"<>|]/g, "-");
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(seconds % 60)}` : `${m}:${pad(seconds % 60)}`;
}

/** The small meeting-details card under the (i) button. */
function toggleInfo(show) {
  const pop = $("#info-pop");
  const chip = $(".meet-chip");
  show = show ?? pop.hidden;
  chip.setAttribute("aria-expanded", String(show));
  chip.classList.toggle("active", show);
  if (show) {
    pop.hidden = false;
    pop.classList.remove("closing");
  } else if (!pop.hidden) {
    pop.classList.add("closing");
    setTimeout(() => { if (pop.classList.contains("closing")) { pop.hidden = true; pop.classList.remove("closing"); } }, 180);
  }
}
document.addEventListener("pointerdown", (event) => {
  if (!$("#info-pop").hidden && !event.target.closest("#info-pop, .meet-chip")) toggleInfo(false);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#info-pop").hidden) toggleInfo(false); });

function tickClock() {
  const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  for (const clock of document.querySelectorAll(".clock")) clock.textContent = now;
  if (polling) {
    const elapsed = formatDuration(Date.now() - joinedAt);
    $("#meeting-timer").textContent = elapsed;
    $("#meet-elapsed").textContent = elapsed;
    $("#meet-started").textContent = new Date(joinedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => toast("Full screen is not available"));
}
document.addEventListener("fullscreenchange", () => {
  refreshLocal();
  layoutGrid();
});

function openSettings() {
  refreshDevices();
  $("#noise-toggle").checked = prefs.noise;
  $("#caption-lang").value = prefs.lang;
  $("#settings-dialog").showModal();
}

function openLayoutDialog() {
  for (const radio of document.querySelectorAll("[name=layout]")) radio.checked = radio.value === prefs.layout;
  $("#layout-dialog").showModal();
}

// ---------- Buttons and keyboard ----------

const actions = {
  "new-meeting": () => goToMeeting(newMeetingCode()),
  join: joinMeeting,
  mic: () => setMic(!me.mic),
  cam: () => setCamera(!me.cam),
  flip: flipCamera,
  share: toggleScreenShare,
  hand: toggleHand,
  captions: toggleCaptions,
  reactions: () => toggleReactionPicker(),
  more: () => toggleMenu(),
  leave: leaveMeeting,
  info: () => toggleInfo(),
  people: () => togglePanel("people"),
  chat: () => togglePanel("chat"),
  polls: () => togglePanel("polls"),
  "close-panel": () => togglePanel(openPanel),
  "copy-link": async () => {
    await navigator.clipboard.writeText(`Join my DU Meet: ${meetingLink()}`);
    toast("Meeting link copied");
  },
  layout: openLayoutDialog,
  pip: togglePip,
  whiteboard: () => setWhiteboardOpen(!wb.open, true),
  record: toggleRecording,
  "hide-self": () => {
    prefs.hideSelf = !prefs.hideSelf;
    savePrefs();
    renderAll();
    toast(prefs.hideSelf ? "Self view hidden. Others still see you." : "Self view shown");
  },
  fullscreen: toggleFullscreen,
  notes: downloadNotes,
  settings: openSettings,
  "poll-add-option": addPollOption,
  rejoin: () => openLobby(room),
  home: goHome,
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button && !button.disabled) {
    if (button.closest("#more-menu")) toggleMenu(false);
    actions[button.dataset.action]?.();
  }
  const tileButton = event.target.closest("[data-tile-action=pin]");
  if (tileButton) togglePin(tileButton.closest(".tile").dataset.id);
  // A click anywhere outside the picker or menu closes it.
  if (!event.target.closest("#reaction-picker, [data-action=reactions]")) toggleReactionPicker(false);
  if (!event.target.closest("#more-menu, [data-action=more]") && !$("#more-menu").hidden) toggleMenu(false);
  // Browsers may block sound until the page is clicked once.
  for (const peer of peers.values()) if (peer.audio.paused && peer.audio.srcObject) peer.audio.play().catch(() => {});
  if (audioContext?.state === "suspended") audioContext.resume();
});

// Double-click a tile to pin or unpin it.
$("#grid").addEventListener("dblclick", (event) => {
  const tile = event.target.closest(".tile");
  if (tile && !event.target.closest("canvas, .wb-tools, button")) togglePin(tile.dataset.id);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("#more-menu").hidden) {
    toggleMenu(false);
    $(".ctrl[data-action=more]").focus();
  } else if (!$("#reaction-picker").hidden) {
    toggleReactionPicker(false);
    $("[data-action=reactions]").focus();
  } else if (openPanel) {
    togglePanel(openPanel);
  }
});

// Arrow keys move through the More options menu.
$("#more-menu").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = [...$("#more-menu").querySelectorAll("button")].filter((b) => b.offsetParent);
  const index = items.indexOf(document.activeElement);
  items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
});

$("#join-code").addEventListener("input", (event) => {
  $("#join-submit").disabled = !event.target.value.trim();
});

$("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = parseMeetingInput($("#join-code").value);
  if (code) goToMeeting(code);
  else toast("Check the meeting code and try again");
});

$("#name-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinMeeting();
});

$("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("#chat-input").value.trim();
  if (!text) return;
  send("chat", { text });
  addChatMessage(me.name, text, true);
  $("#chat-input").value = "";
});

$("#mic-select").addEventListener("change", (event) => changeMic(event.target.value));
$("#cam-select").addEventListener("change", (event) => changeCamera(event.target.value));
$("#speaker-select").addEventListener("change", (event) => setSpeaker(event.target.value));
$("#noise-toggle").addEventListener("change", (event) => {
  prefs.noise = event.target.checked;
  const current = micTrack()?.getSettings().deviceId;
  if (current) changeMic(current);
  else savePrefs();
});
$("#caption-lang").addEventListener("change", (event) => {
  prefs.lang = event.target.value;
  savePrefs();
  stopRecognition();
  recognitionWanted = false;
  updateRecognition();
});
$("#layout-dialog").addEventListener("change", (event) => {
  if (event.target.name !== "layout") return;
  prefs.layout = event.target.value;
  savePrefs();
  layoutGrid();
});
// Clicking the dark backdrop closes a dialog.
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// Shortcuts like Google Meet: ⌘/Ctrl + D mic, ⌘/Ctrl + E camera,
// Ctrl + Alt + H hand, Ctrl + Alt + C chat, Ctrl + Alt + P people.
document.addEventListener("keydown", (event) => {
  if (!me.stream) return;
  const meetCombo = (event.ctrlKey && event.altKey) || (event.metaKey && event.ctrlKey);
  if (meetCombo && polling) {
    const action = { KeyH: "hand", KeyC: "chat", KeyP: "people" }[event.code];
    if (action) {
      event.preventDefault();
      actions[action]();
    }
    return;
  }
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === "d") {
    event.preventDefault();
    setMic(!me.mic);
  } else if (key === "e") {
    event.preventDefault();
    setCamera(!me.cam);
  }
});

window.addEventListener("popstate", () => {
  if (!polling) route();
});

$("#caption-lang").value = prefs.lang;
tickClock();
setInterval(tickClock, 1000);
renderPolls();
route();
