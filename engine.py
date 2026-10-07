import math

class SportsAnalyticsEngine:
    def __init__(self, rho=-0.13):
        # Dixon-Coles düşük skor (0-0, 1-1, 1-0, 0-1) düzeltme katsayısı
        self.rho = rho

    def _poisson(self, k, lamb):
        if lamb <= 0:
            return 1.0 if k == 0 else 0.0
        return (math.exp(-lamb) * (lamb ** k)) / math.factorial(k)

    def _dixon_coles_tau(self, x, y, lambda_h, mu_a):
        """Gerçek futboldaki skor koruma psikolojisini modellediğimiz katsayı"""
        if x == 0 and y == 0:
            return 1.0 - (lambda_h * mu_a * self.rho)
        elif x == 0 and y == 1:
            return 1.0 + (lambda_h * self.rho)
        elif x == 1 and y == 0:
            return 1.0 + (mu_a * self.rho)
        elif x == 1 and y == 1:
            return 1.0 - self.rho
        return 1.0

    def analyze_match(self, match_data):
        home_team = match_data.get("home_team", "Ev Sahibi")
        away_team = match_data.get("away_team", "Deplasman")
        
        h_stats = match_data.get("home_stats", {})
        a_stats = match_data.get("away_stats", {})

        # Form ve Saha Çarpanlı xG
        h_xg = max(0.45, float(h_stats.get("calc_xg", 1.55)))
        a_xg = max(0.35, float(a_stats.get("calc_xg", 1.15)))

        # Devre dağılımları (İlk yarı %44, İkinci yarı %56)
        h_1h, a_1h = h_xg * 0.44, a_xg * 0.44
        h_2h, a_2h = h_xg * 0.56, a_xg * 0.56

        # MAÇ SONU (Dixon-Coles matrisi)
        ms_h, ms_d, ms_a = 0.0, 0.0, 0.0
        o15, o25, o35 = 0.0, 0.0, 0.0
        btts_yes = 0.0
        matrix = []

        for h in range(7):
            for a in range(7):
                p_base = self._poisson(h, h_xg) * self._poisson(a, a_xg)
                tau = self._dixon_coles_tau(h, a, h_xg, a_xg)
                p = max(0.0, p_base * tau)

                if h > a: ms_h += p
                elif h == a: ms_d += p
                else: ms_a += p

                tg = h + a
                if tg > 1.5: o15 += p
                if tg > 2.5: o25 += p
                if tg > 3.5: o35 += p
                if h > 0 and a > 0: btts_yes += p

                matrix.append((f"{h}-{a}", p))

        # İLK YARI
        iy_h, iy_d, iy_a = 0.0, 0.0, 0.0
        for h in range(5):
            for a in range(5):
                p = self._poisson(h, h_1h) * self._poisson(a, a_1h)
                if h > a: iy_h += p
                elif h == a: iy_d += p
                else: iy_a += p

        # İKİNCİ YARI
        y2_h, y2_d, y2_a = 0.0, 0.0, 0.0
        for h in range(5):
            for a in range(5):
                p = self._poisson(h, h_2h) * self._poisson(a, a_2h)
                if h > a: y2_h += p
                elif h == a: y2_d += p
                else: y2_a += p

        tot_ms = ms_h + ms_d + ms_a or 1.0
        tot_iy = iy_h + iy_d + iy_a or 1.0
        tot_2y = y2_h + y2_d + y2_a or 1.0

        p_home_win = round((ms_h / tot_ms) * 100, 1)
        p_away_win = round((ms_a / tot_ms) * 100, 1)

        # VOLATİLİTE / DERBİ TESPİTİ
        h_rank = h_stats.get("rank")
        a_rank = a_stats.get("rank")
        is_top_match = isinstance(h_rank, int) and isinstance(a_rank, int) and h_rank <= 4 and a_rank <= 4
        is_close_odds = abs(p_home_win - p_away_win) < 9.0

        volatility_warning = None
        if is_top_match or is_close_odds:
            volatility_warning = "YÜKSEK VOLATİLİTE: Bu karşılaşmada taraf tercihi risklidir. Modelimiz Gol Baremleri veya Devre seçeneklerine odaklanmanızı önerir."

        matrix.sort(key=lambda x: x[1], reverse=True)
        top_scores = [
            {"score": s[0], "prob": f"%{round((s[1]/tot_ms)*100, 1)}"}
            for s in matrix[:3]
        ]

        return {
            "match": f"{home_team} vs {away_team}",
            "home_team": home_team,
            "away_team": away_team,
            "volatility_warning": volatility_warning,
            "analysis": {
                "ms_home": p_home_win,
                "ms_draw": round((ms_d / tot_ms) * 100, 1),
                "ms_away": p_away_win,
                "iy_home": round((iy_h / tot_iy) * 100, 1),
                "iy_draw": round((iy_d / tot_iy) * 100, 1),
                "iy_away": round((iy_a / tot_iy) * 100, 1),
                "y2_home": round((y2_h / tot_2y) * 100, 1),
                "y2_draw": round((y2_d / tot_2y) * 100, 1),
                "y2_away": round((y2_a / tot_2y) * 100, 1),
                "over_15": round((o15 / tot_ms) * 100, 1),
                "over_25": round((o25 / tot_ms) * 100, 1),
                "over_35": round((o35 / tot_ms) * 100, 1),
                "btts_yes": round((btts_yes / tot_ms) * 100, 1),
                "btts_no": round((1.0 - (btts_yes / tot_ms)) * 100, 1)
            },
            "top_scores": top_scores,
            "team_details": {
                "home_rank": h_stats.get("rank", "-"),
                "away_rank": a_stats.get("rank", "-"),
                "home_points": h_stats.get("points", "-"),
                "away_points": a_stats.get("points", "-"),
                "home_form": h_stats.get("form", ["G", "B", "G", "M", "G"]),
                "away_form": a_stats.get("form", ["M", "B", "G", "M", "B"])
            }
        }
