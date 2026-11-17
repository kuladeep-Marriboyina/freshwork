using UWorldFreshdeskCopilot.Models;

namespace UWorldFreshdeskCopilot.Services;

// Single source of truth for demo data: seeds the known showcase customers and
// generates hundreds more deterministically. Both the policy data service and the
// 360 data service read from here, so a customer's data and their copilot decision
// always line up.
public class DemoCustomer
{
    public required Customer360 Full { get; init; }
    public required CustomerProfile Profile { get; init; }
    public required string Subject { get; init; }
    public required string Description { get; init; }
    public required string Label { get; init; }
    public string Email => Full.User!.Email;
}

public static class SampleDataStore
{
    public static readonly DateOnly Today = new(2026, 11, 17);
    private const int GeneratedCount = 300;

    // Lazy so these build AFTER all the static data arrays below are initialized.
    private static readonly Lazy<List<DemoCustomer>> _ordered = new(Build);
    // Several demo users may share one email (e.g. the demo inbox), so index as a lookup.
    private static readonly Lazy<ILookup<string, DemoCustomer>> _byEmail =
        new(() => _ordered.Value.ToLookup(c => c.Email, StringComparer.OrdinalIgnoreCase));

    public static IReadOnlyList<DemoCustomer> All => _ordered.Value;

    // Primary (first) user for an email.
    public static DemoCustomer? Get(string email) => _byEmail.Value[email].FirstOrDefault();

    public static IReadOnlyList<DemoCustomer> GetAllByEmail(string email) => _byEmail.Value[email].ToList();

    public static DemoCustomer? GetByUserId(long userId) =>
        _ordered.Value.FirstOrDefault(c => c.Full.User?.UserId == userId);

    // When several users share the email, pick the one the ticket names — by UWorld
    // user ID or full name — otherwise the primary user.
    public static DemoCustomer? Resolve(string email, string? text)
    {
        var users = GetAllByEmail(email);
        if (users.Count <= 1 || string.IsNullOrWhiteSpace(text)) return users.FirstOrDefault();
        var t = text.ToLowerInvariant();
        return users.FirstOrDefault(u => u.Full.User is { } a && a.UserId > 0 && t.Contains(a.UserId.ToString()))
            ?? users.FirstOrDefault(u => u.Full.User is { } a && t.Contains(a.FullName.ToLowerInvariant()))
            ?? users[0];
    }

    // ── deterministic RNG (stable across runs; no Math.Random/Date) ──────────────
    private sealed class Rng
    {
        private long _s;
        public Rng(int seed) { _s = seed * 2654435761L + 1013904223L; }
        public int Next(int mod)
        {
            unchecked { _s = _s * 6364136223846793005L + 1442695040888963407L; }
            ulong x = (ulong)_s;
            return (int)((x >> 33) % (ulong)mod);
        }
    }

    private static readonly string[] First =
    {
        "Aarav","Priya","Alex","Sam","Jordan","Robin","Taylor","Maya","Liam","Noah",
        "Emma","Olivia","Arjun","Sara","Kiran","Dev","Neha","Rahul","Anita","Vikram",
        "Chloe","Ethan","Zoe","Omar","Lina","Hassan","Mia","Lucas","Isha","Rohan"
    };
    private static readonly string[] Last =
    {
        "Nair","Morgan","Lee","Diaz","Shah","Brooks","Patel","Khan","Reddy","Gupta",
        "Smith","Johnson","Garcia","Kumar","Mehta","Verma","Iyer","Das","Bose","Rao"
    };
    private static readonly string[] Countries = { "India", "USA", "UK", "Canada", "UAE", "Australia" };
    private static readonly string[] Methods =
        { "Visa •••• 4242", "Mastercard •••• 8888", "Amex •••• 1007", "Visa •••• 1111", "RuPay •••• 2020" };

    private static readonly (string Name, decimal Price)[] Catalog =
    {
        ("USMLE Step 1 Qbank", 319m), ("USMLE Step 2 Qbank", 299m), ("USMLE Step 3 Qbank", 279m),
        ("NCLEX Qbank", 199m), ("MCAT Qbank", 429m), ("SAT Qbank", 149m),
        ("CPA Review", 999m), ("LSAT Qbank", 249m)
    };

    // Scenario kinds drive the generated profile so the decision is predictable.
    private enum Kind { RefundDeny, RefundApprove, RefundBorderline, Duplicate, Locked, CancelPreActivation, PasswordReset, AccessIssue, BillingDispute }

    private static readonly (string Subject, string Desc, string Label)[] ScenarioText =
    {
        ("Refund request", "I want a refund", "Refund — heavily used"),
        ("Refund request", "I want a refund, I barely used it", "Refund — low usage, in window"),
        ("Refund request", "refund, I barely used it", "Refund — borderline"),
        ("Charged twice", "I was charged twice, duplicate charge", "Duplicate charge"),
        ("Account locked", "my account is locked, too many attempts", "Account locked"),
        ("Cancel subscription", "please cancel subscription and refund", "Cancel before activation"),
        ("Password reset", "I forgot my password, please reset", "Password reset"),
        ("Access issue", "my activation code is not working", "Access / activation issue"),
        ("Billing dispute", "I'll file a chargeback and call my lawyer", "Billing dispute (human only)"),
    };

    private static List<DemoCustomer> Build()
    {
        var list = new List<DemoCustomer>();

        // ── Seeded showcase customers (stable emails used elsewhere in the demo) ──
        list.Add(DemoAccount());
        // ── Shared demo inbox: different people, same email (pushpabaivadithe522@gmail.com).
        //    A ticket picks the person by naming them or their user ID. ──
        const string Inbox = "pushpabaivadithe522@gmail.com";
        list.Add(Make(9000001, Inbox, "Ravi Kumar",   "+91 90001 00001", "India", Kind.RefundApprove,       9101, "NCLEX Qbank",        3,  2, 199m, memberDays: 2,   labelOverride: "Ravi Kumar — refund, low usage (auto-approve)"));
        list.Add(Make(9000002, Inbox, "Ananya Rao",   "+91 90001 00002", "India", Kind.RefundDeny,          9102, "USMLE Step 1 Qbank", 85, 40, 319m, memberDays: 300, labelOverride: "Ananya Rao — refund, heavily used (auto-deny)"));
        list.Add(Make(9000003, Inbox, "Kiran Reddy",  "+91 90001 00003", "India", Kind.Duplicate,           9103, "USMLE Step 2 Qbank", 10,  1, 299m, memberDays: 40,  labelOverride: "Kiran Reddy — charged twice (auto-refund duplicate)"));
        list.Add(Make(9000004, Inbox, "Meera Iyer",   "+91 90001 00004", "India", Kind.Locked,              9104, "MCAT Qbank",         40, 20, 429m, memberDays: 150, failed: 8, labelOverride: "Meera Iyer — account locked (auto-unlock)"));
        list.Add(Make(9000005, Inbox, "Arjun Mehta",  "+91 90001 00005", "India", Kind.CancelPreActivation, 9105, "USMLE Step 3 Qbank",  0,  3, 279m, memberDays: 3,   labelOverride: "Arjun Mehta — cancel before activation (auto full refund)"));
        list.Add(Make(9000006, Inbox, "Sneha Patel",  "+91 90001 00006", "India", Kind.RefundBorderline,    9106, "MCAT Qbank",         30, 12, 429m, memberDays: 20,  labelOverride: "Sneha Patel — borderline refund (agent review)"));
        list.Add(Make(9000007, Inbox, "Vikram Das",   "+91 90001 00007", "India", Kind.PasswordReset,       9107, "USMLE Step 1 Qbank", 50, 90, 319m, memberDays: 500, labelOverride: "Vikram Das — password reset (auto temp password)"));
        list.Add(Make(9000008, Inbox, "Lakshmi Nair", "+91 90001 00008", "India", Kind.AccessIssue,         9108, "NCLEX Qbank",        15,  5, 199m, memberDays: 10,  labelOverride: "Lakshmi Nair — activation issue (agent review)"));
        list.Add(Make(9000009, Inbox, "Rahul Verma",  "+91 90001 00009", "India", Kind.BillingDispute,      9109, "CPA Review",         70, 45, 999m, memberDays: 365, labelOverride: "Rahul Verma — billing dispute (human only)"));

        list.Add(Make(40010, "used.customer@example.com", "Priya Nair", "+91 98888 00000", "India",
            Kind.RefundDeny, 7001, "USMLE Step 1 Qbank", 80, 40, 319m, memberDays: 200));
        list.Add(Make(40002, "fresh.customer@example.com", "Alex Morgan", "+1 212 555 0190", "USA",
            Kind.RefundApprove, 6002, "NCLEX Qbank", 3, 2, 199m, memberDays: 2));
        list.Add(Make(40011, "borderline.customer@example.com", "Sam Lee", "+1 646 555 0110", "USA",
            Kind.RefundBorderline, 7002, "MCAT Qbank", 30, 12, 429m, memberDays: 15));
        list.Add(Make(40001, "duplicate.customer@example.com", "Taylor Brooks", "+1 415 555 0132", "USA",
            Kind.Duplicate, 6001, "NCLEX Qbank", 10, 1, 199m, memberDays: 30));
        list.Add(Make(40012, "locked.customer@example.com", "Jordan Diaz", "+1 305 555 0144", "USA",
            Kind.Locked, 7003, "USMLE Step 2 Qbank", 45, 20, 319m, memberDays: 100, failed: 7));
        list.Add(Make(40013, "notactivated.customer@example.com", "Robin Shah", "+91 90000 11111", "India",
            Kind.CancelPreActivation, 7004, "MCAT Qbank", 0, 3, 429m, memberDays: 3));

        // ── Generated population ─────────────────────────────────────────────────
        for (int i = 0; i < GeneratedCount; i++)
        {
            var rng = new Rng(i + 101);
            var kind = (Kind)(i % 9);
            string first = First[i % First.Length];
            string last = Last[(i / First.Length) % Last.Length];
            string name = $"{first} {last}";
            long userId = 100000 + i;
            string email = $"{first}.{last}{i}".ToLowerInvariant() + "@example.com";
            string country = Countries[rng.Next(Countries.Length)];
            var (subName, price) = Catalog[rng.Next(Catalog.Length)];

            int usage; int daysAgo; bool activated = true; int failed = 0; bool dup = false; string status = "Active";
            switch (kind)
            {
                case Kind.RefundDeny: usage = 55 + rng.Next(40); daysAgo = 20 + rng.Next(40); break;
                case Kind.RefundApprove: usage = 1 + rng.Next(14); daysAgo = 1 + rng.Next(8); break;
                case Kind.RefundBorderline: usage = 22 + rng.Next(16); daysAgo = 10 + rng.Next(4); break;
                case Kind.Duplicate: usage = 5 + rng.Next(15); daysAgo = 1 + rng.Next(5); dup = true; break;
                case Kind.Locked: usage = 30 + rng.Next(40); daysAgo = 10 + rng.Next(30); failed = 5 + rng.Next(5); status = "Locked"; break;
                case Kind.CancelPreActivation: usage = 0; daysAgo = 1 + rng.Next(6); activated = false; status = "Pending"; break;
                case Kind.PasswordReset: usage = rng.Next(60); daysAgo = rng.Next(120); break;
                case Kind.AccessIssue: usage = rng.Next(50); daysAgo = rng.Next(60); break;
                default: usage = 40 + rng.Next(50); daysAgo = 15 + rng.Next(60); break; // BillingDispute
            }

            string phone = country == "India" ? $"+91 9{rng.Next(9)}{rng.Next(9)}00 0{rng.Next(9)}{rng.Next(9)}{rng.Next(9)}"
                                              : $"+1 {200 + rng.Next(700)} 555 0{rng.Next(9)}{rng.Next(9)}{rng.Next(9)}";

            list.Add(Make(userId, email, name, phone, country, kind, 200000 + i, subName,
                usage, daysAgo, price, memberDays: 30 + rng.Next(700), failed: failed, dup: dup,
                statusOverride: status, activatedOverride: activated, methodIdx: rng.Next(Methods.Length)));
        }

        return list;
    }

    // pushpabaivadithe522@gmail.com — one real inbox holding every scenario. Each
    // subscription is in a different state; the decision uses the subscription the
    // ticket mentions (see SubscriptionSelector), the account itself is locked.
    private static DemoCustomer DemoAccount()
    {
        var c = Make(30002129792, "pushpabaivadithe522@gmail.com", "Pushpa Vadithe", "+91 90000 00000", "India",
            Kind.RefundDeny, 5001, "USMLE Step 1 Qbank", 78, 35, 319m,
            subjOverride: "Refund for USMLE Step 1 Qbank", descOverride: "I want a refund for my USMLE Step 1 Qbank",
            labelOverride: "Demo account — all scenarios (mention the product in the ticket)",
            memberDays: 400, failed: 7);
        const string card = "Visa •••• 4242";
        void Add(long id, string name, string status, int usage, int daysAgo, decimal amount, bool activated, bool dup = false)
        {
            var purchase = Today.AddDays(-daysAgo);
            c.Full.Subscriptions.Add(new SubscriptionRecord { SubscriptionId = id, Name = name, Status = status,
                UsagePercent = usage, PurchaseDate = purchase, ExpiryDate = purchase.AddDays(365),
                AmountPaid = amount, IsActivated = activated, AutoRenew = false });
            c.Full.Payments.Add(new PaymentRecord { PaymentId = $"PAY-{id}", Date = purchase, Amount = amount,
                Method = card, Status = "Succeeded", Description = name });
            if (dup)
                c.Full.Payments.Add(new PaymentRecord { PaymentId = $"PAY-{id}D", Date = purchase, Amount = amount,
                    Method = card, Status = "Succeeded", Description = name + " (duplicate)", IsDuplicate = true });
        }
        Add(5002, "NCLEX Qbank",        "Active",  3,  2, 199m, activated: true);              // refund -> auto-approve
        Add(5003, "MCAT Qbank",         "Active", 30, 12, 429m, activated: true);              // refund -> borderline review
        Add(5004, "USMLE Step 2 Qbank", "Active", 10,  1, 299m, activated: true, dup: true);   // charged twice -> auto-refund duplicate
        Add(5005, "USMLE Step 3 Qbank", "Pending", 0,  3, 279m, activated: false);             // cancel -> auto full refund
        c.Full.User!.AccountStatus = "Locked";                                                 // account locked -> auto-unlock
        return c;
    }

    private static DemoCustomer Make(
        long userId, string email, string name, string phone, string country, Kind kind,
        long subId, string subName, int usage, int daysAgo, decimal amount,
        int memberDays = 60, int failed = 0, bool dup = false,
        string? statusOverride = null, bool? activatedOverride = null, int methodIdx = 0,
        string? subjOverride = null, string? descOverride = null, string? labelOverride = null,
        (long Id, string Name, string Status, int Usage, int DaysAgo, decimal Amount)? extra = null)
    {
        var (subj, desc, label) = ScenarioText[(int)kind];
        subj = subjOverride ?? subj; desc = descOverride ?? desc; label = labelOverride ?? label;
        dup = dup || kind == Kind.Duplicate; // a duplicate-charge scenario always has the duplicate payment

        bool activated = activatedOverride ?? (kind != Kind.CancelPreActivation);
        string status = statusOverride ?? (kind == Kind.CancelPreActivation ? "Pending" : kind == Kind.Locked ? "Active" : "Active");
        var purchase = Today.AddDays(-daysAgo);
        string method = Methods[methodIdx % Methods.Length];

        var subs = new List<SubscriptionRecord>
        {
            new() { SubscriptionId = subId, Name = subName,
                    Status = kind == Kind.CancelPreActivation ? "Pending" : "Active",
                    UsagePercent = usage, PurchaseDate = purchase, ExpiryDate = purchase.AddDays(365),
                    AmountPaid = amount, IsActivated = activated, AutoRenew = (userId % 2 == 0) }
        };
        var pays = new List<PaymentRecord>
        {
            new() { PaymentId = $"PAY-{subId}", Date = purchase, Amount = amount, Method = method,
                    Status = "Succeeded", Description = subName }
        };
        if (dup)
            pays.Add(new PaymentRecord { PaymentId = $"PAY-{subId}D", Date = purchase, Amount = amount,
                Method = method, Status = "Succeeded", Description = subName + " (duplicate)", IsDuplicate = true });
        if (extra is { } ex)
        {
            var exPurchase = Today.AddDays(-ex.DaysAgo);
            subs.Add(new SubscriptionRecord { SubscriptionId = ex.Id, Name = ex.Name, Status = ex.Status,
                UsagePercent = ex.Usage, PurchaseDate = exPurchase, ExpiryDate = exPurchase.AddDays(365),
                AmountPaid = ex.Amount, IsActivated = true, AutoRenew = false });
            pays.Add(new PaymentRecord { PaymentId = $"PAY-{ex.Id}", Date = exPurchase, Amount = ex.Amount,
                Method = method, Status = "Succeeded", Description = ex.Name });
        }

        var full = new Customer360
        {
            User = new UserAccount
            {
                UserId = userId, Email = email, FullName = name, Phone = phone, Country = country,
                AccountStatus = kind == Kind.Locked ? "Locked" : "Active",
                MemberSince = Today.AddDays(-memberDays), FailedLoginAttempts = failed
            },
            Subscriptions = subs,
            Payments = pays
        };

        var profile = new CustomerProfile
        {
            UserId = userId, Email = email, FullName = name, SubscriptionName = subName, SubscriptionStatus = status,
            UsagePercent = usage, PurchaseDate = purchase, RefundWindowDays = 14,
            IsActivated = activated, FailedLoginAttempts = failed, HasDuplicateCharge = dup, AmountPaid = amount
        };

        return new DemoCustomer { Full = full, Profile = profile, Subject = subj, Description = desc, Label = label };
    }
}
