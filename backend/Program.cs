using UWorldFreshdeskCopilot.Models;
using UWorldFreshdeskCopilot.Services;
using UWorldFreshdeskCopilot.Services.Rules;

var builder = WebApplication.CreateBuilder(args);

// ── Options ──────────────────────────────────────────────────────────────────
builder.Services.Configure<PolicyOptions>(builder.Configuration.GetSection("Policy"));
var policyOptions = builder.Configuration.GetSection("Policy").Get<PolicyOptions>() ?? new PolicyOptions();
builder.Services.AddSingleton(policyOptions);

// ── Core services ────────────────────────────────────────────────────────────
builder.Services.AddSingleton<IntentDetector>();
builder.Services.AddSingleton<TempPasswordService>();
builder.Services.AddScoped<PolicyEngine>();
builder.Services.AddHttpClient<FreshdeskClient>();

// UWorld data source: mock for demo, real SQL when UWorldDb:UseMockData = false.
if (builder.Configuration.GetValue("UWorldDb:UseMockData", true))
{
    builder.Services.AddSingleton<IUWorldDataService, MockUWorldDataService>();
    builder.Services.AddSingleton<IUWorld360DataService, Mock360DataService>();
}
else
{
    builder.Services.AddSingleton<IUWorldDataService, SqlUWorldDataService>();
    builder.Services.AddSingleton<IUWorld360DataService, Sql360DataService>();
}

// ── Rule catalog (ORDER MATTERS — first match wins; safety rule first) ────────
builder.Services.AddScoped<IPolicyRule, BillingDisputeRule>();
builder.Services.AddScoped<IPolicyRule, PasswordResetRule>();
builder.Services.AddScoped<IPolicyRule, AccountLockedRule>();
builder.Services.AddScoped<IPolicyRule, DuplicateChargeRule>();
builder.Services.AddScoped<IPolicyRule, CancellationBeforeActivationRule>();
builder.Services.AddScoped<IPolicyRule, RefundDenyRule>();
builder.Services.AddScoped<IPolicyRule, RefundApproveRule>();
builder.Services.AddScoped<IPolicyRule, RefundBorderlineRule>();
builder.Services.AddScoped<IPolicyRule, AccessIssueRule>();
builder.Services.AddScoped<IPolicyRule, ExtendSubscriptionRule>();

// ── CORS ─────────────────────────────────────────────────────────────────────
// FDK apps run inside an iframe on Freshworks-owned domains that vary, so for the
// demo we allow any origin (no credentials are used). Tighten for production.
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseCors();
app.UseStaticFiles();
app.MapGet("/", () => Results.Redirect("/demo.html"));

// ── Helper: run the full pipeline for a ticket ───────────────────────────────
async Task<(IntentResult intent, CustomerProfile customer, Decision decision)> Analyze(
    string? subject, string? description, string email,
    IntentDetector detector, IUWorldDataService data, PolicyEngine engine, PolicyOptions opts)
{
    var intent = detector.Detect(subject, description);
    var customer = await data.GetCustomerByEmailAsync(email) ?? new CustomerProfile { Email = email, FullName = "Customer" };
    var ctx = new PolicyContext
    {
        Intent = intent.Intent,
        IntentConfidence = intent.Confidence,
        Customer = customer,
        Options = opts
    };
    return (intent, customer, engine.Decide(ctx));
}

// ── Endpoints ────────────────────────────────────────────────────────────────

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "uworld-copilot" }));

// Dry-run: shows exactly what WOULD be sent for a ticket, without calling Freshservice.
app.MapGet("/api/preview", async (
    string email, long? ticketId, string? subject, string? description,
    IntentDetector detector, IUWorldDataService data, PolicyEngine engine, PolicyOptions opts) =>
{
    if (string.IsNullOrWhiteSpace(email))
        return Results.BadRequest(new { error = "email is required" });

    var (intent, customer, decision) = await Analyze(subject, description, email, detector, data, engine, opts);

    string note = decision.IsAutoSend
        ? $"<b>copilot-auto-sent</b> — rule: {decision.RuleName} · action: {decision.Action} · " +
          $"confidence: {decision.Confidence:P0}<br/>Reason: {decision.Reason}"
        : $"<b>copilot-suggests</b> — {decision.Reason}<br/>Open the UWorld Copilot panel for suggested steps.";

    return Results.Ok(new
    {
        wouldAutoSend = decision.IsAutoSend,
        action = decision.Action.ToString(),
        rule = decision.RuleName,
        confidence = decision.Confidence,
        reason = decision.Reason,
        customerEmailHtml = decision.CustomerEmailHtml,
        privateNoteHtml = note,
        wouldSetStatus = decision.IsAutoSend ? "Resolved" : "unchanged"
    });
});

// Called by a Freshservice automation/webhook on ticket creation.
app.MapPost("/webhook/ticket", async (
    FreshdeskWebhookPayload payload,
    IntentDetector detector, IUWorldDataService data, PolicyEngine engine,
    PolicyOptions opts, FreshdeskClient freshdesk, ILogger<Program> log) =>
{
    if (string.IsNullOrWhiteSpace(payload.Email) || payload.TicketId <= 0)
        return Results.BadRequest(new { error = "ticketId and email are required" });

    var (intent, customer, decision) = await Analyze(
        payload.Subject, payload.Description, payload.Email, detector, data, engine, opts);

    log.LogInformation("Ticket {Id}: intent={Intent} action={Action}", payload.TicketId, intent.Intent, decision.Action);

    if (decision.IsAutoSend && decision.CustomerEmailHtml is not null)
    {
        var sent = await freshdesk.ReplyToTicketAsync(payload.TicketId, decision.CustomerEmailHtml);
        await freshdesk.AddPrivateNoteAsync(payload.TicketId,
            $"<b>copilot-auto-sent</b> — rule: {decision.RuleName} · action: {decision.Action} · " +
            $"confidence: {decision.Confidence:P0}<br/>Reason: {decision.Reason}");
        if (sent)
            await freshdesk.SetStatusAsync(payload.TicketId, resolved: true);

        return Results.Ok(new { handled = true, action = decision.Action.ToString(), decision.RuleName, decision.Reason, emailSent = sent });
    }

    // Low confidence / discretionary -> leave for the agent; sidebar will show details.
    await freshdesk.AddPrivateNoteAsync(payload.TicketId,
        $"<b>copilot-suggests</b> — {decision.Reason}<br/>Open the UWorld Copilot panel for suggested steps.");

    return Results.Ok(new { handled = false, action = decision.Action.ToString(), decision.RuleName, decision.Reason });
});

// Called by the Freshservice sidebar app to render customer data + suggested steps.
app.MapGet("/api/insights", async (
    string email, long? ticketId, string? subject, string? description,
    IntentDetector detector, IUWorldDataService data, PolicyEngine engine, PolicyOptions opts) =>
{
    if (string.IsNullOrWhiteSpace(email))
        return Results.BadRequest(new { error = "email is required" });

    var (intent, customer, decision) = await Analyze(subject, description, email, detector, data, engine, opts);

    // For auto decisions the email is ready; for agent-review, draft one from the steps.
    string replyHtml = decision.CustomerEmailHtml ?? EmailTemplates.Wrap(customer.FullName,
        "<p>Thank you for contacting UWorld Support regarding your request.</p>" +
        (decision.SuggestedSteps.Count > 0
            ? "<p>Here's an update on your case:</p><ul>" +
              string.Join("", decision.SuggestedSteps.Select(s => $"<li>{s.Text}</li>")) + "</ul>"
            : ""));

    var insights = new TicketInsights
    {
        Customer = customer,
        Intent = intent.Intent,
        RecommendedAction = decision.Action,
        Confidence = decision.Confidence,
        Reason = decision.Reason,
        SuggestedSteps = decision.SuggestedSteps,
        WasAutoHandled = decision.IsAutoSend,
        SuggestedReplyHtml = replyHtml
    };
    return Results.Ok(insights);
});

// ── Agent actions from the sidebar (reply / note / resolve) ──────────────────
// The browser app never holds the API key; it calls these, and the backend posts
// to Freshservice using the stored key.

app.MapPost("/api/ticket/{id:long}/reply", async (long id, TicketActionBody body, FreshdeskClient fd) =>
{
    if (string.IsNullOrWhiteSpace(body.Html))
        return Results.BadRequest(new { error = "html is required" });
    var ok = await fd.ReplyToTicketAsync(id, body.Html);
    if (ok && body.Resolve) await fd.SetStatusAsync(id, resolved: true);
    return ok ? Results.Ok(new { sent = true, resolved = body.Resolve })
              : Results.StatusCode(502);
});

app.MapPost("/api/ticket/{id:long}/note", async (long id, TicketActionBody body, FreshdeskClient fd) =>
{
    if (string.IsNullOrWhiteSpace(body.Html))
        return Results.BadRequest(new { error = "html is required" });
    var ok = await fd.AddPrivateNoteAsync(id, body.Html);
    return ok ? Results.Ok(new { added = true }) : Results.StatusCode(502);
});

app.MapPost("/api/ticket/{id:long}/resolve", async (long id, FreshdeskClient fd) =>
{
    var ok = await fd.SetStatusAsync(id, resolved: true);
    return ok ? Results.Ok(new { resolved = true }) : Results.StatusCode(502);
});

// Customer 360 module: full user + subscriptions + payments data.
app.MapGet("/api/customer/360", async (string email, IUWorld360DataService data) =>
{
    if (string.IsNullOrWhiteSpace(email))
        return Results.BadRequest(new { error = "email is required" });

    var c = await data.GetCustomer360Async(email);
    return c is null ? Results.NotFound(new { error = "customer not found" }) : Results.Ok(c);
});

// Sample catalog: searchable, paginated list of demo users with their 360 data +
// the expected copilot decision. Makes it easy to validate suggestions live.
app.MapGet("/api/samples", (
    string? q, int? page, int? pageSize,
    IntentDetector detector, IUWorldDataService data, PolicyEngine engine, PolicyOptions opts) =>
{
    var term = (q ?? "").Trim().ToLowerInvariant();
    IEnumerable<DemoCustomer> matches = SampleDataStore.All;
    if (term.Length > 0)
        matches = matches.Where(c =>
            c.Email.ToLowerInvariant().Contains(term) ||
            c.Full.User!.FullName.ToLowerInvariant().Contains(term) ||
            c.Full.User!.UserId.ToString().Contains(term));

    var all = matches.ToList();
    int size = Math.Clamp(pageSize ?? 24, 1, 100);
    int pageNum = Math.Max(page ?? 1, 1);
    int total = all.Count;
    var pageItems = all.Skip((pageNum - 1) * size).Take(size);

    var items = pageItems.Select(c =>
    {
        var intent = detector.Detect(c.Subject, c.Description);
        var ctx = new PolicyContext { Intent = intent.Intent, IntentConfidence = intent.Confidence, Customer = c.Profile, Options = opts };
        var decision = engine.Decide(ctx);
        return new
        {
            label = c.Label,
            demoText = c.Description,
            user = c.Full.User,
            subscriptions = c.Full.Subscriptions,
            payments = c.Full.Payments,
            totalPaid = c.Full.TotalPaid,
            activeSubscriptions = c.Full.ActiveSubscriptions,
            intent = intent.Intent,
            expectedAction = decision.Action.ToString(),
            autoSend = decision.IsAutoSend,
            confidence = decision.Confidence,
            reason = decision.Reason,
            rule = decision.RuleName
        };
    }).ToList();

    return Results.Ok(new { total, page = pageNum, pageSize = size, totalPages = (int)Math.Ceiling(total / (double)size), items });
});

app.Run();
