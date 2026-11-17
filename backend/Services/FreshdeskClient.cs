using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace UWorldFreshdeskCopilot.Services;

public class FreshdeskClient
{
    private readonly HttpClient _http;
    private readonly ILogger<FreshdeskClient> _logger;
    private readonly int _resolvedStatus;
    private readonly int _openStatus;

    public FreshdeskClient(HttpClient http, IConfiguration config, ILogger<FreshdeskClient> logger)
    {
        _logger = logger;
        var domain = config["Freshdesk:Domain"] ?? "";
        var apiKey = config["Freshdesk:ApiKey"] ?? "";
        _resolvedStatus = config.GetValue("Freshdesk:ResolvedStatus", 4);
        _openStatus = config.GetValue("Freshdesk:OpenStatus", 2);

        _http = http;
        _http.BaseAddress = new Uri($"https://{domain}/api/v2/");
        // Freshdesk basic auth: apiKey as username, any password (we use 'X').
        var token = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{apiKey}:X"));
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", token);
    }

    public async Task<bool> ReplyToTicketAsync(long ticketId, string bodyHtml)
    {
        var payload = JsonContent(new { body = bodyHtml });
        var resp = await _http.PostAsync($"tickets/{ticketId}/reply", payload);
        await LogIfFailed(resp, $"reply to ticket {ticketId}");
        return resp.IsSuccessStatusCode;
    }

    public async Task<bool> AddPrivateNoteAsync(long ticketId, string bodyHtml)
    {
        var payload = JsonContent(new { body = bodyHtml, @private = true });
        var resp = await _http.PostAsync($"tickets/{ticketId}/notes", payload);
        await LogIfFailed(resp, $"note on ticket {ticketId}");
        return resp.IsSuccessStatusCode;
    }

    public async Task<bool> SetStatusAsync(long ticketId, bool resolved)
    {
        var payload = JsonContent(new { status = resolved ? _resolvedStatus : _openStatus });
        var resp = await _http.PutAsync($"tickets/{ticketId}", payload);
        await LogIfFailed(resp, $"status update on ticket {ticketId}");
        return resp.IsSuccessStatusCode;
    }

    private static StringContent JsonContent(object o) =>
        new(JsonSerializer.Serialize(o), Encoding.UTF8, "application/json");

    private async Task LogIfFailed(HttpResponseMessage resp, string what)
    {
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync();
            _logger.LogError("Freshdesk {What} failed: {Status} {Body}", what, resp.StatusCode, body);
        }
    }
}
