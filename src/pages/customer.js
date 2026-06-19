import Head from "next/head";
import Script from "next/script";
import { useEffect } from "react";

export default function CustomerApp() {
  useEffect(() => {
    window.initCustomerLogic = function() {
      if (typeof window.firebase === "undefined" || typeof window.L === "undefined") {
        setTimeout(window.initCustomerLogic, 100);
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

      const DEMO_USER = {
        uid: "uid_customer_001",
        name: "Budi",
        role: "customer",
      };

      if (!window.firebaseAppInstance) {
        window.firebaseAppInstance = window.firebase.initializeApp(FIREBASE_CONFIG);
      }
      const dbRef = window.firebase.database();
      const DEFAULT_CENTER = [-6.2088, 106.8456];
      
      const mapContainer = document.getElementById("map");
      if (mapContainer && !mapContainer._leaflet_id) {
        window.mapInstance = window.L.map("map", { center: DEFAULT_CENTER, zoom: 14, zoomControl: false });
        window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(window.mapInstance);
      }
      
      const map = window.mapInstance;
      const courierIcon = window.L.divIcon({
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

      window.switchTab = function(tabName) {
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("tab-panel--active"));
        document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("nav-item--active"));
        const panel = document.getElementById(`tab-${tabName}`);
        if (panel) panel.classList.add("tab-panel--active");
        const navBtn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
        if (navBtn) navBtn.classList.add("nav-item--active");
        if (tabName === "tracking" && map) {
          setTimeout(() => map.invalidateSize(), 150);
        }
      }

      document.querySelectorAll("[data-tab]").forEach(btn => {
        btn.onclick = () => window.switchTab(btn.dataset.tab);
      });

      const btnTrackActive = document.getElementById("btn-track-active");
      if (btnTrackActive) {
        btnTrackActive.onclick = () => {
          if (activeOrderId) {
            document.getElementById("track-order-id").value = activeOrderId;
            window.switchTab("tracking");
            startTracking(activeOrderId);
          }
        };
      }

      function formatRupiah(amount) { return "Rp " + new Intl.NumberFormat("id-ID").format(amount); }
      function formatTime(ts) { return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }

      async function loadDashboardData() {
        try {
          dbRef.ref(`/users/${DEMO_USER.uid}/wallet/balance`).on("value", snap => {
            const formatted = formatRupiah(snap.val() ?? 0);
            document.getElementById("nav-balance-display").textContent = formatted;
            document.getElementById("wallet-balance-display").textContent = formatted;
          });

          const [userSnap, ordersSnap] = await Promise.all([
            dbRef.ref(`/users/${DEMO_USER.uid}`).once("value"),
            dbRef.ref("/orders").orderByChild("customerId").equalTo(DEMO_USER.uid).once("value"),
          ]);

          const ordersData = ordersSnap.val() || {};
          let totalOrders = 0, delivered = 0, inTransit = 0, latestActive = null;
          Object.values(ordersData).forEach(order => {
            totalOrders++;
            if (order.status === "delivered") delivered++;
            if (["accepted", "in_transit"].includes(order.status)) { inTransit++; latestActive = order; }
          });

          document.getElementById("stat-total-orders").textContent = totalOrders;
          document.getElementById("stat-delivered").textContent = delivered;
          document.getElementById("stat-in-transit").textContent = inTransit;

          if (latestActive) {
            activeOrderId = latestActive.orderId;
            renderActiveOrderFlow(latestActive);
            document.getElementById("active-order-card").style.display = "block";
          }
        } catch (error) { console.error(error); }
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
          return `<div class="${cls}"><div class="step-icon"><i class="ph ${step.icon}"></i></div><span class="step-label">${step.label}</span></div>`;
        }).join("");
      }

      document.getElementById("order-form").onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById("btn-submit-order");
        const payload = {
          customerId: DEMO_USER.uid,
          pickup: { address: document.getElementById("pickup-address").value, contactName: document.getElementById("pickup-contact").value, contactPhone: document.getElementById("pickup-phone").value, lat: -6.2088 + (Math.random() * 0.02 - 0.01), lng: 106.8456 + (Math.random() * 0.02 - 0.01) },
          destination: { address: document.getElementById("dest-address").value, contactName: document.getElementById("dest-contact").value, contactPhone: document.getElementById("dest-phone").value, lat: -6.1930 + (Math.random() * 0.02 - 0.01), lng: 106.8235 + (Math.random() * 0.02 - 0.01) },
          package: { description: document.getElementById("pkg-desc").value, weight: parseFloat(document.getElementById("pkg-weight").value) || 1, category: document.getElementById("pkg-category").value },
          note: document.getElementById("order-note").value,
        };
        submitBtn.disabled = true;
        try {
          const res = await fetch(`${BACKEND_URL}/api/create-order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const result = await res.json();
          if (result.success) { showToast("success", "Pesanan Dibuat!"); e.target.reset(); loadDashboardData(); window.switchTab("dashboard"); }
          else showToast("error", result.error);
        } catch (err) { showToast("error", "Gagal!"); }
        submitBtn.disabled = false;
      };

      document.getElementById("topup-form").onsubmit = async (e) => {
        e.preventDefault();
        const amount = parseInt(document.getElementById("topup-amount").value, 10);
        if (!amount || amount < 10000) return showToast("error", "Min Rp 10.000");
        try {
          const res = await fetch(`${BACKEND_URL}/api/topup-wallet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: DEMO_USER.uid, amount }) });
          const result = await res.json();
          if (result.success) { showToast("success", "Berhasil!"); loadDashboardData(); window.switchTab("dashboard"); }
        } catch (err) { showToast("error", "Gagal!"); }
      };

      function startTracking(orderId) {
        if (trackingListenerOff) trackingListenerOff();
        dbRef.ref(`/orders/order_${orderId}`).once("value").then(snap => {
          const order = snap.val();
          if (!order?.courierId) return showToast("error", "Menunggu kurir");
          document.getElementById("map-overlay").classList.add("hidden");
          const trackRef = dbRef.ref(`/tracking/${order.courierId}`);
          const listener = trackRef.on("value", snapshot => {
            const data = snapshot.val();
            if (!data?.currentLocation) return;
            const { lat, lng } = data.currentLocation;
            if (!courierMarker && map) courierMarker = window.L.marker([lat, lng], { icon: courierIcon }).addTo(map);
            else if (courierMarker) courierMarker.setLatLng([lat, lng]);
            if (map) map.panTo([lat, lng]);
            document.getElementById("coord-lat").textContent = lat.toFixed(5);
            document.getElementById("coord-lng").textContent = lng.toFixed(5);
            document.getElementById("tracking-status-badge").className = "status-badge live";
            document.getElementById("tracking-status-badge").textContent = "Live";
          });
          trackingListenerOff = () => trackRef.off("value", listener);
        });
      }

      document.getElementById("btn-start-tracking").onclick = () => startTracking(document.getElementById("track-order-id").value);

      function showToast(type, msg) {
        const container = document.getElementById("toast-container");
        const div = document.createElement("div");
        div.className = `toast ${type}`;
        div.innerHTML = `<span>${msg}</span>`;
        container.appendChild(div);
        setTimeout(() => div.remove(), 3000);
      }

      loadDashboardData();
    };

    if (typeof window.firebase !== "undefined" && typeof window.L !== "undefined") {
      window.initCustomerLogic();
    }
  }, []);

  return (
    <>
      <Head>
        <title>LogiParalel | Customer</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </Head>
      <Script src="https://unpkg.com/@phosphor-icons/web" strategy="lazyOnload" />
      <Script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js" strategy="beforeInteractive" />
      <Script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js" strategy="beforeInteractive" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="beforeInteractive" />
      <Script id="loader">{`setTimeout(function(){ if(window.initCustomerLogic) window.initCustomerLogic(); }, 800);`}</Script>

      <div className="customer-body">
        <div className="app-container">
          <header className="top-nav">
            <div className="brand"><i className="ph-fill ph-package brand-icon"></i><span className="brand-text">LogiParalel</span></div>
            <div className="user-chip"><i className="ph ph-wallet"></i><span id="nav-balance-display">Rp 0</span></div>
          </header>
          <main className="main-content">
            <section className="tab-panel tab-panel--active" id="tab-dashboard">
              <div className="greeting-section"><h1 className="greeting-title">Halo, <span id="user-greeting-name">Budi</span></h1><p className="greeting-subtitle">Mau kirim apa hari ini?</p></div>
              <div className="quick-actions-grid">
                <button className="action-btn" data-tab="order"><div className="action-btn-icon"><i className="ph ph-paper-plane-tilt"></i></div><span>Kirim</span></button>
                <button className="action-btn" data-tab="tracking"><div className="action-btn-icon"><i className="ph ph-map-pin-line"></i></div><span>Lacak</span></button>
                <button className="action-btn" data-tab="wallet"><div className="action-btn-icon"><i className="ph ph-wallet"></i></div><span>Dompet</span></button>
                <button className="action-btn" data-tab="chat"><div className="action-btn-icon"><i className="ph ph-chat-circle-dots"></i></div><span>Chat</span></button>
              </div>
              <div className="stats-cards">
                <div className="stat-card"><span className="stat-label">Total</span><span className="stat-value" id="stat-total-orders">0</span></div>
                <div className="stat-card"><span className="stat-label">Proses</span><span className="stat-value" id="stat-in-transit">0</span></div>
                <div className="stat-card"><span className="stat-label">Selesai</span><span className="stat-value" id="stat-delivered">0</span></div>
              </div>
              <div className="card" id="active-order-card" style={{ display: "none" }}>
                <div className="card-header flex-between"><h3 className="card-title">Pesanan Aktif</h3><button className="text-btn" id="btn-track-active">Detail</button></div>
                <div className="card-body"><div className="stepper" id="active-order-flow"></div></div>
              </div>
            </section>

            <section className="tab-panel" id="tab-order">
              <h1 className="page-title">Kirim Paket</h1>
              <form className="order-form" id="order-form">
                <div className="form-section">
                  <div className="input-group"><label>Alamat Jemput</label><input type="text" id="pickup-address" required /></div>
                  <div className="input-row">
                    <div className="input-group"><label>Nama</label><input type="text" id="pickup-contact" required /></div>
                    <div className="input-group"><label>HP</label><input type="tel" id="pickup-phone" required /></div>
                  </div>
                  <div className="input-group"><label>Alamat Tujuan</label><input type="text" id="dest-address" required /></div>
                  <div className="input-row">
                    <div className="input-group"><label>Nama</label><input type="text" id="dest-contact" required /></div>
                    <div className="input-group"><label>HP</label><input type="tel" id="dest-phone" required /></div>
                  </div>
                  <div className="input-group"><label>Barang</label><input type="text" id="pkg-desc" required /></div>
                  <div className="input-row">
                    <div className="input-group"><label>Berat (Kg)</label><input type="number" id="pkg-weight" step="0.1" required /></div>
                    <div className="input-group"><label>Kategori</label><select id="pkg-category"><option value="general">Umum</option></select></div>
                  </div>
                  <div className="input-group"><label>Catatan</label><textarea id="order-note"></textarea></div>
                </div>
                <button type="submit" className="btn btn-primary btn-block" id="btn-submit-order">Pesan Sekarang</button>
              </form>
            </section>

            <section className="tab-panel" id="tab-tracking">
              <h1 className="page-title">Live Tracking</h1>
              <div className="search-box"><input type="text" id="track-order-id" placeholder="ID Pesanan" /><button type="button" className="btn btn-sm btn-primary" id="btn-start-tracking">Cari</button></div>
              <div className="courier-card"><div className="courier-info"><h4 id="courier-name">Menunggu...</h4></div><div className="status-badge" id="tracking-status-badge">Offline</div></div>
              <div className="map-container"><div id="map" style={{height:"100%"}}></div><div className="map-overlay" id="map-overlay"><p>Masukkan ID untuk melacak</p></div></div>
              <div className="telemetry-grid">
                <div className="telemetry-item"><span className="telemetry-label">Lat</span><span className="telemetry-val" id="coord-lat">-</span></div>
                <div className="telemetry-item"><span className="telemetry-label">Lng</span><span className="telemetry-val" id="coord-lng">-</span></div>
              </div>
            </section>

            <section className="tab-panel" id="tab-wallet">
              <h1 className="page-title">Dompet</h1>
              <div className="wallet-hero-card"><h2 className="wallet-hero-balance" id="wallet-balance-display">Rp 0</h2></div>
              <form id="topup-form"><div className="input-group"><label>Nominal</label><input type="number" id="topup-amount" min="10000" /></div><button type="submit" className="btn btn-primary btn-block">Top-Up</button></form>
              <div className="transaction-list" id="transaction-list"></div>
            </section>
          </main>
          <nav className="bottom-nav">
            <button className="nav-item nav-item--active" data-tab="dashboard"><i className="ph ph-house"></i><span>Home</span></button>
            <button className="nav-item" data-tab="order"><i className="ph ph-plus-square"></i><span>Pesan</span></button>
            <button className="nav-item" data-tab="tracking"><i className="ph ph-map-pin"></i><span>Lacak</span></button>
            <button className="nav-item" data-tab="wallet"><i className="ph ph-wallet"></i><span>Dompet</span></button>
          </nav>
          <div id="toast-container" className="toast-container"></div>
        </div>
      </div>
    </>
  );
}
