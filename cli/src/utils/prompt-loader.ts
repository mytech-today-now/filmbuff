/**
 * Prompt Loader Utility
 *
 * Loads step-specific AI prompt templates from cli/src/prompts/*.txt and
 * performs {{variable}} placeholder substitution.
 *
 * Prompt files live at:  cli/src/prompts/<step-name>.txt
 * At runtime (compiled): dist/prompts/<step-name>.txt
 *
 * Satisfies: bd-pf-a1 - Implement prompt-loader.ts utility
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute path to the directory containing pipeline step prompt files. */
export const PROMPTS_DIR: string = path.join(__dirname, '..', 'prompts');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptVariables {
  [key: string]: string | number | boolean | null | undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a prompt template for a pipeline step and substitute {{variable}}
 * placeholders with the supplied values.
 *
 * @param stepName  Pipeline step name, e.g. 'logline' or 'beat-sheet'.
 * @param variables Key/value map whose keys match {{...}} tokens in the file.
 * @returns         Prompt text with all known placeholders substituted.
 * @throws          Error if the prompt file does not exist for the step.
 */
export function loadPrompt(
  stepName: string,
  variables: PromptVariables = {},
): string {
  const promptPath = path.join(PROMPTS_DIR, `${stepName}.txt`);

  if (!fs.existsSync(promptPath)) {
    throw new Error(
      `Prompt file not found for step "${stepName}": ${promptPath}`,
    );
  }

  let content = fs.readFileSync(promptPath, 'utf-8');

  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined && value !== null) {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      content = content.replace(placeholder, String(value));
    }
  }

  return content;
}

/**
 * Return true when a prompt file exists for the given step name.
 * Use this to gracefully skip missing prompts rather than throwing.
 */
export function promptExists(stepName: string): boolean {
  return fs.existsSync(path.join(PROMPTS_DIR, `${stepName}.txt`));
}

