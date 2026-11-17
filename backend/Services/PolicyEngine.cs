using UWorldFreshdeskCopilot.Models;

namespace UWorldFreshdeskCopilot.Services;

public class PolicyContext
{
    public required string Intent { get; init; }
    public required double IntentConfidence { get; init; }
    public required CustomerProfile Customer { get; init; }
    public required PolicyOptions Options { get; init; }
    public DateOnly Today { get; init; } = new(2026, 11, 17);
}

public class PolicyOptions
{
    public int RefundUsageDenyThresholdPercent { get; set; } = 50;
    public int RefundWindowDays { get; set; } = 14;
    public int RefundBorderlineLowerPercent { get; set; } = 20;
    public double AutoSendConfidenceThreshold { get; set; } = 0.9;
    public int AccountLockAttemptsThreshold { get; set; } = 5;

    // Only these request types are answered automatically; every other decision
    // (refunds, cancellations, duplicate charges, email changes...) goes to an agent
    // as a recommendation with a drafted reply.
    public string[] AutoHandleIntents { get; set; } = { "password_reset", "account_locked" };
}

// A single, self-contained policy rule. New rules just implement this and get
// picked up automatically via DI — no change to the engine.
public interface IPolicyRule
{
    string Name { get; }
    bool Matches(PolicyContext ctx);
    Decision Evaluate(PolicyContext ctx);
}

public class PolicyEngine
{
    private readonly IReadOnlyList<IPolicyRule> _rules;
    private readonly ILogger<PolicyEngine> _logger;

    public PolicyEngine(IEnumerable<IPolicyRule> rules, ILogger<PolicyEngine> logger)
    {
        _rules = rules.ToList();
        _logger = logger;
    }

    public Decision Decide(PolicyContext ctx)
    {
        foreach (var rule in _rules)
        {
            if (!rule.Matches(ctx)) continue;

            var decision = rule.Evaluate(ctx);
            decision.RuleName = rule.Name;

            // Safety: never auto-send if intent confidence is below the gate.
            if (decision.IsAutoSend && ctx.IntentConfidence < ctx.Options.AutoSendConfidenceThreshold)
            {
                _logger.LogInformation(
                    "Rule {Rule} wanted {Action} but intent confidence {Conf} < gate {Gate}; downgrading to AgentReview.",
                    rule.Name, decision.Action, ctx.IntentConfidence, ctx.Options.AutoSendConfidenceThreshold);
                decision.Action = PolicyAction.AgentReview;
                decision.Reason = $"Low intent confidence ({ctx.IntentConfidence:P0}) — routed to agent. " + decision.Reason;
            }

            // Policy: only the configured request types are sent automatically.
            if (decision.IsAutoSend && !ctx.Options.AutoHandleIntents.Contains(ctx.Intent))
                decision = ToRecommendation(decision);

            _logger.LogInformation("Rule {Rule} -> {Action} ({Conf:P0})", rule.Name, decision.Action, decision.Confidence);
            return decision;
        }

        return PolicyDecisions.AgentReview(
            "no_rule_matched",
            "No automated rule matched this ticket. Review the customer details and resolve manually.",
            new[]
            {
                "Read the customer's message and confirm the request type.",
                "Check the customer profile panel for subscription and usage details.",
                "Respond or escalate per standard UWorld support process."
            });
    }

    // Keep the rule's verdict, confidence and drafted email, but let an agent send it.
    private static Decision ToRecommendation(Decision d)
    {
        string verdict = d.Action switch
        {
            PolicyAction.AutoApprove => "approve",
            PolicyAction.AutoDeny => "deny",
            _ => "resolve"
        };
        return new Decision
        {
            Action = PolicyAction.AgentReview,
            Confidence = d.Confidence,
            RuleName = d.RuleName,
            Reason = $"Recommended: {verdict}. " + d.Reason
                .Replace("auto-approved", "eligible for approval")
                .Replace("auto-refunded", "eligible for refund")
                .Replace("auto-denied", "not eligible"),
            CustomerEmailHtml = d.CustomerEmailHtml,
            SuggestedSteps = PolicyDecisions.Steps(
                $"Check the recommendation ({verdict}) against the customer's record.",
                "If you agree, insert the drafted reply, send it and complete the action in UWorld.",
                "If an exception applies, edit the reply before sending.")
        };
    }
}
