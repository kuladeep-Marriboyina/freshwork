using System.Text.RegularExpressions;

namespace UWorldFreshdeskCopilot.Services;

public record IntentResult(string Intent, double Confidence);

public class IntentDetector
{
    private static readonly (string Intent, string[] Keywords)[] Patterns =
    {
        ("password_reset", new[] { "password", "reset password", "forgot password", "can't log in", "cant login", "login not working" }),
        ("account_locked", new[] { "locked", "account locked", "too many attempts", "lockout" }),
        ("refund",         new[] { "refund", "money back", "cancel and refund", "want my money" }),
        ("cancellation",   new[] { "cancel", "cancel subscription", "cancel my order", "unsubscribe" }),
        ("duplicate_charge", new[] { "charged twice", "double charge", "duplicate charge", "two charges", "charged me twice" }),
        ("extend_subscription", new[] { "extend", "extension", "more time", "transfer subscription" }),
        ("access_issue",   new[] { "activation code", "can't access", "cannot access", "course not showing", "not working", "access denied" }),
        ("billing_dispute", new[] { "chargeback", "dispute", "fraud", "lawyer", "legal", "complaint", "sue" }),
    };

    public IntentResult Detect(string? subject, string? description)
    {
        var text = ($"{subject} {description}").ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(text))
            return new IntentResult("unknown", 0.0);

        string? best = null;
        int bestHits = 0;

        foreach (var (intent, keywords) in Patterns)
        {
            int hits = keywords.Count(k => Regex.IsMatch(text, $@"\b{Regex.Escape(k)}\b"));
            if (hits > bestHits)
            {
                bestHits = hits;
                best = intent;
            }
        }

        if (best is null)
            return new IntentResult("unknown", 0.2);

        // crude confidence: one clear keyword is already a confident signal;
        // more hits push it higher (cap 0.98).
        double confidence = Math.Min(0.78 + 0.12 * bestHits, 0.98);
        return new IntentResult(best, confidence);
    }
}
