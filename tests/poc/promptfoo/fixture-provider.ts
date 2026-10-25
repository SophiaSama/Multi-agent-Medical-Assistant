/**
 * Custom Fixture Provider for Promptfoo.
 * Returns the frozen MedicalAdvice response from the test case vars,
 * allowing Promptfoo assertions to grade identical responses without
 * calling the upstream consultation pipeline.
 */
export default class FixtureProvider {
  id(): string {
    return "medical-fixture-provider";
  }

  async callApi(prompt: string, context?: { vars?: Record<string, any> }): Promise<{ output: string }> {
    const rawResponse = context?.vars?.response;
    const output = typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse, null, 2);
    return { output };
  }
}
