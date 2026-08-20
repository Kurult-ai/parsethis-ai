/**
 * Interpolate {{variables}} in a prompt template.
 * {{input}} is replaced with the test case input; other keys come from the variables map.
 */
export function interpolatePrompt(
  template: string,
  variables: Record<string, string> | undefined,
  input: string
): string {
  let result = template;
  // Replace {{input}} with the test case input
  result = result.replace(/\{\{input\}\}/g, input);
  // Replace other variables
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
  }
  return result;
}
