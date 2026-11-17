using Microsoft.Data.SqlClient;
using UWorldFreshdeskCopilot.Models;

namespace UWorldFreshdeskCopilot.Services;

public interface IUWorld360DataService
{
    Task<Customer360?> GetCustomer360Async(string email);
}

public class Mock360DataService : IUWorld360DataService
{
    public Task<Customer360?> GetCustomer360Async(string email)
    {
        var full = SampleDataStore.Get(email)?.Full
            ?? new Customer360
            {
                User = new UserAccount
                {
                    UserId = 0, Email = email, FullName = "Unknown Customer",
                    Country = "—", AccountStatus = "Unknown", MemberSince = SampleDataStore.Today
                }
            };
        return Task.FromResult<Customer360?>(full);
    }
}

// Real DB implementation stub — swap in by setting UWorldDb:UseMockData = false.
// Runs three parameterized ADO.NET queries (user, subscriptions, payments).
public class Sql360DataService : IUWorld360DataService
{
    private readonly string _connectionString;

    public Sql360DataService(IConfiguration config)
    {
        _connectionString = config["UWorldDb:ConnectionString"]
            ?? throw new InvalidOperationException("UWorldDb:ConnectionString not configured.");
    }

    public async Task<Customer360?> GetCustomer360Async(string email)
    {
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync();

        var result = new Customer360();

        const string userSql = @"
            SELECT TOP 1 Id, Email, FullName, Phone, Country, AccountStatus, MemberSince, FailedLoginAttempts
            FROM Customers WHERE Email = @Email;";
        await using (var cmd = new SqlCommand(userSql, conn))
        {
            cmd.Parameters.AddWithValue("@Email", email);
            await using var r = await cmd.ExecuteReaderAsync();
            if (!await r.ReadAsync()) return null;
            result.User = new UserAccount
            {
                UserId = r.GetInt64(0), Email = r.GetString(1), FullName = r.GetString(2),
                Phone = r.IsDBNull(3) ? "" : r.GetString(3), Country = r.IsDBNull(4) ? "" : r.GetString(4),
                AccountStatus = r.GetString(5), MemberSince = DateOnly.FromDateTime(r.GetDateTime(6)),
                FailedLoginAttempts = r.GetInt32(7)
            };
        }

        const string subSql = @"
            SELECT s.Id, s.SubscriptionName, s.Status, s.UsagePercent, s.PurchaseDate, s.ExpiryDate,
                   s.AmountPaid, s.IsActivated, s.AutoRenew
            FROM Subscriptions s INNER JOIN Customers c ON c.Id = s.CustomerId
            WHERE c.Email = @Email ORDER BY s.PurchaseDate DESC;";
        await using (var cmd = new SqlCommand(subSql, conn))
        {
            cmd.Parameters.AddWithValue("@Email", email);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                result.Subscriptions.Add(new SubscriptionRecord
                {
                    SubscriptionId = r.GetInt64(0), Name = r.GetString(1), Status = r.GetString(2),
                    UsagePercent = r.GetInt32(3), PurchaseDate = DateOnly.FromDateTime(r.GetDateTime(4)),
                    ExpiryDate = DateOnly.FromDateTime(r.GetDateTime(5)), AmountPaid = r.GetDecimal(6),
                    IsActivated = r.GetBoolean(7), AutoRenew = r.GetBoolean(8)
                });
        }

        const string paySql = @"
            SELECT p.PaymentRef, p.PaidOn, p.Amount, p.Currency, p.Method, p.Status, p.Description, p.IsDuplicate
            FROM Payments p INNER JOIN Customers c ON c.Id = p.CustomerId
            WHERE c.Email = @Email ORDER BY p.PaidOn DESC;";
        await using (var cmd = new SqlCommand(paySql, conn))
        {
            cmd.Parameters.AddWithValue("@Email", email);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                result.Payments.Add(new PaymentRecord
                {
                    PaymentId = r.GetString(0), Date = DateOnly.FromDateTime(r.GetDateTime(1)),
                    Amount = r.GetDecimal(2), Currency = r.GetString(3), Method = r.GetString(4),
                    Status = r.GetString(5), Description = r.IsDBNull(6) ? "" : r.GetString(6),
                    IsDuplicate = r.GetBoolean(7)
                });
        }

        return result;
    }
}
