using Microsoft.Data.SqlClient;
using UWorldFreshdeskCopilot.Models;

namespace UWorldFreshdeskCopilot.Services;

public interface IUWorldDataService
{
    Task<CustomerProfile?> GetCustomerByEmailAsync(string email);
}

public class MockUWorldDataService : IUWorldDataService
{
    public Task<CustomerProfile?> GetCustomerByEmailAsync(string email)
    {
        var profile = SampleDataStore.Get(email)?.Profile
            ?? new CustomerProfile
            {
                Email = email, FullName = "Unknown Customer", SubscriptionName = "N/A",
                SubscriptionStatus = "Unknown", UsagePercent = 0, PurchaseDate = SampleDataStore.Today,
                RefundWindowDays = 14, IsActivated = false
            };
        return Task.FromResult<CustomerProfile?>(profile);
    }
}

// Real DB implementation — swap in by setting UWorldDb:UseMockData = false.
// Uses raw ADO.NET with a parameterized query (no EF/Dapper), matching UWorld's style.
public class SqlUWorldDataService : IUWorldDataService
{
    private readonly string _connectionString;

    public SqlUWorldDataService(IConfiguration config)
    {
        _connectionString = config["UWorldDb:ConnectionString"]
            ?? throw new InvalidOperationException("UWorldDb:ConnectionString not configured.");
    }

    public async Task<CustomerProfile?> GetCustomerByEmailAsync(string email)
    {
        const string sql = @"
            SELECT TOP 1
                c.Email, c.FullName, s.SubscriptionName, s.Status,
                s.UsagePercent, s.PurchaseDate, s.RefundWindowDays,
                s.IsActivated, c.FailedLoginAttempts, s.HasDuplicateCharge, s.AmountPaid
            FROM Customers c
            INNER JOIN Subscriptions s ON s.CustomerId = c.Id
            WHERE c.Email = @Email
            ORDER BY s.PurchaseDate DESC;";

        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync();
        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@Email", email);

        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
            return null;

        return new CustomerProfile
        {
            Email = reader.GetString(0),
            FullName = reader.GetString(1),
            SubscriptionName = reader.GetString(2),
            SubscriptionStatus = reader.GetString(3),
            UsagePercent = reader.GetInt32(4),
            PurchaseDate = DateOnly.FromDateTime(reader.GetDateTime(5)),
            RefundWindowDays = reader.GetInt32(6),
            IsActivated = reader.GetBoolean(7),
            FailedLoginAttempts = reader.GetInt32(8),
            HasDuplicateCharge = reader.GetBoolean(9),
            AmountPaid = reader.GetDecimal(10)
        };
    }
}
