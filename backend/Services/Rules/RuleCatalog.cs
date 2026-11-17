using UWorldFreshdeskCopilot.Models;

namespace UWorldFreshdeskCopilot.Services.Rules;

// ─────────────────────────────────────────────────────────────────────────────
// Rule catalog. Rules are evaluated in DI-registration order (see Program.cs);
// first match wins. Each rule is small and self-contained. Add a new scenario by
// writing a new class here and registering it in Program.cs.
//
// SAFETY: BillingDisputeRule is registered FIRST so sensitive tickets can never be
// auto-answered, regardless of other matches.
// ─────────────────────────────────────────────────────────────────────────────

// 0. Safety allow-list: disputes / legal / chargebacks -> always a human.
public class BillingDisputeRule : IPolicyRule
{
    public string Name => "billing_dispute_human_only";
    public bool Matches(PolicyContext ctx) => ctx.Intent == "billing_dispute";
    public Decision Evaluate(PolicyContext ctx) => PolicyDecisions.AgentReview(Name,
        "Sensitive intent (dispute/chargeback/legal). Never auto-respond — escalate to a specialist.",
        new[]
        {
            "Do NOT send an automated reply.",
            "Escalate to the billing/legal specialist queue.",
            "Review payment history and prior tickets before responding."
        });
}

// 1. Password reset -> auto-resolve with a temp password.
public class PasswordResetRule : IPolicyRule
{
    private readonly TempPasswordService _pw;
    public PasswordResetRule(TempPasswordService pw) => _pw = pw;

    public string Name => "password_reset_auto";
    public bool Matches(PolicyContext ctx) => ctx.Intent == "password_reset";

    public Decision Evaluate(PolicyContext ctx)
    {
        var temp = _pw.Generate();
        return PolicyDecisions.Auto(PolicyAction.AutoResolve, Name, 0.97,
            "Password reset is a safe, deterministic action — temp password issued automatically.",
            EmailTemplates.PasswordReset(ctx.Customer.FullName, temp));
    }
}

// 2. Account locked -> auto unlock + notify.
public class AccountLockedRule : IPolicyRule
{
    public string Name => "account_locked_auto_unlock";
    public bool Matches(PolicyContext ctx) =>
        ctx.Intent == "account_locked" &&
        ctx.Customer.FailedLoginAttempts >= ctx.Options.AccountLockAttemptsThreshold;

    public Decision Evaluate(PolicyContext ctx) => PolicyDecisions.Auto(
        PolicyAction.AutoResolve, Name, 0.95,
        $"Account locked after {ctx.Customer.FailedLoginAttempts} failed attempts — auto-unlocked.",
        EmailTemplates.AccountUnlocked(ctx.Customer.FullName));
}

// 3. Duplicate charge detected in DB -> auto refund the duplicate.
public class DuplicateChargeRule : IPolicyRule
{
    public string Name => "duplicate_charge_auto_refund";
    public bool Matches(PolicyContext ctx) =>
        ctx.Intent is "duplicate_charge" or "refund" && ctx.Customer.HasDuplicateCharge;

    public Decision Evaluate(PolicyContext ctx) => PolicyDecisions.Auto(
        PolicyAction.AutoApprove, Name, 0.96,
        "Duplicate charge confirmed in billing records — extra payment auto-refunded.",
        EmailTemplates.DuplicateRefund(ctx.Customer.FullName, ctx.Customer.AmountPaid));
}

// 4. Cancellation before activation -> auto approve full refund.
public class CancellationBeforeActivationRule : IPolicyRule
{
    public string Name => "cancel_before_activation_auto";
    public bool Matches(PolicyContext ctx) =>
        ctx.Intent is "cancellation" or "refund" &&
        !ctx.Customer.IsActivated && ctx.Customer.UsagePercent == 0;

    public Decision Evaluate(PolicyContext ctx) => PolicyDecisions.Auto(
        PolicyAction.AutoApprove, Name, 0.94,
        "Subscription never activated and unused — cancellation + full refund auto-approved.",
        EmailTemplates.CancellationBeforeActivation(
            ctx.Customer.FullName, ctx.Customer.SubscriptionName, ctx.Customer.AmountPaid));
}

// 5. Refund — heavily used OR window closed -> auto DENY with reason.
public class RefundDenyRule : IPolicyRule
{
    public string Name => "refund_used_or_expired_auto_deny";
    public bool Matches(PolicyContext ctx)
    {
        if (ctx.Intent != "refund") return false;
        var c = ctx.Customer;
        bool heavilyUsed = c.UsagePercent >= ctx.Options.RefundUsageDenyThresholdPercent;
        bool windowClosed = !c.WithinRefundWindow(ctx.Today);
        return heavilyUsed || windowClosed;
    }

    public Decision Evaluate(PolicyContext ctx)
    {
        var c = ctx.Customer;
        int days = c.DaysSincePurchase(ctx.Today);
        return PolicyDecisions.Auto(PolicyAction.AutoDeny, Name, 0.93,
            $"Refund not allowed: usage {c.UsagePercent}% (deny ≥{ctx.Options.RefundUsageDenyThresholdPercent}%), " +
            $"purchased {days}d ago (window {c.RefundWindowDays}d).",
            EmailTemplates.RefundDenied(c.FullName, c.SubscriptionName, c.UsagePercent, days, c.RefundWindowDays));
    }
}

// 6. Refund — within window & low usage -> auto APPROVE.
public class RefundApproveRule : IPolicyRule
{
    public string Name => "refund_within_window_low_usage_auto_approve";
    public bool Matches(PolicyContext ctx)
    {
        if (ctx.Intent != "refund") return false;
        var c = ctx.Customer;
        return c.WithinRefundWindow(ctx.Today) &&
               c.UsagePercent < ctx.Options.RefundBorderlineLowerPercent;
    }

    public Decision Evaluate(PolicyContext ctx) => PolicyDecisions.Auto(
        PolicyAction.AutoApprove, Name, 0.92,
        $"Within {ctx.Customer.RefundWindowDays}-day window and low usage ({ctx.Customer.UsagePercent}%) — refund auto-approved.",
        EmailTemplates.RefundApproved(ctx.Customer.FullName, ctx.Customer.SubscriptionName, ctx.Customer.AmountPaid));
}

// 7. Refund — borderline (mid usage / near window edge) -> AGENT REVIEW.
public class RefundBorderlineRule : IPolicyRule
{
    public string Name => "refund_borderline_agent_review";
    public bool Matches(PolicyContext ctx) => ctx.Intent == "refund"; // remaining refund cases

    public Decision Evaluate(PolicyContext ctx)
    {
        var c = ctx.Customer;
        int days = c.DaysSincePurchase(ctx.Today);
        return PolicyDecisions.AgentReview(Name,
            $"Borderline refund: usage {c.UsagePercent}%, purchased {days}d ago (window {c.RefundWindowDays}d). Needs human judgment.",
            new[]
            {
                $"Review usage ({c.UsagePercent}%) and time since purchase ({days} of {c.RefundWindowDays} days).",
                "Check for extenuating circumstances in the customer's message.",
                "If goodwill refund is warranted, process it; otherwise offer an extension or partial credit.",
                "Reply to the customer with the decision."
            });
    }
}

// 8. Access / activation code issue -> AGENT REVIEW with DB facts.
public class AccessIssueRule : IPolicyRule
{
    public string Name => "access_issue_agent_review";
    public bool Matches(PolicyContext ctx) => ctx.Intent == "access_issue";

    public Decision Evaluate(PolicyContext ctx)
    {
        var c = ctx.Customer;
        return PolicyDecisions.AgentReview(Name,
            $"Access issue on '{c.SubscriptionName}' (status: {c.SubscriptionStatus}, activated: {c.IsActivated}).",
            new[]
            {
                $"Confirm subscription '{c.SubscriptionName}' status is '{c.SubscriptionStatus}'.",
                c.IsActivated ? "Subscription shows activated — check for a region/device access block."
                              : "Subscription NOT activated — resend or re-issue the activation code.",
                "Verify the customer is logging into the correct account/email.",
                "If still blocked, escalate to platform support."
            });
    }
}

// 9. Extend / transfer subscription -> auto approve if within window, else review.
public class ExtendSubscriptionRule : IPolicyRule
{
    public string Name => "extend_subscription";
    public bool Matches(PolicyContext ctx) => ctx.Intent == "extend_subscription";

    public Decision Evaluate(PolicyContext ctx)
    {
        var c = ctx.Customer;
        if (c.WithinRefundWindow(ctx.Today))
            return PolicyDecisions.Auto(PolicyAction.AutoApprove, Name, 0.9,
                "Extension requested within the eligible window — auto-approved.",
                EmailTemplates.Wrap(c.FullName,
                    $"<p>We've applied an extension to your <strong>{c.SubscriptionName}</strong> subscription. Enjoy the extra time!</p>"));

        return PolicyDecisions.AgentReview(Name,
            "Extension requested outside the standard window — needs agent approval.",
            new[]
            {
                "Check remaining subscription duration and prior extensions.",
                "Decide on a courtesy extension per policy.",
                "Apply the extension and notify the customer."
            });
    }
}
