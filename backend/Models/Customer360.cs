namespace UWorldFreshdeskCopilot.Models;

// Richer data model for the "Customer 360" module (user + subscriptions + payments).
public class UserAccount
{
    public long UserId { get; set; }
    public string Email { get; set; } = "";
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Country { get; set; } = "";
    public string AccountStatus { get; set; } = "";
    public DateOnly MemberSince { get; set; }
    public int FailedLoginAttempts { get; set; }
}

public class SubscriptionRecord
{
    public long SubscriptionId { get; set; }
    public string Name { get; set; } = "";
    public string Status { get; set; } = "";
    public int UsagePercent { get; set; }
    public DateOnly PurchaseDate { get; set; }
    public DateOnly ExpiryDate { get; set; }
    public decimal AmountPaid { get; set; }
    public bool IsActivated { get; set; }
    public bool AutoRenew { get; set; }
}

public class PaymentRecord
{
    public string PaymentId { get; set; } = "";
    public DateOnly Date { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "USD";
    public string Method { get; set; } = "";
    public string Status { get; set; } = "";
    public string Description { get; set; } = "";
    public bool IsDuplicate { get; set; }
}

public class Customer360
{
    public UserAccount? User { get; set; }
    public List<SubscriptionRecord> Subscriptions { get; set; } = new();
    public List<PaymentRecord> Payments { get; set; } = new();

    public decimal TotalPaid => Payments.Where(p => p.Status == "Succeeded").Sum(p => p.Amount);
    public int ActiveSubscriptions => Subscriptions.Count(s => s.Status == "Active");
}
