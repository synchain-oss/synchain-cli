import prompts from "prompts";

/** Prompts for a password with no echo. Returns "" if the user aborts. */
export async function promptPassword(label: string): Promise<string> {
  const response = await prompts(
    { type: "password", name: "value", message: label },
    {
      onCancel: () => {
        // Don't throw — let the caller decide. Returning empty signals cancel.
      },
    }
  );
  return typeof response.value === "string" ? response.value : "";
}

/** Prompts for a yes/no confirmation. Default false. */
export async function promptConfirm(label: string, initial = false): Promise<boolean> {
  const response = await prompts({ type: "confirm", name: "value", message: label, initial });
  return Boolean(response.value);
}

/** Prompts for a plain text value. Returns "" if the user aborts. */
export async function promptText(label: string, opts: { initial?: string } = {}): Promise<string> {
  const response = await prompts({
    type: "text",
    name: "value",
    message: label,
    initial: opts.initial,
  });
  return typeof response.value === "string" ? response.value : "";
}
