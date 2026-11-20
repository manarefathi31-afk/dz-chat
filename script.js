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
let allMessagesCache = [];
let onlineUserIds = new Set();
let showOnlineStatus = true;
let presenceChannel = null;
let realtimeChannel = null;

let selectedMedia = null;
let selectedMediaType = "video";
let activeCommentVideoId = null;
let activeSharePost = null;
let activeOptionsPost = null;
let activeEditPost = null;
let editPostMediaFile = null;
let editPostMediaType = null;
let activeChatUserId = "__none__";
let activeProfileTab = "posts";
let activeFollowsTab = "following";
let viewedUserProfileId = null;
let viewedUserProfileTab = "posts";
let feedObserver = null;
let friendsFeedObserver = null;

let activeLiveRoom = null;
let selectedLiveMode = "video";
let pendingPinRoom = null;
let liveSeatsCache = [];
let liveCommentsCache = [];
let liveRoomChannel = null;
let localMediaStream = null;
let peerConnections = {};
let amISpeakerNow = false;
let isMicMuted = false;
let isCamEnabled = true;
let currentCamFacing = "user";

let liveMusicAudio = null;
let liveAudioCtx = null;
let liveMixedDest = null;

let voiceRecorder = null;
let voiceChunks = [];
let voiceTimerInt = null;
let voiceSeconds = 0;
let voiceMimeType = "";

const seatPhotoInput = document.createElement("input");
seatPhotoInput.type = "file";
seatPhotoInput.accept = "image/*";
seatPhotoInput.hidden = true;
document.body.appendChild(seatPhotoInput);

function formatCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);
}

function formatRelTime(iso) {
  if (!iso) return "";
  const diff = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (diff < 60) return `منذ ${diff} د`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `منذ ${h} س`;
  return `منذ ${Math.floor(h / 24)} ي`;
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
  box._timer = setTimeout(() => box.classList.remove("show"), 3200);
}

function authMessage(message, error = false) {
  const box = $("dzAuthMessage");
  if (!box) return;
  box.textContent = message;
  box.style.color = error ? "#dc2626" : "#07845b";
}

function setAvatarContent(container, url, altText = "صورة") {
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

function attachSwipeBack(el, onBack) {
  if (!el) return;
  let sx = 0, sy = 0, tracking = false;
  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    if (e.target.closest("input[type=range], .dm-quick-bar, .inbox-stories-strip, .live-share-friends-row, .follows-tabs")) {
      tracking = false; return;
    }
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  el.addEventListener("touchend", e => {
    if (!tracking || !e.changedTouches.length) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.4 && Math.abs(dy) < 95) {
      onBack();
    }
  }, { passive: true });
}

function getSavedPostIds() {
  if (!currentUser) return [];
  try { return JSON.parse(localStorage.getItem("dz_saved_" + currentUser.id) || "[]"); } catch { return []; }
}

function toggleSavedPostId(postId) {
  if (!currentUser) return false;
  const list = getSavedPostIds();
  const idx = list.indexOf(postId);
  const saved = idx === -1;
  if (saved) list.unshift(postId);
  else list.splice(idx, 1);
  localStorage.setItem("dz_saved_" + currentUser.id, JSON.stringify(list));
  return saved;
}

function getUserThought() {
  if (!currentUser) return "";
  return localStorage.getItem("dz_thought_" + currentUser.id) || "";
}

function setUserThought(txt) {
  if (!currentUser) return;
  localStorage.setItem("dz_thought_" + currentUser.id, txt.trim());
}

function parseRoomMeta(rawTitle) {
  const fallback = { t: rawTitle || "غرفة لايف 🇩🇿", m: "audio", b: "default", p: "" };
  if (!rawTitle || typeof rawTitle !== "string") return fallback;
  if (rawTitle.trim().startsWith("{")) {
    try {
      const obj = JSON.parse(rawTitle);
      if (obj && typeof obj.t === "string") {
        return { t: obj.t || fallback.t, m: obj.m || "audio", b: obj.b || "default", p: obj.p || "" };
      }
    } catch {}
  }
  return fallback;
}

function packRoomMeta(meta) {
  return JSON.stringify({ t: meta.t || "غرفة لايف 🇩🇿", m: meta.m || "audio", b: meta.b || "default", p: meta.p || "" });
}

function parseMsgPayload(content) {
  if (!content || typeof content !== "string") return { kind: "text", text: "" };
  if (content.trim().startsWith("{")) {
    try {
      const p = JSON.parse(content);
      if (p && p.dz_share) return { kind: "share", ...p };
      if (p && p.dz_img) return { kind: "image", url: p.url, react: p.react || "" };
      if (p && p.dz_voice) return { kind: "voice", url: p.url, dur: p.dur || "", react: p.react || "" };
      if (p && p.dz_live_invite) return { kind: "live", roomId: p.roomId, title: p.title, hostName: p.hostName };
      if (p && p.dz_txt) return { kind: "text", text: p.text || "", react: p.react || "" };
    } catch {}
  }
  return { kind: "text", text: content, react: "" };
}

const authScreen = document.createElement("div");
authScreen.id = "dzAuth";
authScreen.innerHTML = `
  <div class="auth-card">
    <div class="auth-flag">🇩🇿</div>
    <h2>DZ-CHAT</h2>
    <p class="auth-sub">سجّل باسم المستخدم وكلمة المرور فقط بدون تعقيدات</p>
    <form id="dzLoginForm">
      <input id="dzEmail" type="text" placeholder="اسم المستخدم" required minlength="3" autocomplete="username">
      <input id="dzPassword" type="password" placeholder="كلمة المرور" required minlength="6" autocomplete="current-password">
      <button class="auth-main" type="submit">تسجيل الدخول</button>
    </form>
    <form id="dzRegisterForm" hidden>
      <input id="dzName" type="text" placeholder="اسم المستخدم" required minlength="3" autocomplete="username">
      <input id="dzNewPassword" type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" required minlength="6" autocomplete="new-password">
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
  closePrivateChat();
  closeUserProfile();
  currentUser = null;
  currentProfile = null;
  onlineUserIds = new Set();
  db.removeAllChannels();
  presenceChannel = null;
  realtimeChannel = null;
  document.querySelectorAll("video").forEach(v => v.pause());
  app.style.display = "none";
  authScreen.style.display = "flex";
}

let registerMode = false;
$("dzSwitch").addEventListener("click", () => {
  registerMode = !registerMode;
  $("dzLoginForm").hidden = registerMode;
  $("dzRegisterForm").hidden = !registerMode;
  $("dzSwitch").textContent = registerMode ? "لديك حساب؟ سجل الدخول" : "ليس لديك حساب؟ أنشئ حساباً جديداً";
  authMessage("");
});

function usernameToAuthEmail(input) {
  const raw = (input || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw.toLowerCase();
  const clean = raw.replace(/^@+/, "").toLowerCase();
  if (/^[a-z0-9_-]{3,40}$/.test(clean)) return clean + "@dzchat.com";
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (((h2 << 5) + h2) ^ c) >>> 0;
  }
  return "u_" + h1.toString(36) + h2.toString(36) + "@dzchat.com";
}

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

$("dzLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = e.submitter;
  const rawLogin = $("dzEmail").value.trim();
  const password = $("dzPassword").value;
  if (rawLogin.replace(/^@+/, "").length < 3) { authMessage("اسم المستخدم يجب أن يكون 3 أحرف على الأقل", true); return; }
  btn.disabled = true; btn.textContent = "جارٍ الدخول...";
  try {
    const { data, error } = await db.auth.signInWithPassword({ email: usernameToAuthEmail(rawLogin), password });
    if (error) throw error;
    await loadUser(data.user);
  } catch (err) {
    const msg = err.message || "";
    authMessage(msg.includes("Invalid login credentials") ? "اسم المستخدم أو كلمة المرور غير صحيحة." : "تعذر تسجيل الدخول: " + msg, true);
  } finally { btn.disabled = false; btn.textContent = "تسجيل الدخول"; }
});

$("dzRegisterForm").addEventListener("submit", async e => {
  e.preventDefault();
  const username = $("dzName").value.trim().replace(/^@+/, "");
  const password = $("dzNewPassword").value;
  const btn = e.submitter;
  if (username.length < 3) { authMessage("اسم المستخدم يجب أن يكون 3 أحرف على الأقل", true); return; }
  btn.disabled = true; btn.textContent = "جارٍ الإنشاء...";
  try {
    const { data, error } = await db.auth.signUp({
      email: usernameToAuthEmail(username),
      password,
      options: { data: { username, display_name: username } }
    });
    if (error) throw error;
    if (data.session) await loadUser(data.user);
    else authMessage("أوقف Confirm email في إعدادات Supabase للدخول المباشر بدون بريد.", true);
  } catch (err) {
    const msg = err.message || "";
    authMessage(msg.includes("User already registered") ? "اسم المستخدم مستخدم بالفعل، اختر اسماً آخر." : "تعذر إنشاء الحساب: " + msg, true);
  } finally { btn.disabled = false; btn.textContent = "إنشاء حساب جديد"; }
});

async function refreshAllData(redrawFeed = true) {
  const [profilesRes, videosRes, likesRes, commentsRes, followsRes, roomsRes, msgsRes] = await Promise.all([
    db.from("profiles").select("*"),
    db.from("videos").select("*").order("created_at", { ascending: false }),
    db.from("video_likes").select("video_id, user_id"),
    db.from("video_comments").select("id, video_id"),
    db.from("follows").select("follower_id, following_id"),
    db.from("live_rooms").select("*").eq("is_active", true).order("created_at", { ascending: false }),
    currentUser ? db.from("messages").select("*").order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] })
  ]);

  profilesMap = {};
  (profilesRes.data || []).forEach(p => { profilesMap[p.id] = p; });
  if (currentUser && profilesMap[currentUser.id]) currentProfile = profilesMap[currentUser.id];

  videosCache = videosRes.data || [];
  likesCache = likesRes.data || [];
  commentsCache = commentsRes.data || [];
  followsCache = followsRes.data || [];
  liveRoomsCache = roomsRes.data || [];
  allMessagesCache = msgsRes.data || [];

  renderLiveRoomsStrip();
  renderProfile();
  renderInbox();
  if (redrawFeed) {
    renderVideoFeed();
    renderFriendsFeed();
  } else {
    videosCache.forEach(v => updatePostCountsInPlace(v.id));
  }
  renderDiscoverSearch();
  if (!$("dzFollowsModal").hidden) renderFollowsList();
  if (!$("dzUserProfileModal").hidden && viewedUserProfileId) renderViewedUserProfile();
}

function setupOnlinePresence() {
  if (!currentUser) return;
  if (presenceChannel) db.removeChannel(presenceChannel);
  presenceChannel = db.channel("dz-online-presence", { config: { presence: { key: currentUser.id } } });
  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      const next = new Set();
      Object.values(state).flat().forEach(p => {
        if (p && p.user_id && p.active !== false) next.add(p.user_id);
      });
      onlineUserIds = next;
      renderInbox();
      if (activeChatUserId !== "__none__" && activeChatUserId !== null) {
        const live = liveRoomsCache.find(r => r.host_id === activeChatUserId);
        const f = profilesMap[activeChatUserId] || {};
        $("chatHeaderSub").textContent = live ? "🔴 في بث مباشر الآن" : (onlineUserIds.has(activeChatUserId) ? "🟢 نشط الآن" : (f.country || "غير متصل"));
      }
    })
    .subscribe(async status => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ user_id: currentUser.id, active: showOnlineStatus });
      }
    });
}

async function loadUser(user) {
  if (!user) return;
  currentUser = user;
  try {
    currentProfile = await ensureProfile(user);
    showApp();
    await refreshAllData(true);
    subscribeRealtimeAll();
    setupOnlinePresence();
    showToast("مرحباً بك في DZ-CHAT 🇩🇿");
  } catch (err) {
    console.error(err);
    showApp();
    showToast("خطأ في تحميل البيانات: " + err.message);
  }
}

function switchPage(pageId) {
  const target = $(pageId);
  if (!target) return;
  pages.forEach(page => page.classList.remove("active"));
  target.classList.add("active");
  app.className = "app page-" + pageId;
  navItems.forEach(item => item.classList.toggle("active", item.dataset.page === pageId));
  if (pageId !== "homePage" && pageId !== "discoverPage") {
    document.querySelectorAll(".video-slide video").forEach(v => v.pause());
  }
  if (pageId === "homePage") refreshAllData(false);
  if (pageId === "discoverPage") renderFriendsFeed();
  if (pageId === "messagesPage") refreshAllData(false);
  if (pageId === "profilePage") renderProfile();
}

function renderLiveRoomsStrip() {
  const strip = $("liveRoomsStrip");
  strip.textContent = "";
  if (!liveRoomsCache.length) { strip.hidden = true; return; }
  strip.hidden = false;
  liveRoomsCache.forEach(room => {
    const meta = parseRoomMeta(room.title);
    const hostName = profilesMap[room.host_id]?.username || "مضيف";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "live-room-pill";
    btn.innerHTML = `<span class="live-pill-badge">${meta.p ? "🔒" : "🔴"} لايف</span><strong></strong><small></small>`;
    btn.querySelector("strong").textContent = meta.t;
    btn.querySelector("small").textContent = `(@${hostName})`;
    btn.addEventListener("click", () => tryEnterLiveRoom(room));
    strip.appendChild(btn);
  });
}

function applyLiveRoomBackground(bg) {
  const el = $("dzLiveRoom");
  const map = {
    default: "radial-gradient(circle at 50% 15%, #1d3557 0%, transparent 55%), linear-gradient(180deg, #0b1324 0%, #070b14 100%)",
    emerald: "radial-gradient(circle at 50% 15%, #065f46 0%, transparent 60%), linear-gradient(180deg, #064e3b 0%, #03110d 100%)",
    purple: "radial-gradient(circle at 50% 15%, #6d28d9 0%, transparent 60%), linear-gradient(180deg, #3b0764 0%, #0d051a 100%)",
    sunset: "radial-gradient(circle at 50% 15%, #c2410c 0%, transparent 60%), linear-gradient(180deg, #431407 0%, #110605 100%)"
  };
  if (bg && bg.startsWith("http")) {
    el.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.75)), url("${bg}")`;
  } else {
    el.style.backgroundImage = map[bg] || map.default;
  }
}

function tryEnterLiveRoom(room) {
  if (!room || !currentUser) return;
  const meta = parseRoomMeta(room.title);
  if (meta.p && room.host_id !== currentUser.id) {
    pendingPinRoom = room;
    $("livePinAttemptInput").value = "";
    $("livePinErr").hidden = true;
    $("dzLivePinModal").hidden = false;
    return;
  }
  enterLiveRoom(room);
}

$("dzCloseLivePin").addEventListener("click", () => { pendingPinRoom = null; $("dzLivePinModal").hidden = true; });
$("livePinSubmitBtn").addEventListener("click", () => {
  if (!pendingPinRoom) return;
  const meta = parseRoomMeta(pendingPinRoom.title);
  if ($("livePinAttemptInput").value.trim() === meta.p) {
    const r = pendingPinRoom;
    pendingPinRoom = null;
    $("dzLivePinModal").hidden = true;
    enterLiveRoom(r);
  } else {
    $("livePinErr").textContent = "المفتاح السري غير صحيح!";
    $("livePinErr").hidden = false;
  }
});

$("choiceUploadBtn").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; switchPage("uploadPage"); });
$("choiceLiveBtn").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; $("dzLiveSetupModal").hidden = false; });
$("dzCloseChoice").addEventListener("click", () => { $("dzCreateChoiceModal").hidden = true; });
$("dzCreateChoiceModal").addEventListener("click", e => { if (e.target === $("dzCreateChoiceModal")) $("dzCreateChoiceModal").hidden = true; });
$("dzCloseLiveSetup").addEventListener("click", () => { $("dzLiveSetupModal").hidden = true; });
$("dzLiveSetupModal").addEventListener("click", e => { if (e.target === $("dzLiveSetupModal")) $("dzLiveSetupModal").hidden = true; });

$("liveModeVideo").addEventListener("click", () => { selectedLiveMode = "video"; $("liveModeVideo").classList.add("active"); $("liveModeAudio").classList.remove("active"); });
$("liveModeAudio").addEventListener("click", () => { selectedLiveMode = "audio"; $("liveModeAudio").classList.add("active"); $("liveModeVideo").classList.remove("active"); });

$("startLiveConfirmBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  const btn = $("startLiveConfirmBtn");
  const titleText = $("liveTitleInput").value.trim() || "غرفة لايف 🇩🇿";
  const packed = packRoomMeta({ t: titleText, m: selectedLiveMode, b: "default", p: "" });
  btn.disabled = true; btn.textContent = "جارٍ فتح البث...";
  try {
    await db.from("live_rooms").update({ is_active: false }).eq("host_id", currentUser.id);
    const { data, error } = await db.from("live_rooms").insert({ host_id: currentUser.id, title: packed, is_active: true }).select().single();
    if (error) throw error;
    $("dzLiveSetupModal").hidden = true;
    await refreshAllData(false);
    await enterLiveRoom(data);
  } catch (err) {
    alert("تعذر فتح البث:\n" + (err.message || JSON.stringify(err)));
  } finally { btn.disabled = false; btn.textContent = "بدء البث المباشر الآن"; }
});

async function enterLiveRoom(room) {
  if (!currentUser || !room) return;
  activeLiveRoom = room;
  const meta = parseRoomMeta(room.title);
  isMicMuted = false;
  isCamEnabled = meta.m === "video";
  currentCamFacing = "user";
  document.querySelectorAll(".video-slide video").forEach(v => v.pause());
  const host = profilesMap[room.host_id] || {};
  const isHost = room.host_id === currentUser.id;
  $("liveRoomTitle").textContent = (meta.p ? "🔒 " : "") + meta.t;
  $("liveHostName").textContent = "المضيف: @" + (host.username || "host");
  setAvatarContent($("liveHostAvatar"), host.avatar_url, "المضيف");
  $("liveExitBtn").textContent = isHost ? "إنهاء البث" : "خروج";
  $("liveSettingsBtn").hidden = !isHost;
  $("liveRequestsDrawer").hidden = true;
  $("liveHostStage").hidden = !isCamEnabled;
  $("liveHostStage").textContent = "";
  applyLiveRoomBackground(meta.b);
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
  await syncSpeakerMediaAndPresence();
}

function buildSeatMiniControls() {
  const wrap = document.createElement("div");
  wrap.className = "seat-mini-controls";

  const micBtn = document.createElement("button");
  micBtn.type = "button";
  micBtn.className = "seat-mini-btn " + (isMicMuted ? "off" : "on");
  micBtn.textContent = isMicMuted ? "🔇" : "🎙️";
  micBtn.addEventListener("click", e => { e.stopPropagation(); toggleMyLiveMic(); });

  const camBtn = document.createElement("button");
  camBtn.type = "button";
  camBtn.className = "seat-mini-btn " + (isCamEnabled ? "on" : "");
  camBtn.textContent = isCamEnabled ? "📹" : "📷";
  camBtn.addEventListener("click", e => { e.stopPropagation(); toggleSeatCamera(); });

  const flipBtn = document.createElement("button");
  flipBtn.type = "button";
  flipBtn.className = "seat-mini-btn";
  flipBtn.textContent = "🔄";
  flipBtn.addEventListener("click", e => { e.stopPropagation(); flipSeatCamera(); });

  const photoBtn = document.createElement("button");
  photoBtn.type = "button";
  photoBtn.className = "seat-mini-btn";
  photoBtn.textContent = "🖼️";
  photoBtn.addEventListener("click", e => { e.stopPropagation(); seatPhotoInput.click(); });

  wrap.append(micBtn, camBtn, flipBtn, photoBtn);
  return wrap;
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
      const row = document.createElement("div"); row.className = "req-row";
      const name = document.createElement("span"); name.textContent = "@" + (u.username || "صديق") + " يطلب الصعود";
      const btns = document.createElement("div"); btns.className = "req-btns";
      const acc = document.createElement("button"); acc.type = "button"; acc.className = "req-accept"; acc.textContent = "قبول ✅";
      acc.addEventListener("click", () => approveGuestRequest(req.user_id));
      const rej = document.createElement("button"); rej.type = "button"; rej.className = "req-reject"; rej.textContent = "رفض";
      rej.addEventListener("click", () => removeSeatRow(req.user_id));
      btns.append(acc, rej); row.append(name, btns); reqListEl.appendChild(row);
    });
  }

  const grid = $("liveGuestSeats");
  grid.textContent = "";

  const hostProfile = profilesMap[activeLiveRoom.host_id] || {};
  const hostSeat = document.createElement("div");
  hostSeat.className = "guest-seat occupied host-seat";
  const hNum = document.createElement("span"); hNum.className = "seat-num"; hNum.textContent = "👑";
  const hAv = document.createElement("div"); hAv.className = "seat-avatar";
  if (isHost && isCamEnabled && localMediaStream && localMediaStream.getVideoTracks().length) {
    const hv = document.createElement("video"); hv.autoplay = true; hv.muted = true; hv.playsInline = true; hv.srcObject = localMediaStream; hAv.appendChild(hv);
  } else {
    setAvatarContent(hAv, hostProfile.avatar_url, hostProfile.username || "المضيف");
  }
  const hLabel = document.createElement("div"); hLabel.className = "seat-name";
  hLabel.textContent = "@" + (hostProfile.username || "المضيف");
  hostSeat.append(hNum, hAv, hLabel);
  if (isHost) hostSeat.appendChild(buildSeatMiniControls());
  grid.appendChild(hostSeat);

  for (let num = 2; num <= 9; num++) {
    const guest = seatedList.find(s => s.seat_number === num);
    const seatEl = document.createElement("div");
    seatEl.className = "guest-seat" + (guest ? " occupied" : "");
    const numTag = document.createElement("span"); numTag.className = "seat-num"; numTag.textContent = num;
    seatEl.appendChild(numTag);
    const av = document.createElement("div"); av.className = "seat-avatar";
    const label = document.createElement("div"); label.className = "seat-name";

    if (guest) {
      const gp = profilesMap[guest.user_id] || {};
      const isMySeat = guest.user_id === currentUser.id;
      if (isMySeat && isCamEnabled && localMediaStream && localMediaStream.getVideoTracks().length) {
        const gv = document.createElement("video"); gv.autoplay = true; gv.muted = true; gv.playsInline = true; gv.srcObject = localMediaStream; av.appendChild(gv);
      } else {
        setAvatarContent(av, gp.avatar_url, gp.username || "ضيف");
      }
      label.textContent = "@" + (gp.username || "ضيف");
      if (!isMySeat) {
        const mic = document.createElement("span"); mic.className = "seat-mic"; mic.textContent = guest.is_muted ? "🔇" : "🎙️";
        seatEl.appendChild(mic);
      }
      seatEl.append(av, label);
      if (isMySeat) seatEl.appendChild(buildSeatMiniControls());
      if (isHost) {
        seatEl.addEventListener("click", () => {
          if (confirm(`هل تريد إنزال @${gp.username || "الضيف"} من المقعد ${num}؟`)) removeSeatRow(guest.user_id);
        });
      }
    } else {
      av.textContent = "＋";
      label.textContent = `مقعد ${num}`;
      seatEl.append(av, label);
      if (!isHost && !mySeatRow) seatEl.addEventListener("click", requestToJoinSeat);
    }
    grid.appendChild(seatEl);
  }

  const ctrl = $("liveActionControls");
  ctrl.textContent = "";
  if (!isHost && mySeatRow && mySeatRow.status === "seated") {
    const downBtn = document.createElement("button");
    downBtn.type = "button"; downBtn.className = "live-ctrl-btn warn"; downBtn.textContent = "⬇️ نزول من المقعد";
    downBtn.addEventListener("click", () => removeSeatRow(currentUser.id));
    ctrl.appendChild(downBtn);
  } else if (!isHost && mySeatRow && mySeatRow.status === "pending") {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button"; cancelBtn.className = "live-ctrl-btn warn"; cancelBtn.textContent = "⏳ إلغاء طلب الصعود";
    cancelBtn.addEventListener("click", () => removeSeatRow(currentUser.id));
    ctrl.appendChild(cancelBtn);
  } else if (!isHost) {
    const reqBtn = document.createElement("button");
    reqBtn.type = "button"; reqBtn.className = "live-ctrl-btn primary"; reqBtn.textContent = "✋ طلب الصعود للمقعد";
    reqBtn.addEventListener("click", requestToJoinSeat);
    ctrl.appendChild(reqBtn);
  }
}

async function toggleSeatCamera() {
  if (!activeLiveRoom || !currentUser) return;
  const isHost = activeLiveRoom.host_id === currentUser.id;
  if (isCamEnabled) {
    isCamEnabled = false;
    if (localMediaStream) localMediaStream.getVideoTracks().forEach(t => { t.stop(); localMediaStream.removeTrack(t); });
    if (isHost) { $("liveHostStage").hidden = true; $("liveHostStage").textContent = ""; }
    renderLiveSeatsAndControls();
    showToast("تم غلق الكاميرا 📷");
    return;
  }
  try {
    const vidStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: currentCamFacing } } });
    const vTrack = vidStream.getVideoTracks()[0];
    if (!localMediaStream) localMediaStream = new MediaStream();
    localMediaStream.getVideoTracks().forEach(t => { t.stop(); localMediaStream.removeTrack(t); });
    localMediaStream.addTrack(vTrack);
    isCamEnabled = true;

    for (const [peerId, pc] of Object.entries(peerConnections)) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
      if (sender) await sender.replaceTrack(vTrack).catch(() => {});
      else {
        pc.addTrack(vTrack, localMediaStream);
        if (liveRoomChannel) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          liveRoomChannel.send({ type: "broadcast", event: "rtc-signal", payload: { to: peerId, from: currentUser.id, sdp: pc.localDescription } });
        }
      }
    }
    if (isHost) {
      const stage = $("liveHostStage"); stage.hidden = false; stage.textContent = "";
      const v = document.createElement("video"); v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = localMediaStream;
      stage.appendChild(v);
    }
    renderLiveSeatsAndControls();
    showToast("تم فتح الكاميرا 📹");
  } catch { showToast("تعذر تشغيل الكاميرا"); }
}

async function flipSeatCamera() {
  if (!activeLiveRoom || !currentUser) return;
  currentCamFacing = currentCamFacing === "user" ? "environment" : "user";
  if (!isCamEnabled) { await toggleSeatCamera(); return; }
  try {
    if (localMediaStream) localMediaStream.getVideoTracks().forEach(t => { t.stop(); localMediaStream.removeTrack(t); });
    const vidStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: currentCamFacing } } });
    const newTrack = vidStream.getVideoTracks()[0];
    if (!localMediaStream) localMediaStream = new MediaStream();
    localMediaStream.addTrack(newTrack);
    Object.values(peerConnections).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(newTrack).catch(() => {});
    });
    const stageVid = $("liveHostStage").querySelector("video");
    if (stageVid) stageVid.srcObject = localMediaStream;
    renderLiveSeatsAndControls();
    showToast(currentCamFacing === "user" ? "الكاميرا الأمامية 🤳" : "الكاميرا الخلفية 📷");
  } catch { showToast("تعذر تبديل الكاميرا"); }
}

seatPhotoInput.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;
  showToast("جارٍ تحديث صورة المقعد...");
  try {
    const ext = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${currentUser.id}/seat_${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (upErr) throw upErr;
    const url = db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    await db.from("profiles").update({ avatar_url: url }).eq("id", currentUser.id);
    if (currentProfile) currentProfile.avatar_url = url;
    if (profilesMap[currentUser.id]) profilesMap[currentUser.id].avatar_url = url;
    isCamEnabled = false;
    if (localMediaStream) localMediaStream.getVideoTracks().forEach(t => { t.stop(); localMediaStream.removeTrack(t); });
    if (activeLiveRoom && activeLiveRoom.host_id === currentUser.id) { $("liveHostStage").hidden = true; $("liveHostStage").textContent = ""; }
    if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "seat-photo", payload: { user_id: currentUser.id, url } });
    renderLiveSeatsAndControls();
    renderProfile();
    showToast("تم وضع الصورة في المقعد ✅");
  } catch (err) { showToast("تعذر تغيير الصورة: " + err.message); }
  e.target.value = "";
});

async function requestToJoinSeat() {
  if (!activeLiveRoom || !currentUser) return;
  try {
    const { error } = await db.from("live_seats").upsert({ room_id: activeLiveRoom.id, user_id: currentUser.id, status: "pending", seat_number: null, is_muted: false }, { onConflict: "room_id,user_id" });
    if (error) throw error;
    showToast("تم إرسال طلب الصعود للمضيف ✋");
    await loadLiveRoomState();
  } catch (err) { alert("تعذر إرسال الطلب:\n" + err.message); }
}

async function approveGuestRequest(userId) {
  if (!activeLiveRoom) return;
  const taken = new Set(liveSeatsCache.filter(s => s.status === "seated").map(s => s.seat_number));
  let freeSeat = null;
  for (let i = 2; i <= 9; i++) { if (!taken.has(i)) { freeSeat = i; break; } }
  if (!freeSeat) { showToast("جميع مقاعد الضيوف ممتلئة!"); return; }
  try {
    const { error } = await db.from("live_seats").update({ status: "seated", seat_number: freeSeat, is_muted: false }).match({ room_id: activeLiveRoom.id, user_id: userId });
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
  if (localMediaStream) localMediaStream.getAudioTracks().forEach(t => { t.enabled = !isMicMuted; });
  if (activeLiveRoom && currentUser && activeLiveRoom.host_id !== currentUser.id) {
    await db.from("live_seats").update({ is_muted: isMicMuted }).match({ room_id: activeLiveRoom.id, user_id: currentUser.id });
  }
  renderLiveSeatsAndControls();
}

$("liveSettingsBtn").addEventListener("click", () => {
  if (!activeLiveRoom) return;
  const meta = parseRoomMeta(activeLiveRoom.title);
  $("livePinInput").value = meta.p || "";
  $("liveBgPresets").querySelectorAll(".bg-swatch").forEach(b => b.classList.toggle("selected", b.dataset.bg === meta.b));
  $("dzLiveSettingsModal").hidden = false;
});
$("dzCloseLiveSettings").addEventListener("click", () => { $("dzLiveSettingsModal").hidden = true; });
$("dzLiveSettingsModal").addEventListener("click", e => { if (e.target === $("dzLiveSettingsModal")) $("dzLiveSettingsModal").hidden = true; });

async function updateLiveRoomMeta(patch) {
  if (!activeLiveRoom || !currentUser) return;
  const meta = { ...parseRoomMeta(activeLiveRoom.title), ...patch };
  const packed = packRoomMeta(meta);
  const { error } = await db.from("live_rooms").update({ title: packed }).eq("id", activeLiveRoom.id);
  if (error) { showToast("فشل تحديث الخصائص: " + error.message); return; }
  activeLiveRoom.title = packed;
  $("liveRoomTitle").textContent = (meta.p ? "🔒 " : "") + meta.t;
  applyLiveRoomBackground(meta.b);
  if (liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "room-meta", payload: meta });
}

$("liveBgPresets").addEventListener("click", async e => {
  const btn = e.target.closest(".bg-swatch");
  if (!btn) return;
  $("liveBgPresets").querySelectorAll(".bg-swatch").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  await updateLiveRoomMeta({ b: btn.dataset.bg });
  showToast("تم تغيير خلفية الغرفة 🎨");
});

$("liveBgFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;
  showToast("جارٍ رفع الخلفية...");
  try {
    const ext = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${currentUser.id}/livebg_${Date.now()}.${ext}`;
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type || "image/jpeg" });
    if (error) throw error;
    const url = db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    await updateLiveRoomMeta({ b: url });
    showToast("تم تعيين صورة الخلفية ✅");
  } catch (err) { showToast("فشل رفع الخلفية: " + err.message); }
  e.target.value = "";
});

$("liveSaveSettingsBtn").addEventListener("click", async () => {
  const pin = $("livePinInput").value.trim();
  if (pin && !/^\d{4}$/.test(pin)) { showToast("المفتاح السري يجب أن يتكون من 4 أرقام فقط"); return; }
  await updateLiveRoomMeta({ p: pin });
  $("dzLiveSettingsModal").hidden = true;
  showToast(pin ? "تم قفل الغرفة بالمفتاح السري 🔒" : "الغرفة الآن مفتوحة بدون رمز 🔓");
});

$("liveMusicFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  if (liveMusicAudio) { liveMusicAudio.pause(); liveMusicAudio = null; }
  liveMusicAudio = new Audio(URL.createObjectURL(file));
  liveMusicAudio.loop = true;
  liveMusicAudio.volume = parseFloat($("liveMusicVol").value || "0.4");
  $("liveMusicStatus").textContent = "المقطع: " + file.name;
  $("liveMusicToggleBtn").disabled = false;
  liveMusicAudio.play().then(() => { $("liveMusicToggleBtn").textContent = "⏸️ إيقاف الموسيقى"; mixMusicIntoPeers(); }).catch(() => {});
});
$("liveMusicToggleBtn").addEventListener("click", () => {
  if (!liveMusicAudio) return;
  if (liveMusicAudio.paused) { liveMusicAudio.play().catch(() => {}); $("liveMusicToggleBtn").textContent = "⏸️ إيقاف الموسيقى"; }
  else { liveMusicAudio.pause(); $("liveMusicToggleBtn").textContent = "▶️ تشغيل الموسيقى"; }
});
$("liveMusicVol").addEventListener("input", () => { if (liveMusicAudio) liveMusicAudio.volume = parseFloat($("liveMusicVol").value || "0.4"); });

function mixMusicIntoPeers() {
  if (!liveMusicAudio || !localMediaStream) return;
  try {
    if (!liveAudioCtx) liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (liveAudioCtx.state === "suspended") liveAudioCtx.resume();
    if (!liveMixedDest) liveMixedDest = liveAudioCtx.createMediaStreamDestination();
    liveAudioCtx.createMediaStreamSource(localMediaStream).connect(liveMixedDest);
    const musSrc = liveAudioCtx.createMediaElementSource(liveMusicAudio);
    musSrc.connect(liveMixedDest); musSrc.connect(liveAudioCtx.destination);
    const mixedTrack = liveMixedDest.stream.getAudioTracks()[0];
    if (mixedTrack) {
      Object.values(peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "audio");
        if (sender) sender.replaceTrack(mixedTrack).catch(() => {});
      });
    }
  } catch {}
}

$("liveShareBtn").addEventListener("click", () => {
  if (!activeLiveRoom || !currentUser) return;
  const row = $("liveShareFriendsRow"); row.textContent = ""; $("liveShareStatus").textContent = "";
  const followingIds = followsCache.filter(f => f.follower_id === currentUser.id).map(f => f.following_id);
  const friends = followingIds.map(id => profilesMap[id]).filter(Boolean);
  if (!friends.length) row.innerHTML = `<p style="font-size:12px;color:#64748b;padding:8px">لا تتابع أي صديق بعد.</p>`;
  else {
    friends.forEach(f => {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "live-share-friend";
      const av = document.createElement("div"); av.className = "av"; setAvatarContent(av, f.avatar_url, f.username);
      const sm = document.createElement("small"); sm.textContent = "@" + f.username;
      btn.append(av, sm);
      btn.addEventListener("click", async () => {
        const meta = parseRoomMeta(activeLiveRoom.title);
        const hostName = profilesMap[activeLiveRoom.host_id]?.username || "host";
        const payload = JSON.stringify({ dz_live_invite: true, roomId: activeLiveRoom.id, title: meta.t, hostName });
        const { error } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: f.id, content: payload });
        if (error) $("liveShareStatus").textContent = "تعذر الإرسال: " + error.message;
        else { $("liveShareStatus").textContent = `✅ تم إرسال رابط البث إلى @${f.username}`; showToast(`تم إرسال الدعوة لـ @${f.username} ➤`); }
      });
      row.appendChild(btn);
    });
  }
  $("dzLiveShareModal").hidden = false;
});
$("dzCloseLiveShare").addEventListener("click", () => { $("dzLiveShareModal").hidden = true; });
$("dzLiveShareModal").addEventListener("click", e => { if (e.target === $("dzLiveShareModal")) $("dzLiveShareModal").hidden = true; });

function renderLiveComments() {
  const box = $("liveCommentsArea"); box.textContent = "";
  liveCommentsCache.forEach(c => {
    const uname = profilesMap[c.user_id]?.username || "عضو";
    const pill = document.createElement("div");
    const isSys = c.content.startsWith("✅ صعد");
    pill.className = "live-comment-pill" + (isSys ? " sys" : "");
    if (isSys) pill.textContent = c.content;
    else { const st = document.createElement("strong"); st.textContent = "@" + uname + ":"; const tx = document.createElement("span"); tx.textContent = c.content; pill.append(st, tx); }
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
    if (!confirm("هل تريد إنهاء البث للجميع؟")) return;
    await db.from("live_rooms").update({ is_active: false }).eq("id", activeLiveRoom.id);
  } else {
    await db.from("live_seats").delete().match({ room_id: activeLiveRoom.id, user_id: currentUser.id });
  }
  leaveLiveRoom(false);
});

function closeAllPeers() {
  Object.values(peerConnections).forEach(pc => { try { pc.close(); } catch {} });
  peerConnections = {};
  $("liveAudioPool").textContent = "";
}

function leaveLiveRoom(silent = false) {
  closeAllPeers();
  if (liveMusicAudio) { liveMusicAudio.pause(); liveMusicAudio = null; }
  if (localMediaStream) { localMediaStream.getTracks().forEach(t => t.stop()); localMediaStream = null; }
  if (liveRoomChannel) { db.removeChannel(liveRoomChannel); liveRoomChannel = null; }
  amISpeakerNow = false;
  activeLiveRoom = null;
  $("dzLiveRoom").hidden = true;
  if (!silent) refreshAllData(false);
}

async function ensureLocalMediaIfNeeded(shouldSpeak) {
  if (!shouldSpeak) {
    if (localMediaStream) { localMediaStream.getTracks().forEach(t => t.stop()); localMediaStream = null; }
    return false;
  }
  if (localMediaStream) return true;
  const isHost = activeLiveRoom && activeLiveRoom.host_id === currentUser.id;
  const meta = parseRoomMeta(activeLiveRoom?.title || "");
  const wantVideo = isHost && meta.m === "video";
  try {
    localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo ? { facingMode: { ideal: currentCamFacing } } : false });
  } catch {
    try { localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); isCamEnabled = false; }
    catch { showToast("لم يتم تفعيل الميكروفون أو الكاميرا"); return false; }
  }
  localMediaStream.getAudioTracks().forEach(t => { t.enabled = !isMicMuted; });
  if (wantVideo && localMediaStream.getVideoTracks().length) {
    const stage = $("liveHostStage"); stage.hidden = false; stage.textContent = "";
    const v = document.createElement("video"); v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = localMediaStream;
    stage.appendChild(v);
  }
  renderLiveSeatsAndControls();
  return true;
}

async function syncSpeakerMediaAndPresence() {
  if (!activeLiveRoom || !currentUser || !liveRoomChannel) return;
  const isHost = activeLiveRoom.host_id === currentUser.id;
  const mySeat = liveSeatsCache.find(s => s.user_id === currentUser.id && s.status === "seated");
  const shouldSpeak = isHost || !!mySeat;
  if (shouldSpeak !== amISpeakerNow) {
    amISpeakerNow = shouldSpeak;
    await ensureLocalMediaIfNeeded(shouldSpeak);
    closeAllPeers();
    await liveRoomChannel.track({ user_id: currentUser.id, is_speaker: shouldSpeak });
  }
}

function createPeerConnection(peerId) {
  if (peerConnections[peerId]) return peerConnections[peerId];
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
  peerConnections[peerId] = pc;
  if (localMediaStream) localMediaStream.getTracks().forEach(track => pc.addTrack(track, localMediaStream));
  else { pc.addTransceiver("audio", { direction: "recvonly" }); pc.addTransceiver("video", { direction: "recvonly" }); }

  pc.onicecandidate = event => {
    if (event.candidate && liveRoomChannel) liveRoomChannel.send({ type: "broadcast", event: "rtc-signal", payload: { to: peerId, from: currentUser.id, candidate: event.candidate } });
  };
  pc.ontrack = event => {
    const stream = event.streams[0];
    if (stream && stream.getVideoTracks().length && activeLiveRoom && peerId === activeLiveRoom.host_id) {
      const stage = $("liveHostStage"); stage.hidden = false; stage.textContent = "";
      const v = document.createElement("video"); v.autoplay = true; v.playsInline = true; v.srcObject = stream;
      stage.appendChild(v); v.play().catch(() => {}); return;
    }
    let audio = document.getElementById("aud_" + peerId);
    if (!audio) { audio = document.createElement("audio"); audio.id = "aud_" + peerId; audio.autoplay = true; audio.playsInline = true; $("liveAudioPool").appendChild(audio); }
    audio.srcObject = stream; audio.play().catch(() => {});
  };
  return pc;
}

async function setupLiveRoomRealtime(roomId) {
  if (liveRoomChannel) db.removeChannel(liveRoomChannel);
  const isHost = activeLiveRoom.host_id === currentUser.id;
  amISpeakerNow = isHost;
  await ensureLocalMediaIfNeeded(isHost);

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
      else if (payload.new && activeLiveRoom) {
        activeLiveRoom.title = payload.new.title;
        const meta = parseRoomMeta(payload.new.title);
        $("liveRoomTitle").textContent = (meta.p ? "🔒 " : "") + meta.t;
        applyLiveRoomBackground(meta.b);
      }
    })
    .on("broadcast", { event: "room-meta" }, ({ payload }) => {
      if (payload && activeLiveRoom) {
        activeLiveRoom.title = packRoomMeta(payload);
        $("liveRoomTitle").textContent = (payload.p ? "🔒 " : "") + payload.t;
        applyLiveRoomBackground(payload.b);
      }
    })
    .on("broadcast", { event: "seat-photo" }, ({ payload }) => {
      if (payload && payload.user_id && profilesMap[payload.user_id]) {
        profilesMap[payload.user_id].avatar_url = payload.url;
        renderLiveSeatsAndControls();
      }
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
function buildFeedSlide(post) {
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
  const creator = profilesMap[post.user_id] || {};
  const creatorName = (creator.username || "dz_user").replace(/^@/, "");
  const info = document.createElement("div"); info.className = "video-info";
  const strong = document.createElement("strong"); strong.textContent = "@" + creatorName;
  strong.addEventListener("click", e => { e.stopPropagation(); openUserProfile(post.user_id); });
  const p = document.createElement("p"); p.textContent = post.caption || "منشور من مجتمع DZ-CHAT 🇩🇿";
  const small = document.createElement("small"); small.textContent = isImagePost(post) ? "🖼️ صورة - DZ-CHAT" : "🎵 الصوت الأصلي - " + creatorName;
  info.append(strong, p, small);

  const actions = document.createElement("div"); actions.className = "video-actions";

  const avBtn = document.createElement("button");
  avBtn.type = "button";
  avBtn.className = "action-creator-av" + (liveRoomsCache.some(r => r.host_id === post.user_id) ? " is-live" : "");
  setAvatarContent(avBtn, creator.avatar_url, creatorName);
  avBtn.addEventListener("click", e => { e.stopPropagation(); openUserProfile(post.user_id); });
  actions.appendChild(avBtn);

  const videoLikes = likesCache.filter(l => l.video_id === post.id);
  const isLiked = currentUser && videoLikes.some(l => l.user_id === currentUser.id);
  const likeBtn = document.createElement("button");
  likeBtn.type = "button"; likeBtn.className = "action like-btn" + (isLiked ? " liked" : "");
  likeBtn.innerHTML = `<span>♥</span><small>${formatCount(videoLikes.length)}</small>`;
  likeBtn.addEventListener("click", e => { e.stopPropagation(); toggleLike(post.id); });

  const commentCount = commentsCache.filter(c => c.video_id === post.id).length;
  const commentBtn = document.createElement("button");
  commentBtn.type = "button"; commentBtn.className = "action comment-btn";
  commentBtn.innerHTML = `<span>💬</span><small>${commentCount}</small>`;
  commentBtn.addEventListener("click", e => { e.stopPropagation(); openComments(post.id); });

  const isSaved = getSavedPostIds().includes(post.id);
  const saveBtn = document.createElement("button");
  saveBtn.type = "button"; saveBtn.className = "action";
  saveBtn.innerHTML = `<span>${isSaved ? "🔖" : "🏷️"}</span><small>${isSaved ? "محفوظ" : "حفظ"}</small>`;
  saveBtn.addEventListener("click", e => {
    e.stopPropagation();
    const s = toggleSavedPostId(post.id);
    saveBtn.querySelector("span").textContent = s ? "🔖" : "🏷️";
    saveBtn.querySelector("small").textContent = s ? "محفوظ" : "حفظ";
    renderProfile();
    showToast(s ? "تم الحفظ في المحفوظات 🔖" : "تمت الإزالة من المحفوظات");
  });

  const shareBtn = document.createElement("button");
  shareBtn.type = "button"; shareBtn.className = "action";
  shareBtn.innerHTML = `<span>➤</span><small>مشاركة</small>`;
  shareBtn.addEventListener("click", e => { e.stopPropagation(); openShareModal(post); });

  const dotsBtn = document.createElement("button");
  dotsBtn.type = "button"; dotsBtn.className = "action more-dots-btn";
  dotsBtn.innerHTML = `<span>•••</span><small>المزيد</small>`;
  dotsBtn.addEventListener("click", e => { e.stopPropagation(); openPostOptions(post); });

  actions.append(likeBtn, commentBtn, saveBtn, shareBtn, dotsBtn);

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
  return slide;
}

function renderVideoFeed() {
  const feed = $("videoFeed");
  if (feedObserver) feedObserver.disconnect();
  feed.textContent = "";
  if (!videosCache.length) {
    feed.innerHTML = `<div class="video-slide"><div class="video-placeholder"><div class="play-symbol">▶</div><span>مرحباً بك في DZ-CHAT</span><small>اضغط (+) لنشر صورة/فيديو أو فتح بث مباشر 🇩🇿</small></div><div class="video-gradient"></div></div>`;
    return;
  }
  videosCache.forEach(post => feed.appendChild(buildFeedSlide(post)));
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

function renderFriendsFeed() {
  if (!currentUser) return;
  const followingIds = new Set(followsCache.filter(f => f.follower_id === currentUser.id).map(f => f.following_id));

  const topAvs = $("friendsTopAvatars");
  topAvs.textContent = "";
  const previewFriends = [...followingIds].slice(0, 3).map(id => profilesMap[id]).filter(Boolean);
  previewFriends.forEach(f => {
    const isLive = liveRoomsCache.some(r => r.host_id === f.id);
    const av = document.createElement("button");
    av.type = "button";
    av.className = "friends-mini-av" + (isLive ? " live" : "");
    setAvatarContent(av, f.avatar_url, f.username);
    av.addEventListener("click", () => {
      const lr = liveRoomsCache.find(r => r.host_id === f.id);
      if (lr) tryEnterLiveRoom(lr);
      else openUserProfile(f.id);
    });
    topAvs.appendChild(av);
  });

  const feed = $("friendsFeed");
  if (friendsFeedObserver) friendsFeedObserver.disconnect();
  feed.textContent = "";
  const friendPosts = videosCache.filter(v => followingIds.has(v.user_id));

  if (!friendPosts.length) {
    feed.innerHTML = `
      <div class="video-slide">
        <div class="video-placeholder">
          <div class="play-symbol">👥</div>
          <span>منشورات أصدقائك</span>
          <small>${followingIds.size ? "لم ينشر أصدقاؤك أي منشورات جديدة بعد." : "تابع أصدقاءك لتظهر كل منشوراتهم ونشاطاتهم هنا!"}</small>
          <button type="button" class="play-mini-btn" id="friendsFindBtn" style="margin-top:8px;">اكتشف أصدقاء للمتابعة 🔍</button>
        </div>
        <div class="video-gradient"></div>
      </div>`;
    const btn = $("friendsFindBtn");
    if (btn) btn.addEventListener("click", openSearchModal);
    return;
  }

  friendPosts.forEach(post => feed.appendChild(buildFeedSlide(post)));
  friendsFeedObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const vid = entry.target.querySelector("video");
      if (!vid) return;
      if (entry.isIntersecting && $("discoverPage").classList.contains("active") && $("dzLiveRoom").hidden) vid.play().catch(() => {});
      else vid.pause();
    });
  }, { root: feed, threshold: 0.65 });
  feed.querySelectorAll(".video-slide").forEach(slide => friendsFeedObserver.observe(slide));
}

function openPostOptions(post) {
  activeOptionsPost = post;
  const isOwner = currentUser && post.user_id === currentUser.id;
  $("postOptEditBtn").hidden = !isOwner;
  $("postOptDeleteBtn").hidden = !isOwner;
  const isSaved = getSavedPostIds().includes(post.id);
  $("postOptSaveBtn").textContent = isSaved ? "🔖 إزالة من المحفوظات" : "🔖 حفظ في المحفوظات";
  $("dzPostOptionsModal").hidden = false;
}
$("dzClosePostOptions").addEventListener("click", () => { $("dzPostOptionsModal").hidden = true; });
$("dzPostOptionsModal").addEventListener("click", e => { if (e.target === $("dzPostOptionsModal")) $("dzPostOptionsModal").hidden = true; });

$("postOptSaveBtn").addEventListener("click", () => {
  if (!activeOptionsPost) return;
  const saved = toggleSavedPostId(activeOptionsPost.id);
  $("dzPostOptionsModal").hidden = true;
  renderProfile();
  showToast(saved ? "تم حفظ المنشور في المحفوظات 🔖" : "تمت إزالة المنشور من المحفوظات");
});

$("postOptCopyBtn").addEventListener("click", async () => {
  if (!activeOptionsPost) return;
  try { await navigator.clipboard.writeText(activeOptionsPost.video_url || ""); } catch {}
  $("dzPostOptionsModal").hidden = true;
  showToast("تم نسخ رابط المنشور 🔗");
});

$("postOptDeleteBtn").addEventListener("click", async () => {
  if (!activeOptionsPost) return;
  if (!confirm("هل تريد حذف هذا المنشور نهائياً؟")) return;
  const { error } = await db.from("videos").delete().eq("id", activeOptionsPost.id);
  $("dzPostOptionsModal").hidden = true;
  if (error) showToast("تعذر الحذف: " + error.message);
  else { await refreshAllData(true); showToast("تم حذف المنشور 🗑️"); }
});

$("postOptEditBtn").addEventListener("click", () => {
  if (!activeOptionsPost) return;
  $("dzPostOptionsModal").hidden = true;
  activeEditPost = activeOptionsPost;
  editPostMediaFile = null; editPostMediaType = null;
  $("editPostMediaFile").value = ""; $("editPostStatus").textContent = "";
  $("editPostCaption").value = activeEditPost.caption || "";
  const prev = $("editPostPreview"); prev.textContent = "";
  if (isImagePost(activeEditPost)) { const img = document.createElement("img"); img.src = activeEditPost.video_url; prev.appendChild(img); }
  else { const vid = document.createElement("video"); vid.src = activeEditPost.video_url; vid.controls = true; vid.playsInline = true; prev.appendChild(vid); }
  prev.hidden = false;
  $("dzEditPostModal").hidden = false;
});
$("dzCloseEditPost").addEventListener("click", () => { $("dzEditPostModal").hidden = true; });
$("dzEditPostModal").addEventListener("click", e => { if (e.target === $("dzEditPostModal")) $("dzEditPostModal").hidden = true; });

$("editPostMediaFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const isImg = file.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
  const isVid = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|3gp)$/i.test(file.name);
  if (!isImg && !isVid) { showToast("اختر صورة أو فيديو صالحاً"); return; }
  if (file.size > 50 * 1024 * 1024) { showToast("حجم الملف أكبر من 50 MB"); return; }
  editPostMediaFile = file; editPostMediaType = isImg ? "image" : "video";
  $("editPostStatus").textContent = "تم اختيار ملف جديد: " + file.name;
  const prev = $("editPostPreview"); prev.textContent = "";
  const url = URL.createObjectURL(file);
  if (isImg) { const img = document.createElement("img"); img.src = url; prev.appendChild(img); }
  else { const vid = document.createElement("video"); vid.src = url; vid.controls = true; vid.playsInline = true; prev.appendChild(vid); }
  prev.hidden = false;
});

$("saveEditPostBtn").addEventListener("click", async () => {
  if (!activeEditPost || !currentUser) return;
  const btn = $("saveEditPostBtn");
  const newCaption = $("editPostCaption").value.trim() || "منشور من DZ-CHAT 🇩🇿";
  btn.disabled = true; btn.textContent = "جارٍ حفظ التعديلات...";
  try {
    let videoUrl = activeEditPost.video_url;
    let mediaType = activeEditPost.media_type;
    if (editPostMediaFile) {
      const ext = editPostMediaFile.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || (editPostMediaType === "image" ? "jpg" : "mp4");
      const path = `${currentUser.id}/${editPostMediaType}_${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, editPostMediaFile, { contentType: editPostMediaFile.type });
      if (upErr) throw upErr;
      videoUrl = db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      mediaType = editPostMediaType;
    }
    const { error } = await db.from("videos").update({ caption: newCaption, video_url: videoUrl, media_type: mediaType }).eq("id", activeEditPost.id);
    if (error) throw error;
    $("dzEditPostModal").hidden = true;
    await refreshAllData(true);
    showToast("تم تعديل المنشور بنجاح ✅");
  } catch (err) {
    alert("تعذر تعديل المنشور:\n" + (err.message || err));
  } finally { btn.disabled = false; btn.textContent = "حفظ التعديلات ✅"; }
});

function updatePostCountsInPlace(videoId) {
  document.querySelectorAll(`[data-video-id="${videoId}"]`).forEach(slide => {
    const videoLikes = likesCache.filter(l => l.video_id === videoId);
    const isLiked = currentUser && videoLikes.some(l => l.user_id === currentUser.id);
    const likeBtn = slide.querySelector(".like-btn");
    if (likeBtn) { likeBtn.classList.toggle("liked", !!isLiked); likeBtn.querySelector("small").textContent = formatCount(videoLikes.length); }
    const commentBtn = slide.querySelector(".comment-btn");
    if (commentBtn) commentBtn.querySelector("small").textContent = commentsCache.filter(c => c.video_id === videoId).length;
  });
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
    if (!$("dzUserProfileModal").hidden && viewedUserProfileId) renderViewedUserProfile();
  } catch (err) { showToast("تعذر الإعجاب: " + err.message); }
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
    renderFriendsFeed();
    if (!$("dzFollowsModal").hidden) renderFollowsList();
    if (!$("dzUserProfileModal").hidden && viewedUserProfileId) renderViewedUserProfile();
  } catch (err) { showToast("تعذر المتابعة: " + err.message); }
}

async function openComments(videoId) {
  activeCommentVideoId = videoId;
  $("dzCommentsModal").hidden = false;
  const list = $("commentsList");
  list.innerHTML = `<p style="text-align:center;color:#64748b;font-size:13px">جارٍ التحميل...</p>`;
  const { data, error } = await db.from("video_comments").select("*").eq("video_id", videoId).order("created_at", { ascending: true });
  if (error) { list.innerHTML = `<div class="modal-error">${error.message}</div>`; return; }
  list.textContent = "";
  if (!data.length) { list.innerHTML = `<p style="text-align:center;color:#64748b;font-size:13px;padding:12px 0">لا توجد تعليقات بعد.</p>`; return; }
  data.forEach(c => {
    const item = document.createElement("div"); item.className = "comment-item";
    const author = document.createElement("strong"); author.textContent = "@" + (profilesMap[c.user_id]?.username || "user");
    author.addEventListener("click", () => { $("dzCommentsModal").hidden = true; openUserProfile(c.user_id); });
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
  } catch (err) { showToast("فشل إرسال التعليق: " + err.message); }
  finally { btn.disabled = false; }
});

function openShareModal(post) {
  activeSharePost = post;
  const select = $("shareFriendSelect"); select.textContent = "";
  const friends = Object.values(profilesMap).filter(p => currentUser && p.id !== currentUser.id);
  if (!friends.length) { const opt = document.createElement("option"); opt.value = ""; opt.textContent = "لا يوجد أصدقاء بعد"; select.appendChild(opt); }
  else friends.forEach(f => { const opt = document.createElement("option"); opt.value = f.id; opt.textContent = "@" + f.username; select.appendChild(opt); });
  $("shareLinkInput").value = post.video_url || "";
  $("dzShareModal").hidden = false;
}
$("dzCloseShare").addEventListener("click", () => { $("dzShareModal").hidden = true; });
$("dzShareModal").addEventListener("click", e => { if (e.target === $("dzShareModal")) $("dzShareModal").hidden = true; });

async function sendPostToChat(receiverId) {
  if (!currentUser || !activeSharePost) return;
  const creatorName = profilesMap[activeSharePost.user_id]?.username || "user";
  const payload = JSON.stringify({ dz_share: true, type: isImagePost(activeSharePost) ? "image" : "video", creator: creatorName, caption: activeSharePost.caption || "", url: activeSharePost.video_url });
  const { error } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: receiverId, content: payload });
  if (error) {
    if (receiverId === null && /null|policy|violates/i.test(error.message || "")) {
      alert("الشات العام محظور من قاعدة بيانات Supabase:\n" + error.message);
    } else {
      showToast("تعذرت المشاركة: " + error.message);
    }
    return;
  }
  $("dzShareModal").hidden = true;
  openPrivateChat(receiverId);
  showToast("تمت مشاركة المنشور في الشات 💬");
}
$("shareToPublicBtn").addEventListener("click", () => sendPostToChat(null));
$("shareToFriendBtn").addEventListener("click", () => { const id = $("shareFriendSelect").value; if (id) sendPostToChat(id); });
$("shareExternalBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(activeSharePost?.video_url || ""); } catch {}
  $("dzShareModal").hidden = true; showToast("تم نسخ رابط المنشور 🔗");
});

$("videoFile").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  const isImg = file.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
  const isVid = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|3gp)$/i.test(file.name);
  if (!isImg && !isVid) { showToast("اختر ملف صورة أو فيديو صحيحاً"); return; }
  if (file.size > 50 * 1024 * 1024) { showToast("حجم الملف أكبر من 50 MB"); return; }
  selectedMedia = file; selectedMediaType = isImg ? "image" : "video";
  $("uploadStatus").textContent = `تم اختيار ${isImg ? "الصورة" : "الفيديو"}: ${file.name}`;
  const preview = $("uploadPreview"); preview.textContent = "";
  const objUrl = URL.createObjectURL(file);
  if (isImg) { const img = document.createElement("img"); img.src = objUrl; preview.appendChild(img); }
  else { const vid = document.createElement("video"); vid.src = objUrl; vid.controls = true; vid.playsInline = true; preview.appendChild(vid); }
  preview.hidden = false;
});

$("publishBtn").addEventListener("click", async () => {
  if (!currentUser || !selectedMedia) { showToast("اختر صورة أو فيديو أولاً"); return; }
  const btn = $("publishBtn"); btn.disabled = true; btn.textContent = "جارٍ النشر...";
  try {
    const ext = selectedMedia.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || (selectedMediaType === "image" ? "jpg" : "mp4");
    const filePath = `${currentUser.id}/${selectedMediaType}_${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(filePath, selectedMedia, { contentType: selectedMedia.type });
    if (upErr) throw upErr;
    const { data: pub } = db.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    const caption = $("newCaption").value.trim() || "منشور جديد من DZ-CHAT 🇩🇿";
    const { error: dbErr } = await db.from("videos").insert({ user_id: currentUser.id, video_url: pub.publicUrl, caption, media_type: selectedMediaType });
    if (dbErr) throw dbErr;
    selectedMedia = null; $("videoFile").value = ""; $("newCaption").value = ""; $("uploadStatus").textContent = ""; $("uploadPreview").hidden = true;
    await refreshAllData(true);
    switchPage("homePage");
    $("videoFeed").scrollTo({ top: 0, behavior: "smooth" });
    showToast("تم نشر منشورك لجميع أصدقائك 🇩🇿");
  } catch (err) { alert("فشل النشر: " + err.message); }
  finally { btn.disabled = false; btn.textContent = "نشر الآن"; }
});

$("inboxOpenDiscoverBtn").addEventListener("click", openSearchModal);
$("inboxSearchBtn").addEventListener("click", openSearchModal);
$("inboxStatusToggle").addEventListener("click", async () => {
  showOnlineStatus = !showOnlineStatus;
  $("myStatusDot").classList.toggle("off", !showOnlineStatus);
  if (presenceChannel && currentUser) await presenceChannel.track({ user_id: currentUser.id, active: showOnlineStatus });
  showToast(showOnlineStatus ? "حالة النشاط مفعلة 🟢" : "حالة النشاط مخفية");
});

function renderInbox() {
  if (!currentUser) return;
  const miniStack = $("inboxMiniStack");
  miniStack.textContent = "";
  const onlineOrLive = Object.values(profilesMap).filter(p => p.id !== currentUser.id && (liveRoomsCache.some(r => r.host_id === p.id) || onlineUserIds.has(p.id))).slice(0, 2);
  onlineOrLive.forEach(p => {
    const isLive = liveRoomsCache.some(r => r.host_id === p.id);
    const av = document.createElement("div");
    av.className = "friends-mini-av" + (isLive ? " live" : "");
    setAvatarContent(av, p.avatar_url, p.username);
    miniStack.appendChild(av);
  });

  const strip = $("inboxStoriesStrip");
  strip.textContent = "";

  const myItem = document.createElement("button");
  myItem.type = "button"; myItem.className = "story-item";
  const bubble = document.createElement("span"); bubble.className = "story-bubble-note"; bubble.textContent = getUserThought() || "تحدث عن ما جرى";
  const myRing = document.createElement("div"); myRing.className = "story-ring";
  const myInner = document.createElement("div"); myInner.className = "story-avatar-inner";
  setAvatarContent(myInner, currentProfile?.avatar_url, "حسابي");
  const plus = document.createElement("span"); plus.className = "story-plus-badge"; plus.textContent = "＋";
  myRing.append(myInner, plus);
  const myName = document.createElement("span"); myName.className = "story-name"; myName.textContent = "إنشاء";
  myItem.append(bubble, myRing, myName);
  myItem.addEventListener("click", () => { $("dzThoughtInput").value = getUserThought(); $("dzThoughtModal").hidden = false; });
  strip.appendChild(myItem);

  const liveHostIds = new Set();
  liveRoomsCache.forEach(room => {
    liveHostIds.add(room.host_id);
    const host = profilesMap[room.host_id] || { id: room.host_id, username: "مضيف" };
    const item = document.createElement("button"); item.type = "button"; item.className = "story-item";
    const ring = document.createElement("div"); ring.className = "story-ring live-ring";
    const inner = document.createElement("div"); inner.className = "story-avatar-inner";
    setAvatarContent(inner, host.avatar_url, host.username);
    const badge = document.createElement("span"); badge.className = "story-live-badge"; badge.textContent = "LIVE |ı|";
    ring.append(inner, badge);
    const nm = document.createElement("span"); nm.className = "story-name"; nm.textContent = host.username || "بث مباشر";
    item.append(ring, nm);
    item.addEventListener("click", () => tryEnterLiveRoom(room));
    strip.appendChild(item);
  });

  Object.values(profilesMap).forEach(p => {
    if (p.id === currentUser.id || liveHostIds.has(p.id)) return;
    const isOn = onlineUserIds.has(p.id);
    const item = document.createElement("button"); item.type = "button"; item.className = "story-item";
    const ring = document.createElement("div"); ring.className = "story-ring" + (isOn ? " online-ring" : "");
    const inner = document.createElement("div"); inner.className = "story-avatar-inner";
    setAvatarContent(inner, p.avatar_url, p.username);
    ring.appendChild(inner);
    if (isOn) { const dot = document.createElement("span"); dot.className = "online-dot-badge"; ring.appendChild(dot); }
    const nm = document.createElement("span"); nm.className = "story-name"; nm.textContent = p.username || "صديق";
    item.append(ring, nm);
    item.addEventListener("click", () => openPrivateChat(p.id));
    strip.appendChild(item);
  });

  const list = $("inboxChatsList");
  list.textContent = "";

  const myPostIds = new Set(videosCache.filter(v => v.user_id === currentUser.id).map(v => v.id));
  const actCount = likesCache.filter(l => myPostIds.has(l.video_id) && l.user_id !== currentUser.id).length
    + followsCache.filter(f => f.following_id === currentUser.id).length;
  const badgeEl = $("inboxNavBadge");
  if (badgeEl) {
    badgeEl.hidden = actCount === 0;
    badgeEl.textContent = actCount > 99 ? "99+" : String(actCount);
  }

  const actRow = document.createElement("button"); actRow.type = "button"; actRow.className = "inbox-row";
  actRow.innerHTML = `
    <div class="inbox-row-main">
      <div class="inbox-avatar"><div class="inbox-avatar-inner pink-sys">⚡</div></div>
      <div class="inbox-row-text"><strong>النشاط والمتابعون الجدد</strong><small>الإعجابات والمتابعات على منشوراتك</small></div>
    </div>
    <div class="inbox-row-side">${actCount ? `<span class="inbox-badge-red">${actCount}</span>` : ""}<span>‹</span></div>`;
  actRow.addEventListener("click", () => openFollowsModal("followers"));
  list.appendChild(actRow);

  const pubRow = document.createElement("button"); pubRow.type = "button"; pubRow.className = "inbox-row";
  const lastPub = allMessagesCache.find(m => m.receiver_id === null);
  pubRow.innerHTML = `
    <div class="inbox-row-main">
      <div class="inbox-avatar"><div class="inbox-avatar-inner pub-sys">🌐</div></div>
      <div class="inbox-row-text"><strong>شات الأصدقاء العام</strong><small>${lastPub ? formatMsgPreview(lastPub) : "محادثة مفتوحة للجميع"}</small></div>
    </div>
    <div class="inbox-row-side"><span>📷</span></div>`;
  pubRow.addEventListener("click", () => openPrivateChat(null));
  list.appendChild(pubRow);

  const others = Object.values(profilesMap).filter(p => p.id !== currentUser.id);
  const lastMap = {};
  allMessagesCache.forEach(m => {
    if (m.receiver_id === null) return;
    const otherId = m.sender_id === currentUser.id ? m.receiver_id : m.sender_id;
    if (!lastMap[otherId]) lastMap[otherId] = m;
  });
  others.sort((a, b) => {
    const aLive = liveRoomsCache.some(r => r.host_id === a.id) ? 1 : 0;
    const bLive = liveRoomsCache.some(r => r.host_id === b.id) ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    const ta = lastMap[a.id]?.created_at ? new Date(lastMap[a.id].created_at).getTime() : 0;
    const tb = lastMap[b.id]?.created_at ? new Date(lastMap[b.id].created_at).getTime() : 0;
    return tb - ta;
  });

  others.forEach(friend => {
    const last = lastMap[friend.id];
    const liveRoom = liveRoomsCache.find(r => r.host_id === friend.id);
    const isOn = onlineUserIds.has(friend.id);

    const row = document.createElement("div"); row.className = "inbox-row";
    const main = document.createElement("div"); main.className = "inbox-row-main";

    const av = document.createElement("div");
    av.className = "inbox-avatar " + (liveRoom ? "has-live" : (isOn ? "has-online" : ""));
    const avIn = document.createElement("div"); avIn.className = "inbox-avatar-inner";
    setAvatarContent(avIn, friend.avatar_url, friend.username);
    av.appendChild(avIn);
    if (liveRoom) {
      const wv = document.createElement("span"); wv.className = "live-wave-badge"; wv.textContent = "|ı|";
      av.appendChild(wv);
      av.addEventListener("click", e => { e.stopPropagation(); tryEnterLiveRoom(liveRoom); });
    } else {
      if (isOn) { const dot = document.createElement("span"); dot.className = "online-dot-badge"; av.appendChild(dot); }
      av.addEventListener("click", e => { e.stopPropagation(); openUserProfile(friend.id); });
    }

    const txt = document.createElement("div"); txt.className = "inbox-row-text";
    const st = document.createElement("strong"); st.textContent = friend.username;
    const sm = document.createElement("small");
    if (liveRoom) sm.textContent = "في بث مباشر الآن — اضغط الصورة للدخول";
    else if (last) sm.textContent = (last.sender_id === currentUser.id ? "تم الإرسال" : formatMsgPreview(last)) + " • " + formatRelTime(last.created_at);
    else sm.textContent = "قل مرحبًا لـ " + friend.username;

    txt.append(st, sm);
    main.append(av, txt);
    const side = document.createElement("div"); side.className = "inbox-row-side";
    side.innerHTML = `<span>📷</span>`;
    row.append(main, side);
    row.addEventListener("click", () => openPrivateChat(friend.id));
    list.appendChild(row);
  });
}
function formatMsgPreview(msg) {
  const p = parseMsgPayload(msg.content);
  if (p.kind === "image") return "📷 صورة";
  if (p.kind === "voice") return "🎙️ رسالة صوتية";
  if (p.kind === "share") return "🎬 مشاركة منشور";
  if (p.kind === "live") return "🔴 دعوة لبث مباشر";
  return p.text || "";
}

function openPrivateChat(targetUserId) {
  if (!currentUser) return;
  activeChatUserId = targetUserId;
  if (targetUserId === null) {
    $("chatHeaderName").textContent = "شات الأصدقاء العام";
    $("chatHeaderSub").textContent = "مفتوح لجميع الأعضاء";
    setAvatarContent($("chatHeaderAvatar"), null, "العام");
  } else {
    const f = profilesMap[targetUserId] || {};
    const live = liveRoomsCache.find(r => r.host_id === targetUserId);
    $("chatHeaderName").textContent = f.username || "صديق";
    $("chatHeaderSub").textContent = live ? "🔴 في بث مباشر الآن" : (onlineUserIds.has(targetUserId) ? "🟢 نشط الآن" : (f.country || "غير متصل"));
    setAvatarContent($("chatHeaderAvatar"), f.avatar_url, f.username);
  }
  $("chatEmojiBar").hidden = true;
  $("chatVoiceBar").hidden = true;
  $("chatSendBtn").hidden = $("chatInput").value.trim().length === 0;
  $("dzChatRoom").hidden = false;
  loadMessages();
}

function closePrivateChat() {
  stopVoiceRecorder(false);
  activeChatUserId = "__none__";
  $("dzChatRoom").hidden = true;
}

$("chatBackBtn").addEventListener("click", closePrivateChat);
$("chatHeaderAvatar").addEventListener("click", () => { if (activeChatUserId && activeChatUserId !== "__none__") openUserProfile(activeChatUserId); });
$("chatHeaderUserMeta").addEventListener("click", () => { if (activeChatUserId && activeChatUserId !== "__none__") openUserProfile(activeChatUserId); });
$("chatCallBtn").addEventListener("click", () => {
  const live = activeChatUserId && liveRoomsCache.find(r => r.host_id === activeChatUserId);
  if (live) { closePrivateChat(); tryEnterLiveRoom(live); }
  else { closePrivateChat(); $("dzLiveSetupModal").hidden = false; }
});
$("chatMoreBtn").addEventListener("click", () => showToast("اضغط على أي رسالة للتفاعل ❤️ أو الإلغاء"));

$("chatInput").addEventListener("input", () => { $("chatSendBtn").hidden = $("chatInput").value.trim().length === 0; });
$("chatEmojiBtn").addEventListener("click", () => { $("chatEmojiBar").hidden = !$("chatEmojiBar").hidden; });
$("chatEmojiBar").addEventListener("click", e => {
  const btn = e.target.closest(".dm-emoji-item");
  if (!btn) return;
  $("chatInput").value += btn.textContent;
  $("chatSendBtn").hidden = false;
  $("chatInput").focus();
});

$("chatQuickBar").addEventListener("click", async e => {
  const chip = e.target.closest(".dm-quick-chip");
  if (!chip || activeChatUserId === "__none__") return;
  const q = chip.dataset.quick;
  if (q === "heart") await sendRawMessage("❤️");
  else if (q === "share") {
    if (videosCache.length) { activeSharePost = videosCache[0]; await sendPostToChat(activeChatUserId); }
    else showToast("لا توجد منشورات للمشاركة بعد");
  } else if (q === "reply") {
    const replies = ["السلام عليكم، واش راك؟ 🇩🇿", "الله يحفظك خويا العزيز ❤️", "راني داخل للبث الآن 🔥"];
    $("chatInput").value = replies[Math.floor(Math.random() * replies.length)];
    $("chatSendBtn").hidden = false; $("chatInput").focus();
  }
});

$("chatGalleryBtn").addEventListener("click", () => $("chatImgInput").click());
$("chatCamBtn").addEventListener("click", () => $("chatCamInput").click());

async function handleChatImageUpload(e) {
  const file = e.target.files[0];
  if (!file || !currentUser || activeChatUserId === "__none__") return;
  showToast("جارٍ إرسال الصورة...");
  try {
    const ext = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${currentUser.id}/chat_${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type || "image/jpeg" });
    if (upErr) throw upErr;
    const url = db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    await sendRawMessage(JSON.stringify({ dz_img: true, url }));
  } catch (err) { showToast("فشل إرسال الصورة: " + err.message); }
  e.target.value = "";
}
$("chatImgInput").addEventListener("change", handleChatImageUpload);
$("chatCamInput").addEventListener("change", handleChatImageUpload);

$("chatMicBtn").addEventListener("click", async () => {
  if (activeChatUserId === "__none__" || !currentUser) return;
  if (voiceRecorder && voiceRecorder.state === "recording") return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    voiceSeconds = 0;
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
    voiceMimeType = candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
    voiceRecorder = voiceMimeType ? new MediaRecorder(stream, { mimeType: voiceMimeType }) : new MediaRecorder(stream);
    voiceRecorder.ondataavailable = ev => { if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data); };
    voiceRecorder.start(250);
    $("chatVoiceTimer").textContent = "00:00";
    $("chatVoiceBar").hidden = false;
    voiceTimerInt = setInterval(() => {
      voiceSeconds++;
      const mm = String(Math.floor(voiceSeconds / 60)).padStart(2, "0");
      const ss = String(voiceSeconds % 60).padStart(2, "0");
      $("chatVoiceTimer").textContent = `${mm}:${ss}`;
    }, 1000);
  } catch (err) {
    showToast("تعذر فتح الميكروفون: " + (err.message || "تحقق من الإذن"));
  }
});

async function uploadVoiceWithFallback(chunks, primaryMime) {
  const base = (primaryMime || "audio/webm").split(";")[0];
  const attempts = [];
  if (base.includes("mp4")) {
    attempts.push({ mime: "audio/mp4", ext: "m4a" });
    attempts.push({ mime: "video/mp4", ext: "mp4" });
  } else if (base.includes("ogg")) {
    attempts.push({ mime: "audio/ogg", ext: "ogg" });
    attempts.push({ mime: "audio/webm", ext: "webm" });
    attempts.push({ mime: "video/webm", ext: "webm" });
  } else {
    attempts.push({ mime: "audio/webm", ext: "webm" });
    attempts.push({ mime: "video/webm", ext: "webm" });
  }
  attempts.push({ mime: "application/octet-stream", ext: "bin" });

  let lastErr = null;
  for (const att of attempts) {
    const freshBlob = new Blob(chunks, { type: att.mime });
    const path = `${currentUser.id}/voice_${Date.now()}_${Math.floor(Math.random() * 1000)}.${att.ext}`;
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, freshBlob, { contentType: att.mime });
    if (!error) {
      return db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    }
    lastErr = error;
    if (!/mime/i.test(error.message || "")) break;
  }
  throw lastErr || new Error("تعذر رفع الصوت");
}

function stopVoiceRecorder(send) {
  clearInterval(voiceTimerInt);
  const finalDur = $("chatVoiceTimer") ? $("chatVoiceTimer").textContent : "00:01";
  if ($("chatVoiceBar")) $("chatVoiceBar").hidden = true;
  if (!voiceRecorder) return;
  const rec = voiceRecorder;
  const targetChatId = activeChatUserId;
  voiceRecorder = null;

  rec.onstop = async () => {
    try { rec.stream.getTracks().forEach(t => t.stop()); } catch {}
    if (!send || !currentUser || targetChatId === "__none__") return;
    if (!voiceChunks.length) { showToast("التسجيل قصير جداً، حاول التحدث أطول قليلاً"); return; }

    const rawMime = rec.mimeType || voiceMimeType || "audio/webm";
    showToast("جارٍ إرسال الرسالة الصوتية...");
    try {
      const url = await uploadVoiceWithFallback(voiceChunks, rawMime);
      const { error: msgErr } = await db.from("messages").insert({
        sender_id: currentUser.id,
        receiver_id: targetChatId,
        content: JSON.stringify({ dz_voice: true, url, dur: finalDur })
      });
      if (msgErr) throw msgErr;
      if (activeChatUserId === targetChatId) await loadMessages();
      refreshAllData(false);
    } catch (err) {
      const msg = err.message || String(err);
      if (/mime/i.test(msg)) {
        alert("مخزن Supabase (dz-chat-media) يرفض ملفات الصوت حالياً.\nافتح Storage -> dz-chat-media -> Edit bucket وامسح قيود Allowed MIME types.");
      } else {
        alert("فشل إرسال الرسالة الصوتية:\n" + msg);
      }
    }
  };
  try {
    if (rec.state === "recording" && rec.requestData) rec.requestData();
    if (rec.state !== "inactive") rec.stop();
  } catch {}
}
$("chatVoiceCancelBtn").addEventListener("click", () => stopVoiceRecorder(false));
$("chatVoiceSendBtn").addEventListener("click", () => stopVoiceRecorder(true));

async function sendRawMessage(content) {
  if (!currentUser || activeChatUserId === "__none__") return;
  const targetId = activeChatUserId;
  const { error } = await db.from("messages").insert({ sender_id: currentUser.id, receiver_id: targetId, content });
  if (error) {
    if (targetId === null && /null|policy|violates/i.test(error.message || "")) {
      alert("تعذر الإرسال في الشات العام بسبب قيود جدول messages في Supabase:\n" + error.message);
    } else {
      showToast("فشل الإرسال: " + error.message);
    }
  } else {
    await loadMessages();
    refreshAllData(false);
  }
}

$("chatForm").addEventListener("submit", async e => {
  e.preventDefault();
  const content = $("chatInput").value.trim();
  if (!content) return;
  $("chatInput").value = ""; $("chatSendBtn").hidden = true;
  await sendRawMessage(content);
});

async function loadMessages() {
  if (!currentUser || activeChatUserId === "__none__") return;
  const requestedChatId = activeChatUserId;
  const box = $("chatMessages");
  let query = db.from("messages").select("*").order("created_at", { ascending: true }).limit(100);
  if (requestedChatId === null) query = query.is("receiver_id", null);
  else query = query.or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${requestedChatId}),and(sender_id.eq.${requestedChatId},receiver_id.eq.${currentUser.id})`);
  const { data, error } = await query;
  if (activeChatUserId !== requestedChatId) return;
  if (error) { showToast("تعذر تحميل الرسائل: " + error.message); return; }
  box.textContent = "";
  if (!data.length) { box.innerHTML = `<div class="dm-sys-notice">لا توجد رسائل بعد. قل مرحباً! 👋</div>`; return; }

  data.forEach(m => {
    const isMine = m.sender_id === currentUser.id;
    const row = document.createElement("div");
    row.className = "dm-row " + (isMine ? "mine" : "theirs");

    if (!isMine) {
      const av = document.createElement("div"); av.className = "dm-mini-av";
      setAvatarContent(av, profilesMap[m.sender_id]?.avatar_url, "صديق");
      av.addEventListener("click", () => openUserProfile(m.sender_id));
      row.appendChild(av);
    }

    const wrap = document.createElement("div"); wrap.className = "dm-bubble-wrap";
    const parsed = parseMsgPayload(m.content);

    if (requestedChatId === null && !isMine && parsed.kind !== "text") {
      const tag = document.createElement("span"); tag.className = "dm-sender-tag";
      tag.textContent = "@" + (profilesMap[m.sender_id]?.username || "عضو");
      wrap.appendChild(tag);
    }

    if (parsed.kind === "live") {
      const card = document.createElement("div"); card.className = "dm-live-invite";
      const t = document.createElement("strong"); t.textContent = `🔴 دعوة لبث @${parsed.hostName}`;
      const sub = document.createElement("small"); sub.textContent = parsed.title || "بث مباشر الآن";
      const joinBtn = document.createElement("button"); joinBtn.type = "button"; joinBtn.textContent = "دخول البث الآن";
      joinBtn.addEventListener("click", async () => {
        const found = liveRoomsCache.find(r => r.id === parsed.roomId);
        if (found) { closePrivateChat(); tryEnterLiveRoom(found); return; }
        const { data: rData } = await db.from("live_rooms").select("*").eq("id", parsed.roomId).eq("is_active", true).maybeSingle();
        if (rData) { closePrivateChat(); tryEnterLiveRoom(rData); } else showToast("هذا البث المباشر قد انتهى");
      });
      card.append(t, sub, joinBtn); wrap.appendChild(card);
    } else if (parsed.kind === "share") {
      const card = document.createElement("div"); card.className = "shared-card";
      const by = document.createElement("small"); by.textContent = "📤 منشور @" + parsed.creator; card.appendChild(by);
      if (parsed.type === "image") { const img = document.createElement("img"); img.src = parsed.url; card.appendChild(img); }
      else { const vid = document.createElement("video"); vid.src = parsed.url; vid.controls = true; vid.playsInline = true; card.appendChild(vid); }
      if (parsed.caption) { const cap = document.createElement("p"); cap.textContent = parsed.caption; card.appendChild(cap); }
      wrap.appendChild(card);
    } else if (parsed.kind === "image") {
      const img = document.createElement("img"); img.className = "dm-img-msg"; img.src = parsed.url; wrap.appendChild(img);
    } else if (parsed.kind === "voice") {
      const bubble = document.createElement("div"); bubble.className = "dm-bubble";
      const aud = document.createElement("audio"); aud.className = "dm-audio-msg"; aud.controls = true; aud.preload = "metadata"; aud.src = parsed.url;
      bubble.appendChild(aud); wrap.appendChild(bubble);
    } else {
      const bubble = document.createElement("div"); bubble.className = "dm-bubble";
      if (requestedChatId === null && !isMine) {
        const tag = document.createElement("span"); tag.className = "dm-sender-tag";
        tag.textContent = "@" + (profilesMap[m.sender_id]?.username || "عضو"); bubble.appendChild(tag);
      }
      const span = document.createElement("span"); span.textContent = parsed.text;
      bubble.appendChild(span); wrap.appendChild(bubble);
    }

    if (parsed.react) { const rp = document.createElement("span"); rp.className = "dm-react-pill"; rp.textContent = parsed.react; wrap.appendChild(rp); }

    const actions = document.createElement("div"); actions.className = "dm-bubble-actions"; actions.hidden = true;
    const heartBtn = document.createElement("button"); heartBtn.type = "button"; heartBtn.textContent = "❤️ تفاعل";
    heartBtn.addEventListener("click", async () => {
      const nextReact = parsed.react === "❤️" ? "" : "❤️";
      let updatedContent;
      if (parsed.kind === "text") updatedContent = JSON.stringify({ dz_txt: true, text: parsed.text, react: nextReact });
      else if (parsed.kind === "image") updatedContent = JSON.stringify({ dz_img: true, url: parsed.url, react: nextReact });
      else if (parsed.kind === "voice") updatedContent = JSON.stringify({ dz_voice: true, url: parsed.url, dur: parsed.dur, react: nextReact });
      else return;
      const { error: uErr } = await db.from("messages").update({ content: updatedContent }).eq("id", m.id);
      if (uErr) showToast("لتفعيل التفاعل فعّل UPDATE لجدول messages");
      else await loadMessages();
    });
    actions.appendChild(heartBtn);

    if (isMine) {
      const unsendBtn = document.createElement("button"); unsendBtn.type = "button"; unsendBtn.textContent = "🗑️ إلغاء الإرسال";
      unsendBtn.addEventListener("click", async () => {
        const { error: dErr } = await db.from("messages").delete().eq("id", m.id);
        if (dErr) showToast("لتفعيل الإلغاء فعّل DELETE لجدول messages");
        else await loadMessages();
      });
      actions.appendChild(unsendBtn);
    }
    wrap.appendChild(actions);
    wrap.addEventListener("click", ev => {
      if (ev.target.tagName === "BUTTON" || ev.target.tagName === "AUDIO") return;
      actions.hidden = !actions.hidden;
    });
    row.appendChild(wrap);
    box.appendChild(row);
  });
  box.scrollTop = box.scrollHeight;
}

function subscribeRealtimeAll() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db.channel("dz-chat-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, async payload => {
      const msg = payload.new;
      if (!currentUser) return;
      if (msg && msg.sender_id && !profilesMap[msg.sender_id]) {
        const { data } = await db.from("profiles").select("*").eq("id", msg.sender_id).maybeSingle();
        if (data) profilesMap[data.id] = data;
      }
      await refreshAllData(false);
      if (activeChatUserId !== "__none__") await loadMessages();
      else if (payload.eventType === "INSERT" && msg && msg.sender_id && msg.sender_id !== currentUser.id) {
        showToast(`رسالة جديدة من @${profilesMap[msg.sender_id]?.username || "صديق"} 💬`);
      }
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
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "videos" }, async () => { await refreshAllData(true); })
    .on("postgres_changes", { event: "*", schema: "public", table: "live_rooms" }, async () => {
      const { data } = await db.from("live_rooms").select("*").eq("is_active", true).order("created_at", { ascending: false });
      liveRoomsCache = data || [];
      renderLiveRoomsStrip();
      renderInbox();
      renderFriendsFeed();
      if (!$("dzUserProfileModal").hidden && viewedUserProfileId) renderViewedUserProfile();
    })
    .subscribe();
}

function openSearchModal() {
  $("dzSearchModal").hidden = false;
  renderDiscoverSearch();
  $("searchInput").focus();
}
$("searchBtn").addEventListener("click", openSearchModal);
$("friendsSearchOpenBtn").addEventListener("click", openSearchModal);
$("searchCloseBtn").addEventListener("click", () => { $("dzSearchModal").hidden = true; });

function renderDiscoverSearch() {
  const q = $("searchInput").value.trim().toLowerCase();
  const container = $("discoverResults"); container.textContent = "";
  const matchedUsers = Object.values(profilesMap).filter(p => currentUser && p.id !== currentUser.id && (p.username || "").toLowerCase().includes(q));
  const matchedVideos = videosCache.filter(v => (profilesMap[v.user_id]?.username || "").toLowerCase().includes(q) || (v.caption || "").toLowerCase().includes(q));
  if (!matchedUsers.length && !matchedVideos.length) {
    container.innerHTML = `<div class="discover-box"><div>🇩🇿</div><h3>لا توجد نتائج</h3></div>`;
    return;
  }
  matchedUsers.forEach(user => {
    const row = document.createElement("div"); row.className = "discover-item";
    const info = document.createElement("div"); info.style.cursor = "pointer"; info.style.flex = "1";
    info.innerHTML = `<strong></strong><small></small>`;
    info.querySelector("strong").textContent = "@" + user.username;
    info.querySelector("small").textContent = user.country || "الجزائر";
    info.addEventListener("click", () => { $("dzSearchModal").hidden = true; openUserProfile(user.id); });
    const chatBtn = document.createElement("button"); chatBtn.type = "button"; chatBtn.className = "play-mini-btn"; chatBtn.textContent = "مراسلة 💬";
    chatBtn.addEventListener("click", () => { $("dzSearchModal").hidden = true; openPrivateChat(user.id); });
    row.append(info, chatBtn); container.appendChild(row);
  });
  matchedVideos.forEach(post => {
    const uname = profilesMap[post.user_id]?.username || "user";
    const row = document.createElement("div"); row.className = "discover-item";
    const info = document.createElement("div");
    const st = document.createElement("strong"); st.textContent = `${isImagePost(post) ? "🖼️" : "🎬"} @${uname}`;
    const sm = document.createElement("small"); sm.textContent = post.caption;
    info.append(st, sm);
    const playBtn = document.createElement("button"); playBtn.type = "button"; playBtn.className = "play-mini-btn"; playBtn.textContent = "مشاهدة";
    playBtn.addEventListener("click", () => {
      $("dzSearchModal").hidden = true;
      switchPage("homePage");
      const t = $("videoFeed").querySelector(`[data-video-id="${post.id}"]`);
      if (t) t.scrollIntoView({ behavior: "smooth" });
    });
    row.append(info, playBtn); container.appendChild(row);
  });
}
$("searchInput").addEventListener("input", renderDiscoverSearch);

function openUserProfile(userId) {
  if (!currentUser || !userId) return;
  if (userId === currentUser.id) {
    closePrivateChat();
    switchPage("profilePage");
    return;
  }
  viewedUserProfileId = userId;
  viewedUserProfileTab = "posts";
  $("userProfTabs").querySelectorAll(".profile-tab").forEach(t => t.classList.toggle("active", t.dataset.utab === "posts"));
  renderViewedUserProfile();
  $("dzUserProfileModal").hidden = false;
}

function closeUserProfile() {
  viewedUserProfileId = null;
  $("dzUserProfileModal").hidden = true;
}
$("userProfBackBtn").addEventListener("click", closeUserProfile);
$("userProfBellBtn").addEventListener("click", () => showToast("تم تفعيل إشعارات هذا الحساب 🔔"));
$("userProfShareBtn").addEventListener("click", async () => {
  const u = profilesMap[viewedUserProfileId];
  try { await navigator.clipboard.writeText("@" + (u?.username || "user")); } catch {}
  showToast("تم نسخ اسم الحساب ↪️");
});

$("userProfTabs").addEventListener("click", e => {
  const btn = e.target.closest(".profile-tab");
  if (!btn) return;
  viewedUserProfileTab = btn.dataset.utab;
  $("userProfTabs").querySelectorAll(".profile-tab").forEach(t => t.classList.toggle("active", t === btn));
  renderViewedUserProfile();
});

function renderViewedUserProfile() {
  if (!currentUser || !viewedUserProfileId) return;
  const u = profilesMap[viewedUserProfileId] || { id: viewedUserProfileId, username: "عضو" };
  const liveRoom = liveRoomsCache.find(r => r.host_id === viewedUserProfileId);

  $("userProfDisplayName").textContent = u.username || "عضو";
  $("userProfHandle").textContent = "@" + (u.username || "user");
  $("userProfBio").textContent = u.bio || "";
  $("userProfCountry").textContent = u.country ? "📍 " + u.country : "";
  setAvatarContent($("userProfAvatar"), u.avatar_url, u.username);

  const ring = $("userProfAvatarWrap");
  ring.classList.toggle("is-live", !!liveRoom);
  $("userProfLiveBadge").hidden = !liveRoom;
  ring.onclick = liveRoom ? () => { closeUserProfile(); tryEnterLiveRoom(liveRoom); } : null;

  const theirPosts = videosCache.filter(v => v.user_id === viewedUserProfileId);
  const theirPostIds = new Set(theirPosts.map(v => v.id));
  $("userProfFollowingCount").textContent = formatCount(followsCache.filter(f => f.follower_id === viewedUserProfileId).length);
  $("userProfFollowersCount").textContent = formatCount(followsCache.filter(f => f.following_id === viewedUserProfileId).length);
  $("userProfLikesCount").textContent = formatCount(likesCache.filter(l => theirPostIds.has(l.video_id)).length);

  const iFollow = followsCache.some(f => f.follower_id === currentUser.id && f.following_id === viewedUserProfileId);
  const followsMe = followsCache.some(f => f.follower_id === viewedUserProfileId && f.following_id === currentUser.id);

  const actRow = $("userProfActionsRow");
  actRow.textContent = "";

  if (!iFollow) {
    const fBtn = document.createElement("button"); fBtn.type = "button"; fBtn.className = "uprof-btn-main"; fBtn.textContent = "متابعة";
    fBtn.addEventListener("click", () => toggleFollow(viewedUserProfileId));
    const msgBtn = document.createElement("button"); msgBtn.type = "button"; msgBtn.className = "uprof-btn-sq"; msgBtn.textContent = "💬";
    msgBtn.addEventListener("click", () => { const id = viewedUserProfileId; closeUserProfile(); openPrivateChat(id); });
    const sugBtn = document.createElement("button"); sugBtn.type = "button"; sugBtn.className = "uprof-btn-sq"; sugBtn.textContent = "👤＋";
    sugBtn.addEventListener("click", () => { closeUserProfile(); openFollowsModal("suggested"); });
    actRow.append(fBtn, msgBtn, sugBtn);
  } else {
    const msgBtn = document.createElement("button"); msgBtn.type = "button"; msgBtn.className = "uprof-btn-gray"; msgBtn.textContent = "مراسلة";
    msgBtn.addEventListener("click", () => { const id = viewedUserProfileId; closeUserProfile(); openPrivateChat(id); });
    const fBtn = document.createElement("button"); fBtn.type = "button"; fBtn.className = "uprof-btn-gray";
    fBtn.textContent = (followsMe ? "الأصدقاء" : "أتابعه") + " ▾";
    fBtn.addEventListener("click", () => {
      if (confirm(`هل تريد إلغاء متابعة @${u.username}؟`)) toggleFollow(viewedUserProfileId);
    });
    const sugBtn = document.createElement("button"); sugBtn.type = "button"; sugBtn.className = "uprof-btn-sq"; sugBtn.textContent = "👤＋";
    sugBtn.addEventListener("click", () => { closeUserProfile(); openFollowsModal("suggested"); });
    actRow.append(msgBtn, fBtn, sugBtn);
  }

  let items = theirPosts;
  if (viewedUserProfileTab === "likes") {
    const likedSet = new Set(likesCache.filter(l => l.user_id === viewedUserProfileId).map(l => l.video_id));
    items = videosCache.filter(v => likedSet.has(v.id));
  }

  const grid = $("userProfGrid"); grid.textContent = "";
  if (!items.length) { grid.innerHTML = `<div class="grid-empty">لا توجد منشورات هنا.</div>`; return; }

  items.forEach(post => {
    const tile = document.createElement("div"); tile.className = "grid-post-tile";
    if (isImagePost(post)) { const img = document.createElement("img"); img.src = post.video_url; tile.appendChild(img); }
    else { const vid = document.createElement("video"); vid.src = post.video_url; vid.muted = true; vid.playsInline = true; vid.preload = "metadata"; tile.appendChild(vid); }
    const meta = document.createElement("div"); meta.className = "grid-post-meta";
    meta.textContent = `▷ ${likesCache.filter(l => l.video_id === post.id).length}`;
    tile.appendChild(meta);
    tile.addEventListener("click", () => {
      closeUserProfile();
      switchPage("homePage");
      setTimeout(() => { const t = $("videoFeed").querySelector(`[data-video-id="${post.id}"]`); if (t) t.scrollIntoView({ behavior: "smooth" }); }, 60);
    });
    grid.appendChild(tile);
  });
}

function renderProfile() {
  if (!currentUser) return;
  const p = currentProfile || {};
  const username = (p.username || currentUser.email.split("@")[0]).replace(/^@/, "");
  $("profileDisplayName").textContent = username;
  $("profileName").textContent = "@" + username;
  $("profileBio").textContent = p.bio ? p.bio : "＋ إضافة سيرة ذاتية";
  $("profileCountry").textContent = p.country ? "📍 " + p.country : "";
  $("profileThoughtText").textContent = getUserThought() || "ماذا يدور في ذهنك؟";
  setAvatarContent($("profileAvatar"), p.avatar_url, "الصورة الشخصية");

  const myPosts = videosCache.filter(v => v.user_id === currentUser.id);
  const myPostIds = new Set(myPosts.map(v => v.id));
  $("statFollowers").textContent = formatCount(followsCache.filter(f => f.following_id === currentUser.id).length);
  $("statFollowing").textContent = formatCount(followsCache.filter(f => f.follower_id === currentUser.id).length);
  $("statLikes").textContent = formatCount(likesCache.filter(l => myPostIds.has(l.video_id)).length);

  let items = [];
  if (activeProfileTab === "posts") items = myPosts;
  else if (activeProfileTab === "saved") { const s = new Set(getSavedPostIds()); items = videosCache.filter(v => s.has(v.id)); }
  else { const l = new Set(likesCache.filter(x => x.user_id === currentUser.id).map(x => x.video_id)); items = videosCache.filter(v => l.has(v.id)); }

  const grid = $("myVideosList"); grid.textContent = "";
  if (!items.length) {
    const msg = activeProfileTab === "posts" ? "لم تنشر أي صورة أو فيديو بعد." : (activeProfileTab === "saved" ? "لا توجد منشورات محفوظة بعد." : "لم تعجب بأي منشور بعد.");
    grid.innerHTML = `<div class="grid-empty">${msg}</div>`;
    return;
  }
  items.forEach(post => {
    const tile = document.createElement("div"); tile.className = "grid-post-tile";
    if (isImagePost(post)) { const img = document.createElement("img"); img.src = post.video_url; tile.appendChild(img); }
    else { const vid = document.createElement("video"); vid.src = post.video_url; vid.muted = true; vid.playsInline = true; vid.preload = "metadata"; tile.appendChild(vid); }
    const meta = document.createElement("div"); meta.className = "grid-post-meta";
    meta.textContent = `▷ ${likesCache.filter(l => l.video_id === post.id).length}`;
    tile.appendChild(meta);
    tile.addEventListener("click", () => {
      switchPage("homePage");
      setTimeout(() => { const t = $("videoFeed").querySelector(`[data-video-id="${post.id}"]`); if (t) t.scrollIntoView({ behavior: "smooth" }); }, 60);
    });
    grid.appendChild(tile);
  });
}

document.querySelectorAll("#profilePage .profile-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    activeProfileTab = tab.dataset.tab;
    document.querySelectorAll("#profilePage .profile-tab").forEach(t => t.classList.toggle("active", t === tab));
    renderProfile();
  });
});

$("profileThoughtBubble").addEventListener("click", () => { $("dzThoughtInput").value = getUserThought(); $("dzThoughtModal").hidden = false; });
$("dzCloseThoughtBtn").addEventListener("click", () => { $("dzThoughtModal").hidden = true; });
$("dzSaveThoughtBtn").addEventListener("click", () => { setUserThought($("dzThoughtInput").value); $("dzThoughtModal").hidden = true; renderProfile(); renderInbox(); showToast("تم حفظ حالتك 💭"); });

$("profileMenuBtn").addEventListener("click", () => { $("dzProfileMenuModal").hidden = false; });
$("dzCloseProfileMenu").addEventListener("click", () => { $("dzProfileMenuModal").hidden = true; });
$("menuEditProfileBtn").addEventListener("click", () => { $("dzProfileMenuModal").hidden = true; openEditProfileModal(); });
$("menuCreateBtn").addEventListener("click", () => { $("dzProfileMenuModal").hidden = true; $("dzCreateChoiceModal").hidden = false; });
$("menuLogoutBtn").addEventListener("click", async () => {
  $("dzProfileMenuModal").hidden = true;
  if (!confirm("هل تريد تسجيل الخروج؟")) return;
  leaveLiveRoom(true); await db.auth.signOut(); showAuth(); showToast("تم تسجيل الخروج");
});

$("profileAddFriendBtn").addEventListener("click", () => openFollowsModal("suggested"));
$("profileTopEditBtn").addEventListener("click", openEditProfileModal);
$("profilePlusBtn").addEventListener("click", openEditProfileModal);
$("profileBioBtn").addEventListener("click", openEditProfileModal);
$("statFollowingBtn").addEventListener("click", () => openFollowsModal("following"));
$("statFollowersBtn").addEventListener("click", () => openFollowsModal("followers"));

function openFollowsModal(tab = "following") {
  if (!currentUser) return;
  activeFollowsTab = tab;
  $("followsHeaderUsername").textContent = currentProfile?.username || "حسابي";
  $("followsSearchInput").value = "";
  $("followsTabs").querySelectorAll(".follows-tab").forEach(b => b.classList.toggle("active", b.dataset.ftab === tab));
  renderFollowsList();
  $("dzFollowsModal").hidden = false;
}
$("followsBackBtn").addEventListener("click", () => { $("dzFollowsModal").hidden = true; });
$("followsAddFriendBtn").addEventListener("click", () => { $("dzFollowsModal").hidden = true; openSearchModal(); });
$("followsSearchInput").addEventListener("input", renderFollowsList);
$("followsTabs").addEventListener("click", e => {
  const btn = e.target.closest(".follows-tab");
  if (!btn) return;
  activeFollowsTab = btn.dataset.ftab;
  $("followsTabs").querySelectorAll(".follows-tab").forEach(b => b.classList.toggle("active", b === btn));
  renderFollowsList();
});

function renderFollowsList() {
  if (!currentUser) return;
  const followingSet = new Set(followsCache.filter(f => f.follower_id === currentUser.id).map(f => f.following_id));
  const followersSet = new Set(followsCache.filter(f => f.following_id === currentUser.id).map(f => f.follower_id));
  const friendsIds = [...followingSet].filter(id => followersSet.has(id));

  $("ftabFollowingCount").textContent = followingSet.size;
  $("ftabFollowersCount").textContent = followersSet.size;
  $("ftabFriendsCount").textContent = friendsIds.length;

  let userIds = [];
  if (activeFollowsTab === "following") userIds = [...followingSet];
  else if (activeFollowsTab === "followers") userIds = [...followersSet];
  else if (activeFollowsTab === "friends") userIds = friendsIds;
  else userIds = Object.keys(profilesMap).filter(id => id !== currentUser.id && !followingSet.has(id));

  const q = $("followsSearchInput").value.trim().toLowerCase();
  const users = userIds.map(id => profilesMap[id]).filter(u => u && (u.username || "").toLowerCase().includes(q));

  const list = $("followsList"); list.textContent = "";
  if (!users.length) { list.innerHTML = `<p style="text-align:center;color:#6b7280;font-size:13px;padding:30px 0">لا يوجد أعضاء في هذه القائمة.</p>`; return; }

  users.forEach(u => {
    const isFollowing = followingSet.has(u.id);
    const isMutual = isFollowing && followersSet.has(u.id);
    const liveRoom = liveRoomsCache.find(r => r.host_id === u.id);

    const row = document.createElement("div"); row.className = "follow-row";
    const left = document.createElement("div"); left.className = "follow-row-user";
    const av = document.createElement("div"); av.className = "follow-row-av" + (liveRoom ? " is-live" : "");
    const avIn = document.createElement("div"); avIn.className = "follow-row-av-in";
    setAvatarContent(avIn, u.avatar_url, u.username);
    av.appendChild(avIn);
    if (liveRoom) {
      const b = document.createElement("span"); b.className = "story-live-badge"; b.textContent = "LIVE"; av.appendChild(b);
      av.addEventListener("click", e => { e.stopPropagation(); $("dzFollowsModal").hidden = true; tryEnterLiveRoom(liveRoom); });
    }
    const info = document.createElement("div"); info.className = "follow-row-info";
    const st = document.createElement("strong"); st.textContent = u.username || "عضو";
    const sm = document.createElement("small"); sm.textContent = u.bio || u.country || "DZ-CHAT";
    info.append(st, sm);
    left.append(av, info);
    left.addEventListener("click", () => { $("dzFollowsModal").hidden = true; openUserProfile(u.id); });

    const right = document.createElement("div"); right.className = "follow-row-actions";
    const fBtn = document.createElement("button"); fBtn.type = "button";
    fBtn.className = "follow-pill-btn" + (isFollowing ? "" : " to-follow");
    fBtn.textContent = isMutual ? "الأصدقاء" : (isFollowing ? "أتابعه" : "متابعة");
    fBtn.addEventListener("click", () => toggleFollow(u.id));

    const dots = document.createElement("button"); dots.type = "button"; dots.className = "follow-dots-btn"; dots.textContent = "•••";
    dots.addEventListener("click", () => { $("dzFollowsModal").hidden = true; openPrivateChat(u.id); });

    right.append(fBtn, dots);
    row.append(left, right);
    list.appendChild(row);
  });
}

function openEditProfileModal() {
  if (!currentUser) return;
  const p = currentProfile || {};
  $("dzEditUsername").value = p.username || "";
  $("dzEditBio").value = p.bio || "";
  $("dzEditCountry").value = p.country || "الجزائر";
  $("dzEditAvatar").value = "";
  $("dzProfileError").hidden = true; $("dzProfileError").textContent = "";
  setAvatarContent($("dzAvatarPreview"), p.avatar_url, "معاينة الصورة");
  $("dzProfileModal").hidden = false;
}
$("dzCloseProfile").addEventListener("click", () => { $("dzProfileModal").hidden = true; });
$("dzProfileModal").addEventListener("click", e => { if (e.target === $("dzProfileModal")) $("dzProfileModal").hidden = true; });

$("dzEditAvatar").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  if ((file.type && !file.type.startsWith("image/")) || file.size > 5 * 1024 * 1024) { showToast("اختر صورة أقل من 5 ميغابايت"); return; }
  const reader = new FileReader();
  reader.onload = () => setAvatarContent($("dzAvatarPreview"), reader.result, "معاينة");
  reader.readAsDataURL(file);
});

$("dzSaveProfile").addEventListener("click", async () => {
  if (!currentUser) return;
  const btn = $("dzSaveProfile"), errBox = $("dzProfileError");
  const username = $("dzEditUsername").value.trim().replace(/^@/, "");
  const bio = $("dzEditBio").value.trim(), country = $("dzEditCountry").value.trim(), imageFile = $("dzEditAvatar").files[0];
  errBox.hidden = true;
  if (username.length < 3) { errBox.textContent = "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"; errBox.hidden = false; return; }
  btn.disabled = true; btn.textContent = "جارٍ الحفظ...";
  try {
    let avatarUrl = currentProfile?.avatar_url || null;
    if (imageFile) {
      const ext = imageFile.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const filePath = `${currentUser.id}/avatar_${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(filePath, imageFile, { upsert: true, contentType: imageFile.type || "image/jpeg" });
      if (upErr) throw upErr;
      avatarUrl = db.storage.from(STORAGE_BUCKET).getPublicUrl(filePath).data.publicUrl;
    }
    const { data, error } = await db.from("profiles").upsert({ id: currentUser.id, username, bio, country, avatar_url: avatarUrl }, { onConflict: "id" }).select().single();
    if (error) throw error;
    currentProfile = data; profilesMap[currentUser.id] = data;
    renderProfile(); renderVideoFeed(); renderFriendsFeed(); renderInbox();
    $("dzProfileModal").hidden = true; showToast("تم حفظ التعديلات بنجاح 🇩🇿");
  } catch (err) {
    errBox.textContent = err.message || "فشل الحفظ"; errBox.hidden = false;
  } finally { btn.disabled = false; btn.textContent = "حفظ التعديلات"; }
});

attachSwipeBack($("dzChatRoom"), closePrivateChat);
attachSwipeBack($("dzFollowsModal"), () => { $("dzFollowsModal").hidden = true; });
attachSwipeBack($("dzUserProfileModal"), closeUserProfile);
attachSwipeBack($("dzSearchModal"), () => { $("dzSearchModal").hidden = true; });
attachSwipeBack($("messagesPage"), () => switchPage("homePage"));
attachSwipeBack($("profilePage"), () => switchPage("homePage"));
attachSwipeBack($("uploadPage"), () => switchPage("homePage"));
attachSwipeBack($("discoverPage"), () => switchPage("homePage"));

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
