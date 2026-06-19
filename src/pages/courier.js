import Head from "next/head";
import Script from "next/script";
import { useEffect } from "react";

export default function CourierApp() {
  useEffect(() => {
    window.initCourierLogic = function() {
      if (typeof window.firebase === "undefined" || typeof window.L === "undefined") {
        setTimeout(window.initCourierLogic, 100);
        return;
      }

      const BACKEND_URL = window.location.origin;
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

      const DEMO_COURIER = { uid: "uid_courier_001", name: "Agus", role: "courier" };
      if (!window.firebaseAppInstance) window.firebaseAppInstance = window.firebase.initializeApp(FIREBASE_CONFIG);
      const dbRef = window.firebase.database();

      const ROUTES = {
        sudirman: [[-6.2260, 106.8020], [-6.2160, 106.8080], [-6.2080, 106.8125], [-6.1880, 106.8245]],
        circular: [[-6.1950, 106.8230], [-6.1940, 106.8248], [-6.1963, 106.8248]],
        random: []
      };

      let courierMap = null;
      let courierMarker = null;
      function initCourierMap() {
        if (courierMap) return;
        const el = document.getElementById("courier-map");
        if (el && !el._leaflet_id) {
          courierMap = window.L.map("courier-map", { center: [-6.2088, 106.8456], zoom: 14, zoomControl: false });
          window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(courierMap);
        }
      }

      const bikeIcon = window.L.divIcon({
        className: "custom-marker",
        html: `<div style="background: #0d9488; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white;"></div>`,
        iconSize: [24, 24], iconAnchor: [12, 12],
      });

      let gpsIntervalId = null;
      let gpsRouteIndex = 0;
      let activeOrderData = null;

      window.switchCourierTab = function(tabName) {
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("tab-panel--active"));
        document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("nav-item--active"));
        const panel = document.getElementById(`tab-${tabName}`);
        if (panel) panel.classList.add("tab-panel--active");
        const navBtn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
        if (navBtn) navBtn.classList.add("nav-item--active");
        if (tabName === "tracking") { initCourierMap(); setTimeout(() => courierMap?.invalidateSize(), 150); }
      }

      document.querySelectorAll("[data-tab]").forEach(btn => btn.onclick = () => window.switchCourierTab(btn.dataset.tab));

      function formatRupiah(amount) { return "Rp " + new Intl.NumberFormat("id-ID").format(amount); }

      async function loadDashboardData() {
        try {
          const userSnap = await dbRef.ref(`/users/${DEMO_COURIER.uid}`).once("value");
          const userData = userSnap.val();
          if (userData) {
            document.getElementById("stat-today-earnings").textContent = formatRupiah(userData.wallet?.totalEarnings ?? 0);
            document.getElementById("earn-wallet").textContent = formatRupiah(userData.wallet?.balance ?? 0);
          }
          const ordersSnap = await dbRef.ref("/orders").orderByChild("courierId").equalTo(DEMO_COURIER.uid).once("value");
          const ordersData = ordersSnap.val() || {};
          let active = null;
          Object.values(ordersData).forEach(order => { if (["accepted", "in_transit"].includes(order.status)) active = order; });
          if (active) { activeOrderData = active; renderActiveDeliveryCard(active); }
        } catch (err) { console.error(err); }
      }

      function renderActiveDeliveryCard(order) {
        const card = document.getElementById("active-delivery-card");
        const details = document.getElementById("active-delivery-details");
        card.style.display = "block";
        document.getElementById("active-delivery-status").textContent = order.orderId;
        details.innerHTML = `<div class="detail-row"><span>Alamat</span><span>${order.pickup?.address}</span></div>`;
        if (order.status === "accepted") { document.getElementById("btn-pickup").style.display = "block"; document.getElementById("btn-deliver").style.display = "none"; }
        else { document.getElementById("btn-pickup").style.display = "none"; document.getElementById("btn-deliver").style.display = "block"; }
      }

      document.getElementById("btn-pickup").onclick = () => updateOrderStatus("in_transit");
      document.getElementById("btn-deliver").onclick = () => updateOrderStatus("delivered");

      async function updateOrderStatus(newStatus) {
        if (!activeOrderData) return;
        const res = await fetch(`${BACKEND_URL}/api/order/${activeOrderData.orderId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus, courierId: DEMO_COURIER.uid }) });
        const result = await res.json();
        if (result.success) {
          if (newStatus === "delivered") { activeOrderData = null; document.getElementById("active-delivery-card").style.display = "none"; alert("Selesai!"); }
          else { activeOrderData.status = newStatus; renderActiveDeliveryCard(activeOrderData); }
        }
      }

      async function loadPendingOrders() {
        const list = document.getElementById("orders-list");
        try {
          const res = await fetch(`${BACKEND_URL}/api/orders/pending`);
          const result = await res.json();
          const orders = result.orders || [];
          if (orders.length === 0) { list.innerHTML = `<div>Kosong</div>`; return; }
          list.innerHTML = orders.map(o => `
            <div class="order-card">
              <span>${o.orderId}</span>
              <button class="btn btn-primary btn-block" onclick="window.acceptOrder('${o.orderId}')">Terima</button>
            </div>
          `).join("");
        } catch (err) { list.innerHTML = `<div>Gagal</div>`; }
      }

      window.acceptOrder = async function(orderId) {
        if (activeOrderData) return alert("Ada tugas aktif!");
        const res = await fetch(`${BACKEND_URL}/api/order/${orderId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "accepted", courierId: DEMO_COURIER.uid }) });
        const result = await res.json();
        if (result.success) { loadDashboardData(); window.switchCourierTab("dashboard"); }
      };

      document.getElementById("btn-start-gps").onclick = function() {
        if (gpsIntervalId) return;
        document.getElementById("gps-dot").className = "gps-dot active";
        gpsIntervalId = setInterval(async () => {
          const points = ROUTES.sudirman;
          const [lat, lng] = points[gpsRouteIndex % points.length];
          await dbRef.ref(`/tracking/${DEMO_COURIER.uid}`).set({ courierId: DEMO_COURIER.uid, courierName: DEMO_COURIER.name, isTracking: true, currentLocation: { lat, lng, speed: 40 }, lastUpdated: window.firebase.database.ServerValue.TIMESTAMP });
          gpsRouteIndex++;
          if (courierMap) {
            if (!courierMarker) courierMarker = window.L.marker([lat, lng], { icon: bikeIcon }).addTo(courierMap);
            else courierMarker.setLatLng([lat, lng]);
            courierMap.panTo([lat, lng]);
          }
        }, 3000);
      };

      document.getElementById("btn-stop-gps").onclick = () => { clearInterval(gpsIntervalId); gpsIntervalId = null; document.getElementById("gps-dot").className = "gps-dot"; };

      loadDashboardData();
      loadPendingOrders();
    };

    if (typeof window.firebase !== "undefined" && typeof window.L !== "undefined") window.initCourierLogic();
  }, []);

  return (
    <>
      <Head><title>LogiParalel | Courier</title><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" /></Head>
      <Script src="https://unpkg.com/@phosphor-icons/web" strategy="lazyOnload" />
      <Script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js" strategy="beforeInteractive" />
      <Script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js" strategy="beforeInteractive" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="beforeInteractive" />
      <Script id="c-loader">{`setTimeout(function(){ if(window.initCourierLogic) window.initCourierLogic(); }, 800);`}</Script>

      <div className="courier-body">
        <div className="app-container">
          <header className="top-nav">
            <div className="brand"><i className="ph-fill ph-moped brand-icon"></i><span className="brand-text">LogiParalel</span></div>
            <div className="flex-row"><div className="status-toggle"><span id="online-status-text">Online</span></div></div>
          </header>
          <main className="main-content">
            <section className="tab-panel tab-panel--active" id="tab-dashboard">
              <div className="greeting-section"><h1 className="greeting-title">Halo Driver!</h1></div>
              <div className="quick-actions-grid">
                <button className="action-btn" data-tab="orders"><span>Pesanan</span></button>
                <button className="action-btn" data-tab="tracking"><span>GPS</span></button>
                <button className="action-btn" data-tab="earnings"><span>Dana</span></button>
              </div>
              <div className="stats-cards">
                <div className="stat-card"><span>Pendapatan</span><span id="stat-today-earnings">Rp 0</span></div>
              </div>
              <div className="card" id="active-delivery-card" style={{ display: "none" }}>
                <div className="card-header"><h3 className="card-title">Tugas Aktif</h3><span id="active-delivery-status"></span></div>
                <div className="card-body"><div id="active-delivery-details"></div>
                  <button className="btn btn-primary btn-block" id="btn-pickup">Dijemput</button>
                  <button className="btn btn-success btn-block" id="btn-deliver">Selesai</button>
                </div>
              </div>
            </section>
            <section className="tab-panel" id="tab-orders">
              <h1 className="page-title">Bursa Pesanan</h1>
              <div id="orders-list"></div>
            </section>
            <section className="tab-panel" id="tab-tracking">
              <h3 className="card-title">GPS</h3><div className="gps-dot" id="gps-dot"></div>
              <button className="btn btn-success" id="btn-start-gps">Start</button><button className="btn btn-danger" id="btn-stop-gps">Stop</button>
              <div id="courier-map" style={{height:"200px", marginTop:"20px"}}></div>
            </section>
            <section className="tab-panel" id="tab-earnings"><h2 id="earn-wallet">Rp 0</h2></section>
          </main>
          <nav className="bottom-nav">
            <button className="nav-item" data-tab="dashboard">Home</button>
            <button className="nav-item" data-tab="orders">Order</button>
            <button className="nav-item" data-tab="tracking">GPS</button>
          </nav>
        </div>
      </div>
    </>
  );
}
