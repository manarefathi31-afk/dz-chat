const SUPABASE_URL = "https://knjxiberzbxncbfzbzjh.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ton9lLhZhEYvXyyoPYUfVw_iIpqnc1W";
const STORAGE_BUCKET = "dz-chat-media";

if (!window.supabase) {
  alert("تعذر تحميل مكتبة Supabase. تأكد من الاتصال بالإنترنت.");
  throw new Error("Supabase not loaded");
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let profilesMap = {};
let videosCache = [];
let likesCache = [];
let commentsCache = [];
let followsCache = [];
let liveRoomsCache = [];
let selectedMedia = null;
let selectedMediaType = "video";
let activeCommentVideoId = null;
let activeSharePost = null;
let activeChatUserId = null;
let feedObserver = null;

let activeLiveRoom = null;
let liveSeatsCache = [];
let liveCommentsCache = [];
let liveRoomChannel = null;
let localAudioStream = null;
let peerConnections = {};
let amISpeakerNow = false;
let isMicMuted = false;

function formatCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);
}

function isImagePost(post) {
  if (post.media_type === "image") return true;
  if (post.media_type === "video") return false;
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(post.video_url || "");
}

function showToast(message) {
  const box = $("toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(box._timer);
  box._timer = setTimeout(() => box.classList.remove("show"), 3500);
}

function authMessage(message, error = false) {
  const box = $("dzAuthMessage");
  if (!box) return;
  box.textContent = message;
  box.style.color = error ? "#dc2626" : "#07845b";
}

function setAvatarContent(container, url, altText) {
  if (!container) return;
  container.textContent = "";
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = altText;
    container.appendChild(img);
  } else {
    container.textContent = "🇩🇿";
  }
}

const authScreen = document.createElement("div");
authScreen.id = "dzAuth";
authScreen.innerHTML = `
  <div class="auth-card">
    <div class="auth-flag">🇩🇿</div>
    <h2>DZ-CHAT</h2>
    <p class="auth-sub">تواصل مع أصدقائك وشارك صورك وفيديوهاتك</p>
    <form id="dzLoginForm">
      <input id="dzEmail" type="email" placeholder="البريد الإلكتروني" required>
      <input id="dzPassword" type="password" placeholder="كلمة المرور" required minlength="6">
      <button class="auth-main" type="submit">تسجيل الدخول</button>
    </form>
    <form id="dzRegisterForm" hidden>
      <input id="dzName" type="text" placeholder="اسم المستخدم" required minlength="3">
      <input id="dzNewEmail" type="email" placeholder="البريد الإلكتروني" required>
      <input id="dzNewPassword" type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" required minlength="6">
      <button class="auth-main" type="submit">إنشاء حساب جديد</button>
    </form>
    <button type="button" class="auth-switch" id="dzSwitch">ليس لديك حساب؟ أنشئ حساباً جديداً</button>
    <div class="auth-message" id="dzAuthMessage"></div>
  </div>
`;
document.body.appendChild(authScreen);

const app = document.querySelector(".app");
const pages = document.querySelectorAll(".page");
const navItems = document.querySelectorAll(".nav-item");

function showApp() {
  authScreen.style.display = "none";
  app.style.display = "";
}

function showAuth() {
  leaveLiveRoom(true);
  currentUser = null;
  currentProfile = null;
  db.removeAllChannels();
  document.querySelectorAll(".video-slide video").forEach(v => v.pause());
  app.style.display = "none";
  authScreen.style.display = "flex";
}

let registerMode = false;
$("dzSwitch").addEventListener("click", () => {
  registerMode = !registerMode;
  $("dzLoginForm").hidden = registerMode;
  $("dzRegisterForm").hidden = !registerMode;
  $("dzSwitch").textContent = registerMode
    ? "لديك حساب؟ سجل الدخول"
    : "ليس لديك حساب؟ أنشئ حساباً جديداً";
  authMessage("");
});

async function ensureProfile(user) {
  const { data, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;

  const username = (user.user_metadata?.username || user.user_metadata?.display_name || user.email.split("@")[0]).replace(/^@/, "");
  const { data: inserted, error: insertError } = await db
    .from("profiles")
    .upsert({ id: user.id, username, bio: "عضو في مجتمع DZ-CHAT", country: "الجزائر", avatar_url: null }, { onConflict: "id" })
    .select()
    .single();
  if (insertError) throw insertError;
  return inserted;
}

async function refreshAllData(redrawFeed = true) {
  const [profilesRes, videosRes, likesRes, commentsRes, followsRes, roomsRes] = await Promise.all([
    db.from("profiles").select("*"),
    db.from("videos").select("*").order("created_at", { ascending: false }),
    db.from("video_likes").select("video_id, user_id"),
    db.from("video_comments").select("id, video_id"),
    db.from("follows").select("follower_id, following_id"),
    db.from("live_rooms").select("*").eq("is_active", true).order("created_at", { ascending: false })
  ]);

  profilesMap = {};
  (profilesRes.data || []).forEach(p => { profilesMap[p.id] = p; });
  if (currentUser && profilesMap[currentUser.id]) currentProfile = profilesMap[currentUser.id];

  videosCache = videosRes.data || [];
  likesCache = likesRes.data || [];
  commentsCache = commentsRes.data || [];
  followsCache = followsRes.data || [];
  liveRoomsCache = roomsRes.data || [];

  renderLiveRoomsStrip();
  renderProfile();
  if (redrawFeed) renderVideoFeed();
  else videosCache.forEach(v => updatePostCountsInPlace(v.id));
  renderDiscover();
  renderFriendsBar();
}

async function loadUser(user) {
  if (!user) return;
  currentUser = user;
  try {
    currentProfile = await ensureProfile(user);
    showApp();
    await refreshAllData(true);
    await loadMessages();
    subscribeRealtimeAll();
    showToast("مرحباً بك في DZ-CHAT 🇩🇿");
  } catch (err) {
    console.error(err);
    showApp();
    showToast("خطأ في تحميل البيانات: " + err.message);
  }
}

$("dzLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  btn.textContent = "جارٍ الدخول...";
  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: $("dzEmail").value.trim(),
      password: $("dzPassword").value
    });
    if (error) throw error;
    await loadUser(data.user);
  } catch (err) {
    authMessage("تعذر تسجيل الدخول: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "تسجيل الدخول";
  }
});

$("dzRegisterForm").addEventListener("submit", async e => {
  e.preventDefault();
  const username = $("dzName").value.trim().replace(/^@/, "");
  const email = $("dzNewEmail").value.trim();
  const password = $("dzNewPassword").value;
  const btn = e.submitter;
  if (username.length < 3) {
    authMessage("اسم المستخدم يجب أن يكون 3 أحرف على الأقل", true);
    return;
  }
  btn.disabled = true;
  btn.textContent = "جارٍ الإنشاء...";
  try {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username } }
    });
    if (error) throw error;
    if (data.session) await loadUser(data.user);
    else {
      authMessage("تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتفعيله ثم سجّل الدخول.");
      registerMode = false;
      $("dzRegisterForm").hidden = true;
      $("dzLoginForm").hidden = false;
      $("dzSwitch").textContent = "ليس لديك حساب؟ أنشئ حساباً جديداً";
    }
  } catch (err) {
    authMessage("تعذر إنشاء الحساب: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "إنشاء حساب جديد";
  }
});

function renderLiveRoomsStrip() {
  const strip = $("liveRoomsStrip");
  strip.textContent = "";
  if (!liveRoomsCache.length) { strip.hidden = true; return; }
  strip.hidden = false;
  liveRoomsCache.forEach(room => {
    const hostName = profilesMap[room.host_id]?.username || "مضيف";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "live-room-pill";
    btn.innerHTML = `<span class="live-pill-badge">🔴 لايف</span><strong></strong><small></small>`;
    btn.querySelector("strong").textContent = room.title;
    btn.querySelector("small").textContent = `(@${hostName})`;
    btn.addEventListener("click", () => enterLiveRoom(room));
    strip.appendChild(btn);
  });
}

function switchPage(pageId) {
  const target = $(pageId);
  if (!target) return;
  pages.forEach(page => page.classList.remove("active"));
  target.classList.add("active");
  navItems.forEach(item => item.classList.toggle("active", item.dataset.page === pageId));
  if (pageId !== "homePage") document.querySelectorAll(".video-slide video").forEach(v => v.pause());
  if (pageId === "homePage") refreshAllData(false);
  if (pageId === "messagesPage") refreshAllData(false).then(loadMessages);
}

$("choiceUploadBtn").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; switchPage("uploadPage"); });
$("choiceLiveBtn").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; $("dzLiveSetupModal").hidden = false; });
$("dzCloseChoice").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; });
$("dzCreateChoiceModal").addEventListener("click", e => { if (e.target === $("dzCreateChoiceModal")) $("dzCreateChoiceModal").hidden = true; });
$("dzCloseLiveSetup").addEventListener("click", () => { $("dzLiveSetupModal").hidden = true; });
$("dzLiveSetupModal").addEventListener("click", e => { if (e.target === $("dzLiveSetupModal")) $("dzLiveSetupModal").hidden = true; });

$("startLiveConfirmBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  const btn = $("startLiveConfirmBtn");
  const title = $("liveTitleInput").value.trim() || "غرفة صوتية لايف 🇩🇿";
  btn.disabled = true;
  btn.textContent = "جارٍ فتح الغرفة...";
  try {
    await db.from("live_rooms").update({ is_active: false }).eq("host_id", currentUser.id);
    const { data, error } = await db.from("live_rooms").insert({ host_id: currentUser.id, title, is_active: true }).select().single();
    if (error) throw error;
    $("dzLiveSetupModal").hidden = true;
    await refreshAllData(false);
    await enterLiveRoom(data);
  } catch (err) {
    alert("تعذر فتح الغرفة الصوتية:\n" + (err.message || JSON.stringify(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "بدء البث المباشر الآن";
  }
});

async function enterLiveRoom(room) {
  if (!currentUser || !room) return;
  activeLiveRoom = room;
  isMicMuted = false;
  document.querySelectorAll(".video-slide video").forEach(v => v.pause());
  const host = profilesMap[room.host_id] || {};
  $("liveRoomTitle").textContent = room.title || "غرفة صوتية لايف";
  $("liveHostName").textContent = "المضيف: @" + (host.username || "host");
  setAvatarContent($("liveHostAvatar"), host.avatar_url, "المضيف");
  $("liveExitBtn").textContent = room.host_id === currentUser.id ? "إنهاء البث" : "خروج";
  $("liveRequestsDrawer").hidden = true;
  $("dzLiveRoom").hidden = false;
  await loadLiveRoomState();
  await setupLiveRoomRealtime(room.id);
}

async function loadLiveRoomState() {
  if (!activeLiveRoom) return;
  const [seatsRes, commentsRes] = await Promise.all([
    db.from("live_seats").select("*").eq("room_id", activeLiveRoom.id).order("created_at", { ascending: true }),
    db.from("live_comments").select("*").eq("room_id", activeLiveRoom.id).order("created_at", { ascending: true }).limit(60)
  ]);
  liveSeatsCache = seatsRes.data || [];
  liveCommentsCache = commentsRes.data || [];
  renderLiveSeatsAndControls();
  renderLiveComments();
  await syncSpeakerMicAndPresence();
}

function renderLiveSeatsAndControls() {
  if (!activeLiveRoom || !currentUser) return;
  const isHost = activeLiveRoom.host_id === currentUser.id;
  const mySeatRow = liveSeatsCache.find(s => s.user_id === currentUser.id);
  const pendingList = liveSeatsCache.filter(s => s.status === "pending");
  const seatedList = liveSeatsCache.filter(s => s.status === "seated");

  $("liveReqToggleBtn").hidden = !isHost;
  $("liveReqCount").textContent = pendingList.length;

  const reqListEl = $("liveRequestsList");
  reqListEl.textContent = "";
  if (!pendingList.length) {
    reqListEl.innerHTML = `<div style="font-size:11px;color:#94a3b8;text-align:center;padding:6px">لا توجد طلبات صعود حالياً</div>`;
  } else {
    pendingList.forEach(req => {
      const u = profilesMap[req.user_id] || {};
      const row = document.createElement("div");
      row.className = "req-row";
      const name = document.createElement("span");
      name.textContent = "@" + (u.username || "صديق") + " يطلب الصعود";
      const btns = document.createElement("div");
      btns.className = "req-btns";
      const acc = document.createElement("button");
      acc.type = "button"; acc.className = "req-accept"; acc.textContent = "قبول ✅";
      acc.addEventListener("click", () => approveGuestRequest(req.user_id));
      const rej = document.createElement("button");
      rej.type = "button"; rej.className = "req-reject"; rej.textContent = "رفض";
      rej.addEventListener("click", () => removeSeatRow(req.user_id));
      btns.append(acc, rej);
      row.append(name, btns);
      reqListEl.appendChild(row);
    });
  }

  const grid = $("liveGuestSeats");
  grid.textContent = "";
  for (let num = 1; num <= 9; num++) {
    const guest = seatedList.find(s => s.seat_number === num);
    const seatEl = document.createElement("div");
    seatEl.className = "guest-seat" + (guest ? " occupied" : "");
    const numTag = document.createElement("span");
    numTag.className = "seat-num"; numTag.textContent = num;
    seatEl.appendChild(numTag);
    const av = document.createElement("div"); av.className = "seat-avatar";
    const label = document.createElement("div"); label.className = "seat-name";

    if (guest) {
      const gp = profilesMap[guest.user_id] || {};
      setAvatarContent(av, gp.avatar_url, gp.username || "ضيف");
      label.textContent = "@" + (gp.username || "ضيف");
      const mic = document.createElement("span");
      mic.className = "seat-mic"; mic.textContent = guest.is_muted ? "🔇" : "🎙️";
      seatEl.appendChild(mic);
      if (isHost) {
        seatEl.addEventListener("click", () => {
          if (confirm(`هل تريد إنزال @${gp.username || "الضيف"} من المقعد ${num}؟`)) removeSeatRow(guest.user_id);
        });
      }
    } else {
      av.textContent = "＋";
      label.textContent = `مقعد ${num}`;
      if (!isHost && !mySeatRow) seatEl.addEventListener("click", requestToJoinSeat);
    }
    seatEl.append(av, label);
    grid.appendChild(seatEl);
  }

  const ctrl = $("liveActionControls");
  ctrl.textContent = "";
  if (isHost || (mySeatRow && mySeatRow.status === "seated")) {
    const micBtn = document.createElement("button");
    micBtn.type = "button";
    micBtn.className = "live-ctrl-btn " + (isMicMuted ? "danger" : "primary");
    micBtn.textContent = isMicMuted ? "🔇 المايك مكتوم (اضغط للفتح)" : "🎙️ المايك مفتوح (اضغط للكتم)";
    micBtn.addEventListener("click", toggleMyLiveMic);
    ctrl.appendChild(micBtn);
    if (!isHost) {
      const downBtn = document.createElement("button");
      downBtn.type = "button"; downBtn.className = "live-ctrl-btn warn"; downBtn.textContent = "⬇️ نزول من المقعد";
      downBtn.addEventListener("click", () => removeSeatRow(currentUser.id));
      ctrl.appendChild(downBtn);
    }
  } else if (mySeatRow && mySeatRow.status === "pending") {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button"; cancelBtn.className = "live-ctrl-btn warn"; cancelBtn.textContent = "⏳ تم إرسال الطلب (اضغط للإلغاء)";
    cancelBtn.addEventListener("click", () => removeSeatRow(currentUser.id));
    ctrl.appendChild(cancelBtn);
  } else {
    const reqBtn = document.createElement("button");
    reqBtn.type = "button"; reqBtn.className = "live-ctrl-btn primary"; reqBtn.textContent = "✋ طلب الصعود لمقعد ضيف";
    reqBtn.addEventListener("click", requestToJoinSeat);
    ctrl.appendChild(reqBtn);
  }
}

async function requestToJoinSeat() {
  if (!activeLiveRoom || !currentUser) return;
  try {
    const { error } = await db.from("live_seats").upsert({
      room_id: activeLiveRoom.id, user_id: currentUser.id, status: "pending", seat_number: null, is_muted: false
    }, { onConflict: "room_id,user_id" });
    if (error) throw error;
    showToast("تم إرسال طلب الصعود للمضيف ✋");
    await loadLiveRoomState();
  } catch (err) { alert("تعذر إرسال الطلب:\n" + err.message); }
}

async function approveGuestRequest(userId) {
  if (!activeLiveRoom) return;
  const taken = new Set(liveSeatsCache.filter(s => s.status === "seated").map(s => s.seat_number));
  let freeSeat = null;
  for (let i = 1; i <= 9; i++) { if (!taken.has(i)) { freeSeat = i; break; } }
  if (!freeSeat) { showToast("جميع المقاعد الـ 9 ممتلئة!"); return; }
  try {
    const { error } = await db.from("live_seats")
      .update({ status: "seated", seat_number: freeSeat, is_muted: false })
      .match({ room_id: activeLiveRoom.id, user_id: userId });
    if (error) throw error;
    const gName = profilesMap[userId]?.username || "ضيف";
    await db.from("live_comments").insert({ room_id: activeLiveRoom.id, user_id: currentUser.id, content: `✅ صعد @${gName} إلى المقعد رقم ${freeSeat}` });
    await loadLiveRoomState();
  } catch (err) { alert("تعذر قبول الضيف:\n" + err.message); }
}

async function removeSeatRow(userId) {
  if (!activeLiveRoom) return;
  try {
    const { error } = await db.from("live_seats").delete().match({ room_id: activeLiveRoom.id, user_id: userId });
    if (error) throw error;
    await loadLiveRoomState();
  } catch (err) { showToast("تعذر التنفيذ: " + err.message); }
}

async function toggleMyLiveMic() {
  isMicMuted = !isMicMuted;
  if (localAudioStream) localAudioStream.getAudioTracks().forEach(t => { t.enabled = !isMicMuted; });
  if (activeLiveRoom && currentUser && activeLiveRoom.host_id !== currentUser.id) {
    await db.from("live_seats").update({ is_muted: isMicMuted }).match({ room_id: activeLiveRoom.id, user_id: currentUser.id });
  }
  renderLiveSeatsAndControls();
}

function renderLiveComments() {
  const box = $("liveCommentsArea");
  box.textContent = "";
  liveCommentsCache.forEach(c => {
    const uname = profilesMap[c.user_id]?.username || "عضو";
    const pill = document.createElement("div");
    const isSys = c.content.startsWith("✅ صعد");
    pill.className = "live-comment-pill" + (isSys ? " sys" : "");
    if (isSys) pill.textContent = c.content;
    else {
      const st = document.createElement("strong"); st.textContent = "@" + uname + ":";
      const tx = document.createElement("span"); tx.textContent = c.content;
      pill.append(st, tx);
    }
    box.appendChild(pill);
  });
  box.scrollTop = box.scrollHeight;
}

$("liveReqToggleBtn").addEventListener("click", () => { $("liveRequestsDrawer").hidden = !$("liveRequestsDrawer").hidden; });

$("liveCommentForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser || !activeLiveRoom) return;
  const content = $("liveCommentInput").value.trim();
  if (!content) return;
  $("liveCommentInput").value = "";
  const { error } = await db.from("live_comments").insert({ room_id: activeLiveRoom.id, user_id: currentUser.id, content });
  if (error) showToast("فشل إرسال التعليق: " + error.message);
});

$("liveExitBtn").addEventListener("click", async () => {
  if (!activeLiveRoom || !currentUser) return;
  if (activeLiveRoom.host_id === currentUser.id) {
    if (!confirm("هل تريد إنهاء البث الصوتي للجميع؟")) return;
    await db.from("live_rooms").update({ is_active: false }).eq("id", activeLiveRoom.id);
  } else {
    await db.from("live_seats").delete().match({ room_id: activeLiveRoom.id, user_id: currentUser.id });
  }
  leaveLiveRoom(false);
});

function closePeer(peerId) {
  if (peerConnections[peerId]) {
    try { peerConnections[peerId].close(); } catch {}
    delete peerConnections[peerId];
  }
  const aud = document.getElementById("aud_" + peerId);
  if (aud) aud.remove();
}

function closeAllPeers() {
  Object.keys(peerConnections).forEach(closePeer);
  $("liveAudioPool").textContent = "";
}

function leaveLiveRoom(silent = false) {
  closeAllPeers();
  if (localAudioStream) { localAudioStream.getTracks().forEach(t => t.stop()); localAudioStream = null; }
  if (liveRoomChannel) { db.removeChannel(liveRoomChannel); liveRoomChannel = null; }
  amISpeakerNow = false;
  activeLiveRoom = null;
  $("dzLiveRoom").hidden = true;
  if (!silent) refreshAllData(false);
}

async function ensureLocalMicIfNeeded(shouldSpeak) {
  if (!shouldSpeak) {
    if (localAudioStream) { localAudioStream.getTracks().forEach(t => t.stop()); localAudioStream = null; }
    return false;
  }
  if (localAudioStream) return true;
  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localAudioStream.getAudioTracks().forEach(t => { t.enabled = !isMicMuted; });
    return true;
  } catch {
    showToast("يرجى السماح بإذن الميكروفون في المتصفح ليصل صوتك");
    return false;
  }
}

async function syncSpeakerMicAndPresence() {
  if (!activeLiveRoom || !currentUser || !liveRoomChannel) return;
  const isHost = activeLiveRoom.host_id === currentUser.id;
  const mySeat = liveSeatsCache.find(s => s.user_id === currentUser.id && s.status === "seated");
  const shouldSpeak = isHost || !!mySeat;
  if (shouldSpeak !== amISpeakerNow) {
    amISpeakerNow = shouldSpeak;
    await ensureLocalMicIfNeeded(shouldSpeak);
    closeAllPeers();
    liveRoomChannel.send({ type: "broadcast", event: "rtc-reset", payload: { from: currentUser.id } });
    await liveRoomChannel.track({ user_id: currentUser.id, is_speaker: shouldSpeak });
  }
}

function createPeerConnection(peerId) {
  if (peerConnections[peerId]) return peerConnections[peerId];
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
  peerConnections[peerId] = pc;
  if (localAudioStream) localAudioStream.getTracks().forEach(track => pc.addTrack(track, localAudioStream));
  else pc.addTransceiver("audio", { direction: "recvonly" });

  pc.onicecandidate = event => {
    if (event.candidate && liveRoomChannel) {
      liveRoomChannel.send({ type: "broadcast", event: "rtc-signal", payload: { to: peerId, from: currentUser.id, candidate: event.candidate } });
    }
  };
  pc.ontrack = event => {
    let audio = document.getElementById("aud_" + peerId);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = "aud_" + peerId; audio.autoplay = true; audio.playsInline = true;
      $("liveAudioPool").appendChild(audio);
    }
    audio.srcObject = event.streams[0];
    audio.play().catch(() => {});
  };
  return pc;
}

async function setupLiveRoomRealtime(roomId) {
  if (liveRoomChannel) db.removeChannel(liveRoomChannel);
  const isHost = activeLiveRoom.host_id === currentUser.id;
  amISpeakerNow = isHost;
  await ensureLocalMicIfNeeded(isHost);

  liveRoomChannel = db.channel("live-room-" + roomId, { config: { presence: { key: currentUser.id } } });
  liveRoomChannel
    .on("postgres_changes", { event: "*", schema: "public", table: "live_seats", filter: `room_id=eq.${roomId}` }, async () => { await loadLiveRoomState(); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_comments", filter: `room_id=eq.${roomId}` }, async payload => {
      const c = payload.new;
      if (!profilesMap[c.user_id]) {
        const { data } = await db.from("profiles").select("*").eq("id", c.user_id).maybeSingle();
        if (data) profilesMap[data.id] = data;
      }
      if (!liveCommentsCache.some(x => x.id === c.id)) { liveCommentsCache.push(c); renderLiveComments(); }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_rooms", filter: `id=eq.${roomId}` }, payload => {
      if (payload.new && payload.new.is_active === false) { showToast("انتهى البث المباشر"); leaveLiveRoom(false); }
    })
    .on("broadcast", { event: "rtc-reset" }, ({ payload }) => {
      if (payload?.from && payload.from !== currentUser.id) closePeer(payload.from);
    })
    .on("presence", { event: "sync" }, async () => {
      const peers = Object.values(liveRoomChannel.presenceState()).flat();
      for (const p of peers) {
        if (!p.user_id || p.user_id === currentUser.id) continue;
        if ((amISpeakerNow || p.is_speaker) && currentUser.id < p.user_id && !peerConnections[p.user_id]) {
          const pc = createPeerConnection(p.user_id);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          liveRoomChannel.send({ type: "broadcast", event: "rtc-signal", payload: { to: p.user_id, from: currentUser.id, sdp: pc.localDescription } });
        }
      }
    })
    .on("broadcast", { event: "rtc-signal" }, async ({ payload }) => {
      if (!payload || payload.to !== currentUser.id) return;
      const pc = createPeerConnection(payload.from);
      if (payload.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        if (payload.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          liveRoomChannel.send({ type: "broadcast", event: "rtc-signal", payload: { to: payload.from, from: currentUser.id, sdp: pc.localDescription } });
        }
      } else if (payload.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch {}
      }
    })
    .subscribe(async status => {
      if (status === "SUBSCRIBED") await liveRoomChannel.track({ user_id: currentUser.id, is_speaker: amISpeakerNow });
    });
}

function renderVideoFeed() {
  const feed = $("videoFeed");
  if (feedObserver) feedObserver.disconnect();
  feed.textContent = "";
  if (videosCache.length === 0) {
    feed.innerHTML = `<div class="video-slide"><div class="video-placeholder"><div class="play-symbol">▶</div><span>مرحباً بك في DZ-CHAT</span><small>لا توجد منشورات بعد. اضغط (+) لنشر صورة/فيديو أو فتح غرفة صوتية 🇩🇿</small></div><div class="video-gradient"></div></div>`;
    return;
  }

  videosCache.forEach(post => {
    const slide = document.createElement("div");
    slide.className = "video-slide";
    slide.dataset.videoId = post.id;

    if (isImagePost(post)) {
      const imgEl = document.createElement("img");
      imgEl.className = "feed-photo"; imgEl.src = post.video_url; imgEl.alt = post.caption || "صورة";
      slide.appendChild(imgEl);
    } else {
      const vidEl = document.createElement("video");
      vidEl.src = post.video_url; vidEl.playsInline = true; vidEl.loop = true; vidEl.preload = "metadata";
      vidEl.addEventListener("click", () => { if (vidEl.paused) vidEl.play().catch(() => {}); else vidEl.pause(); });
      slide.appendChild(vidEl);
    }

    const grad = document.createElement("div"); grad.className = "video-gradient";
    const creatorName = (profilesMap[post.user_id]?.username || "dz_user").replace(/^@/, "");
    const info = document.createElement("div"); info.className = "video-info";
    const strong = document.createElement("strong"); strong.textContent = "@" + creatorName;
    const p = document.createElement("p"); p.textContent = post.caption || "منشور من مجتمع DZ-CHAT 🇩🇿";
    const small = document.createElement("small"); small.textContent = isImagePost(post) ? "🖼️ صورة - DZ-CHAT" : "🎵 الصوت الأصلي - " + creatorName;
    info.append(strong, p, small);

    const actions = document.createElement("div"); actions.className = "video-actions";
    const videoLikes = likesCache.filter(l => l.video_id === post.id);
    const isLiked = currentUser && videoLikes.some(l => l.user_id === currentUser.id);
    const likeBtn = document.createElement("button");
    likeBtn.type = "button"; likeBtn.className = "action like-btn" + (isLiked ? " liked" : "");
    likeBtn.innerHTML = `<span>♥</span><small>${formatCount(videoLikes.length)}</small>`;
    likeBtn.addEventListener("click", e => { e.stopPropagation(); toggleLike(post.id); });

    const commentCount = commentsCache.filter(c => c.video_id === post.id).length;
    const commentBtn = document.createElement("button");
    commentBtn.type = "button"; commentBtn.className = "action comment-btn";
    commentBtn.innerHTML = `<span>●</span><small>${commentCount}</small>`;
    commentBtn.addEventListener("click", e => { e.stopPropagation(); openComments(post.id); });

    const shareBtn = document.createElement("button");
    shareBtn.type = "button"; shareBtn.className = "action";
    shareBtn.innerHTML = `<span>➤</span><small>مشاركة</small>`;
    shareBtn.addEventListener("click", e => { e.stopPropagation(); openShareModal(post); });

    actions.append(likeBtn, commentBtn, shareBtn);

    if (currentUser && post.user_id !== currentUser.id) {
      const isFollowing = followsCache.some(f => f.follower_id === currentUser.id && f.following_id === post.user_id);
      const followBtn = document.createElement("button");
      followBtn.type = "button"; followBtn.dataset.userId = post.user_id;
      followBtn.className = "action follow-btn" + (isFollowing ? " following" : "");
      followBtn.innerHTML = `<span>${isFollowing ? "✓" : "＋"}</span><small>${isFollowing ? "تتابع" : "متابعة"}</small>`;
      followBtn.addEventListener("click", e => { e.stopPropagation(); toggleFollow(post.user_id); });
      actions.appendChild(followBtn);
    }

    slide.append(grad, info, actions);
    feed.appendChild(slide);
  });

  feedObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const vid = entry.target.querySelector("video");
      if (!vid) return;
      if (entry.isIntersecting && $("homePage").classList.contains("active") && $("dzLiveRoom").hidden) vid.play().catch(() => {});
      else vid.pause();
    });
  }, { root: feed, threshold: 0.65 });
  feed.querySelectorAll(".video-slide").forEach(slide => feedObserver.observe(slide));
}

function updatePostCountsInPlace(videoId) {
  const slide = $("videoFeed").querySelector(`[data-video-id="${videoId}"]`);
  if (!slide) return;
  const videoLikes = likesCache.filter(l => l.video_id === videoId);
  const isLiked = currentUser && videoLikes.some(l => l.user_id === currentUser.id);
  const likeBtn = slide.querySelector(".like-btn");
  if (likeBtn) { likeBtn.classList.toggle("liked", !!isLiked); likeBtn.querySelector("small").textContent = formatCount(videoLikes.length); }
  const commentBtn = slide.querySelector(".comment-btn");
  if (commentBtn) commentBtn.querySelector("small").textContent = commentsCache.filter(c => c.video_id === videoId).length;
}

async function toggleLike(videoId) {
  if (!currentUser) return;
  const exists = likesCache.some(l => l.video_id === videoId && l.user_id === currentUser.id);
  try {
    if (exists) {
      const { error } = await db.from("video_likes").delete().match({ video_id: videoId, user_id: currentUser.id });
      if (error) throw error;
      likesCache = likesCache.filter(l => !(l.video_id === videoId && l.user_id === currentUser.id));
    } else {
      const { error } = await db.from("video_likes").insert({ video_id: videoId, user_id: currentUser.id });
      if (error) throw error;
      likesCache.push({ video_id: videoId, user_id: currentUser.id });
    }
    updatePostCountsInPlace(videoId);
    renderProfile();
  } catch (err) { alert("تعذر الإعجاب:\n" + (err.message || JSON.stringify(err))); }
}

async function toggleFollow(targetUserId) {
  if (!currentUser || targetUserId === currentUser.id) return;
  const exists = followsCache.some(f => f.follower_id === currentUser.id && f.following_id === targetUserId);
  try {
    if (exists) {
      const { error } = await db.from("follows").delete().match({ follower_id: currentUser.id, following_id: targetUserId });
      if (error) throw error;
      followsCache = followsCache.filter(f => !(f.follower_id === currentUser.id && f.following_id === targetUserId));
    } else {
      const { error } = await db.from("follows").insert({ follower_id: currentUser.id, following_id: targetUserId });
      if (error) throw error;
      followsCache.push({ follower_id: currentUser.id, following_id: targetUserId });
    }
    const nowFollowing = !exists;
    document.querySelectorAll(`.follow-btn[data-user-id="${targetUserId}"]`).forEach(btn => {
      btn.classList.toggle("following", nowFollowing);
      btn.querySelector("span").textContent = nowFollowing ? "✓" : "＋";
      btn.querySelector("small").textContent = nowFollowing ? "تتابع" : "متابعة";
    });
    renderProfile();
  } catch (err) { alert("تعذر المتابعة:\n" + (err.message || JSON.stringify(err))); }
}

async function openComments(videoId) {
  activeCommentVideoId = videoId;
  $("dzCommentsModal").hidden = false;
  const list = $("commentsList");
  list.innerHTML = `<p style="text-align:center;color:#64748b;font-size:13px">جارٍ التحميل...</p>`;
  const { data, error } = await db.from("video_comments").select("*").eq("video_id", videoId).order("created_at", { ascending: true });
  if (error) { list.innerHTML = `<div class="modal-error">تعذر تحميل التعليقات: ${error.message}</div>`; return; }
  list.textContent = "";
  if (!data.length) { list.innerHTML = `<p style="text-align:center;color:#64748b;font-size:13px;padding:12px 0">لا توجد تعليقات بعد. كن أول من يعلق!</p>`; return; }
  data.forEach(c => {
    const item = document.createElement("div"); item.className = "comment-item";
    const author = document.createElement("strong"); author.textContent = "@" + (profilesMap[c.user_id]?.username || "user");
    const body = document.createElement("span"); body.textContent = c.content;
    item.append(author, body); list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
}

$("dzCloseComments").addEventListener("click", () => { activeCommentVideoId = null; $("dzCommentsModal").hidden = true; });
$("dzCommentsModal").addEventListener("click", e => { if (e.target === $("dzCommentsModal")) { activeCommentVideoId = null; $("dzCommentsModal").hidden = true; } });

$("commentForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser || !activeCommentVideoId) return;
  const content = $("commentInput").value.trim();
  if (!content) return;
  const btn = e.submitter; btn.disabled = true;
  try {
    const { data, error } = await db.from("video_comments").insert({ video_id: activeCommentVideoId, user_id: currentUser.id, content }).select().single();
    if (error) throw error;
    if (!commentsCache.some(c => c.id === data.id)) commentsCache.push({ id: data.id, video_id: activeCommentVideoId });
    $("commentInput").value = "";
    await openComments(activeCommentVideoId);
    updatePostCountsInPlace(activeCommentVideoId);
    renderProfile();
  } catch (err) { alert("فشل إرسال التعليق:\n" + (err.message || JSON.stringify(err))); }
  finally { btn.disabled = false; }
});

function openShareModal(post) {
  activeSharePost = post;
  const select = $("shareFriendSelect"); select.textContent = "";
  const friends = Object.values(profilesMap).filter(p => currentUser && p.id !== currentUser.id);
  if (!friends.length) {
    const opt = document.createElement("option"); opt.value = ""; opt.textContent = "لا يوجد أصدقاء مسجلون بعد"; select.appendChild(opt);
  } else {
    friends.forEach(f => { const opt = document.createElement("option"); opt.value = f.id; opt.textContent = "@" + (f.username || "صديق"); select.appendChild(opt); });
  }
  $("shareLinkInput").value = post.video_url || "";
  $("dzShareModal").hidden = false;
}

$("dzCloseShare").addEventListener("click", () => { $("dzShareModal").hidden = true; });
$("dzShareModal").addEventListener("click", e => { if (e.target === $("dzShareModal")) $("dzShareModal").hidden = true; });

async function sendPostToChat(receiverId) {
  if (!currentUser || !activeSharePost) return;
  const creatorName = profilesMap[activeSharePost.user_id]?.username || "user";
  const payload = JSON.stringify({ dz_share: true, type: isImagePost(activeSharePost) ? "image" : "video", creator: creatorName, caption: activeSharePost.caption || "", url: activeSharePost.video_url });
  try {
    const { error } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: receiverId, content: payload });
    if (error) throw error;
    $("dzShareModal").hidden = true;
    activeChatUserId = receiverId;
    switchPage("messagesPage");
    showToast("تمت مشاركة المنشور في الشات بنجاح 💬");
  } catch (err) { alert("تعذرت المشاركة في الشات:\n" + (err.message || JSON.stringify(err))); }
}

$("shareToPublicBtn").addEventListener("click", () => sendPostToChat(null));
$("shareToFriendBtn").addEventListener("click", () => {
  const targetId = $("shareFriendSelect").value;
  if (!targetId) { showToast("لا يوجد صديق محدد للمشاركة معه"); return; }
  sendPostToChat(targetId);
});

$("shareExternalBtn").addEventListener("click", async () => {
  const url = activeSharePost?.video_url || "";
  const input = $("shareLinkInput"); input.select(); input.setSelectionRange(0, 99999);
  let copied = false;
  try { if (navigator.clipboard) { await navigator.clipboard.writeText(url); copied = true; } } catch {}
  if (!copied) { try { copied = document.execCommand("copy"); } catch {} }
  if (copied) { showToast("تم نسخ رابط المنشور 🔗"); $("dzShareModal").hidden = true; }
  else showToast("اضغط مطولاً على الرابط أعلاه لنسخه");
});

$("videoFile").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  const isImg = file.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
  const isVid = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|3gp)$/i.test(file.name);
  if (!isImg && !isVid) { showToast("اختر ملف صورة أو فيديو صحيحاً"); event.target.value = ""; return; }
  if (file.size > 50 * 1024 * 1024) { showToast("حجم الملف أكبر من 50 MB"); event.target.value = ""; return; }
  selectedMedia = file; selectedMediaType = isImg ? "image" : "video";
  $("uploadStatus").textContent = `تم اختيار ${isImg ? "الصورة" : "الفيديو"}: ${file.name}`;
  const preview = $("uploadPreview"); preview.textContent = "";
  const objUrl = URL.createObjectURL(file);
  if (isImg) { const img = document.createElement("img"); img.src = objUrl; preview.appendChild(img); }
  else { const vid = document.createElement("video"); vid.src = objUrl; vid.controls = true; vid.playsInline = true; preview.appendChild(vid); }
  preview.hidden = false;
});

$("publishBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  if (!selectedMedia) { showToast("اختر صورة أو فيديو أولاً"); return; }
  const btn = $("publishBtn"); btn.disabled = true; btn.textContent = "جارٍ النشر...";
  try {
    const fallbackExt = selectedMediaType === "image" ? "jpg" : "mp4";
    const ext = selectedMedia.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || fallbackExt;
    const filePath = `${currentUser.id}/${selectedMediaType}_${Date.now()}.${ext}`;
    const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(filePath, selectedMedia, { contentType: selectedMedia.type || (selectedMediaType === "image" ? "image/jpeg" : "video/mp4") });
    if (uploadError) throw uploadError;
    const { data: pub } = db.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    const caption = $("newCaption").value.trim() || "منشور جديد من DZ-CHAT 🇩🇿";
    const { error: dbError } = await db.from("videos").insert({ user_id: currentUser.id, video_url: pub.publicUrl, caption, media_type: selectedMediaType });
    if (dbError) throw dbError;
    selectedMedia = null; $("videoFile").value = ""; $("newCaption").value = ""; $("uploadStatus").textContent = ""; $("uploadPreview").hidden = true; $("uploadPreview").textContent = "";
    await refreshAllData(true);
    switchPage("homePage");
    $("videoFeed").scrollTo({ top: 0, behavior: "smooth" });
    showToast("تم نشر منشورك لجميع أصدقائك 🇩🇿");
  } catch (err) { alert("فشل النشر: " + (err.message || JSON.stringify(err))); }
  finally { btn.disabled = false; btn.textContent = "نشر الآن"; }
});

function renderFriendsBar() {
  const bar = $("friendsBar"); bar.textContent = "";
  const publicBtn = document.createElement("button");
  publicBtn.type = "button"; publicBtn.className = "friend-chip" + (activeChatUserId === null ? " active" : "");
  publicBtn.textContent = "🌐 شات الأصدقاء العام";
  publicBtn.addEventListener("click", () => { activeChatUserId = null; renderFriendsBar(); loadMessages(); });
  bar.appendChild(publicBtn);
  Object.values(profilesMap).forEach(p => {
    if (!currentUser || p.id === currentUser.id) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "friend-chip" + (activeChatUserId === p.id ? " active" : "");
    btn.textContent = "@" + (p.username || "صديق");
    btn.addEventListener("click", () => { activeChatUserId = p.id; renderFriendsBar(); loadMessages(); });
    bar.appendChild(btn);
  });
}

async function loadMessages() {
  if (!currentUser) return;
  const box = $("chatMessages");
  let query = db.from("messages").select("*").order("created_at", { ascending: true }).limit(100);
  if (activeChatUserId === null) query = query.is("receiver_id", null);
  else query = query.or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeChatUserId}),and(sender_id.eq.${activeChatUserId},receiver_id.eq.${currentUser.id})`);
  const { data, error } = await query;
  if (error) { showToast("تعذر تحميل الرسائل: " + error.message); return; }
  box.textContent = "";
  if (!data.length) { box.innerHTML = `<p style="text-align:center;color:#8ea0b8;font-size:13px;margin:auto">لا توجد رسائل بعد. ابدأ المحادثة الآن!</p>`; return; }
  data.forEach(m => {
    const bubble = document.createElement("div");
    const isMine = m.sender_id === currentUser.id;
    bubble.className = "chat-bubble" + (isMine ? " mine" : "");
    const sender = document.createElement("strong"); sender.textContent = isMine ? "أنت" : "@" + (profilesMap[m.sender_id]?.username || "صديق");
    bubble.appendChild(sender);
    let shared = null;
    try { const parsed = JSON.parse(m.content); if (parsed && parsed.dz_share) shared = parsed; } catch {}
    if (shared) {
      const card = document.createElement("div"); card.className = "shared-card";
      const by = document.createElement("small"); by.textContent = "📤 منشور مشارَك من @" + shared.creator; card.appendChild(by);
      if (shared.type === "image") { const img = document.createElement("img"); img.src = shared.url; card.appendChild(img); }
      else { const vid = document.createElement("video"); vid.src = shared.url; vid.controls = true; vid.playsInline = true; card.appendChild(vid); }
      if (shared.caption) { const cap = document.createElement("p"); cap.textContent = shared.caption; card.appendChild(cap); }
      bubble.appendChild(card);
    } else {
      const text = document.createElement("span"); text.textContent = m.content; bubble.appendChild(text);
    }
    box.appendChild(bubble);
  });
  box.scrollTop = box.scrollHeight;
}

function subscribeRealtimeAll() {
  db.removeAllChannels();
  db.channel("dz-chat-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async payload => {
      const msg = payload.new;
      if (!currentUser) return;
      if (!profilesMap[msg.sender_id]) {
        const { data } = await db.from("profiles").select("*").eq("id", msg.sender_id).maybeSingle();
        if (data) profilesMap[data.id] = data;
      }
      const belongs = (activeChatUserId === null && msg.receiver_id === null) || (activeChatUserId !== null && ((msg.sender_id === currentUser.id && msg.receiver_id === activeChatUserId) || (msg.sender_id === activeChatUserId && msg.receiver_id === currentUser.id)));
      if (belongs) await loadMessages();
      else if (msg.sender_id !== currentUser.id) showToast(`رسالة جديدة من @${profilesMap[msg.sender_id]?.username || "صديق"} 💬`);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "video_likes" }, async payload => {
      const { data } = await db.from("video_likes").select("video_id, user_id");
      if (data) likesCache = data;
      const vidId = payload.new?.video_id || payload.old?.video_id;
      if (vidId) updatePostCountsInPlace(vidId);
      renderProfile();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "video_comments" }, async payload => {
      const { data } = await db.from("video_comments").select("id, video_id");
      if (data) commentsCache = data;
      const vidId = payload.new?.video_id;
      if (vidId) updatePostCountsInPlace(vidId);
      if (activeCommentVideoId && activeCommentVideoId === vidId) await openComments(activeCommentVideoId);
      renderProfile();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "videos" }, async () => { await refreshAllData(true); })
    .on("postgres_changes", { event: "*", schema: "public", table: "live_rooms" }, async () => {
      const { data } = await db.from("live_rooms").select("*").eq("is_active", true).order("created_at", { ascending: false });
      liveRoomsCache = data || [];
      renderLiveRoomsStrip();
    })
    .subscribe();
}

$("chatForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return;
  const content = $("chatInput").value.trim();
  if (!content) return;
  $("chatInput").value = "";
  try {
    const { error } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: activeChatUserId, content });
    if (error) throw error;
    await loadMessages();
  } catch (err) { showToast("فشل إرسال الرسالة: " + err.message); }
});

function renderDiscover() {
  const q = $("searchInput").value.trim().toLowerCase();
  const container = $("discoverResults"); container.textContent = "";
  const matchedUsers = Object.values(profilesMap).filter(p => currentUser && p.id !== currentUser.id && (p.username || "").toLowerCase().includes(q));
  const matchedVideos = videosCache.filter(v => (profilesMap[v.user_id]?.username || "").toLowerCase().includes(q) || (v.caption || "").toLowerCase().includes(q));
  if (!matchedUsers.length && !matchedVideos.length) {
    container.innerHTML = `<div class="discover-box"><div>🇩🇿</div><h3>لا توجد نتائج</h3><p>عند انضمام أصدقائك ونشر الصور والفيديوهات سيظهرون هنا.</p></div>`;
    return;
  }
  matchedUsers.forEach(user => {
    const row = document.createElement("div"); row.className = "discover-item";
    row.innerHTML = `<div><strong></strong><small></small></div>`;
    row.querySelector("strong").textContent = "@" + user.username;
    row.querySelector("small").textContent = user.country || "الجزائر";
    const chatBtn = document.createElement("button"); chatBtn.type = "button"; chatBtn.className = "play-mini-btn"; chatBtn.textContent = "مراسلة 💬";
    chatBtn.addEventListener("click", () => { activeChatUserId = user.id; switchPage("messagesPage"); });
    row.appendChild(chatBtn); container.appendChild(row);
  });
  matchedVideos.forEach(post => {
    const uname = profilesMap[post.user_id]?.username || "user";
    const row = document.createElement("div"); row.className = "discover-item";
    const info = document.createElement("div");
    const st = document.createElement("strong"); st.textContent = `${isImagePost(post) ? "🖼️" : "🎬"} @${uname}`;
    const sm = document.createElement("small"); sm.textContent = post.caption;
    info.append(st, sm);
    const playBtn = document.createElement("button"); playBtn.type = "button"; playBtn.className = "play-mini-btn"; playBtn.textContent = "مشاهدة";
    playBtn.addEventListener("click", () => { switchPage("homePage"); const t = $("videoFeed").querySelector(`[data-video-id="${post.id}"]`); if (t) t.scrollIntoView({ behavior: "smooth" }); });
    row.append(info, playBtn); container.appendChild(row);
  });
}

$("searchInput").addEventListener("input", renderDiscover);
$("searchBtn").addEventListener("click", () => { switchPage("discoverPage"); $("searchInput").focus(); });

function renderProfile() {
  if (!currentUser) return;
  const p = currentProfile || {};
  const username = (p.username || currentUser.email.split("@")[0]).replace(/^@/, "");
  $("profileName").textContent = "@" + username;
  $("profileBio").textContent = p.bio || "عضو في مجتمع DZ-CHAT";
  $("profileCountry").textContent = p.country ? "📍 " + p.country : "";
  setAvatarContent($("profileAvatar"), p.avatar_url, "الصورة الشخصية");

  const myPosts = videosCache.filter(v => v.user_id === currentUser.id);
  const myPostIds = new Set(myPosts.map(v => v.id));
  $("statFollowers").textContent = formatCount(followsCache.filter(f => f.following_id === currentUser.id).length);
  $("statFollowing").textContent = formatCount(followsCache.filter(f => f.follower_id === currentUser.id).length);
  $("statLikes").textContent = formatCount(likesCache.filter(l => myPostIds.has(l.video_id)).length);

  const list = $("myVideosList"); list.textContent = "";
  if (!myPosts.length) { const empty = document.createElement("p"); empty.textContent = "لم تنشر أي صورة أو فيديو بعد."; list.appendChild(empty); return; }
  myPosts.forEach(post => {
    const row = document.createElement("div"); row.className = "my-video-item";
    const info = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = `${isImagePost(post) ? "🖼️" : "🎬"} ${post.caption || "منشور"}`;
    const meta = document.createElement("small"); meta.textContent = `♥ ${likesCache.filter(l => l.video_id === post.id).length}  •  💬 ${commentsCache.filter(c => c.video_id === post.id).length}`;
    info.append(title, meta);
    const actions = document.createElement("div"); actions.className = "item-actions";
    const playBtn = document.createElement("button"); playBtn.type = "button"; playBtn.className = "play-mini-btn"; playBtn.textContent = "عرض";
    playBtn.addEventListener("click", () => { switchPage("homePage"); const t = $("videoFeed").querySelector(`[data-video-id="${post.id}"]`); if (t) t.scrollIntoView({ behavior: "smooth" }); });
    const delBtn = document.createElement("button"); delBtn.type = "button"; delBtn.className = "delete-mini-btn"; delBtn.textContent = "حذف";
    delBtn.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذا المنشور؟")) return;
      const { error } = await db.from("videos").delete().eq("id", post.id);
      if (error) showToast("تعذر الحذف: " + error.message);
      else { await refreshAllData(true); showToast("تم حذف المنشور"); }
    });
    actions.append(playBtn, delBtn); row.append(info, actions); list.appendChild(row);
  });
}

$("editProfileBtn").addEventListener("click", () => {
  if (!currentUser) return;
  const p = currentProfile || {};
  $("dzEditUsername").value = p.username || "";
  $("dzEditBio").value = p.bio || "";
  $("dzEditCountry").value = p.country || "الجزائر";
  $("dzEditAvatar").value = "";
  $("dzProfileError").hidden = true; $("dzProfileError").textContent = "";
  setAvatarContent($("dzAvatarPreview"), p.avatar_url, "معاينة الصورة");
  $("dzProfileModal").hidden = false;
});

$("dzCloseProfile").addEventListener("click", () => { $("dzProfileModal").hidden = true; });
$("dzProfileModal").addEventListener("click", e => { if (e.target === $("dzProfileModal")) $("dzProfileModal").hidden = true; });

$("dzEditAvatar").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  if ((file.type && !file.type.startsWith("image/")) || file.size > 5 * 1024 * 1024) { showToast("اختر صورة صالحة بحجم أقل من 5 ميغابايت"); event.target.value = ""; return; }
  const reader = new FileReader();
  reader.onload = () => setAvatarContent($("dzAvatarPreview"), reader.result, "معاينة");
  reader.readAsDataURL(file);
});

$("dzSaveProfile").addEventListener("click", async () => {
  if (!currentUser) return;
  const btn = $("dzSaveProfile"), errBox = $("dzProfileError");
  const username = $("dzEditUsername").value.trim().replace(/^@/, "");
  const bio = $("dzEditBio").value.trim(), country = $("dzEditCountry").value.trim(), imageFile = $("dzEditAvatar").files[0];
  errBox.hidden = true; errBox.textContent = "";
  if (username.length < 3) { errBox.textContent = "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"; errBox.hidden = false; return; }
  btn.disabled = true; btn.textContent = "جارٍ الحفظ...";
  try {
    let avatarUrl = currentProfile?.avatar_url || null;
    if (imageFile) {
      const ext = imageFile.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const filePath = `${currentUser.id}/avatar_${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(filePath, imageFile, { upsert: true, contentType: imageFile.type || "image/jpeg" });
      if (upErr) throw new Error("خطأ رفع الصورة: " + upErr.message);
      avatarUrl = db.storage.from(STORAGE_BUCKET).getPublicUrl(filePath).data.publicUrl;
    }
    const { data, error } = await db.from("profiles").upsert({ id: currentUser.id, username, bio, country, avatar_url: avatarUrl }, { onConflict: "id" }).select().single();
    if (error) throw new Error("خطأ قاعدة البيانات: " + error.message);
    currentProfile = data; profilesMap[currentUser.id] = data;
    renderProfile(); renderVideoFeed(); renderDiscover();
    $("dzProfileModal").hidden = true; showToast("تم حفظ التعديلات بنجاح 🇩🇿");
  } catch (err) {
    const msg = err.message || JSON.stringify(err);
    errBox.textContent = msg; errBox.hidden = false; alert("سبب فشل الحفظ:\n" + msg);
  } finally { btn.disabled = false; btn.textContent = "حفظ التعديلات"; }
});

const logoutButton = document.createElement("button");
logoutButton.type = "button"; logoutButton.textContent = "تسجيل الخروج"; logoutButton.className = "edit-profile"; logoutButton.style.marginTop = "10px";
$("editProfileBtn").after(logoutButton);
logoutButton.addEventListener("click", async () => { if (!confirm("هل تريد تسجيل الخروج؟")) return; leaveLiveRoom(true); await db.auth.signOut(); showAuth(); showToast("تم تسجيل الخروج"); });

navItems.forEach(button => {
  button.addEventListener("click", () => {
    if (!currentUser) return;
    if (button.dataset.page === "uploadPage") { $("dzCreateChoiceModal").hidden = false; return; }
    switchPage(button.dataset.page);
  });
});

app.style.display = "none";
showAuth();
(async () => {
  const { data } = await db.auth.getSession();
  if (data.session?.user) await loadUser(data.session.user);
})();
