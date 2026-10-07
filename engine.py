import math

class SportsAnalyticsEngine:
    def __init__(self, rho=-0.13):
        # Dixon-Coles korelasyon katsayısı (0-0, 1-0, 0-1, 1-1 düzeltmesi)
        self.rho = rho

    def _poisson_pmf(self, k, lamb):
        if lamb <= 0:
            return 1.0 if k == 0 else 0.0
        return (math.exp(-lamb) * (lamb ** k)) / math.factorial(k)

    def _dixon_coles_tau(self, x, y, lambda_h, mu_a):
        if x == 0 and y == 0:
            return 1.0 - (lambda_h * mu_a * self.rho)
        elif x == 0 and y == 1:
            return 1.0 + (lambda_h * self.rho)
        elif x == 1 and y == 0:
            return 1.0 + (mu_a * self.rho)
        elif x == 1 and y == 1:
            return 1.0 - self.rho
        return 1.0

    def calculate_dynamic_xg(self, odds):
        """
        Bülten oranlarından (Over/Under & 1X2) ters matematik ile 
        o maça özel hakiki xG ve gol beklentisini türetir.
        Böylece her maçın kendine has yüzdesi çıkar.
        """
        o_over = float(odds.get("over25", 1.80))
        o_under = float(odds.get("under25", 1.85))
        o_home = float(odds.get("home", 2.20))
        o_away = float(odds.get("away", 3.00))

        # Marj arındırma (Vig-free fair probabilities)
        p_raw_over = 1.0 / max(1.05, o_over)
        p_raw_under = 1.0 / max(1.05, o_under)
        margin_ou = p_raw_over + p_raw_under
        p_fair_over = p_raw_over / margin_ou

        # 2.5 Üst olasılığından toplam beklenen gol (Total xG)
        # Örn: %70 üst -> 3.3 gol, %40 üst -> 2.1 gol
        total_xg = 1.40 + (p_fair_over * 2.30)

        # 1X2 oranlarından takımların güç dağılımı
        p_raw_home = 1.0 / max(1.05, o_home)
        p_raw_away = 1.0 / max(1.05, o_away)
        home_strength_ratio = p_raw_home / (p_raw_home + p_raw_away)

        home_xg = max(0.60, total_xg * home_strength_ratio)
        away_xg = max(0.50, total_xg - home_xg)

        return round(home_xg, 2), round(away_xg, 2)

    def analyze_match(self, match_data):
        odds = match_data.get("odds", {})
        home_xg, away_xg = self.calculate_dynamic_xg(odds)

        max_goals = 7
        score_matrix = {}
        prob_home, prob_draw, prob_away = 0.0, 0.0, 0.0
        prob_over25, prob_btts = 0.0, 0.0
        score_list = []

        for h in range(max_goals + 1):
            for a in range(max_goals + 1):
                p_base = self._poisson_pmf(h, home_xg) * self._poisson_pmf(a, away_xg)
                tau = self._dixon_coles_tau(h, a, home_xg, away_xg)
                p_final = max(0.0, p_base * tau)

                score_matrix[(h, a)] = p_final
                score_list.append(((h, a), p_final))

                if h > a: prob_home += p_final
                elif h == a: prob_draw += p_final
                else: prob_away += p_final

                if (h + a) > 2.5: prob_over25 += p_final
                if h > 0 and a > 0: prob_btts += p_final

        total_p = prob_home + prob_draw + prob_away
        if total_p > 0:
            prob_home /= total_p
            prob_draw /= total_p
            prob_away /= total_p
            prob_over25 /= total_p
            prob_btts /= total_p

        score_list.sort(key=lambda x: x[1], reverse=True)
        top_scores = [
            {"score": f"{s[0][0]}-{s[0][1]}", "prob": f"%{round(s[1]*100, 1)}"}
            for s in score_list[:3]
        ]

        entropy = 0.0
        for p in [prob_home, prob_draw, prob_away]:
            if p > 0: entropy -= p * math.log2(p)

        value_scenarios = []
        markets = [
            ("MS 1", float(odds.get("home", 0)), prob_home),
            ("MS X", float(odds.get("draw", 0)), prob_draw),
            ("MS 2", float(odds.get("away", 0)), prob_away),
            ("2.5 Üst", float(odds.get("over25", 0)), prob_over25),
            ("2.5 Alt", float(odds.get("under25", 0)), 1.0 - prob_over25),
            ("KG Var", float(odds.get("btts_yes", 0)), prob_btts),
            ("KG Yok", float(odds.get("btts_no", 0)), 1.0 - prob_btts)
        ]

        for m_name, odd, prob in markets:
            if odd > 1.0:
                ev = (prob * odd) - 1.0
                if ev >= 0.04:  # %4 ve üzeri reel +EV
                    value_scenarios.append({
                        "market": m_name,
                        "bulten_orani": str(odd),
                        "expected_value": f"+%{round(ev * 100, 1)} EV"
                    })

        return {
            "match": f"{match_data.get('home_team')} vs {match_data.get('away_team')}",
            "entropy": round(entropy, 2),
            "expected_goals": {"home": home_xg, "away": away_xg},
            "probabilities": {
                "home_win": round(prob_home * 100, 1),
                "draw": round(prob_draw * 100, 1),
                "away_win": round(prob_away * 100, 1),
                "over_25": round(prob_over25 * 100, 1),
                "under_25": round((1.0 - prob_over25) * 100, 1)
            },
            "top_predicted_scores": top_scores,
            "value_scenarios": value_scenarios
        }
