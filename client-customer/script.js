"use strict";

const ORDER_SERVICE_URL = "https://api-order.krupukruzzz.com"; 
const WALLET_SERVICE_URL = "https://api-wallet.krupukruzzz.com";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBk3WXJYNDPAZVbscReKieiDbyPlUJxwb4",
  authDomain: "logistikkurir-77855.firebaseapp.com",
  databaseURL: "https://logistikkurir-77855-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "logistikkurir-77855",
  storageBucket: "logistikkurir-77855.firebasestorage.app",
  messagingSenderId: "7730591843",
  appId: "1:7730591843:web:870cb22c65a6e5b349a056",
  measurementId: "G-3349PF7TTT"
};

const DEMO_USER = {
  uid: "uid_customer_001",
  name: "Budi",
  role: "customer",
};

const firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
const dbRef = firebase.database();

const DEFAULT_CENTER = [-6.2088, 106.8456];
const map = L.map("map", { center: DEFAULT_CENTER, zoom: 14, zoomControl: false });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

const courierIcon = L.divIcon({
  className: "custom-marker",
  html: `<div style="background: #1D4ED8; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

let courierMarker = null;
let trackingPath = null;
const pathCoords = [];

let activeOrderId = null;
let trackingListenerOff = null;
let chatListenerOff = null;
let activeChatOrderId = null;

function switchTab(tabName) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("tab-panel--active"));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("nav-item--active"));

  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.classList.add("tab-panel--active");

  const navBtn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (navBtn) navBtn.classList.add("nav-item--active");

  if (tabName === "tracking") {
    setTimeout(() => map.invalidateSize(), 150);
  }

  if (tabName === "chat" && activeOrderId && activeChatOrderId !== activeOrderId) {
    document.getElementById("chat-order-id").value = activeOrderId;
    joinChat(activeOrderId);
  }
}

document.querySelectorAll("[data-tab]").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

const btnTrackActive = document.getElementById("btn-track-active");
if (btnTrackActive) {
  btnTrackActive.addEventListener("click", () => {
    if (activeOrderId) {
      document.getElementById("track-order-id").value = activeOrderId;
      switchTab("tracking");
      startTracking(activeOrderId);
    }
  });
}

function formatRupiah(amount) {
  return "Rp " + new Intl.NumberFormat("id-ID").format(amount);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

async function loadDashboardData() {
  try {
    listenToWalletBalance(); // Ensure we are listening for live updates
    const [userSnap, ordersSnap] = await Promise.all([
      dbRef.ref(`/users/${DEMO_USER.uid}`).once("value"),
      dbRef.ref("/orders").orderByChild("customerId").equalTo(DEMO_USER.uid).once("value"),
    ]);

    const userData = userSnap.val();
    if (userData) {
      updateWalletDisplay(userData.wallet?.balance ?? 0);
    }

    const ordersData = ordersSnap.val() || {};
    let totalOrders = 0, delivered = 0, inTransit = 0;
    let latestActive = null;

    Object.values(ordersData)
      .sort((a, b) => (b.timeline?.createdAt || 0) - (a.timeline?.createdAt || 0))
      .forEach(order => {
        totalOrders++;
        if (order.status === "delivered") delivered++;
        if (["pending", "accepted", "in_transit"].includes(order.status)) {
          if (order.status === "in_transit" || order.status === "accepted") inTransit++;
          if (!latestActive) latestActive = order;
        }
      });

    document.getElementById("stat-total-orders").textContent = totalOrders;
    document.getElementById("stat-delivered").textContent = delivered;
    document.getElementById("stat-in-transit").textContent = inTransit;

    if (latestActive) {
      activeOrderId = latestActive.orderId;
      renderActiveOrderFlow(latestActive);
      document.getElementById("active-order-card").style.display = "block";
    }
  } catch (error) {
    console.error("Dashboard error:", error);
  }
}

function updateWalletDisplay(balance) {
  const formatted = formatRupiah(balance);
  document.getElementById("nav-balance-display").textContent = formatted;
  document.getElementById("wallet-balance-display").textContent = formatted;
}

function listenToWalletBalance() {
  dbRef.ref(`/users/${DEMO_USER.uid}/wallet/balance`).on("value", snap => {
    updateWalletDisplay(snap.val() ?? 0);
  });
}

function renderActiveOrderFlow(order) {
  const container = document.getElementById("active-order-flow");
  const steps = [
    { key: "pending", label: "Dibuat", icon: "ph-receipt" },
    { key: "accepted", label: "Diterima", icon: "ph-check-circle" },
    { key: "in_transit", label: "Dikirim", icon: "ph-truck" },
    { key: "delivered", label: "Selesai", icon: "ph-flag-checkered" },
  ];

  const statusOrder = ["pending", "accepted", "in_transit", "delivered"];
  const currentIdx = statusOrder.indexOf(order.status);

  container.innerHTML = steps.map((step, i) => {
    let cls = "step-item";
    if (i <= currentIdx) cls += " done";
    if (i === currentIdx) cls = "step-item active";
    return `
      <div class="${cls}">
        <div class="step-icon"><i class="ph ${step.icon}"></i></div>
        <span class="step-label">${step.label}</span>
      </div>
    `;
  }).join("");
}

function listenToWalletBalance() {
  dbRef.ref(`/users/${DEMO_USER.uid}/wallet/balance`).on("value", snap => {
    updateWalletDisplay(snap.val() ?? 0);
  });
}

document.getElementById("order-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById("btn-submit-order");
  const btnText = submitBtn.querySelector(".btn-text");

  const payload = {
    customerId: DEMO_USER.uid,
    pickup: {
      address: document.getElementById("pickup-address").value,
      contactName: document.getElementById("pickup-contact").value,
      contactPhone: document.getElementById("pickup-phone").value,
      lat: -6.2088 + (Math.random() * 0.02 - 0.01),
      lng: 106.8456 + (Math.random() * 0.02 - 0.01),
    },
    destination: {
      address: document.getElementById("dest-address").value,
      contactName: document.getElementById("dest-contact").value,
      contactPhone: document.getElementById("dest-phone").value,
      lat: -6.1930 + (Math.random() * 0.02 - 0.01),
      lng: 106.8235 + (Math.random() * 0.02 - 0.01),
    },
    package: {
      description: document.getElementById("pkg-desc").value,
      weight: parseFloat(document.getElementById("pkg-weight").value) || 1,
      category: document.getElementById("pkg-category").value,
    },
    note: document.getElementById("order-note").value,
  };

  submitBtn.disabled = true;
  btnText.textContent = "Memproses...";

  try {
    const res = await fetch(`${ORDER_SERVICE_URL}/api/create-order`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      showToast("success", `Pesanan ${result.orderId} dibuat!`);
      e.target.reset();
      loadDashboardData();
      switchTab("dashboard");
    } else {
      showToast("error", result.error || "Gagal membuat pesanan");
    }
  } catch (err) {
    showToast("error", "Koneksi server gagal.");
  } finally {
    submitBtn.disabled = false;
    btnText.textContent = "Pesan Sekarang";
  }
});

document.querySelectorAll(".topup-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.getElementById("topup-amount").value = btn.dataset.amount;
    document.querySelectorAll(".topup-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
});

document.getElementById("topup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseInt(document.getElementById("topup-amount").value, 10);
  const submitBtn = document.getElementById("btn-topup");
  const btnText = submitBtn.querySelector(".btn-text");

  if (!amount || amount < 10000) return showToast("error", "Min top-up Rp 10.000");

  submitBtn.disabled = true;
  btnText.textContent = "Memproses...";

  try {
    const res = await fetch(`${WALLET_SERVICE_URL}/api/topup-wallet`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: DEMO_USER.uid, amount })
    });
    const result = await res.json();

    if (result.success) {
      showToast("success", `Top-up ${formatRupiah(amount)} berhasil!`);
      document.getElementById("topup-amount").value = "";
      document.querySelectorAll(".topup-btn").forEach(b => b.classList.remove("selected"));
      addTransactionItem("topup", amount, result.newBalance, Date.now());
      // Switch back to dashboard to see updated balance
      setTimeout(() => switchTab("dashboard"), 1000);
    } else {
      showToast("error", result.error);
    }
  } catch (err) {
    showToast("error", "Koneksi server gagal.");
  } finally {
    submitBtn.disabled = false;
    btnText.textContent = "Top-Up Saldo";
  }
});

function addTransactionItem(type, amount, newBalance, timestamp) {
  const list = document.getElementById("transaction-list");
  const empty = document.getElementById("tx-empty");
  if (empty) empty.style.display = 'none';

  const isTopup = type === "topup";
  const iconClass = isTopup ? "in" : "out";
  const icon = isTopup ? "ph-arrow-down-left" : "ph-arrow-up-right";
  const label = isTopup ? "Top-Up Saldo" : "Pembayaran";
  const sign = isTopup ? "+" : "-";

  const item = document.createElement("div");
  item.className = "tx-item";
  item.innerHTML = `
    <div class="tx-icon-wrap ${iconClass}"><i class="ph ${icon}"></i></div>
    <div class="tx-body">
      <div class="tx-title">${label}</div>
      <div class="tx-date">${formatTime(timestamp)}</div>
    </div>
    <div class="tx-amount ${iconClass}">${sign}${formatRupiah(amount)}</div>
  `;
  list.prepend(item);
}

function startTracking(orderId) {
  if (trackingListenerOff) { trackingListenerOff(); trackingListenerOff = null; }
  if (trackingPath) { map.removeLayer(trackingPath); trackingPath = null; }
  pathCoords.length = 0;

  dbRef.ref(`/orders/order_${orderId}`).once("value").then(snap => {
    const order = snap.val();
    if (!order) return showToast("error", "Pesanan tidak ditemukan");
    if (!order.courierId) return showToast("error", "Belum ada kurir");

    document.getElementById("map-overlay").classList.add("hidden");

    const trackRef = dbRef.ref(`/tracking/${order.courierId}`);
    const listener = trackRef.on("value", snapshot => {
      const data = snapshot.val();
      if (!data || !data.currentLocation) return;
      
      const { lat, lng, speed } = data.currentLocation;

      if (!courierMarker) courierMarker = L.marker([lat, lng], { icon: courierIcon }).addTo(map);
      else courierMarker.setLatLng([lat, lng]);

      map.panTo([lat, lng], { animate: true, duration: 0.8 });
      pathCoords.push([lat, lng]);
      
      if (trackingPath) trackingPath.setLatLngs(pathCoords);
      else trackingPath = L.polyline(pathCoords, { color: "#1D4ED8", weight: 3, dashArray: "5, 5" }).addTo(map);

      document.getElementById("coord-lat").textContent = lat.toFixed(5);
      document.getElementById("coord-lng").textContent = lng.toFixed(5);
      document.getElementById("coord-speed").textContent = `${speed ?? 0} km/h`;
      document.getElementById("coord-updated").textContent = formatTime(data.lastUpdated);
      document.getElementById("courier-name").textContent = data.courierName || "Kurir";
      document.getElementById("courier-vehicle").textContent = "ID: " + data.courierId.substring(0,8);
      
      const badge = document.getElementById("tracking-status-badge");
      badge.textContent = "Live";
      badge.className = "status-badge live";
    });

    trackingListenerOff = () => trackRef.off("value", listener);
  }).catch(err => showToast("error", "Gagal memuat data tracking"));
}

document.getElementById("btn-start-tracking").addEventListener("click", () => {
  const id = document.getElementById("track-order-id").value;
  if (id) startTracking(id);
});

function joinChat(orderId) {
  if (chatListenerOff) { chatListenerOff(); chatListenerOff = null; }
  const msgsContainer = document.getElementById("chat-messages");
  msgsContainer.innerHTML = "";
  activeChatOrderId = orderId;

  document.getElementById("chat-order-id-display").textContent = orderId;
  document.getElementById("chat-input").disabled = false;
  document.getElementById("btn-send-chat").disabled = false;

  const ref = dbRef.ref(`/chats/order_${orderId}/messages`);
  const listener = ref.on("child_added", snap => {
    const msg = snap.val();
    if (!msg) return;
    const isSelf = msg.senderId === DEMO_USER.uid;
    
    const div = document.createElement("div");
    div.className = `msg-bubble ${isSelf ? "self" : "other"}`;
    div.innerHTML = `
      <div class="msg-text">${escapeHtml(msg.text)}</div>
      <div class="msg-meta">${formatTime(msg.timestamp)}</div>
    `;
    msgsContainer.appendChild(div);
    msgsContainer.scrollTop = msgsContainer.scrollHeight;
  });
  chatListenerOff = () => ref.off("child_added", listener);
}

document.getElementById("btn-join-chat").addEventListener("click", () => {
  const id = document.getElementById("chat-order-id").value;
  if (id) joinChat(id);
});

document.getElementById("btn-send-chat").addEventListener("click", sendChatMessage);
document.getElementById("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter") sendChatMessage();
});

async function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !activeChatOrderId) return;

  try {
    await dbRef.ref(`/chats/order_${activeChatOrderId}/messages`).push({
      senderId: DEMO_USER.uid,
      senderName: DEMO_USER.name,
      text,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
    });
    input.value = "";
  } catch (e) {
    showToast("error", "Gagal kirim pesan");
  }
}

function showToast(type, msg) {
  const container = document.getElementById("toast-container");
  const div = document.createElement("div");
  div.className = `toast ${type}`;
  const icon = type === "success" ? "ph-check-circle" : "ph-x-circle";
  div.innerHTML = `<i class="ph ${icon} ${type}"></i><span>${msg}</span>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function init() {
  loadDashboardData();
  listenToWalletBalance();
  dbRef.ref(`/users/${DEMO_USER.uid}/wallet/transactions`).orderByChild("timestamp").limitToLast(20).once("value", snap => {
    const txs = snap.val();
    if (txs) {
      Object.values(txs).sort((a,b) => b.timestamp - a.timestamp).forEach(tx => {
        addTransactionItem(tx.type, tx.amount, tx.newBalance, tx.timestamp);
      });
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
