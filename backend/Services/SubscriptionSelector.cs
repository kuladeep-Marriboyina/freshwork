using System.Text.RegularExpressions;
using UWorldFreshdeskCopilot.Models;

namespace UWorldFreshdeskCopilot.Services;

// A customer can own several subscriptions. Decide using the one the ticket talks
// about ("refund on USMLE Step 2 Qbank" -> Step 2), not always the newest one.
public static class SubscriptionSelector
{
    // Returns the profile re-pointed at the mentioned subscription, or the original
    // profile when nothing (or more than one product) is mentioned.
    public static CustomerProfile ForTicket(CustomerProfile profile, Customer360? full, string? subject, string? description)
    {
        if (full is null || full.Subscriptions.Count < 2) return profile;

        string text = Normalize($"{subject} {description}");
        var mentioned = full.Subscriptions.Where(s => Mentions(text, s.Name)).ToList();
        if (mentioned.Count != 1) return profile;

        var sub = mentioned[0];
        bool dup = full.Payments.Any(p => p.IsDuplicate &&
            (p.Description ?? "").StartsWith(sub.Name, StringComparison.OrdinalIgnoreCase));

        return new CustomerProfile
        {
            UserId = profile.UserId,
            Email = profile.Email,
            FullName = profile.FullName,
            FailedLoginAttempts = profile.FailedLoginAttempts,
            RefundWindowDays = profile.RefundWindowDays,
            IsKnown = profile.IsKnown,
            SubscriptionName = sub.Name,
            SubscriptionStatus = sub.Status,
            UsagePercent = sub.UsagePercent,
            PurchaseDate = sub.PurchaseDate,
            IsActivated = sub.IsActivated,
            AmountPaid = sub.AmountPaid,
            HasDuplicateCharge = dup
        };
    }

    // "USMLE Step 2 Qbank" is mentioned by "step 2"/"step2"; other products by their
    // first word ("NCLEX", "MCAT", "CPA" ...).
    public static bool Mentions(string normalizedText, string subscriptionName)
    {
        string name = Normalize(subscriptionName);
        var step = Regex.Match(name, @"step (\d)");
        if (step.Success)
            return Regex.IsMatch(normalizedText, $@"\bstep ?{step.Groups[1].Value}\b");
        string key = name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        return key.Length > 1 && Regex.IsMatch(normalizedText, $@"\b{Regex.Escape(key)}\b");
    }

    private static string Normalize(string s) =>
        Regex.Replace(s.ToLowerInvariant(), @"[^a-z0-9]+", " ").Trim();
}
