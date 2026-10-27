export default async function handler(req, res) {
  try {
    const FIREBASE_BASE_URL = "https://mineora-web-default-rtdb.firebaseio.com";
    const snap = await fetch(`${FIREBASE_BASE_URL}/active_trades.json`).then(r => r.json());

    if (!snap) {
      return res.status(404).send("Kayıtlı işlem verisi bulunamadı.");
    }

    // CSV Başlıkları
    const headers = [
      "İşlem ID",
      "Tarih/Saat",
      "Parite",
      "Yön",
      "Giriş Fiyatı",
      "TP1 Fiyatı",
      "TP2 Fiyatı",
      "Stop Fiyatı",
      "Durum",
      "TP1 Alındı mı?",
      "Alıcı Gücü (%)",
      "Borsa Emir Durumu",
      "İstihbarat Nedeni"
    ];

    const rows = Object.values(snap).map(t => {
      const dateStr = t.timestamp ? new Date(t.timestamp).toLocaleString("tr-TR") : "-";
      const cleanReason = (t.reason || "").replace(/(\r\n|\n|\r|,|;)/gm, " ");
      return [
        t.id || "-",
        dateStr,
        t.symbol || "-",
        t.direction || "-",
        t.entryPrice || 0,
        t.tp1 || 0,
        t.tp2 || 0,
        t.sl || 0,
        t.status || "-",
        t.tp1Hit ? "EVET" : "HAYIR",
        t.score || "-",
        t.bitgetOrderResult || "SIMULATION",
        cleanReason
      ].map(val => `"${val}"`).join(";"); // Excel Türkçe uyumu için noktalı virgül
    });

    // Excel Türkçe karakter sorunu olmasın diye UTF-8 BOM ekliyoruz
    const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=Mineora_Sniper_Islemler_${Date.now()}.csv`);
    return res.status(200).send(csvContent);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
