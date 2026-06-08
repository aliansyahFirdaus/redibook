export default class MockImpactProvider {
  id() {
    return "redibook:mock-impact";
  }

  async callApi(prompt) {
    const lower = prompt.toLowerCase();
    let output;
    if (lower.includes("five") && lower.includes("login")) {
      output = {
        summary: "Login lockout changes from the documented attempt policy to five failures.",
        affectedKnowledge: ["Authentication / Lockout"],
        possibleConflicts: ["Existing guidance uses a different failure threshold."],
        missingQuestions: ["How is an account unlocked?"],
        suggestedTests: ["Verify the fifth failed login locks the account."],
        evidence: ["auth-lockout"],
      };
    } else if (lower.includes("certificate")) {
      output = {
        summary: "Certificate completion becomes deferred until required review is complete.",
        affectedKnowledge: ["Learning / Completion"],
        possibleConflicts: ["Current completion is immediate."],
        missingQuestions: ["What event releases the certificate?"],
        suggestedTests: ["Verify certificates remain pending before review."],
        evidence: ["certificate-completion"],
      };
    } else {
      output = {
        summary: "Salary adjustments change from fixed amounts to percentages.",
        affectedKnowledge: ["Compensation / Adjustments"],
        possibleConflicts: ["Rounding and historical calculations may differ."],
        missingQuestions: ["Which salary base and rounding rule apply?"],
        suggestedTests: ["Verify percentage changes for positive and negative adjustments."],
        evidence: ["salary-adjustment"],
      };
    }
    return { output: JSON.stringify(output) };
  }
}
