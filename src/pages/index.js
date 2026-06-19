import Head from "next/head";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <Head>
        <title>LogiParalel | Gateway</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <div style={{
        fontFamily: "'Inter', sans-serif",
        background: "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px"
      }}>
        <div style={{
          background: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          width: "100%",
          maxWidth: "480px",
          padding: "40px",
          textAlign: "center"
        }}>
          <div style={{ marginBottom: "32px" }}>
            <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#0f172a", marginBottom: "8px", letterSpacing: "-0.5px" }}>LogiParalel Gateway</h1>
            <p style={{ fontSize: "15px", color: "#475569" }}>Silakan pilih aplikasi masuk yang ingin Anda tuju</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <Link href="/customer" style={{ textDecoration: "none" }}>
              <div style={{
                background: "#1D4ED8",
                color: "#ffffff",
                padding: "18px 24px",
                borderRadius: "12px",
                fontWeight: "600",
                fontSize: "16px",
                cursor: "pointer",
                transition: "all 0.2s",
                boxShadow: "0 4px 12px rgba(29, 78, 216, 0.2)"
              }}>
                Aplikasi Customer
              </div>
            </Link>

            <Link href="/courier" style={{ textDecoration: "none" }}>
              <div style={{
                background: "#0d9488",
                color: "#ffffff",
                padding: "18px 24px",
                borderRadius: "12px",
                fontWeight: "600",
                fontSize: "16px",
                cursor: "pointer",
                transition: "all 0.2s",
                boxShadow: "0 4px 12px rgba(13, 148, 136, 0.2)"
              }}>
                Aplikasi Kurir / Driver
              </div>
            </Link>
          </div>

          <div style={{ marginTop: "40px", borderTop: "1px solid #e2e8f0", paddingTop: "20px" }}>
            <p style={{ fontSize: "12px", color: "#94a3b8" }}>LogiParalel Logistics Platform Engine v1.0.0</p>
          </div>
        </div>
      </div>
    </>
  );
}
