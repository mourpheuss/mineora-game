import math

class SportsAnalyticsEngine:
    def __init__(self):
        pass

    def _poisson(self, k, lamb):
        if lamb <= 0:
            return 1.0 if k == 0 else 0.0
        return (math.exp(-lamb) * (lamb ** k)) / math.factorial(k)

    def analyze_match(self, match_data):
        home_team = match_data.get("home_team", "Ev Sahibi")
        away_team = match_data.get("away_team", "Deplasman")
        
        # Takım verilerini stats_feeder'dan al
        h_stats = match_data.get("home_stats", {})
        a_stats = match_data.get("away_stats", {})

        # Form, eksikler ve saha avantajına göre hakiki gol beklentileri (xG)
        home_xg = max(0.40, h_stats.get("calc_xg", 1.65))
        away_xg = max(0.30, a_stats.get("calc_xg", 1.15))

        # İlk Yarı (İY) ve İkinci Yarı (2Y) Gol Dağılımı Katsayıları
        # Futbolda gollerin ortalama %44'ü ilk yarı, %56'sı ikinci yarı atılır
        h_xg_1h, a_xg_1h = home_xg * 0.44, away_xg * 0.44
        h_xg_2h, a_xg_2h = home_xg * 0.56, away_xg * 0.56

        # MAÇ SONU (MS) HESAPLAMA
        ms_home, ms_draw, ms_away = 0.0, 0.0, 0.0
        over15, over25, over35 = 0.0, 0.0, 0.0
        btts_yes = 0.0
        score_matrix = []

        for h in range(7):
            for a in range(7):
                p = self._poisson(h, home_xg) * self._poisson(a, away_xg)
                if h > a: ms_home += p
                elif h == a: ms_draw += p
                else: ms_away += p

                total_g = h + a
                if total_g > 1.5: over15 += p
                if total_g > 2.5: over25 += p
                if total_g > 3.5: over35 += p
                if h > 0 and a > 0: btts_yes += p

                score_matrix.append((f"{h}-{a}", p))

        # İLK YARI (İY) HESAPLAMA
        iy_home, iy_draw, iy_away = 0.0, 0.0, 0.0
        for h in range(5):
            for a in range(5):
                p = self._poisson(h, h_xg_1h) * self._poisson(a, a_xg_1h)
                if h > a: iy_home += p
                elif h == a: iy_draw += p
                else: iy_away += p

        # İKİNCİ YARI (2Y) HESAPLAMA
        y2_home, y2_draw, y2_away = 0.0, 0.0, 0.0
        for h in range(5):
            for a in range(5):
                p = self._poisson(h, h_xg_2h) * self._poisson(a, a_xg_2h)
                if h > a: y2_home += p
                elif h == a: y2_draw += p
                else: y2_away += p

        # Normalizasyon
        tot_ms = ms_home + ms_draw + ms_away or 1.0
        tot_iy = iy_home + iy_draw + iy_away or 1.0
        tot_2y = y2_home + y2_draw + y2_away or 1.0

        score_matrix.sort(key=lambda x: x[1], reverse=True)
        top_scores = [
            {"score": s[0], "prob": f"%{round((s[1]/tot_ms)*100, 1)}"}
            for s in score_matrix[:3]
        ]

        return {
            "match": f"{home_team} vs {away_team}",
            "home_team": home_team,
            "away_team": away_team,
            "analysis": {
                # Maç Sonu
                "ms_home": round((ms_home / tot_ms) * 100, 1),
                "ms_draw": round((ms_draw / tot_ms) * 100, 1),
                "ms_away": round((ms_away / tot_ms) * 100, 1),
                
                # İlk Yarı
                "iy_home": round((iy_home / tot_iy) * 100, 1),
                "iy_draw": round((iy_draw / tot_iy) * 100, 1),
                "iy_away": round((iy_away / tot_iy) * 100, 1),

                # İkinci Yarı
                "y2_home": round((y2_home / tot_2y) * 100, 1),
                "y2_draw": round((y2_draw / tot_2y) * 100, 1),
                "y2_away": round((y2_away / tot_2y) * 100, 1),

                # Gol Baremleri
                "over_15": round((over15 / tot_ms) * 100, 1),
                "under_15": round((1.0 - (over15 / tot_ms)) * 100, 1),
                "over_25": round((over25 / tot_ms) * 100, 1),
                "under_25": round((1.0 - (over25 / tot_ms)) * 100, 1),
                "over_35": round((over35 / tot_ms) * 100, 1),
                "under_35": round((1.0 - (over35 / tot_ms)) * 100, 1),

                # Karşılıklı Gol
                "btts_yes": round((btts_yes / tot_ms) * 100, 1),
                "btts_no": round((1.0 - (btts_yes / tot_ms)) * 100, 1)
            },
            "top_scores": top_scores,
            "team_details": {
                "home_rank": h_stats.get("rank", 5),
                "away_rank": a_stats.get("rank", 8),
                "home_form": h_stats.get("form", ["G", "G", "B", "G", "M"]),
                "away_form": a_stats.get("form", ["M", "B", "G", "M", "B"]),
                "home_missing": h_stats.get("missing", "Eksik Oyuncu Yok"),
                "away_missing": a_stats.get("missing", "1 Önemli Eksik")
            }
        }
