namespace UWorldFreshdeskCopilot.Models;

public class FreshdeskWebhookPayload
{
    public long TicketId { get; set; }
    public string? Subject { get; set; }
    public string? Description { get; set; }
    public string? Email { get; set; }
}

public enum PolicyAction
{
    AutoResolve,
    AutoApprove,
    AutoDeny,
    AgentReview
}

public class CustomerProfile
{
    public string Email { get; set; } = "";
    public string FullName { get; set; } = "";
    public string SubscriptionName { get; set; } = "";
    public string SubscriptionStatus { get; set; } = "";
    public int UsagePercent { get; set; }
    public DateOnly PurchaseDate { get; set; }
    public int RefundWindowDays { get; set; }
    public bool IsActivated { get; set; }
    public int FailedLoginAttempts { get; set; }
    public bool HasDuplicateCharge { get; set; }
    public decimal AmountPaid { get; set; }

    public int DaysSincePurchase(DateOnly today) => today.DayNumber - PurchaseDate.DayNumber;
    public bool WithinRefundWindow(DateOnly today) => DaysSincePurchase(today) <= RefundWindowDays;
}

public class SuggestedStep
{
    public int Order { get; set; }
    public string Text { get; set; } = "";
}

public class Decision
{
    public PolicyAction Action { get; set; }
    public double Confidence { get; set; }
    public string RuleName { get; set; } = "";
    public string Reason { get; set; } = "";
    public string? CustomerEmailHtml { get; set; }
    public List<SuggestedStep> SuggestedSteps { get; set; } = new();

    public bool IsAutoSend =>
        Action is PolicyAction.AutoResolve or PolicyAction.AutoApprove or PolicyAction.AutoDeny;
}

public class TicketInsights
{
    public CustomerProfile? Customer { get; set; }
    public string Intent { get; set; } = "";
    public PolicyAction RecommendedAction { get; set; }
    public double Confidence { get; set; }
    public string Reason { get; set; } = "";
    public List<SuggestedStep> SuggestedSteps { get; set; } = new();
    public bool WasAutoHandled { get; set; }
    public string? SuggestedReplyHtml { get; set; }
}

public record TicketActionBody(string? Html, bool Resolve = false);
