export default function handler(req, res) {
  res.status(200).json({ status: "healthy", uptime: process.uptime() });
}
