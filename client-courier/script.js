"use strict";

const ORDER_SERVICE_URL = "https://api-order.krupukruzzz.com";
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

const DEMO_COURIER = {
  uid: "uid_courier_001",
  name: "Agus",
  role: "courier",
};

const firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
const dbRef = firebase.database();

const ROUTES = {
  sudirman: [
    [-6.2260, 106.8020], [-6.2240, 106.8030], [-6.2200, 106.8055],
    [-6.2160, 106.8080], [-6.2120, 106.8100], [-6.2080, 106.8125],
    [-6.2040, 106.8145], [-6.2000, 106.8175], [-6.1960, 106.8200],
    [-6.1920, 106.8225], [-6.1880, 106.8245],
  ],
  circular: [
    [-6.1950, 106.8230], [-6.1940, 106.8248], [-6.1940, 106.8268],
    [-6.1950, 106.8278], [-6.1963, 106.8268], [-6.1963, 106.8248],
  ],
  random: []
};

function generateRandomRoute() {
  const route = [];
  let lat = -6.2088, lng = 106.8456;
  for (let i = 0; i < 20; i++) {
    lat += (Math.random() - 0.5) * 0.002;
    lng += (Math.random() - 0.5) * 0.002;
    route.push([lat, lng]);
  }
  ROUTES.random = route;
}
generateRandomRoute();

let courierMap = null;
let courierMarker = null;

function initCourierMap() {
  if (courierMap) return;
  courierMap = L.map("courier-map", { center: [-6.2088, 106.8456], zoom: 14, zoomControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(courierMap);
}

const bikeIcon = L.divIcon({
  className: "custom-marker",
  html: `<div style="background: #0d9488; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"></div>`,
  iconSize: [24, 24], iconAnchor: [12, 12],
});

let currentTab = "dashboard";
let gpsIntervalId = null;
let gpsRouteIndex = 0;
let gpsBroadcastCount = 0;
let activeOrderData = null;
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
    initCourierMap();
    setTimeout(() => courierMap?.invalidateSize(), 150);
  }

  if (tabName === "chat" && activeOrderData && activeOrderData.orderId && activeChatOrderId !== activeOrderData.orderId) {
    document.getElementById("chat-order-id").value = activeOrderData.orderId;
    joinChat(activeOrderData.orderId);
  }
}

document.querySelectorAll("[data-tab]").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function formatRupiah(amount) { return "Rp " + new Intl.NumberFormat("id-ID").format(amount); }
function formatTime(ts) { return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }

async function loadDashboardData() {
  try {
    const userSnap = await dbRef.ref(`/users/${DEMO_COURIER.uid}`).once("value");
    const userData = userSnap.val();
    if (userData) {
      const totalEarnings = userData.wallet?.totalEarnings ?? 0;
      const balance = userData.wallet?.balance ?? 0;
      const deliveries = userData.totalDeliveries ?? 0;
      const rating = userData.rating ?? 0;

      document.getElementById("stat-today-earnings").textContent = formatRupiah(Math.floor(totalEarnings * 0.08));
      document.getElementById("stat-total-deliveries").textContent = deliveries;
      document.getElementById("stat-rating").textContent = rating.toFixed(1);

      document.getElementById("earnings-total").textContent = formatRupiah(totalEarnings);
      document.getElementById("earn-month").textContent = formatRupiah(Math.floor(totalEarnings * 0.6));
      document.getElementById("earn-wallet").textContent = formatRupiah(balance);
    }

    const ordersSnap = await dbRef.ref("/orders").orderByChild("courierId").equalTo(DEMO_COURIER.uid).once("value");
    const ordersData = ordersSnap.val() || {};
    let active = null;
    Object.values(ordersData)
      .sort((a, b) => (b.timeline?.createdAt || 0) - (a.timeline?.createdAt || 0))
      .forEach(order => {
        if (["accepted", "in_transit"].includes(order.status)) {
          if (!active) active = order;
        }
      });

    if (active) {
      activeOrderData = active;
      renderActiveDeliveryCard(active);
    }
  } catch (err) {
    console.error("Dashboard error:", err);
  }
}

function renderActiveDeliveryCard(order) {
  const card = document.getElementById("active-delivery-card");
  const details = document.getElementById("active-delivery-details");
  const btnPickup = document.getElementById("btn-pickup");
  const btnDeliver = document.getElementById("btn-deliver");

  card.style.display = "block";
  document.getElementById("active-delivery-status").textContent = order.orderId;

  details.innerHTML = `
    <div class="detail-row"><span class="detail-label">Jemput</span><span class="detail-val">${order.pickup?.address}</span></div>
    <div class="detail-row"><span class="detail-label">Tujuan</span><span class="detail-val">${order.destination?.address}</span></div>
    <div class="detail-row"><span class="detail-label">Barang</span><span class="detail-val">${order.package?.description}</span></div>
    <div class="detail-row"><span class="detail-label">Biaya</span><span class="detail-val text-primary">${formatRupiah(order.pricing?.totalFee || 0)}</span></div>
  `;

  if (order.status === "accepted") {
    btnPickup.style.display = "block"; btnDeliver.style.display = "none";
  } else if (order.status === "in_transit") {
    btnPickup.style.display = "none"; btnDeliver.style.display = "block";
  }
}

document.getElementById("btn-pickup").addEventListener("click", () => updateOrderStatus("in_transit"));
document.getElementById("btn-deliver").addEventListener("click", () => updateOrderStatus("delivered"));

async function updateOrderStatus(newStatus) {
  if (!activeOrderData) return;
  try {
    const res = await fetch(`${ORDER_SERVICE_URL}/api/order/${activeOrderData.orderId}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, courierId: DEMO_COURIER.uid })
    });
    const result = await res.json();
    if (result.success) {
      if (newStatus === "delivered") {
        stopGpsBroadcast();
        activeOrderData = null;
        document.getElementById("active-delivery-card").style.display = "none";
        alert("Pengiriman Selesai!");
      } else {
        activeOrderData.status = newStatus;
        renderActiveDeliveryCard(activeOrderData);
      }
    }
  } catch (err) {
    alert("Gagal update status.");
  }
}

async function loadPendingOrders() {
  const list = document.getElementById("orders-list");
  const countDisplay = document.getElementById("orders-count");
  try {
    const res = await fetch(`${ORDER_SERVICE_URL}/api/orders/pending`);
    const result = await res.json();
    const orders = result.orders || [];
    countDisplay.textContent = `${orders.length} pesanan tersedia`;

    if (orders.length === 0) {
      list.innerHTML = `<div class="empty-state-list">Belum ada pesanan masuk.</div>`;
      return;
    }

    list.innerHTML = orders.map(o => `
      <div class="order-card">
        <div class="order-card-header">
          <span class="order-id">${o.orderId}</span>
          <span class="order-fee">${formatRupiah(o.pricing?.totalFee || 0)}</span>
        </div>
        <div class="order-route">
          <div class="route-line"><i class="ph ph-map-pin"></i> ${o.pickup?.address}</div>
          <div class="route-line"><i class="ph ph-flag"></i> ${o.destination?.address}</div>
        </div>
        <button class="btn btn-primary btn-block" onclick="acceptOrder('${o.orderId}')">Terima Pesanan</button>
      </div>
    `).join("");
  } catch (err) {
    list.innerHTML = `<div class="empty-state-list">Gagal memuat pesanan.</div>`;
  }
}

document.getElementById("btn-refresh-orders").addEventListener("click", loadPendingOrders);

window.acceptOrder = async function(orderId) {
  if (activeOrderData) return alert("Selesaikan pesanan aktif dulu.");
  try {
    const res = await fetch(`${ORDER_SERVICE_URL}/api/order/${orderId}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "accepted", courierId: DEMO_COURIER.uid })
    });
    const result = await res.json();
    if (result.success) {
      const snap = await dbRef.ref(`/orders/order_${orderId}`).once("value");
      activeOrderData = snap.val();
      renderActiveDeliveryCard(activeOrderData);
      loadPendingOrders();
      switchTab("dashboard");
      alert("Pesanan diterima!");
    }
  } catch (err) {
    alert("Gagal menerima pesanan.");
  }
};

function startGpsBroadcast() {
  if (gpsIntervalId) return;
  const intervalMs = parseInt(document.getElementById("gps-interval").value) || 3000;
  const routePoints = ROUTES[document.getElementById("gps-route").value];
  if (!routePoints || !routePoints.length) return;

  gpsRouteIndex = 0;
  document.getElementById("gps-dot").className = "gps-dot active";
  document.getElementById("gps-text").textContent = "Live";
  document.getElementById("btn-start-gps").disabled = true;
  document.getElementById("btn-stop-gps").disabled = false;

  gpsIntervalId = setInterval(async () => {
    const [lat, lng] = routePoints[gpsRouteIndex % routePoints.length];
    const speed = Math.floor(Math.random() * 30) + 20;

    await dbRef.ref(`/tracking/${DEMO_COURIER.uid}`).set({
      courierId: DEMO_COURIER.uid,
      courierName: DEMO_COURIER.name,
      activeOrderId: activeOrderData?.orderId || null,
      isTracking: true,
      currentLocation: { lat, lng, speed, accuracy: 10, heading: 0, altitude: 0 },
      lastUpdated: firebase.database.ServerValue.TIMESTAMP,
    });

    gpsBroadcastCount++;
    gpsRouteIndex++;

    document.getElementById("gps-broadcast-count").textContent = gpsBroadcastCount;
    document.getElementById("gps-current-lat").textContent = lat.toFixed(5);
    document.getElementById("gps-current-lng").textContent = lng.toFixed(5);
    document.getElementById("gps-current-speed").textContent = speed + " km/h";

    if (courierMap) {
      if (!courierMarker) courierMarker = L.marker([lat, lng], { icon: bikeIcon }).addTo(courierMap);
      else courierMarker.setLatLng([lat, lng]);
      courierMap.panTo([lat, lng], { animate: true, duration: 0.5 });
    }
  }, intervalMs);
}

function stopGpsBroadcast() {
  if (!gpsIntervalId) return;
  clearInterval(gpsIntervalId);
  gpsIntervalId = null;
  dbRef.ref(`/tracking/${DEMO_COURIER.uid}/isTracking`).set(false);

  document.getElementById("gps-dot").className = "gps-dot";
  document.getElementById("gps-text").textContent = "Offline";
  document.getElementById("btn-start-gps").disabled = false;
  document.getElementById("btn-stop-gps").disabled = true;
}

document.getElementById("btn-start-gps").addEventListener("click", startGpsBroadcast);
document.getElementById("btn-stop-gps").addEventListener("click", stopGpsBroadcast);

function joinChat(orderId) {
  if (chatListenerOff) { chatListenerOff(); chatListenerOff = null; }
  const msgsContainer = document.getElementById("chat-messages");
  msgsContainer.innerHTML = "";
  activeChatOrderId = orderId;

  document.getElementById("chat-order-display").textContent = orderId;
  document.getElementById("chat-input").disabled = false;
  document.getElementById("btn-send-chat").disabled = false;

  const ref = dbRef.ref(`/chats/order_${orderId}/messages`);
  const listener = ref.on("child_added", snap => {
    const msg = snap.val();
    if (!msg) return;
    const isSelf = msg.senderId === DEMO_COURIER.uid;
    
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

document.getElementById("btn-send-chat").addEventListener("click", async () => {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !activeChatOrderId) return;
  await dbRef.ref(`/chats/order_${activeChatOrderId}/messages`).push({
    senderId: DEMO_COURIER.uid, senderName: DEMO_COURIER.name,
    text, timestamp: firebase.database.ServerValue.TIMESTAMP,
  });
  input.value = "";
});

document.getElementById("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-send-chat").click();
});

document.getElementById("toggle-online").addEventListener("change", e => {
  const isOnline = e.target.checked;
  document.getElementById("online-status-text").textContent = isOnline ? "Online" : "Offline";
  dbRef.ref(`/users/${DEMO_COURIER.uid}/isOnline`).set(isOnline);
  if (!isOnline) stopGpsBroadcast();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  loadDashboardData();
  loadPendingOrders();
});
