import math

class SportsAnalyticsEngine:
    def __init__(self, rho=-0.13):
        self.rho = rho

    def _poisson(self, k, lamb):
        try:
            if lamb <= 0:
                return 1.0 if k == 0 else 0.0
            return (math.exp(-lamb) * (lamb ** k)) / math.factorial(k)
        except Exception:
            return 0.0

    def _dixon_coles_tau(self, x, y, lambda_h, mu_a):
        try:
            if x == 0 and y == 0: return 1.0 - (lambda_h * mu_a * self.rho)
            elif x == 0 and y == 1: return 1.0 + (lambda_h * self.rho)
            elif x == 1 and y == 0: return 1.0 + (mu_a * self.rho)
            elif x == 1 and y == 1: return 1.0 - self.rho
            return 1.0
        except Exception:
            return 1.0

    def analyze_match(self, match_data):
        home_team = match_data.get("home_team") or "Ev Sahibi"
        away_team = match_data.get("away_team") or "Deplasman"
        
        h_stats = match_data.get("home_stats") or {}
        a_stats = match_data.get("away_stats") or {}

        # Güvenli float dönüşümü (None gelse dahi çökmez)
        try:
            h_xg_val = h_stats.get("calc_xg")
            h_xg = max(0.45, float(h_xg_val if h_xg_val is not None else 1.55))
        except (ValueError, TypeError):
            h_xg = 1.55

        try:
            a_xg_val = a_stats.get("calc_xg")
            a_xg = max(0.35, float(a_xg_val if a_xg_val is not None else 1.15))
        except (ValueError, TypeError):
            a_xg = 1.15

        h_1h, a_1h = h_xg * 0.44, a_xg * 0.44
        h_2h, a_2h = h_xg * 0.56, a_xg * 0.56

        ms_h, ms_d, ms_a = 0.0, 0.0, 0.0
        o15, o25, o35 = 0.0, 0.0, 0.0
        btts_yes = 0.0
        matrix = []

        for h in range(7):
            for a in range(7):
                p = max(0.0, self._poisson(h, h_xg) * self._poisson(a, a_xg) * self._dixon_coles_tau(h, a, h_xg, a_xg))
                if h > a: ms_h += p
                elif h == a: ms_d += p
                else: ms_a += p

                tg = h + a
                if tg > 1.5: o15 += p
                if tg > 2.5: o25 += p
                if tg > 3.5: o35 += p
                if h > 0 and a > 0: btts_yes += p

                matrix.append((f"{h}-{a}", p))

        # Devre Dağılımları
        iy_h, iy_d, iy_a = 0.0, 0.0, 0.0
        for h in range(5):
            for a in range(5):
                p = self._poisson(h, h_1h) * self._poisson(a, a_1h)
                if h > a: iy_h += p
                elif h == a: iy_d += p
                else: iy_a += p

        y2_h, y2_d, y2_a = 0.0, 0.0, 0.0
        for h in range(5):
            for a in range(5):
                p = self._poisson(h, h_2h) * self._poisson(a, a_2h)
                if h > a: y2_h += p
                elif h == a: y2_d += p
                else: y2_a += p

        tot_ms = max(0.0001, ms_h + ms_d + ms_a)
        tot_iy = max(0.0001, iy_h + iy_d + iy_a)
        tot_2y = max(0.0001, y2_h + y2_d + y2_a)

        p_home = round((ms_h / tot_ms) * 100, 1)
        p_draw = round((ms_d / tot_ms) * 100, 1)
        p_away = round((ms_a / tot_ms) * 100, 1)

        volatility_warning = None
        if abs(p_home - p_away) < 7.5:
            volatility_warning = "YÜKSEK VOLATİLİTE: İki takımın kazanma ihtimali birbirine çok yakın. Modelimiz taraf tercihi yerine Gol / Devre seçeneklerine odaklanmanızı tavsiye eder."

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
                "ms_home": p_home,
                "ms_draw": p_draw,
                "ms_away": p_away,
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
                "home_form": h_stats.get("form") or ["G", "B", "G", "M", "G"],
                "away_form": a_stats.get("form") or ["M", "B", "G", "M", "B"]
            }
        }
